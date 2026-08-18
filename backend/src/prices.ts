/**
 * Steam market prices, as data — no database, no network, no Fastify.
 *
 * Deliberately split from the job that stores it (in main.ts) for the reason
 * upstream split theirs: the whole feature turns on ONE fragile step, mapping a
 * Steam `market_hash_name` onto a catalog id, and that step fails silently. A
 * rename upstream, a prefix we don't know about, a new decoration on the name —
 * each looks exactly like "that item has no price yet", per item, forever. So
 * the mapping lives here where tools/price-parse-check.ts can run the real feed
 * through it without a Postgres or a server, and count what fell out.
 *
 * The name parsing itself is NOT re-implemented here: `parseSteamMarketName` is
 * the Steam import's own gate (see catalog.ts), already carrying the ★ /
 * StatTrak™ / Souvenir / wear-bracket rules and the type-prefix renames. Two
 * readers of the economy is how the cs2-lib 9.0.0 renames got half-applied and
 * blanked the live textures; this is emphatically the same reader.
 */

import {
  getItemIdBySteamName,
  getItemIdByVariant,
  parseSteamMarketName,
  priceGroupId,
  wearTierIndex,
  wearTierOf,
  WEAR_TIER_BOUNDS,
  type SteamWearTier,
} from "./catalog.ts";

/**
 * Where prices come from. Every option is the INSTANCE pulling for itself —
 * there is no 5stack price CDN and deliberately so, for the same reason there is
 * no third party in the asset path: a number about someone's money should come
 * from a source the operator picked, not one they inherited.
 *
 * `skinport` — one unauthenticated request returns ~25k items keyed by
 *   market_hash_name, in about a second. It is a real market's own order book,
 *   so it answers "what would this cost / fetch" directly.
 * `feed` — any JSON file in the cs2-prices-tracker shape, for an operator who
 *   already mirrors one or wants Steam's sold averages instead.
 *
 * Steam's own market is deliberately NOT an option, and it is worth writing down
 * why so nobody re-adds it hopefully: /market/priceoverview 429s after about six
 * requests and stays blocked for minutes, and /market/search/render pins its page
 * size to 10 — so a full sweep of the 35,348 CS2 listings is ~3,500 requests,
 * hours long, per instance, every day. Worse, it shares a host and an IP budget
 * with the Steam INVENTORY IMPORT this app already depends on, so a crawler that
 * gets throttled takes that down with it. One Skinport request replaces all of
 * it. (Browser extensions like Steam Inventory Helper do query Steam per user —
 * they can, being extensions with host permissions and the user's own session. A
 * web page cannot: those endpoints send no CORS headers.)
 */
export const PRICE_SOURCES = ["skinport", "csfloat", "waxpeer", "bitskins", "feed"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
export const DEFAULT_PRICE_SOURCE: PriceSource = "skinport";

/** The public JSON feed the `feed` source defaults to. Fetched only if an
 *  operator selects that source and does not name their own URL. */
export const PRICE_FEED_BASE =
  process.env.INVENTORY_PRICE_FEED ??
  "https://raw.githubusercontent.com/LukeX404/cs2-prices-tracker/main/static/prices";
export const PRICE_FEED_UPSTREAM = PRICE_FEED_BASE;

/** `latest.json` rather than a dated file: the source decides what "latest"
 *  means, and a date computed here would be wrong the moment it publishes on a
 *  different schedule than we poll on. */
export const priceFeedUrl = (base: string = PRICE_FEED_BASE) =>
  `${base.replace(/\/+$/, "")}/latest.json`;

/**
 * Which trailing window a displayed price comes from.
 *
 * Four exist because one is not enough: in the real feed ~38% of names have a
 * null `last_24h` — thinly traded items simply did not sell yesterday — and a
 * blank price for a third of an inventory reads as "pricing is broken". The
 * resolver walks outward until something is there and SAYS which window it
 * landed on, so a 90-day number is never passed off as today's.
 */
export const PRICE_WINDOWS = [
  "suggested",
  "median",
  "lowest",
  "last_24h",
  "last_7d",
  "last_30d",
  "last_90d",
] as const;
export type PriceWindow = (typeof PRICE_WINDOWS)[number];

/**
 * What to try, and in what order, for each kind of number.
 *
 * Explicit chains rather than "walk the list from here" because the two families
 * mean different things. The trailing averages WIDEN — a 7-day ask answering
 * with the 90-day average is honest, answering with yesterday's is just noisier
 * — while the live-market fields substitute sideways: if a market has no
 * reference price, its median listing is the next best answer to the same
 * question, and the cheapest listing after that.
 *
 * The two families never cross. A sold-average and a current ask are different
 * claims and quietly swapping one for the other is how a number stops meaning
 * anything.
 */
export const PRICE_FALLBACK: Record<PriceWindow, readonly PriceWindow[]> = {
  suggested: ["suggested", "median", "lowest"],
  median: ["median", "suggested", "lowest"],
  lowest: ["lowest", "median", "suggested"],
  last_24h: ["last_24h", "last_7d", "last_30d", "last_90d"],
  last_7d: ["last_7d", "last_30d", "last_90d"],
  last_30d: ["last_30d", "last_90d"],
  last_90d: ["last_90d"],
};

/** One row of the mirror: a market listing, resolved onto our catalog. */
export interface PriceRow {
  /** Canonical (name-collapsed) catalog id — see priceGroupId. */
  itemId: number;
  /** -1 when the name carries no wear bracket. */
  wearTier: number;
  stattrak: boolean;
  souvenir: boolean;
  marketHashName: string;
  last24h: number | null;
  last7d: number | null;
  last30d: number | null;
  last90d: number | null;
  /** The market's own reference price — its answer to "what is this worth",
   *  which is not the same as any single listing. */
  suggested: number | null;
  /** Middle of the current listings. Resistant to the one $20k Redline with a
   *  rare pattern that drags the mean into nonsense. */
  median: number | null;
  /** Cheapest listing right now — what it would actually cost to buy. */
  lowest: number | null;
  /** How many are on sale. Not a price — a confidence signal. Two listings and
   *  a four-figure ask is a very different claim from four hundred. */
  listings: number | null;
}

/** A resolved price, with its provenance attached. Never a bare number: "$4.10"
 *  with no window is the same shape of lie as a 90-day average shown as live. */
export interface PricePoint {
  value: number;
  window: PriceWindow;
  marketHashName: string;
  /**
   * Set when the listing found is NOT the one asked for.
   *
   * Markets do not carry every variant of every skin: StatTrak exists for a
   * fraction of finishes and sells far more thinly than plain, and the ends of
   * the wear range often have nothing listed at all. Refusing to answer in those
   * cases is what made a Battle-Scarred StatTrak weapon show no price no matter
   * what its owner changed.
   *
   * So the lookup relaxes — plain instead of StatTrak, the nearest bracket
   * instead of the exact one — and records what it actually matched here. It is
   * never allowed to be silent: a substituted price MUST render differently from
   * an exact one, because "$40" and "$40 for a different variant of this" are
   * different claims.
   */
  approx?: { wearTier: number; stattrak: boolean };
}

const positive = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/** The composite key a price is filed under. Everything that looks a price up
 *  builds it here, so the write side and the read side cannot drift. */
export const priceKey = (
  itemId: number,
  wearTier: number,
  stattrak: boolean,
  souvenir: boolean,
) => `${itemId}:${wearTier}:${stattrak ? 1 : 0}:${souvenir ? 1 : 0}`;

/**
 * The float -> wear-bracket bucketing, as a SQL expression.
 *
 * Prices are looked up by JOINING owned rows against the mirror in Postgres, not
 * by holding the feed in memory, so the bucketing has to happen where the join
 * does. Built from WEAR_TIER_BOUNDS rather than typed out in the schema: the
 * boundaries are already a decision (see wearTierOf), and a second hand-written
 * copy in SQL is how a tile ends up captioned "Field-Tested" beside a Well-Worn
 * price. Nothing here comes from a request — the column name is ours and the
 * numbers are a module constant.
 */
export function wearTierSql(column: string): string {
  const whens = WEAR_TIER_BOUNDS.map((max, i) => `WHEN ${column} < ${max} THEN ${i}`).join(" ");
  return `(CASE WHEN ${column} IS NULL THEN -1 ${whens} ELSE ${WEAR_TIER_BOUNDS.length} END)`;
}

/** How one owned item is addressed when a batch of prices comes back from the
 *  database. Keyed on what was ASKED for — the id-collapse happens in the join,
 *  so collapsing here too would make the two halves disagree. */
export const priceTargetKey = (itemId: number, wear: number | null | undefined, stattrak: boolean) =>
  `${itemId}:${wearTierIndex(wearTierOf(wear))}:${stattrak ? 1 : 0}`;

/** The key for an OWNED item: collapse the id the way the feed's names collapse,
 *  and put the float back in its bracket. `souvenir` is always false — we don't
 *  model souvenirs, though the mirror keeps their rows for when we do. */
export const ownedPriceKey = (
  itemId: number,
  wear: number | null | undefined,
  stattrak: boolean,
) => priceKey(priceGroupId(itemId), wearTierIndex(wearTierOf(wear)), stattrak, false);

export interface MappedFeed {
  prices: PriceRow[];
  /** Names the catalog had no answer for. The number that matters: it is small
   *  and boring while the mapping works, and jumps the day it breaks. */
  unmatched: string[];
  /** Distinct market names that resolved onto a key another name already held.
   *  Expected and small (items whose catalog names collide); a spike means the
   *  key is losing a distinction the market makes. */
  collisions: string[];
  /** Listings that resolved to a specific variant rather than the collapsed
   *  name — Doppler phases and gems. Reported because it is the difference
   *  between pricing a Ruby correctly and pricing it as a Phase 1. */
  variants?: number;
}

/**
 * The whole feed, resolved.
 *
 * Tolerant per entry, strict about the shape as a whole: a single weird value
 * skips one item, but a body that is not an object of objects throws, because
 * that is the difference between "one item is odd" and "we fetched an HTML error
 * page and are about to store it as prices".
 */
export function mapPriceFeed(feed: unknown): MappedFeed {
  if (feed === null || typeof feed !== "object" || Array.isArray(feed)) {
    throw new Error("Price feed is not a JSON object.");
  }
  const entries = Object.entries(feed as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error("Price feed is empty.");
  }
  return mapEntries(
    entries.map(([marketHashName, raw]) => {
      const steam = ((raw as { steam?: unknown } | null)?.steam ?? {}) as Record<string, unknown>;
      return {
        marketHashName,
        last24h: positive(steam.last_24h),
        last7d: positive(steam.last_7d),
        last30d: positive(steam.last_30d),
        last90d: positive(steam.last_90d),
      };
    }),
  );
}

// ---- Providers ---------------------------------------------------------------
// Five interchangeable sources, because one is a single point of failure for a
// number people will notice is missing. Each is a public, unauthenticated bulk
// endpoint that answers in one request; switching between them is a setting, not
// a deploy. All of them are THIS instance pulling for itself — see the note above
// on why Steam's own market is not among them.

/** One listing, normalised. Whatever a provider calls its fields, this is what
 *  the mapper gets: some prices, maybe a count, maybe a phase. */
export interface PriceEntry {
  marketHashName: string;
  /** Doppler phase / gem, when the provider says so out of band. */
  version?: string | null;
  suggested?: number | null;
  median?: number | null;
  lowest?: number | null;
  listings?: number | null;
  last24h?: number | null;
  last7d?: number | null;
  last30d?: number | null;
  last90d?: number | null;
}

/** Prices arrive in cents nearly everywhere except the JSON feed. Converted at
 *  the door so nothing downstream has to remember which provider it came from —
 *  a factor-of-100 error is the kind that looks plausible on a knife. */
const cents = (v: unknown): number | null => {
  const n = positive(v);
  return n === null ? null : n / 100;
};

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

function requireArray(payload: unknown, who: string): unknown[] {
  if (!Array.isArray(payload)) throw new Error(`${who} returned something other than an item array.`);
  if (payload.length === 0) throw new Error(`${who} returned an empty item list.`);
  return payload;
}

/**
 * The phases that ride INSIDE a market name.
 *
 * Skinport hands the phase over in its own `version` field; Bitskins bakes it
 * into the name — "Skeleton Knife | Doppler Black Pearl (Factory New)". Same
 * fact, two encodings, and getting it wrong is not a rounding error: a Black
 * Pearl is worth roughly four times a Phase 1.
 *
 * Only ever tried AFTER an exact lookup fails, so a skin that legitimately ends
 * in one of these words can't be mangled into a variant that doesn't exist.
 */
const INLINE_VARIANTS = ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Ruby", "Sapphire", "Emerald", "Black Pearl"];

/** A market name resolved onto the catalog, phase and all. The one place that
 *  decides which catalog id a listing belongs to. */
function resolveEntry(marketHashName: string, version?: string | null) {
  const parsed = parseSteamMarketName(marketHashName);
  if (parsed.itemId !== null) {
    const variant = (version ?? "").trim();
    const variantId = variant ? getItemIdByVariant(parsed.name, variant) : null;
    return { ...parsed, resolvedId: variantId ?? priceGroupId(parsed.itemId), variant: variantId !== null };
  }
  // Nothing answered to the name. Before giving up, try it as a phase baked into
  // the name rather than shipped beside it.
  for (const phase of INLINE_VARIANTS) {
    if (!parsed.name.endsWith(` ${phase}`)) continue;
    const base = parsed.name.slice(0, -(phase.length + 1));
    const variantId = getItemIdByVariant(base, phase);
    if (variantId !== null) {
      return { ...parsed, itemId: variantId, resolvedId: variantId, variant: true };
    }
    // The phase came off but the base is still unknown — price it as the family
    // rather than dropping the listing entirely.
    const baseId = getItemIdBySteamName(base);
    if (baseId !== null) {
      return { ...parsed, itemId: baseId, resolvedId: priceGroupId(baseId), variant: false };
    }
  }
  return { ...parsed, resolvedId: null, variant: false };
}

/**
 * Entries in, rows out. Every provider funnels through here, so the rules that
 * matter — which catalog id, which bracket, what counts as "no price", how a
 * duplicate key is settled — are written once and tested once.
 */
export function mapEntries(entries: Iterable<PriceEntry>): MappedFeed {
  const prices: PriceRow[] = [];
  const unmatched: string[] = [];
  const collisions: string[] = [];
  const seen = new Set<string>();
  let variants = 0;
  for (const entry of entries) {
    const marketHashName = entry.marketHashName;
    if (!marketHashName) continue;
    const suggested = entry.suggested ?? null;
    const median = entry.median ?? null;
    const lowest = entry.lowest ?? null;
    const last24h = entry.last24h ?? null;
    const last7d = entry.last7d ?? null;
    const last30d = entry.last30d ?? null;
    const last90d = entry.last90d ?? null;
    // Listed but never priced. Absent beats a confident $0.00 — a zero renders
    // as a claim, a blank renders as a blank.
    if (
      suggested === null && median === null && lowest === null &&
      last24h === null && last7d === null && last30d === null && last90d === null
    ) {
      continue;
    }
    const resolved = resolveEntry(marketHashName, entry.version);
    if (resolved.resolvedId === null) {
      unmatched.push(marketHashName);
      continue;
    }
    if (resolved.variant) variants++;
    const row: PriceRow = {
      itemId: resolved.resolvedId,
      wearTier: wearTierIndex(resolved.wearTier as SteamWearTier | null),
      stattrak: resolved.stattrak,
      souvenir: resolved.souvenir,
      marketHashName,
      last24h,
      last7d,
      last30d,
      last90d,
      suggested,
      median,
      lowest,
      listings: entry.listings ?? null,
    };
    const key = priceKey(row.itemId, row.wearTier, row.stattrak, row.souvenir);
    // First name wins. Which one that is is stable — providers hand back arrays
    // and objects in their own fixed order — and "last wins" or "max" would make
    // the stored price depend on how the provider happened to sort.
    if (seen.has(key)) {
      collisions.push(marketHashName);
      continue;
    }
    seen.add(key);
    prices.push(row);
  }
  return { prices, unmatched, collisions, variants };
}

/** Skinport: a market's own reference price, its median and its cheapest ask,
 *  plus the phase in a `version` field. The richest of the five. */
export function mapSkinportItems(payload: unknown): MappedFeed {
  return mapEntries(
    requireArray(payload, "Skinport").map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        marketHashName: typeof item.market_hash_name === "string" ? item.market_hash_name : "",
        version: typeof item.version === "string" ? item.version : null,
        suggested: positive(item.suggested_price),
        median: positive(item.median_price),
        lowest: positive(item.min_price),
        listings: count(item.quantity),
      };
    }),
  );
}

/** CSFloat: cheapest ask and how many are up, in cents. No phases — a Doppler is
 *  one listing there, the way Steam has it. */
export function mapCsfloatItems(payload: unknown): MappedFeed {
  return mapEntries(
    requireArray(payload, "CSFloat").map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        marketHashName: typeof item.market_hash_name === "string" ? item.market_hash_name : "",
        lowest: cents(item.min_price),
        listings: count(item.quantity),
      };
    }),
  );
}

/** Waxpeer: cheapest ask and a count, in cents, under `items`. It also publishes
 *  a `steam_price`, deliberately ignored — mixing another market's number into
 *  this one's row would make the caption a lie. */
export function mapWaxpeerItems(payload: unknown): MappedFeed {
  const items = (payload as { items?: unknown } | null)?.items;
  return mapEntries(
    requireArray(items, "Waxpeer").map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        marketHashName: typeof item.name === "string" ? item.name : "",
        lowest: cents(item.min),
        listings: count(item.count),
      };
    }),
  );
}

/** Bitskins: a suggested price in cents, and the phase baked into the name
 *  rather than handed over separately — see INLINE_VARIANTS. */
export function mapBitskinsItems(payload: unknown): MappedFeed {
  return mapEntries(
    requireArray(payload, "Bitskins").map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return {
        marketHashName: typeof item.name === "string" ? item.name : "",
        suggested: cents(item.suggested_price),
      };
    }),
  );
}

export interface PriceProvider {
  id: PriceSource;
  label: string;
  /** Fixed endpoint, or null when the operator supplies the URL. */
  url: string | null;
  /** One line for the settings panel. */
  blurb: string;
  /** Which number this provider is asked for first. */
  window: PriceWindow;
  headers?: Record<string, string>;
  map(payload: unknown): MappedFeed;
}

export const PRICE_PROVIDERS: Record<PriceSource, PriceProvider> = {
  skinport: {
    id: "skinport",
    label: "Skinport",
    url: "https://api.skinport.com/v1/items?app_id=730&currency=USD",
    blurb:
      "~25,000 items in one request, with a reference price, a median and the cheapest ask — and Doppler phases priced separately. No key, no account. Recommended.",
    window: "suggested",
    // Skinport answers 406 to a client that can't take Brotli.
    headers: { "Accept-Encoding": "br, gzip", Accept: "application/json" },
    map: mapSkinportItems,
  },
  csfloat: {
    id: "csfloat",
    label: "CSFloat",
    url: "https://csfloat.com/api/v1/listings/price-list",
    blurb: "~27,000 items: cheapest current ask and how many are listed. Fast and small; no phase pricing.",
    window: "lowest",
    map: mapCsfloatItems,
  },
  waxpeer: {
    id: "waxpeer",
    label: "Waxpeer",
    url: "https://api.waxpeer.com/v1/prices?game=csgo&minified=0",
    blurb: "Cheapest current ask and a listing count across Waxpeer's market. No phase pricing.",
    window: "lowest",
    map: mapWaxpeerItems,
  },
  bitskins: {
    id: "bitskins",
    label: "BitSkins",
    url: "https://api.bitskins.com/market/skin/730",
    blurb:
      "~30,000 items with BitSkins' own suggested price. Phases are priced, spelled into the item name rather than sent separately.",
    window: "suggested",
    map: mapBitskinsItems,
  },
  feed: {
    id: "feed",
    label: "JSON price feed",
    url: null,
    blurb:
      "Any JSON file in the cs2-prices-tracker shape — Steam sold-averages over 24h/7d/30d/90d. Use this if you already mirror one, or want Steam's numbers specifically.",
    window: "last_7d",
    map: (payload) => mapPriceFeed(payload),
  },
};

/** Where a provider is fetched from. Only the feed needs the operator's URL. */
export const providerUrl = (source: PriceSource, base: string = PRICE_FEED_BASE) =>
  PRICE_PROVIDERS[source].url ?? priceFeedUrl(base);

export const DEFAULT_WINDOW: Record<PriceSource, PriceWindow> = Object.fromEntries(
  PRICE_SOURCES.map((id) => [id, PRICE_PROVIDERS[id].window]),
) as Record<PriceSource, PriceWindow>;

/**
 * The freshest window that actually has a number, preferring `window` and
 * widening from there.
 *
 * Widening rather than narrowing: if the caller asked for 7-day and only the
 * 90-day average exists, 90 is the honest answer to "what is this worth" —
 * whereas a 24-hour number when 7-day was asked for is noisier, not better.
 */
export function pickPrice(
  row: Pick<PriceRow, "last24h" | "last7d" | "last30d" | "last90d" | "suggested" | "median" | "lowest" | "marketHashName">,
  window: PriceWindow = "last_7d",
): PricePoint | null {
  const values: Record<PriceWindow, number | null> = {
    suggested: row.suggested,
    median: row.median,
    lowest: row.lowest,
    last_24h: row.last24h,
    last_7d: row.last7d,
    last_30d: row.last30d,
    last_90d: row.last90d,
  };
  for (const w of PRICE_FALLBACK[window] ?? [window]) {
    const value = values[w];
    if (value != null) return { value, window: w, marketHashName: row.marketHashName };
  }
  return null;
}

// ---- Quoting ----------------------------------------------------------------

/** What a quote needs to know about one thing being priced. Structural on
 *  purpose: an owned row, a craft form's draft and a loadout entry all satisfy
 *  it without being converted first. */
export interface QuoteSpec {
  itemId: number;
  wear?: number | null;
  stattrak?: boolean | null;
  stickers?: ({ id: number } | null | undefined)[] | null;
  patches?: ({ id: number } | null | undefined)[] | null;
  charmId?: number | null;
}

export type QuoteKind = "base" | "sticker" | "patch" | "charm";

export interface QuoteLine {
  kind: QuoteKind;
  itemId: number;
  name: string | null;
  /** Null = the mirror has no listing for it. Distinct from a zero price. */
  price: PricePoint | null;
}

export interface Quote {
  base: QuoteLine;
  attachments: QuoteLine[];
  /** The skin on its own. */
  baseTotal: number;
  /** Every sticker, patch and charm applied to it, at their own market price. */
  attachmentTotal: number;
  total: number;
  /** How many lines the mirror could not price. A total built from 3 of 6 lines
   *  is not the same claim as one built from 6, and the UI has to be able to say
   *  so — an estimate quietly missing the Katowice Crown is worse than no
   *  estimate at all. */
  unpriced: number;
  lines: number;
}

/**
 * An itemized estimate for one item as configured.
 *
 * Attachments are priced at their OWN market value and reported separately,
 * never blended into the base. That is the honest shape: a sticker applied to a
 * gun is not worth what an unapplied one sells for — applying it destroys the
 * listing — and the fraction it retains is a matter of opinion that changes per
 * sticker and per market. We show what each piece costs to buy; what a finished
 * craft would resell for is a different question and not one a price feed can
 * answer.
 */
export function quoteItem(
  spec: QuoteSpec,
  lookup: (itemId: number, wear: number | null, stattrak: boolean) => PricePoint | null,
  nameOf: (itemId: number) => string | null,
): Quote {
  const line = (kind: QuoteKind, itemId: number, wear: number | null, stattrak: boolean): QuoteLine => ({
    kind,
    itemId,
    name: nameOf(itemId),
    price: lookup(itemId, wear, stattrak),
  });
  const base = line("base", spec.itemId, spec.wear ?? null, spec.stattrak === true);
  const attachments: QuoteLine[] = [];
  for (const sticker of spec.stickers ?? []) {
    // A sticker's own scratch wear is NOT a market wear bracket — scraped
    // stickers do not have their own listings — so attachments always price at
    // their bare name.
    if (sticker) attachments.push(line("sticker", sticker.id, null, false));
  }
  for (const patch of spec.patches ?? []) {
    if (patch) attachments.push(line("patch", patch.id, null, false));
  }
  if (spec.charmId != null) attachments.push(line("charm", spec.charmId, null, false));
  const baseTotal = base.price?.value ?? 0;
  const attachmentTotal = attachments.reduce((sum, a) => sum + (a.price?.value ?? 0), 0);
  const all = [base, ...attachments];
  return {
    base,
    attachments,
    baseTotal,
    attachmentTotal,
    total: baseTotal + attachmentTotal,
    unpriced: all.filter((l) => l.price === null).length,
    lines: all.length,
  };
}
