import { ref, toRaw, type Ref } from "vue";
import { ApiError, type CraftCodeWire, type StickerSlot } from "../api";
import { GRID_H, GRID_W, MAX_ON_BOARD, type BoardSticker, type Grouping, type SavedCraft, type StoreCraft } from "../stickerCraftsModel";
import type { WeaponOutline } from "../outlineTrace";
import { gunOnMat } from "./useStickerCraftPlacement";

type Tr = (k: string, f: string, n?: Record<string, unknown>) => string;
type Spot = { x: number; y: number };

/** Someone else's craft from the store, not one of yours. */
export const othersCraft = (entry: SavedCraft | StoreCraft) => "author" in entry && !(entry as StoreCraft).mine;

/** The chalk's box is centred on the home grid. */
export const onChalk = (p: Spot, o: { w: number; h: number }): Spot => ({ x: p.x + GRID_W / 2 - o.w / 2, y: p.y + GRID_H / 2 - o.h / 2 });
export const offChalk = (p: Spot, o: { w: number; h: number }): Spot => ({ x: p.x - (GRID_W / 2 - o.w / 2), y: p.y - (GRID_H / 2 - o.h / 2) });

export function importedCraft(got: CraftCodeWire, slots: StickerSlot[], o: WeaponOutline | null, id: string): { entry: SavedCraft; at?: Spot } {
  const laid = gunOnMat(got.stickers, slots, got.legacy, o);
  return {
    entry: {
      id,
      name: got.name,
      savedAt: Date.now(),
      stickers: got.stickers.map((s, i) => ({ id: s.id, name: s.name, image: s.image ?? "", ...laid.stickers[i], wear: s.w })),
    },
    at: laid.at && o ? onChalk(laid.at, o) : undefined,
  };
}

/**
 * The mat in draw order, bottom first, as UNITS: a loose sticker, or a whole
 * grouping. A grouping's members are kept next to each other in the list —
 * the layer list shows a grouping as one block and drags it as one, which only
 * means something if the block is also one run of draw order. It sits where its
 * top-most member was.
 */
export type Unit = { kind: "one"; s: BoardSticker } | { kind: "group"; group: Grouping; members: BoardSticker[] };
/**
 * What a removal took off the mat, to put back on Undo: each sticker with its
 * place in the draw order, the groupings it was in, and the stickers left alone
 * in a grouping it emptied. Only that — not a picture of the whole mat, which
 * put back would also undo whatever was moved or added in the seconds since.
 */
export type Removed = { stickers: { s: BoardSticker; at: number }[]; groups: Grouping[]; ungrouped: { uid: string; group: string }[] };
/** What an Undo takes back, for its toast's icon; none is a removal. */
export type UndoKind = "open" | "store" | "import";
type Undoable = { label: string; undo: () => void; commit?: () => void; kind?: UndoKind };
const UNDO_MS = 6000;
/** Cut inside the quotes, so a long name never pushes the rest of a toast out of its two lines. */
const quoted = (name: string) => {
  const chars = Array.from(name);
  return chars.length > 24 ? `${chars.slice(0, 23).join("").trimEnd()}…` : name;
};

export function useStickerMat(o: {
  stickers: Ref<BoardSticker[]>;
  groups: Ref<Grouping[]>;
  selected: Ref<Set<string>>;
  name: Ref<string | null>;
  outline: Ref<string>;
  gallery: Ref<boolean>;
  spot: (list: Spot[]) => Spot;
  clamp: (p: Spot) => Spot;
  flash: (uids: string[]) => void;
  newId: () => string;
  tr: Tr;
  read: (code: string, signal: AbortSignal) => Promise<CraftCodeWire>;
  geometry: (model: string) => Promise<{ slots: StickerSlot[] }>;
  outlineOf: (model: string) => Promise<WeaponOutline | null>;
  openStore: () => void;
}) {
  const { stickers, groups, selected } = o;

  function unitsOf(list: BoardSticker[]): Unit[] {
    const out: Unit[] = [];
    const seen = new Set<string>();
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (!s.group) {
        out.push({ kind: "one", s });
        continue;
      }
      if (seen.has(s.group)) {
        continue;
      }
      seen.add(s.group);
      const group = groups.value.find((g) => g.id === s.group) ?? { id: s.group, name: "Group" };
      out.push({ kind: "group", group, members: list.filter((m) => m.group === s.group) });
    }
    return out.reverse();
  }
  const flatten = (units: Unit[]) => units.flatMap((u) => (u.kind === "one" ? [u.s] : u.members));
  const normalize = () => (stickers.value = flatten(unitsOf(stickers.value)));
  /** Groupings left with one member are no grouping at all. */
  function pruneGroups() {
    const counts = new Map<string, number>();
    for (const s of stickers.value) {
      if (s.group) {
        counts.set(s.group, (counts.get(s.group) ?? 0) + 1);
      }
    }
    for (const s of stickers.value) {
      if (s.group && (counts.get(s.group) ?? 0) < 2) {
        s.group = null;
      }
    }
    groups.value = groups.value.filter((g) => (counts.get(g.id) ?? 0) >= 2);
  }

  // The panel's way with a delete (the inventory's Undo toast): it happens at
  // once, and for a few seconds it can be taken back. One at a time — a second
  // delete settles the first. A saved craft's server delete waits out the window
  // (`commit`), so Undo never has anything to put back on the server.
  const undoable = ref<Undoable | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  function settleUndo() {
    const u = undoable.value;
    undoable.value = null;
    clearTimeout(undoTimer);
    u?.commit?.();
  }
  function offerUndo(label: string, undo: () => void, commit?: () => void, kind?: UndoKind) {
    settleUndo();
    undoable.value = { label, undo, commit, kind };
    undoTimer = setTimeout(settleUndo, UNDO_MS);
  }
  function runUndo() {
    const u = undoable.value;
    if (!u) {
      return;
    }
    undoable.value = null;
    clearTimeout(undoTimer);
    u.undo();
  }

  function takeOff(keep: (s: BoardSticker) => boolean): Removed {
    const taken: Removed["stickers"] = [];
    stickers.value.forEach((s, at) => {
      if (!keep(s)) {
        taken.push({ s: { ...toRaw(s) }, at });
      }
    });
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
    for (const { s, at } of r.stickers) {
      next.splice(Math.min(at, next.length), 0, s);
    }
    const have = new Set(groups.value.map((g) => g.id));
    groups.value = [...groups.value, ...r.groups.filter((g) => !have.has(g.id))];
    for (const u of r.ungrouped) {
      const s = next.find((x) => x.uid === u.uid);
      if (s && s.group === null) {
        s.group = u.group;
      }
    }
    stickers.value = next;
    selected.value = new Set(r.stickers.map((t) => t.s.uid));
    pruneGroups();
    normalize();
  }
  function clearBoard() {
    if (!stickers.value.length) {
      return;
    }
    o.name.value = null;
    const removed = takeOff(() => false);
    offerUndo("Cleared the mat", () => putBack(removed));
  }

  /**
   * Lay a craft down on the mat, as a grouping again, selected. One of yours
   * stays linked to it (Update writes back); someone else's from the store is a
   * copy to make your own, named so, and so is one read off an inspect code
   * (`copy`). It goes where `at` says, else the first clear spot. False when the
   * mat has no room for it.
   */
  function placeSaved(entry: SavedCraft | StoreCraft, copy = othersCraft(entry), at = o.spot(entry.stickers)): boolean {
    if (stickers.value.length + entry.stickers.length > MAX_ON_BOARD) {
      return false;
    }
    const theirs = othersCraft(entry);
    const g = entry.stickers.length > 1 ? { id: o.newId(), name: theirs ? `${entry.name} (my copy)` : entry.name } : null;
    if (g) {
      groups.value = [...groups.value, g];
    }
    const made = entry.stickers.map((s) => ({
      ...toRaw(s),
      uid: o.newId(),
      ...o.clamp({ x: at.x + s.x, y: at.y + s.y }),
      group: g?.id ?? null,
      craft: copy ? null : entry.id,
    }));
    stickers.value = [...stickers.value, ...made];
    selected.value = new Set(made.map((s) => s.uid));
    o.flash(made.map((s) => s.uid));
    return true;
  }

  /** Undo puts back the name and the chalk with the stickers: Update and Put on your … act on all three. */
  function replace(apply: () => void, what: string, kind: UndoKind) {
    const before = { name: o.name.value, outline: o.outline.value };
    const taken = takeOff(() => false);
    apply();
    offerUndo(
      what,
      () => {
        takeOff(() => false);
        putBack(taken);
        o.name.value = before.name;
        o.outline.value = before.outline;
      },
      undefined,
      kind,
    );
  }
  function openOnMat(entry: SavedCraft | StoreCraft) {
    if (entry.stickers.length > MAX_ON_BOARD) {
      return;
    }
    closeImport();
    const theirs = othersCraft(entry);
    replace(
      () => {
        o.name.value = theirs ? `${entry.name} (my copy)`.slice(0, 40) : null;
        placeSaved(entry);
        o.gallery.value = false;
      },
      theirs
        ? o.tr("inventory.stickerCrafts.openedCopy", "Opened a copy of “{name}”", { name: quoted(entry.name) })
        : o.tr("inventory.stickerCrafts.opened", "Opened “{name}”", { name: quoted(entry.name) }),
      theirs ? "store" : "open",
    );
  }

  const importOpen = ref(false);
  const importText = ref("");
  const importBusy = ref(false);
  const importError = ref<string | null>(null);
  let inflight: AbortController | null = null;

  function closeImport() {
    inflight?.abort();
    inflight = null;
    importBusy.value = false;
    importError.value = null;
    importOpen.value = false;
  }
  function toggleImport() {
    if (importOpen.value) {
      closeImport();
    } else {
      importOpen.value = true;
      o.gallery.value = false;
    }
  }
  function toggleGallery() {
    closeImport();
    o.gallery.value = !o.gallery.value;
  }
  function openStore() {
    o.gallery.value = false;
    closeImport();
    o.openStore();
  }
  /** Escape: All crafts first, then the import. False when neither was open. */
  function escape(): boolean {
    if (o.gallery.value) {
      o.gallery.value = false;
      return true;
    }
    if (importOpen.value) {
      closeImport();
      return true;
    }
    return false;
  }
  function dispose() {
    closeImport();
    settleUndo();
  }

  function refusal(e: unknown, reading: boolean): string {
    let reason: string | null = null;
    if (e instanceof ApiError) {
      reason = e.reason ?? (e.status === 401 ? "signed-out" : e.status === 413 ? "too-long" : e.status >= 500 ? "server" : null);
    } else if (reading) {
      reason = e instanceof TypeError ? "network" : "server";
    }
    switch (reason) {
      case "too-long":
        return o.tr("inventory.stickerCrafts.importTooLong", "That's too long to be an inspect code.");
      case "unmasked":
        return o.tr(
          "inventory.stickerCrafts.importUnmasked",
          "That link points at an item in someone's inventory, so it can't be read here. Paste the craft's Code from csinspect.com instead.",
        );
      case "not-a-code":
        return o.tr("inventory.stickerCrafts.importNotCode", "That isn't an inspect code. Paste the craft's Code from csinspect.com.");
      case "unreadable":
        return o.tr("inventory.stickerCrafts.importUnreadable", "That code couldn't be read. Copy it again; it may have been cut short.");
      case "not-a-gun":
        return o.tr("inventory.stickerCrafts.importNotGun", "That code isn't for a gun that takes stickers.");
      case "no-stickers":
        return o.tr("inventory.stickerCrafts.importNoStickers", "That code has no stickers this catalog knows.");
      case "signed-out":
        return o.tr("inventory.stickerCrafts.importSignedOut", "You're signed out. Sign in again, then import the code.");
      case "network":
        return o.tr("inventory.stickerCrafts.importOffline", "Couldn't reach the server. Check your connection and try again.");
      case "server":
        return o.tr("inventory.stickerCrafts.importServer", "The server had trouble reading that code. Try again in a moment.");
      default:
        return o.tr("inventory.stickerCrafts.importFailed", "Couldn't read that code. Try again.");
    }
  }
  function note(count: number, skipped: number): string {
    if (!skipped) {
      return o.tr("inventory.stickerCrafts.importDone", "Imported. Save to keep it as your craft.");
    }
    return o.tr("inventory.stickerCrafts.importPartial", "Imported {count} of {total}. {skipped} couldn't be read.", { count, total: count + skipped, skipped });
  }
  async function lay(got: CraftCodeWire) {
    const [geo, outline] = await Promise.all([o.geometry(got.model).catch(() => null), o.outlineOf(got.model).catch(() => null)]);
    return importedCraft(got, geo?.slots ?? [], outline, o.newId());
  }

  async function importCode() {
    const code = importText.value.trim();
    if (!code || importBusy.value) {
      return;
    }
    const ctl = new AbortController();
    inflight = ctl;
    importBusy.value = true;
    importError.value = null;
    let reading = true;
    try {
      const got = await o.read(code, ctl.signal);
      reading = false;
      const laid = ctl.signal.aborted ? null : await lay(got);
      if (!laid || ctl.signal.aborted) {
        return;
      }
      replace(() => {
        o.outline.value = got.model;
        o.name.value = laid.entry.name.slice(0, 40);
        placeSaved(laid.entry, true, laid.at);
        o.gallery.value = false;
      }, note(got.stickers.length, got.skipped), "import");
      importOpen.value = false;
      importText.value = "";
    } catch (e) {
      if (!ctl.signal.aborted) {
        importError.value = refusal(e, reading);
      }
    } finally {
      if (inflight === ctl) {
        inflight = null;
        importBusy.value = false;
      }
    }
  }

  return {
    unitsOf,
    flatten,
    normalize,
    pruneGroups,
    undoable,
    offerUndo,
    settleUndo,
    runUndo,
    takeOff,
    putBack,
    clearBoard,
    placeSaved,
    openOnMat,
    importOpen,
    importText,
    importBusy,
    importError,
    toggleImport,
    toggleGallery,
    openStore,
    escape,
    dispose,
    closeImport,
    importCode,
  };
}
