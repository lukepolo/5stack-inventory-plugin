import { ref } from "vue";
import { ApiError, IMPORT_MAX_CHARS, type CraftCodeWire, type StickerSlot } from "../src/api";
import { offChalk, useStickerMat } from "../src/composables/useStickerMat";
import { frameFrom, membersOf, outlineSeat, seat } from "../src/composables/useStickerCraftPlacement";
import type { BoardSticker, Grouping, SavedCraft, StoreCraft } from "../src/stickerCraftsModel";
import type { WeaponOutline } from "../src/outlineTrace";
import { CODE_LIMITS } from "../backend/src/inspectDecode.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
    failures++;
  } else {
    console.log(`ok   ${label}  ${JSON.stringify(got)}`);
  }
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const slot = (index: number, offset: [number, number]): StickerSlot => ({ index, mesh: "body_hd", offset, scale: 20, rotation: 0 });
const SLOTS = [slot(0, [-0.2, 0.05]), slot(1, [0, 0.05]), slot(2, [0.2, 0.05]), slot(3, [0.4, 0.1])];
const OUTLINE: WeaponOutline = {
  model: "ak47",
  stickerCm: 5,
  w: 40,
  h: 14,
  paths: [],
  anchors: [{ index: 0, x: 10, y: 8 }, { index: 1, x: 20, y: 8 }, { index: 2, x: 30, y: 8 }],
  uv: { hd: [0.0098, 0.0012, 0.18, -0.0011, 0.0099, 0.42] },
};
const AK: CraftCodeWire = {
  model: "ak47",
  name: "AK-47 | Redline",
  legacy: false,
  stickers: [
    { id: 1, name: "s1", image: "/1.webp", slot: 0, x: 0.02, y: 0.01, r: 15, w: 0.1 },
    { id: 2, name: "s2", image: "/2.webp", slot: 1, x: -0.03, y: 0, r: 0, w: 0 },
    { id: 3, name: "s3", image: "/3.webp", slot: 2, x: 0.01, y: -0.02, r: -30, w: 0 },
    { id: 4, name: "s4", image: "/4.webp", slot: 3, x: 0, y: 0.02, r: 90, w: 0.5 },
  ],
  skipped: 1,
};
const sticker = (uid: string, id: number, x: number, craft: string | null, group: string | null): BoardSticker => ({
  uid, id, name: `#${id}`, image: `/${id}.webp`, x, y: 15, rot: 0, wear: 0, group, craft,
});

function scene(opts: { empty?: boolean; layWith?: WeaponOutline | null; gallery?: boolean } = {}) {
  const stickers = ref<BoardSticker[]>(opts.empty ? [] : [sticker("a", 11, 20, "my-awp", "g1"), sticker("b", 12, 26, "my-awp", "g1")]);
  const groups = ref<Grouping[]>(opts.empty ? [] : [{ id: "g1", name: "My AWP" }]);
  const selected = ref(new Set<string>());
  const name = ref<string | null>(null);
  const outline = ref("awp");
  const gallery = ref(opts.gallery ?? false);
  let stores = 0;
  const reads: { code: string; signal: AbortSignal; answer: Deferred<CraftCodeWire> }[] = [];
  const lays: Deferred<void>[] = [];
  let ids = 0;
  const mat = useStickerMat({
    stickers,
    groups,
    selected,
    name,
    outline,
    gallery,
    spot: () => ({ x: 22.5, y: 15 }),
    clamp: (p) => p,
    flash: () => {},
    newId: () => `id${++ids}`,
    tr: (_k, f, n) => f.replace(/\{(\w+)\}/g, (_, k) => String(n?.[k])),
    read: (code, signal) => {
      const answer = deferred<CraftCodeWire>();
      reads.push({ code, signal, answer });
      return answer.promise;
    },
    geometry: async () => ({ slots: SLOTS }),
    outlineOf: async () => {
      const laid = deferred<void>();
      lays.push(laid);
      await laid.promise;
      return opts.layWith === undefined ? OUTLINE : opts.layWith;
    },
    openStore: () => {
      stores++;
    },
  });
  const state = () => JSON.stringify({ stickers: stickers.value, groups: groups.value, name: name.value, outline: outline.value });
  return { mat, stickers, groups, name, outline, gallery, reads, lays, state, stores: () => stores };
}
type Scene = ReturnType<typeof scene>;
async function importAK(s: Scene, code = "  csgo_econ_action_preview 00AA  ") {
  s.mat.toggleImport();
  s.mat.importText.value = code;
  const done = s.mat.importCode();
  s.reads.at(-1)!.answer.resolve(AK);
  await tick();
  s.lays.at(-1)!.resolve();
  await done;
}

{
  const s = scene();
  const before = s.state();
  await importAK(s);
  check("an import replaces the mat, chalks its gun and names it",
    [s.outline.value, s.name.value, s.stickers.value.map((x) => [x.id, x.craft])], ["ak47", "AK-47 | Redline", [[1, null], [2, null], [3, null], [4, null]]]);
  check("the code is sent trimmed", s.reads[0].code, "csgo_econ_action_preview 00AA");
  check("it says how many were left out, on its Undo", s.mat.undoable.value?.label, "Imported 4 of 5. 1 couldn't be read.");
  check("the form closes and empties", [s.mat.importOpen.value, s.mat.importText.value, s.mat.importBusy.value], [false, "", false]);
  s.mat.runUndo();
  check("Undo brings back the stickers with their craft and group, the name and the chalk exactly", s.state(), before);
}
{
  const s = scene();
  s.name.value = "Typed name";
  const before = s.state();
  const theirs = { id: "bob", name: "Bob's duo", savedAt: 0, stickers: [{ id: 5, name: "#5", image: "/5.webp", x: -3, y: 0, rot: 0, wear: 0 }], mine: false, author: { steamId: "2", name: "Bob", avatar: null } } as unknown as StoreCraft;
  s.mat.openOnMat(theirs);
  check("a store craft opens as a copy, named so", [s.name.value, s.stickers.value.map((x) => x.craft)], ["Bob's duo (my copy)", [null]]);
  s.mat.runUndo();
  check("Undo of opening any craft brings back the name that was typed", s.state(), before);
}
{
  const s = scene({ empty: true });
  const before = s.state();
  await importAK(s);
  check("on an empty mat the import still offers its own Undo", s.mat.undoable.value?.label, "Imported 4 of 5. 1 couldn't be read.");
  s.mat.runUndo();
  check("which puts back the empty mat, its chalk and its name", s.state(), before);
}
{
  const s = scene();
  s.mat.clearBoard();
  check("Clear offers its Undo", s.mat.undoable.value?.label, "Cleared the mat");
  const cleared = s.state();
  await importAK(s);
  check("an import replaces Clear's Undo with its own", s.mat.undoable.value?.label, "Imported 4 of 5. 1 couldn't be read.");
  s.mat.runUndo();
  check("so Undo goes back to the cleared mat, never the old stickers on top of the import", s.state(), cleared);
}
{
  const s = scene({ empty: true });
  const mine: SavedCraft = { id: "mine", name: "Mine", savedAt: 0, stickers: [{ id: 7, name: "#7", image: "/7.webp", x: 0, y: 0, rot: 0, wear: 0 }] };
  s.mat.openOnMat(mine);
  check("one of yours opens linked to it", s.stickers.value.map((x) => x.craft), ["mine"]);
  check("and on an empty mat offers its Undo too", s.mat.undoable.value?.label, "Opened “Mine”");
}

{
  const s = scene();
  const before = s.state();
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.mat.importCode();
  check("Reading", s.mat.importBusy.value, true);
  s.mat.closeImport();
  check("closing while Reading cancels the request", s.reads[0].signal.aborted, true);
  s.reads[0].answer.resolve(AK);
  await done;
  await tick();
  check("and nothing lands after: no lay, no Undo, the mat as it was", [s.lays.length, s.mat.undoable.value, s.state() === before], [0, null, true]);
  check("the form is shut and idle", [s.mat.importOpen.value, s.mat.importBusy.value, s.mat.importError.value], [false, false, null]);
}
{
  const s = scene();
  const before = s.state();
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.mat.importCode();
  s.reads[0].answer.resolve(AK);
  await tick();
  s.mat.toggleImport();
  s.lays[0].resolve();
  await done;
  check("closing while the gun's outline loads: nothing lands either", [s.mat.undoable.value, s.state() === before], [null, true]);
}
{
  const s = scene({ empty: true });
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.mat.importCode();
  const bob = { id: "bob", name: "Bob's duo", savedAt: 0, stickers: [{ id: 5, name: "#5", image: "/5.webp", x: 0, y: 0, rot: 0, wear: 0 }], mine: false, author: { steamId: "2", name: "Bob", avatar: null } } as unknown as StoreCraft;
  s.mat.openOnMat(bob);
  check("opening a craft from the store cancels an import still Reading", s.reads[0].signal.aborted, true);
  s.reads[0].answer.resolve(AK);
  await done;
  await tick();
  check("so the store's craft stays on the mat", [s.stickers.value.map((x) => x.id), s.mat.undoable.value?.label], [[5], "Opened a copy of “Bob's duo”"]);
}
{
  const s = scene();
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.mat.importCode();
  s.mat.closeImport();
  s.reads[0].answer.reject(new DOMException("The operation was aborted.", "AbortError"));
  await done;
  check("a cancelled request is no error", s.mat.importError.value, null);
  await importAK(s);
  check("and the next import goes through", s.outline.value, "ak47");
}
{
  const s = scene();
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  void s.mat.importCode();
  void s.mat.importCode();
  check("a second Import while Reading is ignored", s.reads.length, 1);
  s.mat.importText.value = "   ";
  s.mat.closeImport();
  s.mat.toggleImport();
  void s.mat.importCode();
  check("an empty paste sends nothing", s.reads.length, 1);
}

{
  const s = scene({ empty: true });
  await importAK(s);
  const c = {
    x: s.stickers.value.reduce((sum, x) => sum + x.x, 0) / s.stickers.value.length,
    y: s.stickers.value.reduce((sum, x) => sum + x.y, 0) / s.stickers.value.length,
  };
  const at = offChalk(c, OUTLINE);
  const frame = frameFrom({ slots: SLOTS, bounds: null }, false)!;
  const entry: SavedCraft = { id: "saved", name: "saved", savedAt: 0, stickers: s.stickers.value.map((x) => ({ ...x, x: x.x - c.x, y: x.y - c.y })) };
  const put = outlineSeat(entry, membersOf(entry, [0, 1, 2, 3], frame), { ...at, anchors: OUTLINE.anchors, uv: OUTLINE.uv }, frame)!;
  const back = seat(put.members, frame, put.centre.u, put.centre.v, 0).map(({ x, y, r }) => [x!, y!, r]);
  const want = AK.stickers.map((x) => [x.x, x.y, x.r]);
  const off = Math.max(...back.flatMap((b, i) => b.map((v, j) => Math.abs(v - want[i][j]))));
  check("laid on the chalk, then Put on your … from where it lies: the code's places and turns (to 1.5e-4)", off <= 1.5e-4 ? want : back, want);
}
{
  const s = scene({ empty: true, layWith: null });
  await importAK(s);
  check("with no outline to lay it on, the layout goes at the first clear spot", [s.outline.value, s.stickers.value.length], ["ak47", 4]);
}
{
  const s = scene({ empty: true });
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.mat.importCode();
  s.reads[0].answer.resolve(AK);
  await tick();
  s.lays[0].reject(new Error("the outline didn't load"));
  await done;
  check("an outline that fails to load still imports, off the chalk", [s.mat.importError.value, s.stickers.value.length, s.outline.value], [null, 4, "ak47"]);
}

{
  const s = scene({ empty: true });
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.mat.importCode();
  s.reads[0].answer.resolve({ ...AK, skipped: 0 });
  await tick();
  s.gallery.value = true;
  s.lays[0].resolve();
  await done;
  check("a full import says so in two short sentences", s.mat.undoable.value?.label, "Imported. Save to keep it as your craft.");
  check("and closes All crafts as it lands", s.gallery.value, false);
}
{
  const s = scene({ empty: true });
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.mat.importCode();
  s.reads[0].answer.resolve({ ...AK, stickers: AK.stickers.slice(0, 3), skipped: 2 });
  await tick();
  s.lays[0].resolve();
  await done;
  check("two left out", s.mat.undoable.value?.label, "Imported 3 of 5. 2 couldn't be read.");
}
{
  const s = scene({ gallery: true });
  const mine: SavedCraft = { id: "mine", name: "A craft with a really long name for testing", savedAt: 0, stickers: [{ id: 7, name: "#7", image: "/7.webp", x: 0, y: 0, rot: 0, wear: 0 }] };
  s.mat.openOnMat(mine);
  check("opening a craft closes All crafts", s.gallery.value, false);
  check("a long craft name is cut inside its quotes, never the sentence", s.mat.undoable.value?.label, "Opened “A craft with a really l…”");
  const bob = { ...mine, id: "bob", mine: false, author: { steamId: "2", name: "Bob", avatar: null } } as unknown as StoreCraft;
  s.mat.openOnMat(bob);
  check("and a store copy's", s.mat.undoable.value?.label, "Opened a copy of “A craft with a really l…”");
  s.mat.openOnMat({ ...mine, name: `${"A".repeat(22)}😀😀😀` });
  check("an emoji where the cut falls stays whole", s.mat.undoable.value?.label, `Opened “${"A".repeat(22)}😀…”`);
  s.mat.openOnMat({ ...mine, name: `${"A".repeat(20)}😀😀😀😀` });
  check("and names are counted in characters, so 24 with emoji are not cut", s.mat.undoable.value?.label, `Opened “${"A".repeat(20)}😀😀😀😀”`);
}
{
  const s = scene();
  check("each Undo says what it was, for its icon", (() => {
    const kinds: unknown[] = [];
    s.mat.openOnMat({ id: "m", name: "M", savedAt: 0, stickers: [{ id: 7, name: "#7", image: "/7.webp", x: 0, y: 0, rot: 0, wear: 0 }] });
    kinds.push(s.mat.undoable.value?.kind);
    s.mat.openOnMat({ id: "b", name: "B", savedAt: 0, stickers: [{ id: 7, name: "#7", image: "/7.webp", x: 0, y: 0, rot: 0, wear: 0 }], mine: false, author: { steamId: "2", name: "Bob", avatar: null } } as unknown as StoreCraft);
    kinds.push(s.mat.undoable.value?.kind);
    s.mat.clearBoard();
    kinds.push(s.mat.undoable.value?.kind ?? null);
    return kinds;
  })(), ["open", "store", null]);
  await importAK(s);
  check("and an import's", s.mat.undoable.value?.kind, "import");
}

async function reading(s: Scene) {
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  return s.mat.importCode();
}
async function landsAfter(s: Scene, done: Promise<void>) {
  s.reads[0].answer.resolve(AK);
  await done;
  await tick();
  return s.lays.length;
}
{
  const s = scene();
  const before = s.state();
  const done = reading(s);
  check("Escape while Reading closes the import", s.mat.escape(), true);
  check("and cancels it", [s.reads[0].signal.aborted, s.mat.importOpen.value], [true, false]);
  check("so nothing lands", [await landsAfter(s, done), s.state() === before], [0, true]);
  check("Escape with nothing open is not ours", s.mat.escape(), false);
}
{
  const s = scene();
  const done = reading(s);
  s.gallery.value = true;
  check("Escape closes All crafts first", [s.mat.escape(), s.gallery.value, s.mat.importOpen.value], [true, false, true]);
  check("then the import", [s.mat.escape(), s.reads[0].signal.aborted], [true, true]);
  await landsAfter(s, done);
}
{
  const s = scene();
  const before = s.state();
  const done = reading(s);
  s.mat.openStore();
  check("the Craft Store button cancels an import still Reading, closes All crafts and opens the store",
    [s.reads[0].signal.aborted, s.mat.importOpen.value, s.gallery.value, s.stores()], [true, false, false, 1]);
  check("and nothing lands", [await landsAfter(s, done), s.state() === before], [0, true]);
}
{
  const s = scene();
  const done = reading(s);
  s.mat.toggleGallery();
  check("All crafts cancels an import still Reading", [s.reads[0].signal.aborted, s.gallery.value], [true, true]);
  await landsAfter(s, done);
  s.mat.toggleGallery();
  check("and closes again", s.gallery.value, false);
}
{
  const s = scene({ gallery: true });
  s.mat.toggleImport();
  check("opening Import closes All crafts", [s.mat.importOpen.value, s.gallery.value], [true, false]);
}
{
  const s = scene();
  let committed = 0;
  s.mat.offerUndo("Deleted “X”", () => {}, () => committed++);
  const done = reading(s);
  s.mat.dispose();
  check("leaving the tab cancels the import and settles the Undo", [s.reads[0].signal.aborted, s.mat.undoable.value, committed], [true, null, 1]);
  await landsAfter(s, done);
}

async function refusal(error: unknown) {
  const s = scene();
  const before = s.state();
  s.mat.toggleImport();
  s.mat.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.mat.importCode();
  s.reads[0].answer.reject(error);
  await done;
  return [s.mat.importError.value, s.mat.importOpen.value, s.mat.importBusy.value, s.state() === before];
}
const shown = (message: string) => [message, true, false, true];
check("the backend's reason picks the message", await refusal(new ApiError("x", 400, "unmasked")),
  shown("That link points at an item in someone's inventory, so it can't be read here. Paste the craft's Code from csinspect.com instead."));
check("no stickers known", await refusal(new ApiError("x", 400, "no-stickers")), shown("That code has no stickers this catalog knows."));
check("signed out", await refusal(new ApiError("unauthorized", 401, null)), shown("You're signed out. Sign in again, then import the code."));
check("a body past the server's limit is too long", await refusal(new ApiError("Request body is too large", 413, null)), shown("That's too long to be an inspect code."));
check("no answer at all is the network", await refusal(new TypeError("Failed to fetch")), shown("Couldn't reach the server. Check your connection and try again."));
for (const status of [500, 502, 503, 504]) {
  check(`a ${status} is the server's trouble`, await refusal(new ApiError("Bad Gateway", status, null)), shown("The server had trouble reading that code. Try again in a moment."));
}
check("an answer that isn't JSON is the server's trouble, not the network", await refusal(new SyntaxError("Unexpected token '<'")),
  shown("The server had trouble reading that code. Try again in a moment."));
check("any other refusal is try again", await refusal(new ApiError("Not Found", 404, null)), shown("Couldn't read that code. Try again."));
check("the paste field stops where the server does", IMPORT_MAX_CHARS, CODE_LIMITS.maxChars);

if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nopening and importing onto the mat undo exactly, and a closed import never lands");
