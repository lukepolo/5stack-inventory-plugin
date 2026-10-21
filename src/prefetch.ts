/**
 * Warm an item's 3D view before it is opened.
 *
 * A cold open is a chain of waits, each starting only when the one before it
 * lands: the GLB, then the textures its JSON names, then the paint chain and the
 * shared composite store, and on a store miss the composite's sources. Measured
 * through tools/standalone at 100 Mbit/s, that is 2-8.4s and 15-76MB for one
 * knife or rifle, almost all of it network. Nothing in it depends on the user:
 * which files an open needs follows from the item alone. So this fetches them
 * while the user is still deciding (numbers in docs/DEBUGGING.md §4.16):
 *
 *   hover   a tile, after a short intent delay (ItemTile). Dropped if the
 *           pointer leaves before a warm starts.
 *   press   Edit, View in 3D (App.vue's openEdit/openView). Urgent: it is the
 *           mount's own download started a few hundred milliseconds earlier and
 *           in parallel, instead of one file after another.
 *   idle    the equipped items, once the inventory and loadout have landed.
 *
 * What a warm covers, for a weapon with a paint:
 *   - hasModel's HEAD and the GLB (the exact URL loadGltf fetches), then the
 *     textures loadGltf will keep for this variant — gltfTextureUrls, which
 *     shares its skip rule with loadGltf;
 *   - the sticker markup the mount awaits, and the paint chain (loadPaintDef);
 *   - the composite store pair for the item's exact wear/seed, when stored;
 *   - on a store MISS, the paint's own textures (pattern, wear, grunge, …),
 *     and only on a PRESS the weapon's composite inputs (.inputs[.hd],
 *     10-40MB). A hover never fetches those, and neither does idle;
 *   - an Edit press on a store HIT also queues the inputs in the background,
 *     since the first wear or pattern change will need them (not on phones);
 *   - an attached charm's GLB and textures.
 * Other kinds (gloves, agents, pets, charms) get their GLB and textures.
 *
 * The bytes go into src/prefetchStore.ts and the loaders take them from there;
 * nothing relies on the HTTP cache. A file a loader already holds in its own
 * cache is not warmed again (see usedRecently). Everything is skipped under
 * Save-Data, on a 2g estimate, and with the Developer tab's No prefetch switch
 * (`noprefetch`, for timing a cold open against a warm one). Its Prefetch log
 * switch (`prefetchlog`) traces every step.
 */
import { fetchStickerGeometry, getAssetVersion, type InventoryItem, type LoadoutEntry } from "./api";
import { hasModel, hasModelSync, modelUrlFor } from "./modelAvailability";
import type { PaintDef, WeaponInputs } from "./paintComposite";
import {
  HOVER,
  IDLE,
  Intent,
  PREFETCH_LOG,
  URGENT,
  cancelIntent,
  gltfUseKey,
  peekBlob,
  plog,
  prefetchStats,
  setBusyProbe,
  stickyFlag,
  usedRecently,
  usedSince,
  useMark,
  warmCall,
  warmUrl,
  type Lane,
} from "./prefetchStore";
import type { GltfVariant } from "./viewer3d";
import { viewer3d, viewerStats } from "./viewer3dLazy";
import { isQuadModel, resolveViewerModel, resolveViewerModelSync } from "./viewerModel";

export type WarmReason = "hover" | "open" | "edit" | "idle";

/** The parts of an owned item (or a loadout row) that decide what its 3D view
 *  loads. InventoryItem satisfies it as is. */
export interface PrefetchSubject {
  item?: {
    type?: string | null;
    model?: string | null;
    image?: string | null;
    paintMaterial?: string | null;
    legacyPaint?: boolean | null;
  } | null;
  wear?: number | null;
  seed?: number | null;
  charm?: { image?: string | null } | null;
}

const LANE: Record<WarmReason, Lane> = { open: URGENT, edit: URGENT, hover: HOVER, idle: IDLE };
/** Long enough that sweeping the pointer across a grid warms nothing, short
 *  enough that a pointer moving to the tile's Edit button has started. */
const HOVER_INTENT_MS = 150;
/** Sizes of the loader caches a file lives in once taken — GLTF_CACHE_MAX and
 *  COMPOSITE_CACHE_MAX. Used to guess whether a loader still holds it. */
const GLTF_RECENT = 12;
const COMPOSITE_RECENT = 8;
const COARSE = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
const DISABLED = stickyFlag("noprefetch");

// Background warms do not START while an interactive viewer is building.
// viewerStats() is the build queue's own answer, and reads "nothing building"
// until the viewer chunk has loaded, which is right.
setBusyProbe(() => viewerStats().lane === "interactive");

if (PREFETCH_LOG && typeof window !== "undefined") {
  (window as unknown as { __prefetch?: unknown }).__prefetch = { stats: prefetchStats };
}

/** Why warming is off right now, or null when it is allowed. */
function blocked(): string | null {
  if (DISABLED) return "off (No prefetch)";
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData) return "Save-Data";
  if (/2g$/.test(conn?.effectiveType ?? "")) return `connection ${conn?.effectiveType}`;
  // Every URL carries the extraction stamp, which arrives with the catalog. A
  // warm before it would fetch URLs no loader will ever ask for.
  if (!getAssetVersion()) return "catalog not loaded yet";
  return null;
}

/**
 * Warm everything opening `subject`'s 3D view needs. Returns the intent, which
 * a hover cancels when the pointer leaves (see hoverPrefetch); a press or idle
 * warm just runs to the end.
 */
export function prefetchView(subject: PrefetchSubject | null | undefined, reason: WarmReason): Intent {
  const intent = new Intent();
  const why = blocked();
  if (why) {
    plog("skip", reason, why);
    return intent;
  }
  if (subject?.item) void plan(subject, reason, intent).catch((e) => plog("plan failed", e));
  return intent;
}

/**
 * The hover half, for a tile: `enter` on pointerenter/focus, `leave` on
 * pointerleave/blur. The warm starts after HOVER_INTENT_MS, and leaving drops
 * whatever of it has not started yet.
 */
export function hoverPrefetch(subject: () => PrefetchSubject | null | undefined) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let intent: Intent | null = null;
  return {
    enter() {
      if (timer || intent) return;
      timer = setTimeout(() => {
        timer = undefined;
        intent = prefetchView(subject(), "hover");
      }, HOVER_INTENT_MS);
    },
    leave() {
      clearTimeout(timer);
      timer = undefined;
      if (intent) cancelIntent(intent);
      intent = null;
    },
  };
}

/**
 * Once the loadout and inventory have loaded: warm the equipped items in idle
 * time, the given team's first, one item at a time. Idle warms only fill a
 * third of the budget (see prefetchStore), so a big loadout warms its first
 * few items and stops.
 *
 * Not on phones. Nothing asked for these, and a third of a phone's budget is
 * ~13MB on every first visit over what is often a metered connection; a phone
 * still warms on a press, which is when its owner has asked for the view.
 */
export function prefetchEquipped(rows: LoadoutEntry[], inventory: InventoryItem[], team?: string) {
  if (COARSE) return plog("skip", "idle", "coarse pointer");
  if (blocked()) return;
  const byId = new Map(inventory.map((i) => [String(i.id), i]));
  const ordered = [...rows].sort((a, b) => Number(b.team === team) - Number(a.team === team));
  const seen = new Set<string>();
  const subjects: InventoryItem[] = [];
  for (const r of ordered) {
    if (r.item_instance_id == null || seen.has(String(r.item_instance_id))) continue;
    seen.add(String(r.item_instance_id));
    const inst = byId.get(String(r.item_instance_id));
    if (inst?.item) subjects.push(inst);
  }
  if (!subjects.length) return;
  plog("idle: equipped", subjects.map((s) => s.item?.name));
  const idleIntent = new Intent();
  void (async () => {
    for (const s of subjects) {
      await whenIdle();
      if (blocked()) return;
      await plan(s, "idle", idleIntent).catch((e) => plog("plan failed", e));
    }
  })();
}

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 5000 });
    else setTimeout(resolve, 1500);
  });
}

// ---- The plan ---------------------------------------------------------------

async function plan(s: PrefetchSubject, reason: WarmReason, intent: Intent) {
  const item = s.item!;
  const lane = LANE[reason];
  const sync = resolveViewerModelSync(item);
  const target = sync === undefined ? await resolveViewerModel(item) : sync;
  if (!target || isQuadModel(target.model) || intent.cancelled) return;
  const t0 = performance.now();
  // Started here, awaited where needed: on a first open the viewer chunk
  // (which names the files) downloads alongside the first warms.
  void viewer3d().catch(() => {});
  plog("plan", reason, target.model, item.paintMaterial ?? "");
  // Mirrors buildViewer: only the weapon compositor takes a paint, and the
  // variant is what decides which GLB textures are worth fetching at all.
  const weaponPaint = target.kind === "weapon" ? item.paintMaterial ?? null : null;
  const legacy = !!item.legacyPaint;
  const jobs: Promise<unknown>[] = [warmModel(target.model, { legacy, painted: !!weaponPaint }, lane, intent)];
  if (target.kind === "weapon") {
    // Awaited by every weapon mount before the viewer even starts.
    jobs.push(warmCall(`stickers:${target.model}`, lane, intent, () => fetchStickerGeometry(target.model)));
    if (weaponPaint) jobs.push(warmPaint(target.model, weaponPaint, legacy, s, reason, intent));
    if (s.charm?.image) jobs.push(warmCharm(s.charm.image, lane, intent));
  }
  await Promise.all(jobs);
  plog("plan done", reason, target.model, `${(performance.now() - t0).toFixed(0)}ms`, prefetchStats());
}

/** Warm `url` unless a loader asked for it after `mark` (it went to the network
 *  itself) or, with `within`, holds it in its own cache. */
function warmFresh(url: string, lane: Lane, intent: Intent, mark: number, within?: number) {
  if (usedSince(url, mark) || (within != null && usedRecently(url, within))) return null;
  return warmUrl(url, lane, intent);
}

/** The GLB and the textures loadGltf will keep for this variant. */
async function warmModel(model: string, variant: GltfVariant, lane: Lane, intent: Intent) {
  const mark = useMark();
  await warmCall(`has:${model}`, lane, intent, () => hasModel(model));
  if (!hasModelSync(model) || intent.cancelled) return;
  const url = modelUrlFor(model);
  // This variant's parse is still in the GLTF LRU: an open fetches nothing.
  if (usedRecently(gltfUseKey(url, variant), GLTF_RECENT)) return plog("in use", model);
  if ((await warmFresh(url, lane, intent, mark)) !== "ready" || intent.cancelled) return;
  const glb = peekBlob(url);
  if (!glb) return;
  // Only now: the viewer chunk loads in parallel with the GLB rather than
  // in front of it on a first open.
  const v = await viewer3d();
  const textures = v.gltfTextureUrls(await glb.arrayBuffer(), variant);
  // Checked again, synchronously with the warms below: if loadGltf has taken
  // the GLB meanwhile it is already fetching these itself.
  if (!peekBlob(url)) return;
  await Promise.all(textures.map((t) => warmFresh(t, lane, intent, mark)));
}

/** An attached charm: its own GLB, unpainted, as loadCharmModel loads it. */
async function warmCharm(image: string, lane: Lane, intent: Intent) {
  await warmCall(`charm:${image}`, lane, intent, () => resolveViewerModel({ type: "keychain", image }));
  const t = await resolveViewerModel({ type: "keychain", image });
  if (t && !intent.cancelled) await warmModel(t.model, { legacy: false, painted: false }, lane, intent);
}

/** The paint chain, the stored composite, and on a miss what composites it. */
async function warmPaint(
  model: string,
  material: string,
  legacy: boolean,
  s: PrefetchSubject,
  reason: WarmReason,
  intent: Intent,
) {
  const lane = LANE[reason];
  const mark = useMark();
  const v = await viewer3d();
  await warmCall(`paint:${material}`, lane, intent, () => v.loadPaintDef(material));
  const def = await v.loadPaintDef(material);
  if (!def || intent.cancelled) return;
  // The identity the mount files the composite under — the craft modal's wear
  // and pattern defaults, see craftVisualOpts and compositePaint's `persist`.
  const stem = v.compositeKey({
    model,
    legacy,
    material,
    wear: Number(s.wear ?? 0),
    seed: Number(s.seed ?? 1),
    cap: v.compositeSizeCap(def),
  });
  let stored: boolean | null = false;
  for (const f of await v.storedCompositeUrls(stem)) {
    // Looked up recently: the composite LRU most likely still has the pair,
    // which is as good as a hit and needs nothing fetched.
    if (usedRecently(f.albedo, COMPOSITE_RECENT)) {
      plog("in use", stem);
      stored = true;
      break;
    }
    const [a, r] = await Promise.all([warmFresh(f.albedo, lane, intent, mark), warmFresh(f.rm, lane, intent, mark)]);
    if (a === "ready" && r === "ready") {
      stored = true;
      break;
    }
    // Anything but a clean 404 (a failure, a cancel, a loader that got there
    // first) leaves the answer unknown — not worth the sources' bytes.
    if (a !== "missing" || r !== "missing") {
      stored = null;
      break;
    }
  }
  if (stored === null || intent.cancelled || reason === "idle") return;
  // Small, cached, and awaited by the mount either way.
  await warmCall(`inputs:${model}:${legacy}`, lane, intent, () => v.loadWeaponInputs(model, legacy));
  // At the cap the mount composites at: on most desktops and every phone that
  // is the 2048 copies of the big inputs, not the 4096 originals.
  const weapon = v.weaponInputsAt(await v.loadWeaponInputs(model, legacy), v.compositeSizeCap(def)) ?? null;
  if (intent.cancelled) return;
  const { paint, inputs } = compositeSources(def, weapon, v.paintTextureUrl);
  if (stored) {
    // A hit needs no sources now, but editing will: the first wear or pattern
    // change composites from the inputs. Background, after the viewer is up.
    if (reason === "edit" && !COARSE) await Promise.all(inputs.map((u) => warmFresh(u, HOVER, intent, mark, Infinity)));
    return;
  }
  const press = reason === "open" || reason === "edit";
  await Promise.all([
    ...paint.map((u) => warmFresh(u, lane, intent, mark, Infinity)),
    // The big ones. Only when someone pressed for this item, never on a hover.
    ...(press ? inputs.map((u) => warmFresh(u, URGENT, intent, mark, Infinity)) : []),
  ]);
}

/**
 * The textures compositePaint loads on a store miss, split into the weapon's
 * composite inputs and the paint's own. `weapon` must already be the set for
 * the composite's cap (weaponInputsAt). MIRRORS the url list at the top of
 * compositePaint — if that changes, change this. A drift costs a wasted or an
 * un-warmed download, never a wrong texture. position.exr is left out: it loads
 * through EXRLoader, only for the two projected styles.
 */
function compositeSources(def: PaintDef, weapon: WeaponInputs | null, url: (p: string) => string) {
  const u = (p?: string) => (p ? url(p) : null);
  const projected = def.style === 2 || def.style === 5;
  const skinMasks =
    def.masksSkinSpecific && (def.overrideDefaultMasks || (def.caseHardening && def.style === 8)) ? u(def.masks) : null;
  const all = [
    u(def.pattern),
    u(def.wearMask),
    u(def.grunge),
    skinMasks ?? weapon?.masks ?? u(def.masks),
    weapon?.ao ?? u(def.ao),
    weapon?.color ?? u(def.baseColor),
    weapon?.metalness ?? u(def.baseRM),
    u(def.paintRoughnessTex),
    u(def.paintMetalnessTex),
    u(def.overlay),
    u(def.overlayMask),
    def.caseHardening ? u(def.caseHardeningRamp) : null,
    def.caseHardening ? u(def.normal) : null,
    u(def.pearlMask),
    weapon?.mag ?? null,
    projected ? weapon?.surface ?? null : null,
  ].filter((x): x is string => !!x);
  const fromInputs = new Set(
    [weapon?.ao, weapon?.masks, weapon?.color, weapon?.metalness, weapon?.mag, weapon?.surface].filter(Boolean),
  );
  const uniq = [...new Set(all)];
  return { paint: uniq.filter((x) => !fromInputs.has(x)), inputs: uniq.filter((x) => fromInputs.has(x)) };
}
