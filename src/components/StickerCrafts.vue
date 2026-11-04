<script setup lang="ts">
// STICKER CRAFTS — a measuring board for laying stickers out and grouping them.
//
// The fourth header tab, after Craft. You pull stickers out of the same picker
// the craft editor uses, lay them on a centimetre mat in 3D, move and turn them,
// and bind up to five into a grouping that moves as one. A grouping saved to the
// library is a STICKER CRAFT: the weapon editor's sticker picker offers it under
// its own tab and lays the whole thing onto the gun in one pick (see
// applyStickerCraft in App.vue).
//
// The mat is measured in sticker footprints as much as in centimetres: every
// sticker fills the same STICKER_CM square, because a weapon's sticker slot is
// one fixed square too and CS2 has no sticker size. That is what lets a layout
// made here land on any gun the way it looks here.
//
// EXPERIMENTAL. State lives here and on the account (stickerCraftsModel decides
// where; a backend without the storage falls back to this browser). The 3D
// board (stickerBoard.ts) is a renderer that is handed the list on every change
// and reports the pointer.
import { stripName } from "../itemVisuals";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, toRef, watch } from "vue";
import {
  BookmarkPlus,
  ChevronUp,
  CloudOff,
  Crosshair,
  Globe,
  Eraser,
  GripVertical,
  Group,
  LayoutGrid,
  Link2,
  Link2Off,
  Search,
  ListChecks,
  ListPlus,
  Ruler,
  Loader2,
  Lock,
  Magnet,
  Pencil,
  Plus,
  RefreshCw,
  ScanEye,
  Store,
  Trash2,
  View,
  X,
} from "lucide-vue-next";
import { assetUrl, fetchStickerGeometry, fetchWeaponOutline, saveWeaponOutline, type CatalogWeapon, type InventoryItem } from "../api";
import { useAttachmentPicker, type PickerRow } from "../composables/useAttachmentPicker";
import { usePersistedBool, usePersistedString } from "../composables/usePersistedRef";
import {
  GRID_H,
  GRID_W,
  HOME_LAYOUT,
  MAX_ON_BOARD,
  MAX_PER_GROUPING,
  PREVIEW_VERSION,
  OUTLINE_ROOM,
  STICKER_CM,
  deleteCraft,
  loadStickerCrafts,
  saveBoard as storeBoard,
  saveCraft as storeCraft,
  saveCraftPictures,
  setPublished,
  type BoardSticker,
  type CraftScore,
  type CraftSticker,
  type Grouping,
  type MatLayout,
  type SavedCraft,
  type StoreCraft,
} from "../stickerCraftsModel";
import type { StickerBoard } from "../stickerBoard";
import type { WeaponOutline } from "../outlineTrace";
import type { OutlineSpot } from "../composables/useStickerCraftPlacement";
import AttachmentPicker from "./AttachmentPicker.vue";
import ModelRail, { type RailItem } from "./ModelRail.vue";
import CraftUseCase from "./CraftUseCase.vue";
import PillTabs from "./PillTabs.vue";
import Tooltip from "./Tooltip.vue";
import { viewer3d } from "../viewer3dLazy";
import { useSortableList } from "../composables/useSortableList";
import ViewerControls from "./ViewerControls.vue";
import StickerRow from "./StickerRow.vue";
import UndoToast from "./UndoToast.vue";
import { Z } from "../zLayers";

const props = defineProps<{
  /** Every owned row — the picker's Owned shelf reads it. */
  inventory: InventoryItem[];
  /** App's `attachedName`: what an owned sticker is already stuck to. */
  attachedName: (inst?: InventoryItem | null) => string | null;
  compact: boolean;
  /** The catalog's weapons — the chalk outline's choices. */
  weapons: CatalogWeapon[];
  /** Your equipped skin of this gun, if any (App's loadout): its name and 2D art. */
  equippedSkin?: (model: string) => { name: string; image: string | null } | null;
}>();
/** Messages go up to the host's toast, like every other screen's (AdminConsole). */
const emit = defineEmits<{
  (e: "notify", message: string, kind: "error" | "success"): void;
  /** Put this saved craft on a gun of this model (App opens the editor). */
  (e: "put-on-gun", craftId: string, model: string, at: OutlineSpot | null): void;
}>();

const tr = inject<(k: string, f: string) => string>("tr", (_k, f) => f);

/** Snap step for dragging, in cm, and for turning, in degrees. */
const SNAP_CM = 0.5;
const SNAP_DEG = 5;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---- state ------------------------------------------------------------------
const groups = ref<Grouping[]>([]);
const stickers = ref<BoardSticker[]>([]);
const library = ref<SavedCraft[]>([]);
/** Ids of your crafts that are in the Craft Store. */
const published = ref<Set<string>>(new Set());
/** Their votes in the store. */
const scores = ref<Map<string, CraftScore>>(new Map());
const selected = ref<Set<string>>(new Set());
const snap = usePersistedBool("cs2inv.stickerCrafts.snap", true);
const boardView = ref<"angled" | "top">("angled");

// ---- storage ----------------------------------------------------------------
/**
 * Loaded from the account yet. NOTHING is saved before it is: an empty mat
 * written up before the real one had arrived would replace it, on every device.
 */
const loaded = ref(false);
const loadError = ref<string | null>(null);
/** The account copy, as far as this page knows. */
const sync = ref<"idle" | "saving" | "saved" | "error">("idle");
let writing = 0;
/** A write failed since the last time everything was saved. */
let failed = false;
async function track(write: Promise<unknown>) {
  writing++;
  sync.value = "saving";
  try {
    await write;
  } catch {
    failed = true;
  }
  if (--writing > 0) return;
  sync.value = failed ? "error" : "saved";
  failed = false;
}
async function loadAll() {
  loadError.value = null;
  try {
    const got = await loadStickerCrafts();
    groups.value = got.board.groups;
    stickers.value = got.board.stickers;
    // Newest first, as a save puts them: the panel shows the first few.
    library.value = [...got.library].sort((a, b) => b.savedAt - a.savedAt);
    published.value = got.published;
    scores.value = got.scores;
    normalize();
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
    return;
  }
  // After the watchers have seen the loaded state, so loading is not a change
  // to be saved straight back.
  await nextTick();
  loaded.value = true;
  void backfillPreviews();
}

// A drag writes a position per pointer move; saving each one would be a
// request per frame. A short debounce sends the last one.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let boardDirty = false;
function flushBoard() {
  clearTimeout(saveTimer);
  if (!boardDirty || !loaded.value) return;
  boardDirty = false;
  void track(storeBoard({ stickers: stickers.value, groups: groups.value }));
}
watch(
  [stickers, groups],
  () => {
    if (!loaded.value) return;
    boardDirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushBoard, 600);
  },
  { deep: true },
);
/** One craft written after it changed — saved, renamed, or given its picture. */
/** The last craft write: "put on a gun" waits for it, so the editor finds the craft. */
let lastPersist: Promise<unknown> = Promise.resolve();
const persistCraft = (c: SavedCraft) => {
  if (!loaded.value) return;
  const write = storeCraft(c);
  lastPersist = write;
  void track(write);
};

// ---- draw order -------------------------------------------------------------------
/**
 * The mat in draw order, bottom first, as UNITS: a loose sticker, or a whole
 * grouping. A grouping's members are kept next to each other in the list —
 * the layer list shows a grouping as one block and drags it as one, which only
 * means something if the block is also one run of draw order. It sits where its
 * top-most member was.
 */
type Unit = { kind: "one"; s: BoardSticker } | { kind: "group"; group: Grouping; members: BoardSticker[] };
function unitsOf(list: BoardSticker[]): Unit[] {
  const out: Unit[] = [];
  const seen = new Set<string>();
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (!s.group) {
      out.push({ kind: "one", s });
      continue;
    }
    if (seen.has(s.group)) continue;
    seen.add(s.group);
    const group = groups.value.find((g) => g.id === s.group) ?? { id: s.group, name: "Group" };
    out.push({ kind: "group", group, members: list.filter((m) => m.group === s.group) });
  }
  return out.reverse();
}
const flatten = (units: Unit[]) => units.flatMap((u) => (u.kind === "one" ? [u.s] : u.members));
const normalize = () => (stickers.value = flatten(unitsOf(stickers.value)));

// ---- derived ------------------------------------------------------------------
const byUid = (uid: string) => stickers.value.find((s) => s.uid === uid);
const members = (groupId: string) => stickers.value.filter((s) => s.group === groupId);
/**
 * What a move, a turn, a nudge, a copy or a removal acts on: the selection AND
 * the whole link of every selected sticker. A link is "move and turn as one",
 * so it is never split by what happens to be selected — a link made or broken
 * on the slots' chains takes effect at once, whatever was picked before.
 */
const sel = computed(() => {
  const ids = new Set(selected.value);
  for (const st of stickers.value) if (ids.has(st.uid) && st.group) for (const m of members(st.group)) ids.add(m.uid);
  return stickers.value.filter((st) => ids.has(st.uid));
});
/** sel as ids: what the board lights and the slot rows mark. */
const selSet = computed(() => new Set(sel.value.map((st) => st.uid)));
const selIds = () => new Set(selSet.value);
/** The one grouping the selection is exactly, if it is one. */
const selGroup = computed(() => {
  const g = sel.value[0]?.group;
  if (!g || !sel.value.every((s) => s.group === g)) return null;
  return members(g).length === sel.value.length ? (groups.value.find((x) => x.id === g) ?? null) : null;
});
const tooMany = computed(() => sel.value.length > MAX_PER_GROUPING);
const canGroup = computed(() => sel.value.length >= 2 && !tooMany.value && !selGroup.value);
/** What Save keeps: the whole mat — one mat is one gun's slots, so one craft
 *  (decided with Luke). The selection only picks what to move. */
const keep = computed(() => stickers.value);
const canSave = computed(() => keep.value.length >= 1);
const boardFull = computed(() => stickers.value.length >= MAX_ON_BOARD);
const centroid = (list: { x: number; y: number }[]) => ({
  x: list.reduce((a, s) => a + s.x, 0) / Math.max(1, list.length),
  y: list.reduce((a, s) => a + s.y, 0) / Math.max(1, list.length),
});
/** Onto the area stickers may go (workArea): the home grid, or the chalked weapon and room round it. */
const clampX = (x: number) => Math.min(workArea.value.x1, Math.max(workArea.value.x0, x));
const clampY = (y: number) => Math.min(workArea.value.y1, Math.max(workArea.value.y0, y));
/** -180..180 in the game's half-degree steps (CS2_STICKER_ROTATION_STEP). */
const normDeg = (d: number) => {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return Math.round(r * 2) / 2;
};

/** The layer list, top-most first: blocks for groupings, rows for the rest. */
const layerUnits = computed(() => [...unitsOf(stickers.value)].reverse());
// ---- the slots (decided: "Seams") ----------------------------------------------------
// The mat's stickers as a gun's slots, top to bottom: slot 1 is stickers[0],
// the bottom of the draw order, and slot 5 draws on top. A LINK is a grouping
// (they move and turn as one), made on the seam between two neighbours: a
// chain in the left gutter. Links join up — 2, 3, 4 or all 5 — and a click on
// a linked seam splits them there. normalize() keeps a link's stickers next to
// each other, so a link is always one run of slots and drags as one block.
const LINK_COLORS = ["#5cc8e8", "#c48cf0", "#7ee08a"] as const;
/** By the link's place in `groups` (creation order): a link keeps its colour while it lives. */
const linkColor = (gid: string) => LINK_COLORS[Math.max(0, groups.value.findIndex((g) => g.id === gid)) % LINK_COLORS.length];
/** Draggable units in slot order: a loose sticker, or a whole link. */
const slotUnits = computed(() =>
  unitsOf(stickers.value).map((u) =>
    u.kind === "one"
      ? { key: u.s.uid, rows: [u.s], color: null as string | null }
      : { key: u.group.id, rows: u.members, color: linkColor(u.group.id) as string | null },
  ),
);
const slotIndex = computed(() => new Map(stickers.value.map((st, i) => [st.uid, i])));
/** The seam under a sticker (to the next slot): linked, open, or none (the last). */
function seamAt(uid: string): "linked" | "open" | null {
  const i = slotIndex.value.get(uid);
  if (i == null || i + 1 >= stickers.value.length) return null;
  const a = stickers.value[i];
  return a.group && a.group === stickers.value[i + 1].group ? "linked" : "open";
}
/** Click a seam: link the two neighbours (joining their links), or split a link there. */
function toggleSeam(uid: string) {
  const i = slotIndex.value.get(uid);
  const list = stickers.value;
  if (i == null || i + 1 >= list.length) return;
  const a = list[i];
  const b = list[i + 1];
  if (a.group && a.group === b.group) {
    const old = a.group;
    const g = { id: newId(), name: nextGroupName() };
    groups.value = [...groups.value, g];
    for (let j = i + 1; j < list.length && list[j].group === old; j++) list[j].group = g.id;
  } else {
    let gid = a.group ?? b.group;
    if (!gid) {
      const g = { id: newId(), name: nextGroupName() };
      groups.value = [...groups.value, g];
      gid = g.id;
    }
    const absorbed = a.group && b.group && a.group !== b.group ? b.group : null;
    if (absorbed) for (const st of list) if (st.group === absorbed) st.group = gid;
    a.group = gid;
    b.group = gid;
  }
  pruneGroups();
  normalize();
  // The selection follows: the sticker above the chain, with whatever it is
  // linked to now — both after linking, itself alone after unlinking.
  selected.value = new Set([a.uid]);
}

// ---- selection ------------------------------------------------------------------
/**
 * A click selects what you would expect to MOVE: the whole grouping when the
 * sticker is in one. Alt-click reaches a single member; shift adds or removes.
 */
function pick(uid: string | null, mods: { shift: boolean; alt: boolean }) {
  if (!uid) {
    if (!mods.shift) selected.value = new Set();
    return;
  }
  const s = byUid(uid);
  if (!s) return;
  const unit = s.group && !mods.alt ? members(s.group).map((m) => m.uid) : [uid];
  if (mods.shift) {
    const next = new Set(selected.value);
    const all = unit.every((u) => next.has(u));
    for (const u of unit) {
      if (all) next.delete(u);
      else next.add(u);
    }
    selected.value = next;
  } else if (!selected.value.has(uid) || mods.alt) {
    // Pressing a sticker that is already part of the selection keeps the
    // selection, so a drag carries everything that was picked.
    selected.value = new Set(unit);
  }
}
const selectAll = () => (selected.value = new Set(stickers.value.map((s) => s.uid)));
const selectGroup = (id: string, shift: boolean) => {
  const ids = members(id).map((m) => m.uid);
  selected.value = shift ? new Set([...selected.value, ...ids]) : new Set(ids);
};
/** A slot row selects its sticker's whole link, as a click on the mat does. */
const selectLayer = (uid: string, shift: boolean) => pick(uid, { shift, alt: false });
// ---- a finger's selection -------------------------------------------------------
// No Shift, no Alt on a phone. "Add" makes a tap on the mat add to the
// selection (a press on one already in it keeps it, so a drag still carries
// the lot), and the chooser lists the mat — a whole grouping, one sticker of
// one, a loose one — for what Alt-click and Shift-click reach on a desktop.
const tapAdd = ref(false);
const chooser = ref(false);
function pickFromBoard(uid: string | null, mods: { shift: boolean; alt: boolean }) {
  if (tapAdd.value && uid) {
    if (!selected.value.has(uid)) pick(uid, { shift: true, alt: mods.alt });
    return;
  }
  pick(uid, mods);
}
/** Select these: instead of the selection, or added to it with Add on. */
function choose(ids: string[]) {
  selected.value = tapAdd.value ? new Set([...selected.value, ...ids]) : new Set(ids);
  if (!tapAdd.value) chooser.value = false;
}
const chooseAll = () => {
  selectAll();
  chooser.value = false;
};
const chooseNone = () => {
  selected.value = new Set();
  chooser.value = false;
};
const chooseGroup = (id: string) => choose(members(id).map((m) => m.uid));
const chooseOne = (uid: string) => choose([uid]);
watch(
  () => props.compact,
  (c) => {
    if (!c) {
      tapAdd.value = false;
      chooser.value = false;
    }
  },
);


// ---- editing --------------------------------------------------------------------
function patchSelected(fn: (s: BoardSticker) => void) {
  for (const s of sel.value) fn(s);
}
/** Move the selection by this much, in the RULERS' centimetres (cmPerUnit). */
function nudge(dx: number, dy: number) {
  const f = matLayout.value.cmPerUnit;
  patchSelected((s) => {
    s.x = clampX(Math.round((s.x + dx / f) * 100) / 100);
    s.y = clampY(Math.round((s.y + dy / f) * 100) / 100);
  });
}
type Pose = { x: number; y: number; rot: number };
/** Turn stickers from a remembered pose about a centre: positions swing, each sticker turns. */
function turnFrom(from: Map<string, Pose>, c: { x: number; y: number }, deg: number) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  for (const s of stickers.value) {
    const f = from.get(s.uid);
    if (!f) continue;
    const dx = f.x - c.x;
    const dy = f.y - c.y;
    // y runs DOWN the mat, so this is clockwise on screen for a positive angle.
    s.x = clampX(Math.round((c.x + dx * cos - dy * sin) * 100) / 100);
    s.y = clampY(Math.round((c.y + dx * sin + dy * cos) * 100) / 100);
    s.rot = normDeg(f.rot + deg);
  }
}
const poses = () => new Map(sel.value.map((s): [string, Pose] => [s.uid, { x: s.x, y: s.y, rot: s.rot }]));
function rotateSelection(deg: number) {
  if (sel.value.length) turnFrom(poses(), centroid(sel.value), deg);
}
/** The X / Y fields read off the mat's rulers: centimetres from their zero,
 *  in the chalked weapon's own centimetres (MatLayout). */
const rulerX = (x: number) => (x - matLayout.value.x0) * matLayout.value.cmPerUnit;
const rulerY = (y: number) => (y - matLayout.value.y0) * matLayout.value.cmPerUnit;
/** One row's fields (StickerRow): X / Y in the rulers' centimetres, ROT in degrees. */
function setPlace(uid: string, key: "x" | "y" | "r", v: number) {
  const s = stickers.value.find((x) => x.uid === uid);
  if (!s || !Number.isFinite(v)) return;
  const l = matLayout.value;
  if (key === "x") s.x = clampX(Math.round((l.x0 + v / l.cmPerUnit) * 100) / 100);
  else if (key === "y") s.y = clampY(Math.round((l.y0 + v / l.cmPerUnit) * 100) / 100);
  else s.rot = normDeg(v);
}
function setStickerWear(uid: string, w: number) {
  const s = stickers.value.find((x) => x.uid === uid);
  if (s && Number.isFinite(w)) s.wear = w;
}
/** A row's own Remove and Duplicate: that sticker, whatever else is selected. */
function removeOne(uid: string) {
  selected.value = new Set([uid]);
  removeSelection();
}
function duplicateOne(uid: string) {
  selected.value = new Set([uid]);
  duplicateSelection();
}
/** X / Y / ROT on every row, like the gun's sticker section. */
/** Where each sticker sits in the stack, from the bottom: the slot it takes,
 *  in order, when the layout goes onto a gun. */
const stackNo = computed(() => new Map(stickers.value.map((s, i) => [s.uid, i + 1])));
/** One mat sticker as a StickerRow — the gun's own row. */
const rowProps = (s: BoardSticker) => ({
  image: s.image,
  name: stripName(s.name),
  label: String(stackNo.value.get(s.uid) ?? ""),
  wear: s.wear,
  x: rulerX(s.x),
  y: rulerY(s.y),
  r: s.rot,
  unit: "cm",
  step: 0.1,
  selected: selSet.value.has(s.uid),
  grip: stickers.value.length > 1,
  copyable: true,
  coarse: props.compact,
});

/** Groupings left with one member are no grouping at all. */
function pruneGroups() {
  const counts = new Map<string, number>();
  for (const s of stickers.value) if (s.group) counts.set(s.group, (counts.get(s.group) ?? 0) + 1);
  for (const s of stickers.value) if (s.group && (counts.get(s.group) ?? 0) < 2) s.group = null;
  groups.value = groups.value.filter((g) => (counts.get(g.id) ?? 0) >= 2);
}
function nextGroupName() {
  const used = new Set(groups.value.map((g) => g.name));
  let n = groups.value.length + 1;
  while (used.has(`Group ${n}`)) n++;
  return `Group ${n}`;
}
function groupSelection() {
  if (!canGroup.value) return;
  const g = { id: newId(), name: nextGroupName() };
  groups.value = [...groups.value, g];
  patchSelected((s) => (s.group = g.id));
  pruneGroups();
  normalize();
}
function ungroupSelection() {
  patchSelected((s) => (s.group = null));
  pruneGroups();
}
function renameGroup(id: string, name: string) {
  const g = groups.value.find((x) => x.id === id);
  if (g && name.trim()) g.name = name.trim().slice(0, 40);
}
/** Take the selection off the mat, behind an Undo. */
function removeSelection() {
  if (!sel.value.length) return;
  const n = sel.value.length;
  const label = n === 1 ? `Removed “${stripName(sel.value[0].name)}”` : `Removed ${n} stickers`;
  const picked = new Set(selected.value);
  const removed = takeOff((s) => !picked.has(s.uid));
  offerUndo(label, () => putBack(removed));
}
/** Copies land 1 cm down-right. Whole groupings copied become new groupings. */
function duplicateSelection() {
  if (!sel.value.length || stickers.value.length + sel.value.length > MAX_ON_BOARD) return;
  const remap = new Map<string, string>();
  const made: BoardSticker[] = [];
  for (const s of sel.value) {
    let group: string | null = null;
    if (s.group && members(s.group).every((m) => selSet.value.has(m.uid))) {
      if (!remap.has(s.group)) {
        const old = groups.value.find((g) => g.id === s.group);
        const g = { id: newId(), name: `${old?.name ?? "Group"} copy` };
        groups.value = [...groups.value, g];
        remap.set(s.group, g.id);
      }
      group = remap.get(s.group)!;
    }
    // A copy is in no saved craft: Update stays with the originals.
    made.push({ ...toRaw(s), uid: newId(), x: clampX(s.x + 1), y: clampY(s.y + 1), group, craft: null });
  }
  stickers.value = [...stickers.value, ...made];
  selected.value = new Set(made.map((s) => s.uid));
  board.value?.flash(made.map((s) => s.uid));
}
// ---- layer list: drag to reorder ---------------------------------------------------
// The phone-style reorder shared with the gun's sticker list (useSortableList):
// the row lifts and follows, the rest make room, it settles, then the list
// reorders. A press that doesn't move is a click (it selects).
//
// Two kinds of list: "top" is the mat's units, top-most first; "g:<id>" is one
// grouping's members. A sticker never leaves its grouping by being dragged.
const rootEl = ref<HTMLElement | null>(null);
const sorting = useSortableList({ onMove: (list, from, to) => reorder(list, from, to) });
/** Move a row of a list (indices as SHOWN: top-most first). */
function reorder(list: string, from: number, to: number) {
  const units = unitsOf(stickers.value);
  // The slots: units in slot order (slot 1 first), a link moving as one.
  if (list === "slots") {
    const [x] = units.splice(from, 1);
    units.splice(to, 0, x);
    stickers.value = flatten(units);
    return;
  }
  const move = <T,>(shown: T[]) => {
    const [x] = shown.splice(from, 1);
    shown.splice(to, 0, x);
    return shown.reverse();
  };
  if (list === "top") {
    stickers.value = flatten(move([...units].reverse()));
    return;
  }
  const u = units.find((x) => x.kind === "group" && x.group.id === list.slice(2));
  if (u?.kind !== "group") return;
  u.members = move([...u.members].reverse());
  stickers.value = flatten(units);
}

// ---- undo and notices ----------------------------------------------------------
// The panel's way with a delete (the inventory's Undo toast): it happens at
// once, and for a few seconds it can be taken back. One at a time — a second
// delete settles the first. A saved craft's server delete waits out the window
// (`commit`), so Undo never has anything to put back on the server.
type Undoable = { label: string; undo: () => void; commit?: () => void };
const undoable = ref<Undoable | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;
const UNDO_MS = 6000;
function settleUndo() {
  const u = undoable.value;
  undoable.value = null;
  clearTimeout(undoTimer);
  u?.commit?.();
}
function offerUndo(label: string, undo: () => void, commit?: () => void) {
  settleUndo();
  undoable.value = { label, undo, commit };
  undoTimer = setTimeout(settleUndo, UNDO_MS);
}
function runUndo() {
  const u = undoable.value;
  if (!u) return;
  undoable.value = null;
  clearTimeout(undoTimer);
  u.undo();
}
/** A word on what just happened — published, updated, or a write that failed — in the host's toast. */
const say = (text: string, error = false) => emit("notify", text, error ? "error" : "success");
/**
 * What a removal took off the mat, to put back on Undo: each sticker with its
 * place in the draw order, the groupings it was in, and the stickers left alone
 * in a grouping it emptied. Only that — not a picture of the whole mat, which
 * put back would also undo whatever was moved or added in the seconds since.
 */
type Removed = { stickers: { s: BoardSticker; at: number }[]; groups: Grouping[]; ungrouped: { uid: string; group: string }[] };
function takeOff(keep: (s: BoardSticker) => boolean): Removed {
  const taken: Removed["stickers"] = [];
  stickers.value.forEach((s, at) => !keep(s) && taken.push({ s: { ...toRaw(s) }, at }));
  const theirs = new Set(taken.map((t) => t.s.group).filter((g): g is string => !!g));
  const before = new Map(stickers.value.filter(keep).map((s) => [s.uid, s.group]));
  const lost = groups.value.filter((g) => theirs.has(g.id)).map((g) => ({ ...g }));
  stickers.value = stickers.value.filter(keep);
  selected.value = new Set();
  pruneGroups();
  const ungrouped = stickers.value.flatMap((s) => (s.group === null && before.get(s.uid) ? [{ uid: s.uid, group: before.get(s.uid)! }] : []));
  return { stickers: taken, groups: lost, ungrouped };
}
function putBack(r: Removed) {
  const next = stickers.value.slice();
  for (const { s, at } of r.stickers) next.splice(Math.min(at, next.length), 0, s);
  const have = new Set(groups.value.map((g) => g.id));
  groups.value = [...groups.value, ...r.groups.filter((g) => !have.has(g.id))];
  for (const u of r.ungrouped) {
    const s = next.find((x) => x.uid === u.uid);
    if (s && s.group === null) s.group = u.group;
  }
  stickers.value = next;
  selected.value = new Set(r.stickers.map((t) => t.s.uid));
  pruneGroups();
  normalize();
}
function clearBoard() {
  if (!stickers.value.length) return;
  nameDraft.value = null;
  const removed = takeOff(() => false);
  offerUndo("Cleared the mat", () => putBack(removed));
}

// ---- the library ------------------------------------------------------------------
/**
 * Draw a craft's preview on the board and keep it with the entry — and, given
 * where its stickers lie on the mat (`onMat`) with a weapon chalked under them,
 * its proposed use as well. One write for both, so neither save can land over
 * the other.
 */
async function renderPreview(id: string, onMat?: CraftSticker[]) {
  const b = board.value;
  const entry = library.value.find((e) => e.id === id);
  if (!b || !entry) return;
  try {
    const top = await b.snapshot(toRaw(entry.stickers).map((s) => toRaw(s)));
    const use = onMat ? await shootUseCase(onMat).catch(() => null) : null;
    const now = library.value.find((e) => e.id === id);
    if (!now) return;
    // On screen at once, from this browser's own copy, until the stored one is back.
    showPicture(now, "top", URL.createObjectURL(top));
    if (use) now.useCase = { model: use.model, weapon: use.weapon };
    await track(storePictures(now, { top, use: use?.picture }));
  } catch {
    /* no preview is a plainer card, not an error */
  }
}
/** Point a craft at one of its pictures, letting go of a local copy it replaces. */
function showPicture(entry: SavedCraft, kind: "top" | "use", url: string) {
  const old = kind === "top" ? entry.preview : entry.useCase?.image;
  if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
  if (kind === "top") {
    entry.preview = url;
    entry.previewV = PREVIEW_VERSION;
  } else if (entry.useCase) entry.useCase = { ...entry.useCase, image: url };
}
/** The craft's row first (a picture is stored against a saved craft), then its pictures. */
async function storePictures(entry: SavedCraft, pictures: { top?: Blob; use?: Blob }) {
  await storeCraft(entry);
  const urls = await saveCraftPictures(entry.id, pictures);
  const now = library.value.find((e) => e.id === entry.id);
  if (!now) return;
  if (urls.top) showPicture(now, "top", urls.top);
  if (urls.use) showPicture(now, "use", urls.use);
}

// ---- a craft's proposed use -------------------------------------------------------
/**
 * A craft saved (or published) with a weapon's Outline chalked under it keeps
 * a picture of itself on that outline and the weapon's name: where its author
 * means it to go on which gun. It travels into the Craft Store with the craft
 * and opens from the info chip on its tile (CraftUseCase).
 */
const weaponName = (model: string) => props.weapons.find((w) => w.model === model)?.name ?? model;
/** Whether any of these stickers (mat places) sits on the chalked weapon's box. */
function onOutline(list: { x: number; y: number }[]): boolean {
  const o = outline.value;
  if (!o) return false;
  return list.some((s) => Math.abs(s.x - GRID_W / 2) <= o.w / 2 && Math.abs(s.y - GRID_H / 2) <= o.h / 2);
}
/** Mat stickers as plain craft stickers, where they lie now. */
const matCopy = (list: BoardSticker[]): CraftSticker[] =>
  list.map((s) => ({ id: s.id, name: s.name, image: s.image, x: s.x, y: s.y, rot: s.rot, wear: s.wear }));
/** The craft on the chalked weapon, or null: no weapon chalked, or the craft off it. */
async function shootUseCase(onMat: CraftSticker[]): Promise<{ model: string; weapon: string; picture: Blob } | null> {
  const b = board.value;
  const o = outline.value;
  if (!b || !o || !onMat.length || !onOutline(onMat)) return null;
  const weapon = weaponName(o.model);
  const picture = await b.useCaseShot(onMat, weapon);
  return picture ? { model: o.model, weapon, picture } : null;
}
/** The craft's own stickers on the mat, as it is saved (same stickers, same layout), or null. */
function onMatAsSaved(entry: SavedCraft): BoardSticker[] | null {
  const list = stickers.value.filter((s) => s.craft === entry.id);
  if (list.length !== entry.stickers.length) return null;
  const c = centroid(list);
  const same = list.every((s, i) => {
    const e = entry.stickers[i];
    return e.image === s.image && Math.abs(s.x - c.x - e.x) < 0.06 && Math.abs(s.y - c.y - e.y) < 0.06 && Math.abs(s.rot - e.rot) < 0.6;
  });
  return same ? list : null;
}
/** `base`, or "base (2)", "base (3)"… — the first no saved craft is called. */
function uniqueName(base: string) {
  const taken = new Set(library.value.map((c) => c.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
/** The card just saved: scrolled to and lit, so Save visibly did something. */
const justSaved = ref<string | null>(null);
let justSavedTimer: ReturnType<typeof setTimeout> | undefined;
/** The selection as a craft's stickers: about its own centre, in draw order
 *  (bottom first — on a gun that becomes slot order). */
function selectionLayout(): CraftSticker[] {
  const c = centroid(keep.value);
  return keep.value.map((s): CraftSticker => ({
    id: s.id,
    name: s.name,
    image: s.image,
    x: Math.round((s.x - c.x) * 100) / 100,
    y: Math.round((s.y - c.y) * 100) / 100,
    rot: s.rot,
    wear: s.wear,
  }));
}
/**
 * The saved craft the selection can write back to: the one craft its stickers
 * came from (laid down from it, or saved into it). Stickers from no craft may
 * join it; stickers from two different crafts make it ambiguous, and then only
 * Save as new is offered.
 */
const updateTarget = computed<SavedCraft | null>(() => {
  if (!canSave.value) return null;
  const from = new Set(keep.value.map((s) => s.craft).filter((c): c is string => !!c));
  if (from.size !== 1) return null;
  const [id] = from;
  return library.value.find((e) => e.id === id) ?? null;
});
/**
 * The craft's NAME, typed at the top of the panel. Untouched (null), it shows
 * the name of the craft the mat came from; Save uses what is typed (or
 * "Craft n"), Update renames the craft to it.
 */
const nameDraft = ref<string | null>(null);
const craftName = computed({
  get: () => nameDraft.value ?? updateTarget.value?.name ?? "",
  set: (v: string) => (nameDraft.value = v),
});
const typedName = () => (nameDraft.value ?? "").trim().slice(0, 40);
/** The gun this craft is for: the one chalked on the mat, else the one it was saved for. */
const useModel = computed(() => outlineModel.value || updateTarget.value?.useCase?.model || "");
const useWeapon = computed(() => props.weapons.find((w) => w.model === useModel.value) ?? null);
const useGunName = computed(() => useWeapon.value?.name ?? "gun");
/** The skin it would go on: yours, equipped — else none (a new plain one). */
const useSkin = computed(() => (useModel.value ? (props.equippedSkin?.(useModel.value) ?? null) : null));
const useEquipped = computed(() => !!useSkin.value);
/** The button's picture: that skin's 2D art, or the plain gun's. */
const useImage = computed(() => useSkin.value?.image ?? useWeapon.value?.image ?? null);
/**
 * Put the mat on a gun: your equipped one of that model, or a new one. The mat
 * is saved first (Update or Save), so the gun gets exactly what is on it.
 */
async function putOnGun() {
  const model = useModel.value;
  if (!model || !canSave.value) return;
  saveOrUpdate();
  const id = stickers.value[0]?.craft;
  if (!id) return;
  try {
    await lastPersist;
  } catch {
    say("Couldn't save the craft — try again", true);
    return;
  }
  // Where it sits on that gun's chalk, so the editor puts it there rather than
  // on its slots' default spots. The chalk's box is centred on the home grid.
  const o = outline.value?.model === model ? outline.value : null;
  const c = centroid(keep.value);
  const at = o ? { x: c.x - (GRID_W / 2 - o.w / 2), y: c.y - (GRID_H / 2 - o.h / 2), anchors: o.anchors } : null;
  emit("put-on-gun", id, model, at);
}
/** Enter in the name field: Update when the mat is a saved craft, else Save. */
function saveOrUpdate() {
  if (updateTarget.value) updateCraft();
  else saveSelection();
}
/** Light the card a save wrote, and bring it into view. */
function showSaved(id: string) {
  justSaved.value = id;
  clearTimeout(justSavedTimer);
  justSavedTimer = setTimeout(() => (justSaved.value = null), 1600);
}
function saveSelection() {
  if (!canSave.value) return;
  const entry: SavedCraft = {
    id: newId(),
    name: uniqueName(typedName() || `Craft ${library.value.length + 1}`),
    savedAt: Date.now(),
    stickers: selectionLayout(),
  };
  library.value = [entry, ...library.value];
  nameDraft.value = null;
  // These stickers are that craft now: the next change can Update it.
  for (const st of stickers.value) st.craft = entry.id;
  persistCraft(entry);
  void renderPreview(entry.id, matCopy(keep.value));
  showSaved(entry.id);
}
/** Write the selection back over the craft it came from. A published craft's
 *  store copy follows (the server refreshes it on every save). */
function updateCraft() {
  const entry = updateTarget.value;
  if (!entry) return;
  const layout = selectionLayout();
  const moved = JSON.stringify(layout) !== JSON.stringify(toRaw(entry.stickers));
  entry.stickers = layout;
  if (typedName()) entry.name = typedName();
  nameDraft.value = null;
  entry.savedAt = Date.now();
  // The old picture is the old layout: draw it again. So is its proposed use,
  // which is drawn again too when a weapon is chalked under it — and kept, for
  // the same layout, when none is.
  delete entry.preview;
  delete entry.previewV;
  if (moved) delete entry.useCase;
  // Saved just now, so first — the panel shows the newest few.
  library.value = [entry, ...library.value.filter((e) => e !== entry)];
  for (const st of stickers.value) st.craft = entry.id;
  persistCraft(entry);
  void renderPreview(entry.id, matCopy(keep.value));
  showSaved(entry.id);
  say(published.value.has(entry.id) ? `Updated “${entry.name}” — the Craft Store has the new layout` : `Updated “${entry.name}”`);
}
/** Lay a saved craft down in the middle of the mat, as a grouping again. */
/**
 * Where a whole craft lands: the middle of the mat when it is clear there, else
 * the first spot of a 6.5 cm lattice where none of its stickers comes near one
 * already down and all of them stay on the grid — so a second craft no longer
 * lands on the first. Nowhere clear: the middle.
 */
function craftSpot(list: { x: number; y: number }[]): { x: number; y: number } {
  const half = STICKER_CM / 2;
  const a = workArea.value;
  const clear = (cx: number, cy: number) =>
    list.every((s) => {
      const x = cx + s.x;
      const y = cy + s.y;
      return (
        x >= a.x0 + half && x <= a.x1 - half && y >= a.y0 + half && y <= a.y1 - half &&
        !stickers.value.some((o) => Math.hypot(o.x - x, o.y - y) < STICKER_CM * 0.9)
      );
    });
  // The middle of what you are looking at, as for a single sticker.
  const mid = board.value?.viewCentre() ?? { x: GRID_W / 2, y: GRID_H / 2 };
  if (clear(mid.x, mid.y)) return mid;
  for (let y = a.y0 + 6; y <= a.y1 - 2; y += 6.5) {
    for (let x = a.x0 + 6; x <= a.x1 - 2; x += 6.5) if (clear(x, y)) return { x, y };
  }
  return mid;
}
/** Someone else's craft from the store, not one of yours. */
const othersCraft = (entry: SavedCraft | StoreCraft) => "author" in entry && !(entry as StoreCraft).mine;
/**
 * Lay a craft down on the mat, as a grouping again, selected. One of yours
 * stays linked to it (Update writes back); someone else's from the store is a
 * copy to make your own, named so. False when the mat has no room for it.
 */
function placeSaved(entry: SavedCraft | StoreCraft): boolean {
  if (stickers.value.length + entry.stickers.length > MAX_ON_BOARD) return false;
  const theirs = othersCraft(entry);
  const g = entry.stickers.length > 1 ? { id: newId(), name: theirs ? `${entry.name} (my copy)` : entry.name } : null;
  if (g) groups.value = [...groups.value, g];
  const at = craftSpot(entry.stickers);
  const made = entry.stickers.map((s) => ({
    ...toRaw(s),
    uid: newId(),
    x: clampX(at.x + s.x),
    y: clampY(at.y + s.y),
    group: g?.id ?? null,
    craft: theirs ? null : entry.id,
  }));
  stickers.value = [...stickers.value, ...made];
  selected.value = new Set(made.map((s) => s.uid));
  board.value?.flash(made.map((s) => s.uid));
  return true;
}
function renameSaved(entry: SavedCraft, name: string) {
  if (!name.trim()) return;
  entry.name = name.trim().slice(0, 40);
  persistCraft(entry);
}
/** Crafts with a publish request in flight: the switch waits, and a second
 *  press can't undo the first before it has landed. */
const publishing = ref<Set<string>>(new Set());
/**
 * Put a craft in the Craft Store for everyone on the panel, or take it out. The
 * store shows the craft as it is SAVED, so its latest save goes first.
 */
async function togglePublish(entry: SavedCraft) {
  if (!loaded.value || publishing.value.has(entry.id)) return;
  const on = !published.value.has(entry.id);
  publishing.value = new Set([...publishing.value, entry.id]);
  const write = (async () => {
    if (on) {
      // On the mat as saved, on a chalked weapon: publish with its place on
      // that weapon as it lies now.
      const lying = onMatAsSaved(entry);
      const use = lying ? await shootUseCase(matCopy(lying)).catch(() => null) : null;
      if (use) {
        entry.useCase = { model: use.model, weapon: use.weapon };
        await storePictures(entry, { use: use.picture });
      } else await storeCraft(entry);
    }
    await setPublished(entry.id, on);
    const next = new Set(published.value);
    if (on) next.add(entry.id);
    else next.delete(entry.id);
    published.value = next;
  })();
  try {
    await track(write);
    await write;
    say(
      !on
        ? `“${entry.name}” is private again`
        : entry.useCase
          ? `“${entry.name}” is in the Craft Store, shown on the ${entry.useCase.weapon} — everyone on the panel can use it`
          : `“${entry.name}” is in the Craft Store — to show which gun it's for, pick an Outline under it on the mat and press Update`,
    );
  } catch {
    say(on ? `Couldn't publish “${entry.name}” — try again` : `Couldn't take “${entry.name}” out of the store — try again`, true);
  } finally {
    publishing.value = new Set([...publishing.value].filter((x) => x !== entry.id));
  }
}
/** Delete a saved craft, behind an Undo: the server delete (which also takes
 *  it out of the store) waits until the Undo has gone. */
function deleteSaved(id: string) {
  const at = library.value.findIndex((e) => e.id === id);
  if (at < 0) return;
  const entry = library.value[at];
  const wasPublic = published.value.has(id);
  library.value = library.value.filter((e) => e.id !== id);
  if (wasPublic) published.value = new Set([...published.value].filter((x) => x !== id));
  offerUndo(
    wasPublic ? `Deleted “${entry.name}” and took it out of the Craft Store` : `Deleted “${entry.name}”`,
    () => {
      const next = library.value.slice();
      next.splice(Math.min(at, next.length), 0, entry);
      library.value = next;
      if (wasPublic) published.value = new Set([...published.value, id]);
    },
    () => {
      if (loaded.value) void track(deleteCraft(id));
    },
  );
}

// ---- adding stickers --------------------------------------------------------------
const pickerError = ref<string | null>(null);
const pickerView = useAttachmentPicker({
  inventory: toRef(props, "inventory"),
  attachedName: (inst) => props.attachedName(inst),
  fail: (e) => (pickerError.value = e instanceof Error ? e.message : String(e)),
  // A craft laid on the mat needs room on it, and is a grouping of five at most.
  craftRoom: () => Math.min(MAX_PER_GROUPING, MAX_ON_BOARD - stickers.value.length),
  // This tab's own crafts, live: one published or deleted from the picker's
  // tiles shows at once, and nothing is fetched twice.
  library,
  published,
  scores,
});
const { picker, openPicker } = pickerView;
/** The picker straight on a Sticker Crafts shelf: the Craft Store, or all of yours. */
function openCrafts(scope: "mine" | "store") {
  openPicker("sticker");
  pickerView.pickerSource.value = "crafts";
  pickerView.craftsScope.value = scope;
}
/** The picker says what it is showing: on a crafts shelf it is no sticker picker. */
/**
 * Where a new sticker lands: the middle of what the camera is looking at (where
 * it is turned does not matter — a new sticker is never turned), or the clear
 * spot nearest to it, so a few picked in a row lie side by side instead of on
 * top of each other. Nowhere clear: the middle anyway.
 */
function freeSpot(): { x: number; y: number } {
  const v = board.value?.viewCentre() ?? { x: GRID_W / 2, y: GRID_H / 2 };
  // To the tenth of a centimetre the fields and the nudge keys work in.
  const c = { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10 };
  const half = STICKER_CM / 2;
  const a = workArea.value;
  const clear = (x: number, y: number) =>
    x >= a.x0 + half && x <= a.x1 - half && y >= a.y0 + half && y <= a.y1 - half &&
    !stickers.value.some((s) => Math.hypot(s.x - x, s.y - y) < STICKER_CM * 0.9);
  if (!stickers.value.some((s) => Math.hypot(s.x - c.x, s.y - c.y) < STICKER_CM * 0.9)) return c;
  // Rings round the middle, a sticker and a bit apart, nearest first.
  for (let ring = 1; ring <= 6; ring++) {
    const r = ring * (STICKER_CM + 1);
    const steps = ring * 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      if (clear(x, y)) return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    }
  }
  return c;
}
function addSticker(row: PickerRow) {
  picker.value = null;
  if (!row.image || boardFull.value) return;
  const at = freeSpot();
  const s: BoardSticker = {
    uid: newId(),
    id: row.id,
    name: row.name,
    image: row.image,
    x: at.x,
    y: at.y,
    rot: 0,
    wear: row.wear ?? 0,
    group: null,
  };
  stickers.value = [...stickers.value, s];
  selected.value = new Set([s.uid]);
  board.value?.flash([s.uid]);
}
/** The picker's Sticker Crafts tab, opened from here: lay the craft on the mat. */
function addCraft(entry: SavedCraft | StoreCraft) {
  picker.value = null;
  openOnMat(entry);
}
/** A craft's name being edited on its picker tile (See all). */
const renaming = ref<string | null>(null);
/** v-focus: the rename field takes the keyboard, its text selected. */
const vFocus = {
  mounted: (el: HTMLInputElement) => {
    el.focus();
    el.select();
  },
};
function finishRename(entry: SavedCraft, name: string) {
  renaming.value = null;
  renameSaved(entry, name);
}

// ---- the chalk outline, and the mat's size -----------------------------------------
/**
 * A weapon chalked on the mat at sticker scale, to check a layout's size and
 * place against the gun it is for. The model key of the weapon, or "" for none;
 * remembered in this browser.
 *
 * A gun's outline is traced from its own model, shape only (weaponOutline +
 * traceOutline), by the first browser to pick it after an extraction, and
 * stored for everyone (/api/catalog/weapon-outline) — so after that a pick
 * lands at once.
 */
const outlineModel = usePersistedString("cs2inv.stickerCrafts.outline", "");
const outlineBusy = ref(false);
const outlineError = ref(false);
/** Outlines fetched or traced this visit, by model. */
const outlines = shallowRef<Map<string, WeaponOutline>>(new Map());
const outline = computed<WeaponOutline | null>(() => outlines.value.get(outlineModel.value) ?? null);
/**
 * The stored outline, or a fresh trace of the model, which is then stored —
 * calibrated against the gun's own slots on the way in (calibrateOutline), so
 * a layout on the chalk lands on the gun where it was laid out. The stored
 * copy stays as traced.
 */
async function outlineFor(model: string): Promise<WeaponOutline | null> {
  const [stored, geo, trace] = await Promise.all([
    fetchWeaponOutline(model),
    fetchStickerGeometry(model),
    import("../outlineTrace"),
  ]);
  if (stored) return trace.calibrateOutline(stored, geo.slots);
  // Through the lazy edge, so three comes down alongside the viewer's chunk.
  const { weaponOutline } = await viewer3d();
  const side = await weaponOutline(model, geo.slots);
  const traced = side ? trace.traceOutline(model, side) : null;
  // Kept for the next player; this one has it either way.
  if (traced) void saveWeaponOutline(traced).catch(() => {});
  return traced ? trace.calibrateOutline(traced, geo.slots) : null;
}
let outlineToken = 0;
/** The first outline's load, which the board waits for (see onMounted). */
let outlineReady: Promise<void> = Promise.resolve();
watch(
  outlineModel,
  (model) => {
    const token = ++outlineToken;
    outlineError.value = false;
    outlineBusy.value = false;
    if (!model || outlines.value.has(model)) return;
    outlineBusy.value = true;
    outlineReady = outlineFor(model)
      .then((o) => {
        if (token !== outlineToken) return;
        if (o) outlines.value = new Map(outlines.value).set(model, o);
        outlineError.value = !o;
      })
      .catch(() => {
        if (token === outlineToken) outlineError.value = true;
      })
      .finally(() => {
        if (token === outlineToken) outlineBusy.value = false;
      });
  },
  { immediate: true },
);
/** The weapons that take stickers, by kind: the outline cards, in this order. */
const OUTLINE_KINDS = ["rifle", "smg", "heavy", "secondary"] as const;
/** The guns most crafts are for come first (AK-47, M4A4, M4A1-S, AWP, Desert
 *  Eagle, Glock-18, USP-S); the rest follow by kind, then by name. */
const OUTLINE_FIRST = ["ak47", "m4a1", "m4a1_silencer", "awp", "deagle", "glock", "usp_silencer"];
const outlineRank = (model: string) => {
  const i = OUTLINE_FIRST.indexOf(model);
  return i < 0 ? OUTLINE_FIRST.length : i;
};
const outlineItems = computed<RailItem[]>(() => [
  { key: "none", name: tr("inventory.stickerCrafts.noOutline", "No outline"), short: tr("inventory.stickerCrafts.outlineNone", "None") },
  ...OUTLINE_KINDS.flatMap((kind) => props.weapons.filter((w) => w.category === kind).sort((a, b) => a.name.localeCompare(b.name)))
    // A stable sort: the first seven move to the front, the rest keep their order.
    .sort((a, b) => outlineRank(a.model) - outlineRank(b.model))
    .map((w) => ({ key: w.model, name: w.name, short: w.name })),
]);
/**
 * A card's drawing: the game's own buy-menu glyph for the gun (extracted to
 * /anims/icons/<model>.svg, see cs2-equipment-icons). It is a currentColor
 * silhouette, so it is drawn as a mask in the text colour — an <img> would
 * paint it black — and rests grey and lights up like the knife and glove rail.
 */
const glyphStyle = (model: string) => {
  const url = `url("${assetUrl(`/anims/icons/${model}.svg`)}")`;
  return { maskImage: url, WebkitMaskImage: url };
};

// ---- your crafts, following the chalked gun ------------------------------------
/**
 * Which gun's crafts the lower pane lists: the model, "" for every craft, or
 * "none" for those made with no gun chalked. It FOLLOWS the mat: chalk a gun
 * and the list turns to that gun's crafts; the selector picks another.
 */
const craftsGun = ref<string>(outlineModel.value);
watch(outlineModel, (m) => (craftsGun.value = m));
const craftsQuery = ref("");
const craftGunName = computed(() =>
  craftsGun.value === "none" ? "no gun" : (props.weapons.find((w) => w.model === craftsGun.value)?.name ?? craftsGun.value),
);
/** The selector: every gun that has crafts, the chalked one even with none, all, and no gun. */
const craftGunOptions = computed(() => {
  const counts = new Map<string, number>();
  let none = 0;
  for (const c of library.value) {
    const m = c.useCase?.model;
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    else none++;
  }
  if (outlineModel.value && !counts.has(outlineModel.value)) counts.set(outlineModel.value, 0);
  const guns = [...counts]
    .map(([model, count]) => ({ value: model, label: props.weapons.find((w) => w.model === model)?.name ?? model, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "", label: "All guns", count: library.value.length }, ...guns, ...(none ? [{ value: "none", label: "No gun", count: none }] : [])];
});
/** The gallery's cards: the chosen gun's crafts matching the search (name or a sticker's), newest first. */
const shownCrafts = computed(() => {
  const q = craftsQuery.value.trim().toLowerCase();
  const gun = craftsGun.value;
  return library.value.filter(
    (c) =>
      (!gun || (gun === "none" ? !c.useCase?.model : c.useCase?.model === gun)) &&
      (!q || c.name.toLowerCase().includes(q) || c.stickers.some((st) => st.name.toLowerCase().includes(q))),
  );
});

// ---- one mat, and All crafts -------------------------------------------------------
// You work on one mat. Opening a craft — from All crafts, the picker or the
// Craft Store — REPLACES what is on it, with an Undo that puts that back
// (decided with Luke: no tabs, fewer sections). All crafts is every craft as
// a picture over the mat, with rename, publish and delete right on the cards.
const galleryOpen = ref(false);
/** The craft the mat holds now: every sticker on it came from that one. */
const matCraftId = computed(() => {
  const from = new Set(stickers.value.map((st) => st.craft ?? ""));
  const only = from.size === 1 ? [...from][0] : "";
  return only && library.value.some((c) => c.id === only) ? only : null;
});
function openOnMat(entry: SavedCraft | StoreCraft) {
  if (entry.stickers.length > MAX_ON_BOARD) return;
  nameDraft.value = othersCraft(entry) ? `${entry.name} (my copy)`.slice(0, 40) : null;
  const removed = takeOff(() => false);
  placeSaved(entry);
  galleryOpen.value = false;
  const what = othersCraft(entry) ? `“${entry.name}” is on the mat — Save keeps your own copy` : `Opened “${entry.name}”`;
  if (!removed.stickers.length) return say(what);
  offerUndo(what, () => {
    takeOff(() => false);
    putBack(removed);
  });
}

/**
 * Where stickers may go: the home grid — or, with a weapon chalked, the
 * weapon's box and OUTLINE_ROOM round it, centred on the home grid's middle
 * where the board chalks it. A small gun's mat is narrower than the home grid,
 * a long one's wider.
 */
const workArea = computed(() => {
  const o = outline.value;
  if (!o) return { x0: 0, y0: 0, x1: GRID_W, y1: GRID_H };
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    x0: r(GRID_W / 2 - o.w / 2 - OUTLINE_ROOM),
    y0: r(GRID_H / 2 - o.h / 2 - OUTLINE_ROOM),
    x1: r(GRID_W / 2 + o.w / 2 + OUTLINE_ROOM),
    y1: r(GRID_H / 2 + o.h / 2 + OUTLINE_ROOM),
  };
});
/** A sticker or turn handle being dragged: the mat holds its size till it's let go. */
const moving = ref(false);
let heldLayout: MatLayout = HOME_LAYOUT;
/**
 * The mat: the work area, grown to take in any sticker left outside it (put
 * down for a bigger gun, say), so nothing ever sits off the edge; its rulers
 * in the chalked weapon's centimetres.
 */
const matLayout = computed<MatLayout>(() => {
  if (moving.value) return heldLayout;
  const a = workArea.value;
  const pad = STICKER_CM / 2 + 0.5;
  let { x0, y0, x1, y1 } = a;
  for (const s of stickers.value) {
    x0 = Math.min(x0, s.x - pad);
    y0 = Math.min(y0, s.y - pad);
    x1 = Math.max(x1, s.x + pad);
    y1 = Math.max(y1, s.y + pad);
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  const o = outline.value;
  const next = { x0: r(x0), y0: r(y0), x1: r(x1), y1: r(y1), cmPerUnit: o ? o.stickerCm / STICKER_CM : 1 };
  const h = heldLayout;
  // The same numbers keep the same object, so the board isn't told twice.
  if (h.x0 === next.x0 && h.y0 === next.y0 && h.x1 === next.x1 && h.y1 === next.y1 && h.cmPerUnit === next.cmPerUnit) return h;
  return (heldLayout = next);
});
// ---- the board ----------------------------------------------------------------------
const stageEl = ref<HTMLElement | null>(null);
const board = shallowRef<StickerBoard | null>(null);
// The chalk and the mat's size follow the pick (and the board when it is made).
// A new weapon flies the view out or in to fit; the mat growing round a
// sticker left outside the work area leaves the camera be.
watch([outline, board], ([o, b]) => b?.setOutline(o), { immediate: true });
let layoutFor: WeaponOutline | null | undefined;
watch(
  [matLayout, board],
  ([l, b]) => {
    if (!b) return;
    const refit = layoutFor !== undefined && layoutFor !== outline.value;
    layoutFor = outline.value;
    b.setLayout(l, refit);
  },
  { immediate: true },
);
const boardError = ref<string | null>(null);
const boardLoading = ref(true);
let dragFrom: Map<string, { x: number; y: number }> | null = null;
let dragLead: string | null = null;
let turning: { from: Map<string, Pose>; c: { x: number; y: number } } | null = null;

watch(
  [stickers, selected],
  () => board.value?.sync(toRaw(stickers.value).map((s) => toRaw(s)), selIds()),
  { deep: true },
);
// Asked for here: fly there. Changed on the board by hand (tilting out of Top
// makes it Angled), the board is already there — only the buttons follow.
watch(boardView, (v) => {
  if (board.value && board.value.view() !== v) board.value.setView(v);
});

/** Mounts the 3D mat — on arrival, and again when the browser takes its WebGL context away. */
async function mountBoard() {
  boardError.value = null;
  boardLoading.value = true;
  try {
    // The chalked weapon's outline with three: the mat starts at its size
    // rather than growing to it as the view flies in.
    const [{ mountStickerBoard }] = await Promise.all([import("../stickerBoard"), outlineReady]);
    if (!stageEl.value) return;
    const b = await mountStickerBoard(stageEl.value, {
      pick: pickFromBoard,
      dragStart(uid) {
        moving.value = true;
        dragLead = uid;
        dragFrom = new Map(sel.value.map((s) => [s.uid, { x: s.x, y: s.y }]));
      },
      drag(dx, dy) {
        const lead = dragLead && dragFrom?.get(dragLead);
        if (!dragFrom || !lead) return;
        // Snap the sticker under the pointer to the grid and carry the rest by
        // the same amount, so a grouping keeps its own spacing.
        let nx = lead.x + dx;
        let ny = lead.y + dy;
        if (snap.value) {
          // On the rulers' half centimetres, which are the chalked weapon's.
          const l = matLayout.value;
          const step = SNAP_CM / l.cmPerUnit;
          nx = l.x0 + Math.round((nx - l.x0) / step) * step;
          ny = l.y0 + Math.round((ny - l.y0) / step) * step;
        }
        const ddx = nx - lead.x;
        const ddy = ny - lead.y;
        for (const s of stickers.value) {
          const from = dragFrom.get(s.uid);
          if (!from) continue;
          s.x = clampX(Math.round((from.x + ddx) * 100) / 100);
          s.y = clampY(Math.round((from.y + ddy) * 100) / 100);
        }
      },
      dragEnd() {
        dragFrom = null;
        dragLead = null;
        moving.value = false;
      },
      turnStart() {
        moving.value = true;
        turning = sel.value.length ? { from: poses(), c: centroid(sel.value) } : null;
      },
      turn(deg) {
        if (!turning) return;
        turnFrom(turning.from, turning.c, snap.value ? Math.round(deg / SNAP_DEG) * SNAP_DEG : deg);
      },
      turnEnd() {
        turning = null;
        moving.value = false;
      },
      rotate: rotateSelection,
      viewChanged: (v) => (boardView.value = v),
      contextLost() {
        // The mat and the crafts are all in Vue state: a fresh board draws
        // them again exactly as they were.
        board.value?.dispose();
        board.value = null;
        void mountBoard();
      },
    }, { ...matLayout.value });
    // Navigated away while three was still arriving.
    if (!stageEl.value) {
      b.dispose();
      return;
    }
    board.value = b;
    b.sync(toRaw(stickers.value).map((s) => toRaw(s)), selIds());
    void backfillPreviews();
  } catch (e) {
    boardError.value = e instanceof Error ? e.message : String(e);
  } finally {
    boardLoading.value = false;
  }
}
onMounted(mountBoard);

/**
 * Crafts saved before previews existed, or drawn in an older look, get a fresh
 * one, one at a time. Needs both the board (to draw) and the library (to know
 * what), whichever arrives second starts it. The old picture stays up until
 * the new one lands.
 */
let backfilling = false;
async function backfillPreviews() {
  const b = board.value;
  if (!b || !loaded.value || backfilling) return;
  backfilling = true;
  try {
    for (const e of library.value.filter((x) => !x.preview || x.previewV !== PREVIEW_VERSION).map((x) => x.id)) {
      if (board.value !== b) break;
      await renderPreview(e);
    }
  } finally {
    backfilling = false;
  }
}
void loadAll();

// ---- keyboard ---------------------------------------------------------------------------
/** The left hand's arrows. */
const WASD = { w: "ArrowUp", a: "ArrowLeft", s: "ArrowDown", d: "ArrowRight" } as const;
function onKey(e: KeyboardEvent) {
  if (picker.value) {
    if (e.key === "Escape") {
      // A craft's 3D look sits over the picker: it goes first.
      if (pickerView.previewCraft.value) pickerView.previewCraft.value = null;
      else picker.value = null;
      e.stopPropagation();
    }
    return;
  }
  if (galleryOpen.value && e.key === "Escape") {
    galleryOpen.value = false;
    e.stopPropagation();
    return;
  }
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === "a") {
    e.preventDefault();
    selectAll();
  } else if (mod && k === "d" && !e.shiftKey) {
    // Not with Shift: Ctrl/⌘ + Shift + D is the debug menu's (App.vue).
    e.preventDefault();
    duplicateSelection();
  } else if (mod && k === "g") {
    e.preventDefault();
    if (e.shiftKey) ungroupSelection();
    else groupSelection();
  } else if (mod && k === "z" && !e.shiftKey && undoable.value) {
    e.preventDefault();
    runUndo();
  } else if (mod || e.altKey) {
    return;
  } else if (e.key === "Delete" || e.key === "Backspace") {
    if (sel.value.length) {
      e.preventDefault();
      removeSelection();
    }
  } else if (e.key === "Escape") {
    selected.value = new Set();
  } else if (k === "q" || k === "e") {
    rotateSelection((k === "q" ? -1 : 1) * (e.shiftKey ? 15 : 5));
  } else if ((e.key.startsWith("Arrow") || k in WASD) && sel.value.length) {
    // WASD as well as the arrows: the left hand already has Q / E for turning.
    // `k`, lower-cased, so Shift + D (a 1 cm step) is still D.
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.1;
    const dir = WASD[k as keyof typeof WASD] ?? e.key;
    nudge(
      dir === "ArrowLeft" ? -step : dir === "ArrowRight" ? step : 0,
      dir === "ArrowUp" ? -step : dir === "ArrowDown" ? step : 0,
    );
  } else if (k === "v") {
    boardView.value = boardView.value === "top" ? "angled" : "top";
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  clearTimeout(justSavedTimer);
  // Leaving settles a delete still on its Undo: it was meant.
  settleUndo();
  // Send a save that was still waiting on its debounce.
  flushBoard();
  board.value?.dispose();
  board.value = null;
});

const asideEl = ref<HTMLElement | null>(null);
const VIEWS = [
  { id: "angled", label: "Angled", short: "3D", hint: "Three-quarter view of the mat" },
  { id: "top", label: "Top", short: "Top", hint: "Straight down, for measuring (V)" },
] as const;
// 22px tabs + the strip's p-1 and border = 32px, the height of Snap and Clear beside it.
const PILL =
  "relative z-[1] flex h-[22px] items-center justify-center gap-1.5 rounded-md px-2.5 text-f10 uppercase tracking-wider transition-colors";
// A finger needs about 40px: the same buttons, taller, on a phone.
const BTN = computed(
  () =>
    `flex flex-none items-center gap-1.5 rounded-md border border-border px-2.5 text-f10 uppercase tracking-cs1 text-muted-foreground tac-action disabled:opacity-35 ${props.compact ? "h-10" : "py-1.5"}`,
);
const FIELD =
  "h-7 w-full min-w-0 rounded-md border border-border bg-background px-2 font-mono text-f11 outline-none transition-colors focus:border-[color:var(--acc)]";
</script>

<template>
  <div ref="rootEl" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex min-h-0 flex-1 overflow-hidden" :class="compact ? 'flex-col' : ''">
      <!-- ============ STAGE ============ -->
      <div class="flex min-w-0 flex-col" :class="compact ? 'w-full flex-none' : 'min-h-[280px] flex-1'">
      <!-- A phone's mat is 3:2 across the width — capped at under half the
           screen's height, or a phone on its side has a mat taller than the
           screen and no panel at all. -->
      <div class="relative min-w-0 overflow-hidden" :class="compact ? 'aspect-[3/2] max-h-[45dvh] w-full flex-none' : 'min-h-0 flex-1'">
        <div ref="stageEl" class="absolute inset-0"></div>

        <!-- ALL CRAFTS — every craft as a picture, over the mat. Click one to
             open it (it replaces the mat); rename, publish and delete are on
             the card itself. -->
        <div
          v-if="galleryOpen"
          class="absolute inset-x-2 bottom-2 top-14 z-[6] flex animate-fade-in flex-col overflow-hidden rounded-lg border border-border bg-card/95 shadow-2xl backdrop-blur"
          role="dialog"
          aria-label="All crafts"
        >
          <div class="flex flex-none flex-wrap items-center gap-1.5 border-b border-border p-2.5">
            <label class="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-muted-foreground focus-within:border-[color:var(--acc)] sm:w-56">
              <Search class="h-3.5 w-3.5 flex-none" />
              <input id="sc-crafts-q" v-model="craftsQuery" type="search" class="min-w-0 flex-1 bg-transparent text-f11 text-foreground outline-none" placeholder="Search crafts or stickers" aria-label="Search your crafts" />
            </label>
            <button
              v-for="o in craftGunOptions"
              :key="o.value"
              class="h-7 flex-none rounded-full border px-2.5 text-f11 transition-colors"
              :class="craftsGun === o.value ? 'border-[hsl(var(--tac-amber)/0.45)] bg-[hsl(var(--tac-amber)/0.12)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground'"
              :aria-pressed="craftsGun === o.value"
              @click="craftsGun = o.value"
            >{{ o.label }} <span class="font-mono text-f9 text-muted-foreground/70">{{ o.count }}</span></button>
            <button class="ml-auto grid h-7 w-7 flex-none place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground" aria-label="Close All crafts" title="Close (Esc)" @click="galleryOpen = false">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto p-2.5">
            <div v-if="!library.length" class="py-10 text-center text-f11 text-muted-foreground">
              No crafts yet. Select stickers on the mat and press Save.
            </div>
            <div v-else-if="!shownCrafts.length" class="py-10 text-center text-f11 text-muted-foreground">
              <template v-if="craftsQuery.trim()">No crafts match “{{ craftsQuery.trim() }}”.</template>
              <template v-else>No crafts for the {{ craftGunName }} yet.</template>
              <div class="mt-3"><button :class="BTN" class="mx-auto" @click="craftsQuery = ''; craftsGun = ''">Show all {{ library.length }}</button></div>
            </div>
            <div v-else class="grid gap-2.5" :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 130 : 160}px, 1fr))` }">
              <div
                v-for="entry in shownCrafts"
                :key="entry.id"
                :data-craft="entry.id"
                class="group/craft relative flex min-w-0 cursor-pointer flex-col gap-1"
                role="button"
                tabindex="0"
                :aria-label="'Open ' + entry.name + ' on the mat'"
                @click="renaming !== entry.id && openOnMat(entry)"
                @keydown.enter.self="openOnMat(entry)"
                @keydown.f2.self.prevent="renaming = entry.id"
              >
                <span
                  class="relative block aspect-[2/1] overflow-hidden rounded border bg-[#183a31] transition-colors group-hover/craft:border-[hsl(var(--tac-amber)/0.45)]"
                  :class="matCraftId === entry.id ? 'border-[hsl(var(--tac-amber))]' : justSaved === entry.id ? 'border-[color:var(--acc)]' : 'border-border'"
                >
                  <img v-if="entry.preview" :src="entry.preview" alt="" class="h-full w-full object-cover" draggable="false" />
                  <Loader2 v-else class="absolute inset-0 m-auto h-4 w-4 animate-spin text-muted-foreground" />
                  <span
                    class="absolute right-1 top-1 flex gap-0.5 rounded bg-background/85 transition-opacity"
                    :class="compact ? '' : 'opacity-0 focus-within:opacity-100 group-hover/craft:opacity-100'"
                  >
                    <button
                      class="grid h-6 w-6 place-items-center rounded transition-colors disabled:opacity-40"
                      :class="published.has(entry.id) ? 'text-[hsl(var(--success,142_70%_55%))]' : 'text-muted-foreground hover:text-foreground'"
                      :disabled="publishing.has(entry.id)"
                      :aria-pressed="published.has(entry.id)"
                      :aria-label="published.has(entry.id) ? 'In the Craft Store — make it private' : 'Publish to the Craft Store'"
                      :title="published.has(entry.id) ? 'In the Craft Store — click to make it private' : 'Private — click to publish it'"
                      @click.stop="togglePublish(entry)"
                    >
                      <Loader2 v-if="publishing.has(entry.id)" class="h-3.5 w-3.5 animate-spin" />
                      <Globe v-else-if="published.has(entry.id)" class="h-3.5 w-3.5" />
                      <Lock v-else class="h-3.5 w-3.5" />
                    </button>
                    <button class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground" :aria-label="'Rename ' + entry.name" title="Rename (F2)" @click.stop="renaming = entry.id">
                      <Pencil class="h-3.5 w-3.5" />
                    </button>
                    <button class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:text-[#ff7a6a]" :aria-label="'Delete ' + entry.name" title="Delete — you can undo it" @click.stop="deleteSaved(entry.id)">
                      <Trash2 class="h-3.5 w-3.5" />
                    </button>
                  </span>
                </span>
                <span class="flex min-w-0 items-center gap-1">
                  <span v-if="published.has(entry.id)" class="h-1.5 w-1.5 flex-none rounded-full bg-[hsl(var(--success,142_70%_55%))]"></span>
                  <input
                    v-if="renaming === entry.id"
                    v-focus
                    :class="FIELD"
                    class="!h-6 min-w-0 flex-1 font-sans"
                    :value="entry.name"
                    maxlength="40"
                    aria-label="Craft name"
                    @click.stop
                    @keydown.stop.enter="finishRename(entry, ($event.target as HTMLInputElement).value)"
                    @keydown.stop.esc="renaming = null"
                    @blur="finishRename(entry, ($event.target as HTMLInputElement).value)"
                  />
                  <span v-else class="min-w-0 flex-1 truncate text-f11 text-foreground" title="Double-click to rename" @dblclick.stop="renaming = entry.id">{{ entry.name }}</span>
                  <span class="flex-none font-mono text-f9 text-muted-foreground/70">{{ entry.stickers.length }}</span>
                </span>
                <span v-if="entry.useCase" class="truncate text-f9 uppercase tracking-cs1 text-muted-foreground/70">{{ entry.useCase.weapon }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- A finger has no Shift or Alt: on a phone, choose what is selected
             from a list — a whole grouping, one sticker of it, a loose one —
             and Add makes a tap on the mat add to the selection. -->
        <!-- Bottom right: the top row is the view and Snap's, and a phone's
             mat is too narrow for both. -->
        <div v-if="compact && stickers.length" class="absolute bottom-3 right-3 z-[2] flex items-center gap-2">
          <button
            class="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card/80 px-2.5 text-f10 uppercase tracking-cs1 text-muted-foreground backdrop-blur tac-action"
            :class="tapAdd ? 'tac-on' : ''"
            :title="tapAdd ? 'Tapping a sticker adds it to the selection — tap to stop' : 'Make a tap on a sticker add it to the selection'"
            @click="tapAdd = !tapAdd"
          >
            <ListPlus class="h-3.5 w-3.5" /> {{ tr("inventory.stickerCrafts.tapAdd", "Multi") }}
          </button>
          <button
            class="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card/80 px-2.5 text-f10 uppercase tracking-cs1 text-foreground backdrop-blur tac-action"
            :class="chooser ? 'tac-on' : ''"
            title="Choose what is selected"
            @click="chooser = !chooser"
          >
            <ListChecks class="h-3.5 w-3.5" />
            {{ sel.length ? `${sel.length} selected` : tr("inventory.stickerCrafts.choose", "Select") }}
            <ChevronUp class="h-3 w-3" />
          </button>
        </div>
        <template v-if="compact && chooser">
          <div class="absolute inset-0 z-[3]" @pointerdown="chooser = false"></div>
          <div class="absolute bottom-14 right-3 z-[4] flex max-h-[calc(100%-4.5rem)] w-[min(280px,calc(100%-1.5rem))] flex-col overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-2xl">
            <div class="flex gap-1 border-b border-border p-1 pb-1.5">
              <button class="h-9 flex-1 rounded-md text-f10 uppercase tracking-cs1 text-muted-foreground tac-action" @click="chooseAll">All</button>
              <button class="h-9 flex-1 rounded-md text-f10 uppercase tracking-cs1 text-muted-foreground tac-action" @click="chooseNone">None</button>
            </div>
            <template v-for="u in layerUnits" :key="u.kind === 'one' ? u.s.uid : u.group.id">
              <button
                v-if="u.kind === 'group'"
                class="flex min-h-[40px] items-center gap-2 rounded-md px-2 text-left text-f11 transition-colors hover:bg-secondary/60"
                :class="u.members.every((m) => selected.has(m.uid)) ? 'sc-row-on' : 'text-foreground'"
                @click="chooseGroup(u.group.id)"
              >
                <Group class="h-3.5 w-3.5 flex-none text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate">{{ u.group.name }}</span>
                <span class="flex-none font-mono text-f9 text-muted-foreground">{{ u.members.length }}</span>
              </button>
              <button
                v-for="m in u.kind === 'group' ? [...u.members].reverse() : [u.s]"
                :key="m.uid"
                class="flex min-h-[40px] items-center gap-2 rounded-md px-2 text-left text-f11 transition-colors hover:bg-secondary/60"
                :class="[u.kind === 'group' ? 'pl-6' : '', selected.has(m.uid) ? 'sc-row-on' : 'text-muted-foreground']"
                :title="u.kind === 'group' ? 'Just this one of ' + u.group.name : ''"
                @click="chooseOne(m.uid)"
              >
                <img :src="m.image" alt="" class="h-6 w-6 flex-none object-contain" draggable="false" />
                <span class="min-w-0 truncate">{{ stripName(m.name) }}</span>
              </button>
            </template>
          </div>
        </template>

        <!-- View and snap, top-left over the mat — and over the empty
             mat's card, which on a phone's short stage reaches up to them. -->
        <div class="pointer-events-none absolute left-3 top-3 z-[3] flex items-center gap-2">
          <PillTabs
            class="pointer-events-auto rounded-lg border border-border bg-card/80 backdrop-blur"
            :items="VIEWS"
            :item-key="(v) => v.id"
            :item-title="(v) => v.hint"
            :active="boardView"
            list-class="flex"
            :button-class="PILL"
            @select="(id) => (boardView = id as 'angled' | 'top')"
          >
            <template #default="{ item }">
              <component :is="(item as (typeof VIEWS)[number]).id === 'top' ? ScanEye : View" class="h-3.5 w-3.5" />
              <span>{{ compact ? (item as (typeof VIEWS)[number]).short : (item as (typeof VIEWS)[number]).label }}</span>
            </template>
          </PillTabs>
          <!-- Snap in the view pill's own shell (p-1 round a 22px segment,
               lit like the active view), so the two read as one height. -->
          <div class="pointer-events-auto flex rounded-lg border border-border bg-card/80 p-1 backdrop-blur">
            <button
              class="flex h-[22px] items-center gap-1.5 rounded-md border px-2.5 text-f10 uppercase tracking-wider transition-colors"
              :class="snap ? 'text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
              :style="snap ? { borderColor: 'hsl(var(--tac-amber) / 0.45)', background: 'hsl(var(--tac-amber) / 0.12)', boxShadow: '0 0 12px hsl(var(--tac-amber) / 0.25)' } : undefined"
              :aria-pressed="snap"
              :title="snap ? 'Snapping to half centimetres and 5° turns — click to place freely' : 'Placing freely — click to snap to half centimetres and 5° turns'"
              @click="snap = !snap"
            >
              <Magnet class="h-3.5 w-3.5" />
              <span>{{ tr("inventory.stickerCrafts.snap", "Snap") }}</span>
            </button>
          </div>
        </div>

        <!-- Top-right, the ways a craft comes onto the mat — yours (All
             crafts) and everyone's (Craft Store) — then Clear, set apart.
             With the view and Snap opposite, the mat's tools sit on the mat. -->
        <div class="absolute right-3 top-3 z-[7] flex items-center gap-1.5">
          <button
            class="flex items-center gap-1.5 rounded-lg border border-border bg-card/80 px-2.5 text-f10 uppercase tracking-cs1 text-muted-foreground backdrop-blur tac-action disabled:opacity-50"
            :class="[galleryOpen ? 'tac-on' : '', compact ? 'h-7' : 'h-8']"
            :disabled="!loaded"
            :aria-expanded="galleryOpen"
            :title="galleryOpen ? 'Close All crafts (Esc)' : 'Every craft you have saved'"
            @click="galleryOpen = !galleryOpen"
          >
            <LayoutGrid class="h-3.5 w-3.5" /> {{ tr("inventory.stickerCrafts.allCrafts", "All crafts") }}
            <span class="font-mono text-f9 normal-case tracking-normal text-muted-foreground/70">{{ library.length }}</span>
          </button>
          <Tooltip :text="tr('inventory.stickerCrafts.store', 'Craft Store')">
            <button
              class="grid place-items-center rounded-lg border border-border bg-card/80 text-muted-foreground backdrop-blur tac-action disabled:opacity-50"
              :class="compact ? 'h-7 w-7' : 'h-8 w-8'"
              :disabled="!loaded"
              :aria-label="tr('inventory.stickerCrafts.store', 'Craft Store')"
              @click="galleryOpen = false; openCrafts('store')"
            >
              <Store class="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip v-if="stickers.length" :text="tr('inventory.stickerCrafts.clearHint', 'Clear the mat — you can undo it for a few seconds')">
            <button
              class="ml-1.5 grid place-items-center rounded-lg border border-border bg-card/80 text-muted-foreground backdrop-blur transition-colors hover:border-[#e04a3a] hover:bg-[#e04a3a]/10 hover:text-[#ff7a6a]"
              :class="compact ? 'h-7 w-7' : 'h-8 w-8'"
              :aria-label="tr('inventory.stickerCrafts.clear', 'Clear')"
              @click="clearBoard"
            >
              <Eraser class="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>

        <!-- How to drive it: the 3D viewer's own legend, bottom centre, as on a
             gun — the mat takes the same mouse (drag turns the view, right-drag
             pans, a sticker drags to move and Shift-drags to turn), so a
             sticker moves here the way it moves there. -->
        <div v-if="!compact && stickers.length" class="pointer-events-none absolute inset-x-0 bottom-3 z-[2] flex justify-center">
          <ViewerControls class="pointer-events-auto" variant="overlay" subject="mat" edit rotate />
        </div>

        <div v-if="boardLoading || (!loaded && !loadError)" class="absolute inset-0 grid place-items-center">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="boardError" class="absolute inset-0 grid place-items-center p-6 text-center text-f13 text-destructive">
          {{ tr("inventory.stickerCrafts.boardError", "The 3D board could not start.") }} {{ boardError }}
        </div>
        <!-- Nothing can be edited until the mat has loaded: an edit made before
             it arrived would be overwritten by it, or overwrite it. -->
        <div v-else-if="loadError" class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <span class="text-f13 text-destructive">{{ tr("inventory.stickerCrafts.loadError", "Your Sticker Crafts didn't load.") }} {{ loadError }}</span>
          <button :class="[BTN, 'bg-card/80']" @click="loadAll">{{ tr("inventory.stickerCrafts.retry", "Try again") }}</button>
        </div>
        <div v-if="pickerError" class="absolute right-3 top-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-f11 text-destructive">
          {{ pickerError }}
          <button class="text-destructive/70 hover:text-destructive" title="Dismiss" @click="pickerError = null"><X class="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <!-- The weapon outlines along the bottom: a card per gun, its buy-menu
           glyph, on the rail the knife and glove sheets pick models with
           (ModelRail). The chosen one is chalked on the mat, and the mat grows
           or narrows to it. -->
      <div
        class="flex flex-none items-center gap-2 border-t border-border bg-background py-1"
        :class="compact ? 'min-h-[58px] px-2' : 'min-h-[62px] px-3'"
      >
        <ModelRail
          :label="tr('inventory.stickerCrafts.outline', 'Outline')"
          :items="outlineItems"
          :current="outlineModel || 'none'"
          :compact="compact"
          active-bg="color-mix(in srgb, var(--acc) 12%, transparent)"
          up
          @select="(k: string) => (outlineModel = k === 'none' ? '' : k)"
        >
          <template #art="{ item }">
            <Loader2 v-if="item.key === outlineModel && outlineBusy" class="h-4 w-4 animate-spin" />
            <svg v-else-if="item.key === 'none'" viewBox="0 0 45 30" class="h-full w-full" aria-hidden="true">
              <rect x="1" y="1" width="43" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" />
            </svg>
            <Ruler v-else-if="item.key === outlineModel && outlineError" class="h-4 w-4 !text-destructive" />
            <span
              v-else
              class="sc-glyph block h-full w-full bg-current"
              :class="item.key === outlineModel ? 'text-foreground' : 'text-muted-foreground'"
              :style="glyphStyle(item.key)"
              aria-hidden="true"
            ></span>
          </template>
        </ModelRail>
      </div>
      </div>

      <!-- ============ SIDEBAR ============ -->
      <!-- The mat's own stickers, under their toolbar (Group, Save). Your
           crafts are the tabs over the mat and All crafts — never down here,
           so nothing in this panel moves as stickers come and go. -->
      <aside
        ref="asideEl"
        class="sc-panel flex min-h-0 min-w-0 flex-col overflow-hidden"
        :class="compact ? 'flex-1 border-t border-border' : 'w-[360px] flex-none border-l border-border'"
      >
        <!-- ON THE MAT — its stickers, top-most first, in the gun's own rows
             (StickerRow): scratch wear always out, exact placement behind
             each row's position button, the same as a gun's sticker section. Drag a row to
             restack; click one to select it on the mat. The toolbar acts on
             the selection: Group (one toggle) and Save. -->
        <section
          class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3"
        >
          <header class="mb-2.5 flex items-center gap-1.5">
            <!-- The craft's name, at the top: what Save calls it, or what
                 Update renames it to. -->
            <input
              id="sc-craft-name"
              v-model="craftName"
              type="text"
              maxlength="40"
              autocomplete="off"
              spellcheck="false"
              class="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-[hsl(var(--tac-amber)/0.6)]"
              :class="compact ? 'h-9 text-[16px]' : 'h-8 text-f13'"
              :placeholder="`Craft ${library.length + 1}`"
              :aria-label="tr('inventory.stickerCrafts.craftName', 'Craft name')"
              @keydown.enter.prevent="canSave && saveOrUpdate()"
            />
            <!-- Whether the last change reached the account: shown only while
                 saving, or when it failed. -->
            <span
              v-if="loaded && (sync === 'saving' || sync === 'error')"
              class="flex flex-none items-center"
              :class="sync === 'error' ? 'text-destructive' : 'text-muted-foreground/70'"
              :title="sync === 'error' ? 'The last change did not reach the server. The next change will try again.' : 'Saving to your account'"
              role="status"
            >
              <Loader2 v-if="sync === 'saving'" class="h-3 w-3 animate-spin" />
              <CloudOff v-else class="h-3.5 w-3.5" />
            </span>
            <span class="flex flex-none items-center gap-1.5">
              <!-- From a saved craft (laid down from it, or saved into it):
                   write the change back to it, or keep it as a new one. -->
              <template v-if="updateTarget">
                <Tooltip :text="`Write this layout over “${updateTarget.name}”` + (published.has(updateTarget.id) ? ' — the Craft Store gets it too' : '')">
                  <button
                    class="tac-cta flex items-center gap-1.5 rounded-md border border-transparent px-2.5 text-f9 font-bold uppercase tracking-cs1"
                    :class="compact ? 'h-9' : 'h-8'"
                    @click="updateCraft"
                  >
                    <RefreshCw class="h-3.5 w-3.5" /> {{ tr("inventory.stickerCrafts.update", "Update") }}
                  </button>
                </Tooltip>
                <Tooltip text="Save as a new craft — the old one stays as it was">
                  <button
                    class="grid place-items-center rounded-md border border-border bg-secondary text-foreground/80 tac-action"
                    :class="compact ? 'h-9 w-9' : 'h-8 w-8'"
                    :aria-label="tr('inventory.stickerCrafts.saveNew', 'Save as new')"
                    @click="saveSelection"
                  >
                    <BookmarkPlus class="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </template>
              <Tooltip v-else :text="canSave ? 'Keep the mat as a Sticker Craft — any gun\'s sticker slot offers it' : 'Add a sticker to the mat first'">
                <button
                  class="tac-cta flex items-center gap-1.5 rounded-md border border-transparent px-2.5 text-f9 font-bold uppercase tracking-cs1 disabled:cursor-not-allowed disabled:opacity-40"
                  :class="compact ? 'h-9' : 'h-8'"
                  :disabled="!canSave"
                  @click="saveSelection"
                >
                  <BookmarkPlus class="h-3.5 w-3.5" /> {{ tr("inventory.stickerCrafts.save", "Save") }}
                </button>
              </Tooltip>
            </span>
          </header>
          <div v-if="stickers.length > MAX_ON_BOARD" class="mb-2 text-f10 text-destructive">
            A gun takes {{ MAX_ON_BOARD }} stickers — take {{ stickers.length - MAX_ON_BOARD }} off, or the extra {{ stickers.length - MAX_ON_BOARD === 1 ? "one is" : "ones are" }} dropped on the next save.
          </div>
          <!-- An empty mat says what the tab is for here, beside it, rather
               than over the mat itself. -->
          <div v-if="!stickers.length" class="flex flex-col gap-3 pt-1">
            <span class="text-f13 text-foreground">{{ tr("inventory.stickerCrafts.emptyTitle", "Build a sticker combo") }}</span>
            <ol class="m-0 flex list-none flex-col gap-1.5 p-0 text-f11 text-muted-foreground">
              <li v-for="(step, si) in [
                tr('inventory.stickerCrafts.step1', 'Add up to five stickers and arrange them on the mat.'),
                tr('inventory.stickerCrafts.step2', 'Select them and press Save.'),
                tr('inventory.stickerCrafts.step3', 'On a gun, open Your crafts under it and click the craft to put it on.'),
              ]" :key="si" class="flex gap-2">
                <span class="flex-none font-mono text-[hsl(var(--tac-amber))]">{{ si + 1 }}</span><span>{{ step }}</span>
              </li>
            </ol>
            <button :class="BTN" class="self-start" @click="openPicker('sticker')">
              <Plus class="h-3.5 w-3.5" /> {{ tr("inventory.stickerCrafts.addFirst", "Add a sticker") }}
            </button>
          </div>
          <!-- THE SLOTS — see slotUnits. A unit (a loose sticker, or a whole
               link) drags as one; the gutter is its handle for a finger. -->
          <div v-else class="sc-slots flex select-none flex-col gap-1.5">
            <div
              v-for="(u, ui) in slotUnits"
              :key="u.key"
              data-sort-list="slots"
              class="flex flex-col gap-1.5 rounded-md"
            >
              <div
                v-for="st in u.rows"
                :key="st.uid"
                class="sc-slot relative flex items-stretch"
                @pointerdown="sorting.press($event, 'slots', ui, (e) => selectLayer(st.uid, e.shiftKey))"
              >
                <!-- The gutter: the link's rail and dot, and the seam to the next slot. -->
                <span class="relative w-7 flex-none cursor-grab" data-sort-grip>
                  <!-- The dot sits at the plate's middle (StickerRow: 1px border +
                       6px padding + half its 104px plate = 59px), and the rail
                       runs from it to the next slot's dot — the gap plus that
                       same 59px — so a row opened taller never bends it. -->
                  <span
                    v-if="u.color && seamAt(st.uid) === 'linked'"
                    class="pointer-events-none absolute left-1/2 top-[59px] z-[1] w-0.5 -translate-x-1/2 rounded-full"
                    style="bottom: -65px"
                    :style="{ background: u.color }"
                  ></span>
                  <span class="absolute left-1/2 top-[59px] z-[2] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" :style="{ background: st.group && u.color ? u.color : 'hsl(var(--border))' }"></span>
                  <button
                    v-if="seamAt(st.uid)"
                    type="button"
                    class="sc-seam absolute left-1/2 z-[3] grid h-[22px] w-[22px] -translate-x-1/2 place-items-center rounded-full border transition-[color,border-color,opacity] duration-150"
                    style="bottom: -14px"
                    :class="seamAt(st.uid) === 'linked' ? 'sc-seam-on border-transparent text-black' : 'border-border bg-card text-muted-foreground/70 hover:border-[hsl(var(--tac-amber)/0.6)] hover:text-foreground'"
                    :style="seamAt(st.uid) === 'linked' ? { background: u.color ?? undefined } : undefined"
                    :aria-pressed="seamAt(st.uid) === 'linked'"
                    :aria-label="(seamAt(st.uid) === 'linked' ? 'Unlink slots ' : 'Link slots ') + ((slotIndex.get(st.uid) ?? 0) + 1) + ' and ' + ((slotIndex.get(st.uid) ?? 0) + 2)"
                    :title="seamAt(st.uid) === 'linked' ? 'Unlink here — they move on their own' : 'Link with the next sticker — they move and turn as one'"
                    @pointerdown.stop
                    @click.stop="toggleSeam(st.uid)"
                  >
                    <Link2 v-if="seamAt(st.uid) === 'linked'" class="h-3 w-3" />
                    <Link2Off v-else class="h-3 w-3" />
                  </button>
                </span>
                <StickerRow class="min-w-0 flex-1 cursor-grab" v-bind="rowProps(st)" :grip="false" @wear="(w: number) => setStickerWear(st.uid, w)" @place="(k: 'x' | 'y' | 'r', v: number) => setPlace(st.uid, k, v)" @copy="duplicateOne(st.uid)" @remove="removeOne(st.uid)" />
              </div>
            </div>
            <!-- Empty slots, up to a gun's worth: the next sticker goes here. -->
            <button
              v-for="n in Math.max(0, MAX_ON_BOARD - stickers.length)"
              :key="'empty' + n"
              type="button"
              class="ml-7 flex items-center gap-2 rounded-lg border border-dashed border-border pl-2 text-f10 uppercase tracking-cs1 text-muted-foreground transition-colors hover:border-[hsl(var(--tac-amber)/0.45)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              style="padding-block: 6px"
              :disabled="!loaded"
              @click="openPicker('sticker')"
            >
              <span class="w-3 text-center font-mono text-f9 normal-case tracking-normal text-muted-foreground/60">{{ stickers.length + n }}</span>
              <span class="grid h-16 w-24 place-items-center rounded-md border border-dashed border-border/70"><Plus class="h-4 w-4" /></span>
              {{ tr("inventory.stickerCrafts.addFirst", "Add a sticker") }}
            </button>
            <!-- Straight to a gun: your equipped one of the chalked model, or a new one. -->
            <!-- The gun it goes on, as a picture: your equipped skin's 2D art,
                 or the plain gun when you have none equipped. -->
            <button
              type="button"
              class="sc-use mt-4 flex w-full items-center gap-3 rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style="border-color: hsl(var(--tac-amber) / 0.45); background: hsl(var(--tac-amber) / 0.08)"
              :disabled="!useModel || !canSave || !loaded"
              :title="!useModel ? 'Pick the gun this craft is for in the row under the mat' : useEquipped ? `Saves the craft, then opens your equipped ${useGunName} with it on` : `Saves the craft, then starts a new ${useGunName} with it on`"
              @click="putOnGun"
            >
              <!-- The gun rises out of the top of the button on purpose (Luke
                   liked it when it happened by accident): a fixed 64px from the
                   bottom of a 48px box, so every skin pops out the same. -->
              <span class="relative grid h-12 w-28 flex-none place-items-center">
                <img v-if="useModel && useImage" :src="useImage" alt="" class="pointer-events-none absolute bottom-0 left-1/2 h-16 w-auto max-w-[120px] -translate-x-1/2 object-contain" style="filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.55))" draggable="false" />
                <Crosshair v-else class="h-4 w-4 text-muted-foreground" />
              </span>
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate text-f10 font-semibold uppercase tracking-cs1 text-foreground">
                  <template v-if="!useModel">Pick a gun under the mat</template>
                  <template v-else-if="useEquipped">Put on your {{ useGunName }}</template>
                  <template v-else>New {{ useGunName }} with this craft</template>
                </span>
                <span v-if="useModel" class="truncate text-f11 text-muted-foreground">{{ useSkin?.name ?? `A plain ${useGunName} — you don't have one equipped` }}</span>
              </span>
            </button>
            <p class="m-0 mt-1 text-f10 text-muted-foreground/60">Slot {{ MAX_ON_BOARD }} draws on top. Click a chain between two stickers to link them.</p>
          </div>
        </section>


      </aside>
    </div>

    <!-- Undo for what was just removed, bottom centre like the inventory's
         (UndoToast) — over the picker when it is open. Words on a publish or
         an update go to the host's toast (say). -->
    <div
      class="pointer-events-none fixed left-1/2 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2"
      :class="picker ? 'bottom-16' : 'bottom-5'"
      :style="{ zIndex: picker ? Z.pickerToast : Z.toast }"
    >
      <UndoToast :label="undoable?.label ?? null" undo-title="Put it back (Ctrl/⌘ + Z)" @undo="runUndo" @dismiss="settleUndo" />
    </div>

    <!-- The same fade the editor's picker takes (App.vue). v-if on the child,
         not inside it, or the Transition has nothing mounting to animate. -->
    <Transition enter-active-class="animate-fade-in" leave-active-class="animate-fade-out">
    <AttachmentPicker
      v-if="picker"
      :view="pickerView"
      hide-preview
      target="mat"
      :back-label="compact ? undefined : 'Back to the mat'"
      back-title="Back to the mat — nothing is added"
      @pick="addSticker"
      @pick-craft="addCraft"
    >
      <!-- Opened from here, your crafts are managed from their tiles too: the
           panel lists only the newest five. -->
      <template #craftActions="{ craft }">
        <input
          v-if="renaming === craft.id"
          :class="FIELD"
          class="min-w-0 flex-1 font-sans text-f13"
          :value="craft.name"
          maxlength="40"
          aria-label="New name"
          v-focus
          @keydown.enter.prevent="finishRename(craft, ($event.target as HTMLInputElement).value)"
          @keydown.esc.stop.prevent="renaming = null"
          @blur="finishRename(craft, ($event.target as HTMLInputElement).value)"
        />
        <template v-else>
        <button
          class="flex flex-none items-center gap-1.5 rounded-md border border-border px-2 text-f10 uppercase tracking-cs1 tac-action disabled:opacity-35"
          :class="[published.has(craft.id) ? 'tac-on' : 'text-muted-foreground', compact ? 'h-9' : 'h-7']"
          :disabled="publishing.has(craft.id)"
          :aria-pressed="published.has(craft.id)"
          :title="published.has(craft.id) ? 'In the Craft Store — click to make it private again' : 'Private — click to publish it to the Craft Store'"
          @click="togglePublish(craft)"
        >
          <Loader2 v-if="publishing.has(craft.id)" class="h-3.5 w-3.5 animate-spin" />
          <Globe v-else-if="published.has(craft.id)" class="h-3.5 w-3.5" />
          <Lock v-else class="h-3.5 w-3.5" />
          {{ published.has(craft.id) ? tr("inventory.stickerCrafts.inStore", "In store") : tr("inventory.stickerCrafts.private", "Private") }}
        </button>
        <button
          class="grid flex-none place-items-center rounded-md border border-border text-muted-foreground tac-action"
          :class="compact ? 'h-9 w-10' : 'h-7 w-8'"
          aria-label="Rename"
          title="Rename"
          @click="renaming = craft.id"
        >
          <Pencil class="h-3.5 w-3.5" />
        </button>
        <!-- Beside the switch, away from Place in the other corner. -->
        <button
          class="flex flex-none items-center gap-1.5 rounded-md border border-border px-2 text-f10 uppercase tracking-cs1 text-muted-foreground tac-action"
          :class="compact ? 'h-9' : 'h-7'"
          title="Delete from your crafts — you can undo it for a few seconds"
          @click="deleteSaved(craft.id)"
        >
          <Trash2 class="h-3.5 w-3.5" /> {{ tr("inventory.stickerCrafts.delete", "Delete") }}
        </button>
        </template>
      </template>
    </AttachmentPicker>
    </Transition>
  </div>
</template>

<style scoped>
/* Selected in the phone's chooser: StickerRow's amber, not the team accent —
   the mat has no side. */
.sc-row-on {
  color: hsl(var(--foreground));
  background: hsl(var(--tac-amber) / 0.1);
  box-shadow: inset 2px 0 0 hsl(var(--tac-amber));
}
/* The panel scrolls up and down only. An overflow-y scroller is a scroller in
   both directions to iOS, which let a sideways swipe drag the whole panel off
   to one side and bounce it back; pan-y keeps a finger's gesture vertical
   (sliders and the row grips handle their own drags). */
/* A gun's buy-menu glyph, drawn as a mask in the text colour (glyphStyle). */
.sc-glyph {
  mask-position: center;
  mask-repeat: no-repeat;
  mask-size: contain;
  -webkit-mask-position: center;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-size: contain;
}
.sc-panel {
  overscroll-behavior-x: none;
  touch-action: pan-y;
}
/* The handle a finger can drag by; the rest of a row scrolls the list. */
.sc-grip {
  touch-action: none;
}
</style>
