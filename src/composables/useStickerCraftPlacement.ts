// Putting a saved Sticker Craft on a weapon in the craft editor.
//
// Picking a craft from the sticker picker does NOT stick it on straight away.
// It floats over the 3D view (and waits in the Stickers panel) as one card, and
// you drag that onto the gun: the whole layout follows the pointer over the
// surface, live, and lands where you let go. Seating it automatically at the
// slot's anchor was tried first, and a craft wider than the spot ran off the gun
// before you had any say in where it went.
//
// A craft always sits in ONE RUN of slots: picked for a slot, it takes that slot
// and the ones after it, and the gun's own stickers shift along to make room
// (planRun). Reordering the slots keeps it that way — a grouped craft moves as
// one block, and a sticker moved onto it goes before or after the whole block
// (moveWithGroup). A shifted sticker keeps its place on the gun; only its slot,
// which is its draw order, changes.
//
// Once down, its stickers stay a GROUP. While grouped, dragging any one of them
// in 3D carries the others, and turning one (Shift-drag, or a two-finger twist)
// turns the lot about it. Ungroup lets them move one at a time for fine
// adjustments; Group binds them again as they now stand. The group outlives the
// edit: Save records it against the item on the account (stickerCraftsModel),
// and opening the item again — on any device — brings it back as long as those
// slots still hold those stickers. Removing or replacing one, or reordering the slots, ends it. The
// game knows nothing of any of this — it only ever sees five placed stickers.
//
// UNITS. A craft is measured on the board in footprints: STICKER_CM is one
// sticker, and on a gun one sticker is 1/scale of the slot's unwrap (UV1; see
// buildDecal in viewer3d). The decal reads its art with v flipped (cutDecalInUv
// writes 1 - t), so on the unwrap the art's right is +u and its DOWN is +v —
// the board's own axes, y running down. Rotation is the other way round: the
// cut turns by STICKER_ROT_SIGN * r, so a positive game rotation is
// anticlockwise on screen and the board's clockwise turn is its negative.
// Positions turn with the art, about the craft's centre.
import { computed, ref, watch, type Ref } from "vue";
import { fetchStickerGeometry, type StickerBounds, type StickerSlot } from "../api";
import { STICKER_CM, loadItemGroup, saveItemGroup, type SavedCraft } from "../stickerCraftsModel";
import type { StickerPlacement, ViewerHandle } from "../viewer3d";

/** The shape of one of the craft form's sticker slots — App's `Attach`. */
type SlotSticker = {
  id: number;
  name: string;
  image: string | null;
  x?: number | null;
  y?: number | null;
  r?: number | null;
  w?: number | null;
  inst?: string | null;
};
type CraftForm = {
  skin: { legacyPaint?: boolean; paintMaterial?: string | null };
  stickers: (SlotSticker | null)[];
};

/** Where each slot's offsets are measured from, on the body this finish uses. */
type Frame = { anchorOf: (slot: number) => StickerSlot | undefined; bounds: StickerBounds | null };
/** One sticker bound to a slot: its offset from the group's centre in unwrap
 *  units and its rotation, both before any turn of the whole. */
type Member = { slot: number; id: number; image: string; wear: number; ou: number; ov: number; r0: number };

export interface PendingCraft {
  entry: SavedCraft;
  /** The run of slots the craft will take. */
  slots: number[];
  /** The gun's own stickers that shift to make room: [from, to] slots. */
  moves: [number, number][];
  members: Member[];
  frame: Frame;
}
export interface CraftGroup {
  name: string;
  members: Member[];
  frame: Frame;
  /** The group's centre (offset space) and its turn (game degrees). */
  cu: number;
  cv: number;
  turn: number;
  /** Grouped: the stickers move as one. Not: each moves on its own. */
  linked: boolean;
}


const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
/** ±180, in the game's half-degree steps. */
const wrapDeg = (d: number) => Math.round(((((d + 180) % 360) + 360) % 360 - 180) * 2) / 2;

export function useStickerCraftPlacement(o: {
  craft: Ref<CraftForm | null>;
  /** The owned item the editor is showing, if it is one. */
  instanceId: () => number | string | null | undefined;
  /** The weapon model the editor is showing. */
  model: () => string | null | undefined;
  viewer: () => ViewerHandle | null | undefined;
  /** What the form says is on the gun right now (App's craftStickerPlacements). */
  placements: () => StickerPlacement[];
  slotCount: number;
  /** Bring the 3D stage up — the drop needs it. */
  show3d: () => void;
  /** A craft is waiting over the gun (the camera can close in on the stickers). */
  onWait?: () => void;
  /** It went down (`placed`), or was put back. */
  onSettle?: (placed: boolean) => void;
}) {
  const pending = ref<PendingCraft | null>(null);
  const group = ref<CraftGroup | null>(null);
  /** The card under the pointer while it is off the gun. */
  const ghost = ref<{ x: number; y: number; image: string | null } | null>(null);
  /** A drag of the waiting craft is under way. */
  const dragging = ref(false);

  async function frameFor(c: CraftForm): Promise<Frame | null> {
    const model = o.model();
    if (!model) return null;
    const geo = await fetchStickerGeometry(model);
    // The same anchor choice as moveSticker and the viewer's slotMarkup: this
    // finish's body, the exact anchor, else the first.
    const body = c.skin.legacyPaint && c.skin.paintMaterial ? "body_legacy" : "body_hd";
    const mine = geo.slots.filter((s) => s.mesh === body);
    const anchors = mine.length ? mine : geo.slots;
    if (!anchors.length) return null;
    const first = anchors.reduce((lo, s) => (s.index < lo.index ? s : lo));
    return { anchorOf: (slot) => anchors.find((s) => s.index === slot) ?? first, bounds: geo.bounds };
  }

  /** Each sticker of a craft bound to its slot, measured in unwrap units. */
  function membersOf(entry: SavedCraft, slots: number[], frame: Frame): Member[] {
    return slots.map((slot, i) => {
      const s = entry.stickers[i];
      const k = 1 / (STICKER_CM * (frame.anchorOf(slot)?.scale || 1));
      return { slot, id: s.id, image: s.image, wear: s.wear, ou: s.x * k, ov: s.y * k, r0: wrapDeg(-s.rot) };
    });
  }

  /** A group of these slots as they stand on the form right now. */
  function groupFromForm(c: CraftForm, frame: Frame, slots: number[], name: string, linked: boolean): CraftGroup | null {
    const at = slots.map((slot) => {
      const st = c.stickers[slot];
      const a = frame.anchorOf(slot);
      return st?.image && a ? { slot, st, u: a.offset[0] + (st.x ?? 0), v: a.offset[1] + (st.y ?? 0) } : null;
    });
    if (at.some((p) => !p)) return null;
    const pts = at as NonNullable<(typeof at)[number]>[];
    const cu = pts.reduce((s, p) => s + p.u, 0) / pts.length;
    const cv = pts.reduce((s, p) => s + p.v, 0) / pts.length;
    const members = pts.map(({ slot, st, u, v }) => ({
      slot,
      id: st.id,
      image: st.image!,
      wear: st.w ?? 0,
      ou: u - cu,
      ov: v - cv,
      r0: wrapDeg(st.r ?? 0),
    }));
    return { name, members, frame, cu, cv, turn: 0, linked };
  }

  /** A member's offset from the centre once the whole group is turned. */
  function turned(m: Member, turn: number) {
    // The art turns by STICKER_ROT_SIGN * r = -r on the unwrap; its place turns with it.
    const a = (-turn * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return { du: m.ou * cos - m.ov * sin, dv: m.ou * sin + m.ov * cos };
  }

  /** Slot offsets for every member, the group centred at (cu, cv) and turned. */
  function seat(members: Member[], frame: Frame, cu: number, cv: number, turn: number) {
    const fit = (v: number, r?: [number, number]) => round4(r ? Math.min(r[1], Math.max(r[0], v)) : v);
    return members.map((m) => {
      const a = frame.anchorOf(m.slot);
      const { du, dv } = turned(m, turn);
      return {
        m,
        x: a ? fit(cu + du - a.offset[0], frame.bounds?.x) : null,
        y: a ? fit(cv + dv - a.offset[1], frame.bounds?.y) : null,
        r: wrapDeg(m.r0 + turn),
      };
    });
  }

  /** A form sticker moved to another slot WITHOUT moving on the gun: its
   *  offsets re-expressed against the new slot's anchor, as moveSticker does. */
  function reanchor(st: SlotSticker, from: number, to: number, frame: Frame): SlotSticker {
    const a = frame.anchorOf(from);
    const b = frame.anchorOf(to);
    if (!a || !b || a === b) return { ...st };
    const fit = (v: number, r?: [number, number]) => round4(r ? Math.min(r[1], Math.max(r[0], v)) : v);
    return {
      ...st,
      x: fit(a.offset[0] + (st.x ?? 0) - b.offset[0], frame.bounds?.x),
      y: fit(a.offset[1] + (st.y ?? 0) - b.offset[1], frame.bounds?.y),
    };
  }

  /**
   * Where a craft of n stickers goes when picked for `slot`: one run of slots
   * starting there. An empty slot is taken; a full one keeps its sticker, which
   * moves along behind the run — a craft never goes over a sticker already on
   * the gun. The run is opened up at that point, and empty slots are given back
   * to keep five — the nearest ones after the run first, then before it — so
   * the gun's own stickers shift as little as they can and keep their order.
   * [1,1,_,1,_] with a pair picked for slot 3 is [1,1,G,G,1]; picked for slot
   * 2 (full) it is [1,G,G,1,1].
   * Null when there aren't enough empty slots (the picker only offers crafts
   * that fit).
   */
  function planRun(c: CraftForm, slot: number, n: number): { slots: number[]; moves: [number, number][] } | null {
    type Cell = { from: number } | "G" | null;
    const arr: Cell[] = Array.from({ length: o.slotCount }, (_, i) => (c.stickers[i] ? { from: i } : null));
    arr.splice(slot, arr[slot] ? 0 : 1, ...Array<Cell>(n).fill("G"));
    let extra = arr.length - o.slotCount;
    for (let i = slot + n; i < arr.length && extra > 0; ) {
      if (arr[i] === null) {
        arr.splice(i, 1);
        extra--;
      } else i++;
    }
    for (let i = slot - 1; i >= 0 && extra > 0; i--) {
      if (arr[i] === null) {
        arr.splice(i, 1);
        extra--;
      }
    }
    if (extra > 0) return null;
    const slots: number[] = [];
    const moves: [number, number][] = [];
    arr.forEach((cell, i) => {
      if (cell === "G") slots.push(i);
      else if (cell && cell.from !== i) moves.push([cell.from, i]);
    });
    return { slots, moves };
  }

  /** The form's stickers as they will stand once the waiting craft is down:
   *  shifted ones moved (and re-anchored), the craft's run left empty. */
  function arranged(c: CraftForm, p: PendingCraft): (SlotSticker | null)[] {
    const out: (SlotSticker | null)[] = Array.from({ length: o.slotCount }, () => null);
    const moved = new Set(p.moves.map(([from]) => from));
    for (let i = 0; i < o.slotCount; i++) {
      const st = c.stickers[i];
      if (st && !moved.has(i) && !p.slots.includes(i)) out[i] = st;
    }
    for (const [from, to] of p.moves) {
      const st = c.stickers[from];
      if (st) out[to] = reanchor(st, from, to, p.frame);
    }
    return out;
  }

  /** Where a craft of n stickers picked for `slot` would go, for the picker to
   *  say before Use: the run's slots and the moves that open it up. */
  function planFor(slot: number, n: number) {
    const c = o.craft.value;
    return c ? planRun(c, slot, n) : null;
  }

  /** The picker's answer: hold the craft over the gun, ready to drag on. */
  async function pickCraft(entry: SavedCraft, slot: number) {
    const c = o.craft.value;
    if (!c || !entry.stickers.length) return;
    const plan = planRun(c, slot, entry.stickers.length);
    if (!plan) return;
    const frame = await frameFor(c);
    if (o.craft.value !== c) return;
    if (!frame) {
      // No sticker markup for this model: nothing to measure a drop against, so
      // the stickers go on at their slots' own spots, one by one as ever, and
      // the shifted ones keep theirs (there are no anchors to re-express in).
      const before = c.stickers.slice();
      for (const [from, to] of plan.moves) c.stickers[to] = before[from];
      plan.slots.forEach((s, i) => {
        const st = entry.stickers[i];
        c.stickers[s] = { id: st.id, name: st.name, image: st.image, inst: null, x: null, y: null, r: wrapDeg(-st.rot), w: st.wear };
      });
      return;
    }
    pending.value = { entry, slots: plan.slots, moves: plan.moves, members: membersOf(entry, plan.slots, frame), frame };
    o.show3d();
    o.onWait?.();
  }
  const cancel = () => {
    const was = !!pending.value;
    pending.value = null;
    ghost.value = null;
    o.viewer()?.setStickers(o.placements());
    if (was) o.onSettle?.(false);
  };

  /** What the gun shows with the craft seated at a spot: the stickers as they
   *  will stand (arranged), plus the craft in its run. */
  function previewAt(p: PendingCraft, spot: { u: number; v: number }): StickerPlacement[] {
    const c = o.craft.value;
    const seated = seat(p.members, p.frame, spot.u, spot.v, 0);
    const own = (c ? arranged(c, p) : []).flatMap((st, slot) =>
      st?.image ? [{ slot, image: st.image, x: st.x ?? null, y: st.y ?? null, r: st.r ?? null, w: st.w ?? null }] : [],
    );
    return [...own, ...seated.map(({ m, x, y, r }) => ({ slot: m.slot, image: m.image, x, y, r, w: m.wear }))];
  }

  /** Put the waiting craft down, centred on `spot` (unwrap units). */
  function land(p: PendingCraft, spot: { u: number; v: number }) {
    const c = o.craft.value;
    if (!c || pending.value !== p) return;
    // The gun's own stickers shift first, then the craft takes its run.
    const next = arranged(c, p);
    for (let i = 0; i < o.slotCount; i++) c.stickers[i] = next[i];
    for (const { m, x, y, r } of seat(p.members, p.frame, spot.u, spot.v, 0)) {
      const st = p.entry.stickers[p.slots.indexOf(m.slot)];
      c.stickers[m.slot] = { id: m.id, name: st.name, image: m.image, inst: null, x, y, r, w: m.wear };
    }
    group.value = { name: p.entry.name, members: p.members, frame: p.frame, cu: spot.u, cv: spot.v, turn: 0, linked: true };
    pending.value = null;
    o.onSettle?.(true);
  }

  /**
   * Place the waiting craft without a drag — the Place button, or a tap on its
   * card (a finger has no hover, and covers the spot it would drop on). It goes
   * where its run's own slots put a sticker, centred on them; drag it from
   * there like any placed craft.
   */
  function placeHere() {
    const p = pending.value;
    if (!p) return;
    const at = p.slots.map((s) => p.frame.anchorOf(s)).filter((a): a is NonNullable<typeof a> => !!a);
    if (!at.length) return;
    const u = at.reduce((sum, a) => sum + a.offset[0], 0) / at.length;
    const v = at.reduce((sum, a) => sum + a.offset[1], 0) / at.length;
    ghost.value = null;
    land(p, { u, v });
  }

  /**
   * Drag the waiting craft onto the gun, from its floating card or its panel
   * card. Over the sticker surface the stickers themselves are the preview; off
   * it, the card follows the pointer. Letting go on the gun puts the craft down
   * there; anywhere else it waits again. A press that never moves is a tap:
   * placeHere.
   */
  function startDrag(e: PointerEvent) {
    const p = pending.value;
    if (!p || e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    // The element stays in the page for the whole drag (the floating card only
    // turns transparent), so its pointer capture holds.
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragging.value = true;
    let spot: { u: number; v: number } | null = null;
    // One preview per frame, whatever the pointer's event rate. Each preview is
    // a decal rebuild per sticker, and the first ones for a slot build their
    // material from scratch; a rebuild per pointer event started far more of
    // those than could ever finish.
    let last: { x: number; y: number } | null = null;
    let frame = 0;
    const preview = () => {
      frame = 0;
      if (!last) return;
      const v = o.viewer();
      spot = v?.stickerSpotAt(last.x, last.y) ?? null;
      ghost.value = spot ? null : { x: last.x, y: last.y, image: p.entry.preview ?? p.entry.stickers[0]?.image ?? null };
      v?.setStickers(spot ? previewAt(p, spot) : o.placements());
    };
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!frame) frame = requestAnimationFrame(preview);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      cancelAnimationFrame(frame);
      frame = 0;
      dragging.value = false;
      ghost.value = null;
      if (ev.type === "pointerup" && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) {
        o.viewer()?.setStickers(o.placements());
        placeHere();
        return;
      }
      // Where it was let go, not where the last frame happened to look.
      spot = o.viewer()?.stickerSpotAt(ev.clientX, ev.clientY) ?? null;
      if (ev.type !== "pointerup" || !spot || !o.craft.value || pending.value !== p) {
        o.viewer()?.setStickers(o.placements());
        return;
      }
      land(p, spot);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    move(e);
  }

  /**
   * The form's slot reorder (App's moveSticker: a tile dragged onto another, or
   * the ‹ › buttons), when the group is involved. False leaves an ordinary swap
   * to App — neither slot is the group's.
   *
   * GROUPED, the craft is one block: moving one of its stickers moves the whole
   * run, and a sticker moved onto the run goes before it (moving back) or after
   * it (moving forward) — [1,G,G,M,1] with M moved to slot 2 is [1,M,G,G,1].
   * Two of the group's own stickers trade places as a swap. UNGROUPED, every
   * move is a swap. Either way the group follows its stickers to their new
   * slots instead of breaking up, and nothing moves on the gun.
   */
  function moveWithGroup(from: number, to: number): boolean {
    const g = group.value;
    const c = o.craft.value;
    if (!g || !c || from === to) return false;
    const inGroup = (s: number) => g.members.some((m) => m.slot === s);
    if (!inGroup(from) && !inGroup(to)) return false;
    const old = c.stickers.slice(0, o.slotCount);
    // order[newSlot] = the slot whose sticker ends up there.
    let order: number[];
    if (!g.linked || (inGroup(from) && inGroup(to))) {
      order = Array.from({ length: o.slotCount }, (_, i) => (i === from ? to : i === to ? from : i));
    } else {
      const run = g.members.map((m) => m.slot).sort((a, b) => a - b);
      const units: number[][] = [];
      for (let i = 0; i < o.slotCount; i++) {
        if (!run.includes(i)) units.push([i]);
        else if (i === run[0]) units.push(run);
      }
      const unitOf = (s: number) => units.findIndex((u) => u.includes(s));
      const fu = unitOf(from);
      const tu = unitOf(to);
      if (fu === tu) return true;
      // Out, then back in at the target's place: before it when moving back,
      // after it when moving forward (the removal shifted it one left).
      const [moving] = units.splice(fu, 1);
      units.splice(tu, 0, moving);
      order = units.flat();
    }
    order.forEach((was, slot) => {
      const st = old[was];
      c.stickers[slot] = st ? reanchor(st, was, slot, g.frame) : null;
    });
    for (const m of g.members) m.slot = order.indexOf(m.slot);
    return true;
  }

  /** Re-seat every grouped sticker but one (the one the viewer just moved). */
  function reseat(g: CraftGroup, except: number) {
    const c = o.craft.value;
    if (!c) return;
    for (const { m, x, y, r } of seat(g.members, g.frame, g.cu, g.cv, g.turn)) {
      const st = c.stickers[m.slot];
      if (m.slot === except || !st) continue;
      st.x = x;
      st.y = y;
      st.r = r;
    }
  }
  /**
   * A grouped sticker was dragged to (x, y): move the group's centre by the same
   * amount and carry the rest. Call BEFORE the form takes the new offsets.
   */
  function followMove(slot: number, x: number, y: number) {
    const g = group.value;
    const m = g?.linked ? g.members.find((mm) => mm.slot === slot) : undefined;
    const a = m && g?.frame.anchorOf(slot);
    if (!g || !m || !a) return;
    const { du, dv } = turned(m, g.turn);
    g.cu = a.offset[0] + x - du;
    g.cv = a.offset[1] + y - dv;
    reseat(g, slot);
  }
  /**
   * A grouped sticker was turned to r in place: turn the whole group about it.
   * Call BEFORE the form takes the new rotation.
   */
  function followTurn(slot: number, r: number) {
    const g = group.value;
    const st = o.craft.value?.stickers[slot];
    const m = g?.linked ? g.members.find((mm) => mm.slot === slot) : undefined;
    const a = m && g?.frame.anchorOf(slot);
    if (!g || !m || !a || !st) return;
    // Where the turned sticker stands, which the turn must not move.
    const pu = a.offset[0] + (st.x ?? 0);
    const pv = a.offset[1] + (st.y ?? 0);
    g.turn = wrapDeg(r - m.r0);
    const { du, dv } = turned(m, g.turn);
    g.cu = pu - du;
    g.cv = pv - dv;
    reseat(g, slot);
  }
  /** Let the stickers move one at a time — for fine adjustments. */
  const ungroup = () => {
    if (group.value) group.value.linked = false;
  };
  /** Bind them again, as they stand now. */
  function regroup() {
    const g = group.value;
    const c = o.craft.value;
    if (!g || !c) return;
    group.value = groupFromForm(c, g.frame, g.members.map((m) => m.slot), g.name, true);
  }

  /**
   * Record the group (or its absence) against the item a save just wrote.
   * Sticker ids, not images, identify the members: an image URL carries the
   * extraction version and changes under a re-extraction.
   */
  function persist(id: number | string) {
    const g = group.value;
    void saveItemGroup(
      id,
      g ? { name: g.name, slots: g.members.map((m) => m.slot), ids: g.members.map((m) => m.id), linked: g.linked } : null,
    );
  }

  /** Slots the waiting craft will fill, and slots of the placed group. */
  const pendingSlots = computed(() => new Set(pending.value?.slots ?? []));
  const groupSlots = computed(() => new Set(group.value?.members.map((m) => m.slot) ?? []));

  // A grouped sticker removed, replaced or moved to another slot ends the group:
  // the layout it carried no longer describes what is on the gun.
  watch(
    () => o.craft.value?.stickers.map((s) => s?.id ?? null),
    (ids) => {
      const g = group.value;
      if (g && !g.members.every((m) => ids?.[m.slot] === m.id)) group.value = null;
    },
  );

  // A different item in the editor: nothing waiting; its own group, if it has
  // one saved and its slots still hold those stickers. Tried once per item, as
  // soon as the model (and so the anchors) is known.
  let restoreFor: CraftForm | null = null;
  async function tryRestore() {
    const c = o.craft.value;
    const id = o.instanceId();
    if (!c || restoreFor !== c || id == null || !o.model()) return;
    restoreFor = null;
    const saved = await loadItemGroup(id);
    if (!saved || o.craft.value !== c) return;
    if (!saved.slots.every((s, i) => c.stickers[s]?.id === saved.ids[i])) return;
    const frame = await frameFor(c);
    if (o.craft.value !== c || !frame) return;
    group.value = groupFromForm(c, frame, saved.slots, saved.name, saved.linked);
  }
  watch(
    () => o.craft.value,
    (now, before) => {
      if (now === before) return;
      pending.value = null;
      group.value = null;
      ghost.value = null;
      restoreFor = now;
      void tryRestore();
    },
  );
  watch(o.model, () => void tryRestore());

  return {
    pending,
    group,
    ghost,
    dragging,
    pendingSlots,
    groupSlots,
    pickCraft,
    cancel,
    startDrag,
    placeHere,
    planFor,
    followMove,
    followTurn,
    moveWithGroup,
    ungroup,
    regroup,
    persist,
  };
}
