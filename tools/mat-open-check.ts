import { ref } from "vue";
import { ApiError, IMPORT_MAX_CHARS, type CraftCodeWire } from "../src/api";
import { useMatOpen } from "../src/composables/useMatOpen";
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

type Sticker = { id: number; craft: string | null };
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

const AK: CraftCodeWire = {
  model: "ak47",
  name: "AK-47 | Redline",
  legacy: false,
  stickers: [1, 2, 3, 4].map((id) => ({ id, name: `s${id}`, image: null, slot: id - 1, x: 0, y: 0, r: 0, w: 0 })),
  skipped: 1,
};

function scene(opts: { empty?: boolean } = {}) {
  const name = ref<string | null>(null);
  const outline = ref("awp");
  const mat = { stickers: opts.empty ? ([] as Sticker[]) : [{ id: 11, craft: "my-awp" }, { id: 12, craft: "my-awp" }] };
  const said: string[] = [];
  const undo: { label: string; run: () => void }[] = [];
  const reads: { code: string; signal: AbortSignal; answer: Deferred<CraftCodeWire> }[] = [];
  const lays: Deferred<void>[] = [];
  let applied = 0;
  const open = useMatOpen({
    name,
    outline,
    clear: () => {
      const taken = { stickers: mat.stickers };
      mat.stickers = [];
      return taken;
    },
    restore: (taken) => {
      mat.stickers = taken.stickers;
    },
    offerUndo: (label, run) => undo.push({ label, run }),
    say: (text) => said.push(text),
    tr: (_k, f, n) => f.replace(/\{(\w+)\}/g, (_, k) => String(n?.[k])),
    read: (code, signal) => {
      const answer = deferred<CraftCodeWire>();
      reads.push({ code, signal, answer });
      return answer.promise;
    },
    lay: async (got) => {
      const laid = deferred<void>();
      lays.push(laid);
      await laid.promise;
      return () => {
        applied++;
        outline.value = got.model;
        name.value = got.name;
        mat.stickers = got.stickers.map((s) => ({ id: s.id, craft: null }));
      };
    },
  });
  const state = () => ({ name: name.value, outline: outline.value, stickers: mat.stickers });
  return { open, name, outline, mat, said, undo, reads, lays, state, applied: () => applied };
}
async function imported(s: ReturnType<typeof scene>) {
  s.open.toggleImport();
  s.open.importText.value = "  csgo_econ_action_preview 00AA  ";
  const done = s.open.importCode();
  s.reads[0].answer.resolve(AK);
  await tick();
  s.lays[0].resolve();
  await done;
}

{
  const s = scene();
  const before = JSON.stringify(s.state());
  await imported(s);
  check("an import replaces the mat, chalks its gun and names it", [s.outline.value, s.name.value, s.mat.stickers.map((x) => x.craft)], ["ak47", "AK-47 | Redline", [null, null, null, null]]);
  check("the code is sent trimmed", s.reads[0].code, "csgo_econ_action_preview 00AA");
  check("it says how many were left out, on the Undo", s.undo.map((u) => u.label), ["Imported 4 stickers. 1 couldn't be read and was left out."]);
  check("the form closes and empties", [s.open.importOpen.value, s.open.importText.value, s.open.importBusy.value], [false, "", false]);
  s.undo[0].run();
  check("Undo brings back the stickers with their craft, the name and the chalk exactly", JSON.stringify(s.state()), before);
}
{
  const s = scene();
  s.name.value = "Typed name";
  const before = JSON.stringify(s.state());
  s.open.replace(() => {
    s.name.value = "Bob's duo (my copy)";
    s.mat.stickers = [{ id: 21, craft: null }];
  }, "“Bob's duo” is on the mat");
  s.undo[0].run();
  check("Undo of opening any craft brings back the name that was typed", JSON.stringify(s.state()), before);
}
{
  const s = scene({ empty: true });
  await imported(s);
  check("on an empty mat there is nothing to undo: the note goes to the toast", [s.undo.length, s.said], [0, ["Imported 4 stickers. 1 couldn't be read and was left out."]]);
}
{
  const s = scene({ empty: true });
  s.open.toggleImport();
  s.open.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.open.importCode();
  s.reads[0].answer.resolve({ ...AK, skipped: 0 });
  await tick();
  s.lays[0].resolve();
  await done;
  check("with nothing left out it says the stickers are on the mat", s.said, ["The code's stickers are on the mat. Save keeps them as your own craft."]);
}

{
  const s = scene();
  const before = JSON.stringify(s.state());
  s.open.toggleImport();
  s.open.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.open.importCode();
  check("Reading", s.open.importBusy.value, true);
  s.open.closeImport();
  check("closing while Reading cancels the request", s.reads[0].signal.aborted, true);
  s.reads[0].answer.resolve(AK);
  await done;
  await tick();
  check("and nothing lands after: no lay, no Undo, the mat as it was", [s.lays.length, s.undo.length, JSON.stringify(s.state()) === before], [0, 0, true]);
  check("the form is shut and idle", [s.open.importOpen.value, s.open.importBusy.value, s.open.importError.value], [false, false, null]);
}
{
  const s = scene();
  const before = JSON.stringify(s.state());
  s.open.toggleImport();
  s.open.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.open.importCode();
  s.reads[0].answer.resolve(AK);
  await tick();
  s.open.toggleImport();
  s.lays[0].resolve();
  await done;
  check("closing while the gun's outline loads: nothing lands either", [s.applied(), s.undo.length, JSON.stringify(s.state()) === before], [0, 0, true]);
}
{
  const s = scene();
  s.open.toggleImport();
  s.open.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.open.importCode();
  s.open.closeImport();
  s.reads[0].answer.reject(new DOMException("The operation was aborted.", "AbortError"));
  await done;
  check("a cancelled request is no error", s.open.importError.value, null);
  s.reads.length = 0;
  s.lays.length = 0;
  await imported(s);
  check("and the next import goes through", s.outline.value, "ak47");
}
{
  const s = scene();
  s.open.toggleImport();
  s.open.importText.value = "csgo_econ_action_preview 00AA";
  void s.open.importCode();
  void s.open.importCode();
  check("a second Import while Reading is ignored", s.reads.length, 1);
  s.open.importText.value = "   ";
  s.open.closeImport();
  s.open.toggleImport();
  void s.open.importCode();
  check("an empty paste sends nothing", s.reads.length, 1);
}

async function refusal(error: unknown, from: "read" | "lay" = "read") {
  const s = scene();
  s.open.toggleImport();
  s.open.importText.value = "csgo_econ_action_preview 00AA";
  const done = s.open.importCode();
  if (from === "read") {
    s.reads[0].answer.reject(error);
  } else {
    s.reads[0].answer.resolve(AK);
    await tick();
    s.lays[0].reject(error);
  }
  await done;
  return [s.open.importError.value, s.open.importOpen.value, s.open.importBusy.value, s.undo.length];
}
const shown = (message: string) => [message, true, false, 0];
check("the backend's reason picks the message", await refusal(new ApiError("x", 400, "unmasked")),
  shown("That link points at an item in someone's inventory, so it can't be read here. Paste the craft's Code from csinspect.com instead."));
check("no stickers known", await refusal(new ApiError("x", 400, "no-stickers")), shown("That code has no stickers this catalog knows."));
check("signed out", await refusal(new ApiError("unauthorized", 401, null)), shown("You're signed out. Sign in again, then import the code."));
check("a body past the server's limit is too long", await refusal(new ApiError("Request body is too large", 413, null)), shown("That's too long to be an inspect code."));
check("no answer at all is the network", await refusal(new TypeError("Failed to fetch")), shown("Couldn't reach the server. Check your connection and try again."));
check("a server error is try again", await refusal(new ApiError("boom", 500, null)), shown("Couldn't read that code. Try again."));
check("a failure laying it out is try again, not the network", await refusal(new TypeError("x is undefined"), "lay"), shown("Couldn't read that code. Try again."));
check("the paste field stops where the server does", IMPORT_MAX_CHARS, CODE_LIMITS.maxChars);

if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nopening and importing onto the mat undo exactly, and a closed import never lands");
