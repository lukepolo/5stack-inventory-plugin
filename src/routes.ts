// Every screen, modal and draft in this plugin is a URL.
//
// `pluginRouter` handles the mechanics of talking to the host (see its header).
// This module is the vocabulary layer on top: it knows the plugin's own route
// table, which query keys the router owns, and how a craft-in-progress is
// packed into a query string. App.vue reads and writes routes only through
// here, so there is exactly one place that knows what `/items/3/craft` means.
//
// The reason any of this exists: "the P90 renders white" is unreproducible
// without the exact item, wear and seed, and a screenshot doesn't carry them.
// A pasteable URL does.

// ---- route table ------------------------------------------------------------

/** What's layered over an item. The path segment IS the modal. */
export type ItemModal = "detail" | "craft" | "3d";

export type Route =
  | { name: "loadout" }
  | { name: "focus" }
  | { name: "inventory" }
  | { name: "item"; id: string; modal: ItemModal }
  | { name: "draft"; skinId: number }
  | { name: "admin"; section: string };

const ITEM_MODALS: Record<string, ItemModal> = { craft: "craft", "3d": "3d" };

/**
 * Path → route. Total: anything unrecognised falls back to the loadout rather
 * than rendering nothing, because a 404 inside a panel plugin is a dead tab.
 *
 * Item ids stay STRINGS. The API serves them as strings ("1003"), so coercing
 * to Number here made every `inst.id === id` lookup fail and silently opened
 * whatever the fallback found instead of the linked item.
 */
export function parsePath(path: string): Route {
  if (path === "/" || path === "") return { name: "loadout" };
  if (path === "/focus") return { name: "focus" };
  if (path.startsWith("/admin")) {
    return { name: "admin", section: path.replace(/^\/admin\/?/, "") };
  }

  const draft = path.match(/^\/craft\/(\d+)$/);
  if (draft) return { name: "draft", skinId: Number(draft[1]) };

  const item = path.match(/^\/items\/([^/]+)(?:\/([^/]+))?$/);
  if (item) {
    const id = decodeURIComponent(item[1]);
    // An unknown third segment (/items/3/nonsense) degrades to the detail view
    // rather than 404ing — same reasoning as above.
    return { name: "item", id, modal: (item[2] && ITEM_MODALS[item[2]]) || "detail" };
  }
  if (path === "/items") return { name: "inventory" };

  return { name: "loadout" };
}

/** Route → path. The inverse of parsePath; keep them in step. */
export function buildPath(route: Route): string {
  switch (route.name) {
    case "loadout":
      return "/";
    case "focus":
      return "/focus";
    case "inventory":
      return "/items";
    case "item":
      return route.modal === "detail"
        ? `/items/${encodeURIComponent(route.id)}`
        : `/items/${encodeURIComponent(route.id)}/${route.modal}`;
    case "draft":
      return `/craft/${route.skinId}`;
    case "admin":
      return route.section ? `/admin/${route.section}` : "/admin";
  }
}

/** Which top-level screen renders behind whatever modal is open. */
export function screenFor(route: Route): "grid" | "focus" | "inventory" | "admin" {
  switch (route.name) {
    case "focus":
      return "focus";
    case "inventory":
      return "inventory";
    case "admin":
      return "admin";
    // An item modal is layered over the inventory; a draft over wherever you
    // were, which is the loadout in every entry point that opens one.
    case "item":
      return "inventory";
    default:
      return "grid";
  }
}

// ---- query ownership --------------------------------------------------------

// View state that should follow you between screens: which side you're looking
// at, which slot is focused, how the inventory is filtered.
//
// `from` names the screen an item modal was opened over. Without it the path
// alone decides, and every /items/<id> path reads as the inventory (see
// screenFor) — so opening an item from the LOADOUT repainted the screen behind
// the modal, and closing it dropped you on the inventory. Router-owned rather
// than foreign so it's stripped on the way out to a plain screen instead of
// trailing ?from=loadout around the app.
export const STICKY_QUERY_KEYS = ["team", "slot", "q", "origin", "sort", "cat", "wep", "from"] as const;

// State belonging to one screen only. Navigating away drops these — otherwise a
// half-finished draft's wear would ride along onto the admin page.
const DRAFT_KEYS = [
  "wear", "seed", "st", "name", "charm",
  "s0", "s1", "s2", "s3", "s4", "s5",
  "p0", "p1", "p2", "p3", "p4",
] as const;
export const TRANSIENT_QUERY_KEYS = ["d", ...DRAFT_KEYS] as const;

// `player` is deliberately in NEITHER list. It's the caller's, not the
// router's, and it must survive every navigation — dropping it strands a
// viewer halfway through someone else's loadout.
const OWNED = new Set<string>([...STICKY_QUERY_KEYS, ...TRANSIENT_QUERY_KEYS]);

/** Strip only the keys this module owns, leaving `?player=` and anything the host added. */
export function foreignQuery(q: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (!OWNED.has(k)) out[k] = v;
  return out;
}

// ---- draft craft codec ------------------------------------------------------

export interface DraftAttach {
  id: number;
  x?: number | null;
  y?: number | null;
  r?: number | null;
  w?: number | null;
}
export interface DraftCharm {
  id: number;
  x?: number | null;
  y?: number | null;
  z?: number | null;
}
export interface Draft {
  wear: number;
  seed: number;
  stattrak: boolean;
  nametag: string;
  stickers: (DraftAttach | null)[];
  patches: (number | null)[];
  charm: DraftCharm | null;
}

// Fields are joined with "_", NOT ".". Sticker offsets are signed decimals, so
// a "." separator makes "-0.5" ambiguous. "_" can't occur inside a number, and
// URLSearchParams leaves it unescaped — "." and "~" it would percent-encode,
// turning a shareable link into line noise.
const SEP = "_";

// Trailing-zero-free so a pristine sticker is "4621___" and not
// "4621_0.0000_0.0000_0.0000_0.0000".
const num = (n: number | null | undefined, dp = 4): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "" : String(Number(n.toFixed(dp)));

const parseNum = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Draft → query params. Omits everything at its default, so a plain craft link stays short. */
export function encodeDraft(d: Draft, defaultWear: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (d.wear !== defaultWear) out.wear = num(d.wear);
  if (d.seed !== 1) out.seed = String(d.seed);
  if (d.stattrak) out.st = "1";
  if (d.nametag.trim()) out.name = d.nametag.trim();

  d.stickers.forEach((s, i) => {
    if (!s) return;
    // Trailing empties trimmed: an unplaced sticker is just its id.
    out[`s${i}`] = [String(s.id), num(s.x), num(s.y), num(s.r), num(s.w)]
      .join(SEP)
      .replace(/_+$/, "");
  });
  d.patches.forEach((id, i) => {
    if (id) out[`p${i}`] = String(id);
  });
  if (d.charm) {
    out.charm = [String(d.charm.id), num(d.charm.x), num(d.charm.y), num(d.charm.z)]
      .join(SEP)
      .replace(/_+$/, "");
  }
  return out;
}

/**
 * Query params → draft. Ids only — names and images aren't in the URL, so the
 * caller resolves them through `fetchCatalogItems`. Anything malformed is
 * dropped rather than throwing: a truncated link should still open the skin.
 */
export function decodeDraft(
  q: Record<string, string>,
  defaultWear: number,
): Draft {
  const attach = (raw: string | undefined): DraftAttach | null => {
    if (!raw) return null;
    const [id, x, y, r, w] = raw.split(SEP);
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    return { id: n, x: parseNum(x), y: parseNum(y), r: parseNum(r), w: parseNum(w) };
  };

  // Charms are id_x_y_z, stickers are id_x_y_r_w — same shape, different third
  // and fourth fields, so the charm gets its own parse rather than borrowing
  // attach() and silently landing `z` in the sticker rotation slot.
  const parseCharm = (raw: string | undefined): DraftCharm | null => {
    if (!raw) return null;
    const [id, x, y, z] = raw.split(SEP);
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    return { id: n, x: parseNum(x), y: parseNum(y), z: parseNum(z) };
  };

  const wear = parseNum(q.wear);
  const seed = parseNum(q.seed);

  return {
    // Clamped, not just parsed — ?wear=99 from a mangled link would otherwise
    // reach the renderer and the game server as a nonsense float.
    wear: wear === null ? defaultWear : Math.min(1, Math.max(0, wear)),
    seed: seed === null ? 1 : Math.min(1000, Math.max(0, Math.round(seed))),
    stattrak: q.st === "1",
    nametag: q.name ?? "",
    stickers: [0, 1, 2, 3, 4, 5].map((i) => attach(q[`s${i}`])),
    patches: [0, 1, 2, 3, 4].map((i) => {
      const n = Number(q[`p${i}`]);
      return Number.isInteger(n) && n > 0 ? n : null;
    }),
    charm: parseCharm(q.charm),
  };
}

// ---- share links ------------------------------------------------------------

/** One row of the share menu. Lives here, not in ShareMenu.vue: `<script setup>` can't export types. */
export interface ShareLink {
  key: string;
  label: string;
  /** Absolute URL written to the clipboard. */
  href: string;
  /** Optional one-liner under the label — reach for it only when the label alone misleads. */
  hint?: string;
}

/** Every catalog id a decoded draft refers to — one batched lookup, not eight. */
export function draftItemIds(d: Draft): number[] {
  const ids = [
    ...d.stickers.flatMap((s) => (s ? [s.id] : [])),
    ...d.patches.flatMap((p) => (p ? [p] : [])),
    ...(d.charm ? [d.charm.id] : []),
  ];
  return [...new Set(ids)];
}
