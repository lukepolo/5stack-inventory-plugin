/**
 * What a shared link is ABOUT — the words and the picture a crawler gets for it.
 *
 * src/routes.ts opens with the reason every screen in this plugin is a URL: "the
 * P90 renders white" is unreproducible without the exact item, wear and seed,
 * and a screenshot doesn't carry them but a pasteable URL does. The inverse is
 * what this module exists for. A crawler cannot run the SPA, so the URL that
 * carries all that state unfurls in Discord as a bare link with no picture at
 * all — the render is the product, and it could not leave the page.
 *
 * This is the vocabulary layer: plugin path + query in, "which item is this,
 * what is it called, what does the card say" out. Deliberately free of Postgres
 * and the filesystem — main.ts owns both, and keeping them out is what lets the
 * three share routes (image, meta, unfurl) agree on the answer by construction
 * rather than by three handlers re-deriving it.
 */
import { getItem, wearTierOf } from "./catalog.ts";

/**
 * The one thing a shared link can be about.
 *
 * KEEP IN STEP WITH parsePath in src/routes.ts. Not shared code: that module is
 * the client's router and imports Vue-side constants, and a backend copy of the
 * two patterns it needs is cheaper than a shared package. The two only have to
 * agree on which paths exist — a path this misreads degrades to the app card,
 * never to a wrong item, because every branch below re-derives the item from
 * the id in the path rather than from anything the caller asserts.
 */
export type ShareTarget =
  /** A public loadout: `?player=<steam64>` on the loadout or focus screen. */
  | { kind: "player"; steamId: string; team: "CT" | "T" | null }
  /** One owned row: `/items/<id>` and its craft/3d modals. */
  | { kind: "instance"; instanceId: number }
  /** A craft in progress: `/craft/<skinId>` with the draft packed into the query. */
  | { kind: "draft"; skinId: number; wear: number | null; seed: number | null; stattrak: boolean; nametag: string }
  /** Anything else — a screen, not a thing. */
  | { kind: "app" };

const num = (raw: string | undefined): number | null => {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export function parseShareTarget(rawPath: string, query: Record<string, string | undefined>): ShareTarget {
  const path = `/${(rawPath || "/").trim()}`.replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");

  // The DRAFT route first, and the path before the query, because a link copied
  // while viewing someone else's loadout carries their `?player=` along with it
  // (App.vue's viewQuery keeps foreign keys). Reading `player` first would show
  // that stranger's gun on a link that is plainly about a craft.
  const draft = /^\/craft\/(\d+)$/.exec(path);
  if (draft && Number.isSafeInteger(Number(draft[1]))) {
    const wear = num(query.wear);
    const seed = num(query.seed);
    return {
      kind: "draft",
      skinId: Number(draft[1]),
      // Clamped exactly as decodeDraft clamps them. A mangled link must not put
      // a nonsense float in a card that gets cached by every chat client that
      // ever saw it.
      wear: wear === null ? null : Math.min(1, Math.max(0, wear)),
      seed: seed === null ? null : Math.min(100000, Math.max(0, Math.round(seed))),
      stattrak: query.st === "1",
      nametag: (query.name ?? "").slice(0, 20),
    };
  }

  const item = /^\/items\/([^/]+)(?:\/[^/]+)?$/.exec(path);
  if (item) {
    // SAFE integer, not merely an integer: an id past 2^53 survives Number() as
    // something like 1e+30, and node-postgres stringifies it straight into a
    // bigint comparison, where it is a syntax error rather than a miss. A
    // nonsense id has to degrade to the app card, not to a 500.
    const id = Number(decodeURIComponent(item[1]));
    if (Number.isSafeInteger(id) && id > 0) return { kind: "instance", instanceId: id };
  }

  // `player` is the shareable loadout link and the profile tab's own flag (see
  // the README): the same 17-digit steam64 in both, which is why one branch
  // covers both entry points.
  const player = query.player;
  if (player && /^\d{17}$/.test(player)) {
    const team = query.team === "CT" || query.team === "T" ? query.team : null;
    return { kind: "player", steamId: player, team };
  }
  return { kind: "app" };
}

/** The scalars a card is written from, however the row was found. */
export interface ItemFacts {
  itemId: number;
  wear: number | null;
  seed: number | null;
  stattrak: boolean;
  nametag: string | null;
}

/**
 * "StatTrak™ AK-47 | Redline (Field-Tested)" — Steam's own name shape.
 *
 * Written to Steam's convention rather than the app's own header layout because
 * this string is read outside the app entirely: in a Discord embed it sits next
 * to links from the market and from every other skin site, and a name that
 * matches theirs is a name people can search. `altName` (the Doppler phase)
 * rides after the finish for the same reason — "Karambit | Doppler Ruby" is what
 * a market listing calls it, and without it four wildly different knives share
 * one title.
 */
export function itemTitle(facts: ItemFacts): string | null {
  const item = getItem(facts.itemId);
  if (!item) return null;
  // Every capability is read PER ITEM, never from the type — the same trap the
  // craft editor hit: an unpainted Desert Eagle is `type: "weapon"` and can hold
  // none of the three. A share card is worse than a form here, because a link is
  // hand-editable: `?st=1` on a Service Medal must not mint a "StatTrak™" title
  // for an item the economy says can never be one.
  const st = facts.stattrak && item.hasStatTrak ? "StatTrak™ " : "";
  const alt = item.altName ? ` ${item.altName}` : "";
  // `hasWear`, not itemStoresWear: a STICKER stores a value in the wear column
  // too, but that is its scratch, and scratch has no Steam wear bracket at all.
  // Titling one "(Field-Tested)" would invent a market name that does not exist.
  const tier = item.hasWear ? wearTierOf(facts.wear) : null;
  return `${st}${item.name}${alt}${tier ? ` (${tier})` : ""}`;
}

/**
 * The line under the title: the numbers that make this ONE of the item.
 *
 * Every part is conditional on the catalog saying this item can hold it. That
 * guard exists because a Service Medal has no float and a Music Kit has no
 * pattern, and writing the craft form's neutral wear 0 into those rows is the
 * bug dropImpossibleScalars now cleans up on every boot — a 0 float is not "no
 * float", it reads as Factory New to anything that renders it. Printing it in a
 * card that a chat client caches is the same mistake, in public.
 */
export function itemDescription(facts: ItemFacts): string {
  const item = getItem(facts.itemId);
  if (!item) return "";
  const parts: string[] = [];
  if (facts.wear != null) {
    // The one column with two meanings: a weapon's float and a sticker's
    // scratch. Named for what it is in each case rather than labelling both
    // "Float", which is the reading that makes a pristine sticker look
    // Factory New.
    if (item.hasWear) parts.push(`Float ${Number(facts.wear).toFixed(4)}`);
    else if (item.type === "sticker") parts.push(`Scratch ${Number(facts.wear).toFixed(2)}`);
  }
  if (item.hasSeed && facts.seed != null) parts.push(`Pattern ${Number(facts.seed)}`);
  const tag = (facts.nametag ?? "").trim();
  if (tag && item.hasNameTag) parts.push(`“${tag}”`);
  return parts.join(" · ");
}

/**
 * Public origin of the request that arrived — the only thing that can name it.
 *
 * The backend genuinely cannot know its own public URL: the plugin is federated
 * into the panel and its domain is set per install (INVENTORY_DOMAIN), so an
 * absolute og:image has to come from the request that asked for the tags. Safe
 * precisely because the answer only ever goes back to that same caller: a
 * crawler's Host header IS the URL it was handed, which is the one the card must
 * point at. Same derivation resolveInvsimUrl uses for the game-server URL.
 */
export function requestOrigin(request: { headers: Record<string, unknown>; protocol?: string }): string {
  const host = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "").split(",")[0].trim();
  // Both halves are validated, because both are client-supplied headers and this
  // origin ends up inside an href on a page we serve. A scheme taken on trust is
  // the interesting one: `X-Forwarded-Proto: javascript` with a percent-encoded
  // newline in the host builds a `javascript:` link out of nothing but headers.
  // Anything unrecognised yields no origin at all rather than a guess.
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return "";
  const raw = String(request.headers["x-forwarded-proto"] ?? request.protocol ?? "https").split(",")[0].trim();
  return `${raw === "http" ? "http" : "https"}://${host}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapse whitespace and clip to what a card actually renders. */
export function truncate(s: string, max = 200): string {
  const clean = (s || "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A PNG's pixel size, straight out of its IHDR.
 *
 * og:image:width/height are optional, and they earn their place here: without
 * them Discord lays the card out only after fetching the image, and a card bake
 * is cropped to content so its aspect is different for every weapon. 24 bytes
 * off the front of a file we are about to read anyway — no decoder, no
 * dependency. Null for anything that isn't a PNG (the econ-icon fallback is
 * webp, whose header is a different shape and not worth a second parser).
 */
export function pngPixelSize(head: Buffer): { width: number; height: number } | null {
  if (head.length < 24 || head.toString("latin1", 1, 4) !== "PNG" || head.toString("latin1", 12, 16) !== "IHDR") {
    return null;
  }
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  return width && height ? { width, height } : null;
}

export interface UnfurlOptions {
  title: string;
  description: string;
  /** Canonical URL of the thing being shared — what og:url must say. */
  pageUrl: string;
  /** Where a human who follows the link should end up. */
  humanUrl: string;
  image?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

/**
 * The unfurl document itself.
 *
 * Deliberately the same tag set as the panel's own link shims
 * (`web/server/utils/unfurl.ts`, which backs /matches, /news and /events): a
 * crawler that already knows how to read a 5stack match card should find nothing
 * new here, and when the panel grows the middleware that answers
 * /apps/inventory/* for bots, it can render this payload with the helper it
 * already has. Duplicated rather than imported because that helper lives in
 * another repo and this one ships as a self-contained plugin.
 *
 * The `http-equiv` refresh plus the visible link are for the human case: this
 * URL is a share link, so somebody will eventually click it rather than paste
 * it, and a page that unfurls beautifully and then dead-ends is worse than no
 * page. Crawlers ignore both.
 */
export function renderUnfurl(opts: UnfurlOptions): string {
  const title = escapeHtml(opts.title);
  const description = escapeHtml(opts.description);
  const image = opts.image ? escapeHtml(opts.image) : "";
  const pageUrl = escapeHtml(opts.pageUrl);
  const humanUrl = escapeHtml(opts.humanUrl);
  const size = image && opts.imageWidth && opts.imageHeight
    ? `<meta property="og:image:width" content="${opts.imageWidth}" />
    <meta property="og:image:height" content="${opts.imageHeight}" />`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="description" content="${description}" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="5Stack" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${pageUrl}" />
    ${image ? `<meta property="og:image" content="${image}" />` : ""}
    ${image ? `<meta property="og:image:secure_url" content="${image}" />` : ""}
    ${size}
    ${image ? `<meta property="og:image:alt" content="${title}" />` : ""}

    <!-- summary_large_image only when there IS one: a large-image card with a
         missing picture renders as a broken box, where a summary card without
         one is simply a title and a line of text. -->
    <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    ${image ? `<meta name="twitter:image" content="${image}" />` : ""}

    <meta http-equiv="refresh" content="0; url=${humanUrl}" />
    <style>
      body { font-family: system-ui, sans-serif; background: #0a0a0c; color: #f4f1ea; margin: 0; padding: 2rem; }
      a { color: #f99e2f; }
    </style>
  </head>
  <body>
    <p>${title} — <a href="${humanUrl}">open on 5Stack</a>.</p>
  </body>
</html>`;
}
