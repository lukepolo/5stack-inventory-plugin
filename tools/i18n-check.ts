// Do the translation keys in the code and the catalogue still agree?
//
// Run: node --experimental-strip-types tools/i18n-check.ts
//
// Why this exists
// ---------------
// `tr(key, fallback)` is total: a key the catalogue does not have renders the
// FALLBACK, in English, forever. That is the right runtime behaviour — a missing
// translation must never blank a button — but it makes every mistake here
// invisible from the screen:
//
//   1. A key that is used and not in the catalogue. The UI looks perfect and the
//      string is unreachable to a translator, so the moment a second locale
//      exists that control is silently still English.
//   2. A key in the catalogue that nothing uses. Dead weight, and worse than
//      dead: a translator spends real effort on a string nobody will ever see.
//   3. THE DRIFT. A key whose catalogue text and whose in-code fallback have
//      diverged. English users get the catalogue's wording, every reader of the
//      code sees the fallback's, and neither is wrong enough to notice — until
//      someone "fixes" the code to match what they saw on screen.
//
// (3) is the one that cannot be found by reading either file alone, and it is
// the reason this compares TEXT and not just key presence.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const CATALOGUE = join(SRC, "locales/en.json");

let failures = 0;
const fail = (m: string) => {
  console.error(`FAIL ${m}`);
  failures++;
};

/** Every .ts/.vue under src, minus the catalogue itself. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|vue)$/.test(name)) out.push(p);
  }
  return out;
}

/** Flatten the nested catalogue to the dotted keys `tr` is called with. */
function flatten(o: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries((o ?? {}) as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else if (typeof v === "string") out.set(key, v);
  }
  return out;
}

// Both quote styles, on BOTH arguments, as alternatives rather than one
// character class with a backreference — a class cannot express "not the quote
// that opened this", so a naive [^'"] excludes the OTHER quote too and any
// fallback containing an apostrophe silently does not match. That is exactly how
// the first version of this reported 36 unused keys that were all in use: it was
// blind precisely where English is punctuated, which is most user-facing copy.
//
// The fallback may also be a TEMPLATE LITERAL, because several of these
// interpolate a count or an error into the English before handing the same
// values to tr as named params. Those count as USED but their text cannot be
// compared against the catalogue — the catalogue holds "{summary}" where the
// code holds an evaluated expression — so drift checking skips them and the
// summary says how many were skipped rather than implying they were checked.
const CALL =
  /\btr\(\s*(?:'([^']+)'|"([^"]+)")\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;
// A key built at runtime — a template literal or a variable. Counted, never
// guessed at, so the summary cannot imply coverage this tool does not have.
const DYNAMIC = /\btr\(\s*[`a-zA-Z_$]/g;

const catalogue = flatten(JSON.parse(readFileSync(CATALOGUE, "utf8")));
const used = new Map<string, { fallback: string | null; where: string }>();
let dynamic = 0;
let skipped = 0;

for (const file of sources(SRC)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(CALL)) {
    const key = m[1] ?? m[2];
    if (key === undefined) continue;
    // m[5] is the template-literal form: used, but not text-comparable.
    const fallback = m[3] ?? m[4] ?? null;
    used.set(key, { fallback, where: relative(root, file) });
  }
  for (const _ of text.matchAll(DYNAMIC)) void _, dynamic++;
}

for (const [key, { fallback, where }] of used) {
  const inCatalogue = catalogue.get(key);
  if (inCatalogue === undefined) {
    fail(`${where}: tr("${key}") is not in en.json — it renders its English fallback forever, and no translator can reach it`);
  } else if (fallback === null) {
    skipped++;
  } else if (inCatalogue !== fallback) {
    fail(
      `${where}: tr("${key}") has DRIFTED\n` +
        `       en.json:  ${JSON.stringify(inCatalogue)}\n` +
        `       fallback: ${JSON.stringify(fallback)}\n` +
        `       English users see the first; anyone reading the code sees the second.`,
    );
  }
}

const unused = [...catalogue.keys()].filter((k) => !used.has(k));
if (unused.length) {
  // A WARNING, never a failure, and hedged on purpose. Two reasons a key can
  // appear here while being perfectly alive:
  //
  //   - it is reached by a COMPUTED key. AdminConsole builds its extraction-step
  //     labels as tr(`inventory.admin.extract.steps.${s.name}`), so ten real keys
  //     look dead to any static reader. That is what the dynamic count is for.
  //   - it landed before its call site, which is a normal order to work in.
  //
  // Calling either of those a failure would train people to ignore this tool,
  // which is worse than not having it.
  console.log(`warn ${unused.length} catalogue key(s) no LITERAL tr() call names:`);
  for (const k of unused) console.log(`       ${k}`);
  if (dynamic) {
    console.log(
      `     ${dynamic} tr() call(s) build their key at runtime — some of the above\n` +
        `     are probably theirs. Check those before deleting anything.`,
    );
  }
}

console.log(
  `\n${used.size} key(s) used, ${catalogue.size} in en.json` +
    (skipped ? `, ${skipped} with an interpolated fallback (used, text not compared)` : "") +
    (dynamic ? `, ${dynamic} tr( call(s) with a non-literal key — NOT checked` : ""),
);
if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("keys and catalogue agree");
