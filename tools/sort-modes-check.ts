// Does every sort mode have every entry it needs?
//
// Run: node --experimental-strip-types tools/sort-modes-check.ts
//
// Why this exists
// ---------------
// A sort mode is declared in FIVE places that must agree: the `SortMode` union,
// the `SORTS` menu list, `SORT_NATURAL`, `SORT_DIR_HINT` and `SORT_DIR_KIND`.
// TypeScript catches four of them, because those three are `Record<SortMode, …>`
// and a missing key is a compile error.
//
// It does NOT catch the menu list. `SORTS` is an array, so a mode can exist,
// sort correctly, have a hint and an icon, and simply never be offered — and the
// failure is invisible: the grid is sorted the way it always was, by whatever
// mode is still reachable. That is the hole this closes.
//
// It also pins the direction hints to having BOTH directions. `SORT_DIR_HINT` is
// `Record<SortMode, Record<SortDir, string>>`, which a cast can satisfy with one
// key — and a missing hint renders as an empty tooltip next to a control whose
// only label IS the tooltip.
import {
  SORTS,
  SORT_NATURAL,
  SORT_DIR_HINT,
  SORT_DIR_KIND,
  ATTACH_SORTS,
  ATTACH_SORT_NATURAL,
  ATTACH_DIR_HINT,
  ATTACH_SORT_KIND,
} from "../src/sortModes.ts";

let failures = 0;
const fail = (m: string) => {
  console.error(`FAIL ${m}`);
  failures++;
};

const DIRS = ["asc", "desc"] as const;
const KINDS = ["alpha", "numeric", "amount"] as const;

/** One family of modes, checked against its own four registries. */
function checkFamily(
  label: string,
  modes: string[],
  natural: Record<string, string>,
  hint: Record<string, Record<string, string>>,
  kind: Record<string, string>,
) {
  const before = failures;
  // The registries are the source of truth for WHICH modes exist — they are the
  // typed ones. The menu is what gets forgotten, so it is what gets compared.
  const declared = Object.keys(natural);
  for (const m of declared) {
    if (!modes.includes(m)) {
      fail(`${label}: '${m}' exists and is never offered in the menu — it is unreachable`);
    }
    if (!DIRS.every((d) => typeof hint[m]?.[d] === "string" && hint[m][d].length > 0)) {
      fail(`${label}: '${m}' is missing a direction hint (needs both asc and desc)`);
    }
    if (!KINDS.includes(kind[m] as (typeof KINDS)[number])) {
      fail(`${label}: '${m}' has icon kind ${JSON.stringify(kind[m])}, not one of ${KINDS.join("/")}`);
    }
    if (!DIRS.includes(natural[m] as (typeof DIRS)[number])) {
      fail(`${label}: '${m}' has natural direction ${JSON.stringify(natural[m])}, not asc/desc`);
    }
  }
  for (const m of modes) {
    if (!declared.includes(m)) {
      fail(`${label}: menu offers '${m}' but no registry declares it — picking it does nothing`);
    }
  }
  const dupes = modes.filter((m, i) => modes.indexOf(m) !== i);
  if (dupes.length) fail(`${label}: menu lists a mode twice: ${dupes.join(", ")}`);
  // Only claim agreement if this family actually produced none. Printing the ok
  // line unconditionally read as "FAIL ... ok all five declarations agree", which
  // is the one thing a check must never say.
  if (failures === before) {
    console.log(`ok   ${label}: ${declared.length} modes, all five declarations agree`);
    console.log(`     ${modes.join(" ")}`);
  }
}

checkFamily(
  "item sorts",
  SORTS.map(([m]) => m as string),
  SORT_NATURAL as unknown as Record<string, string>,
  SORT_DIR_HINT as unknown as Record<string, Record<string, string>>,
  SORT_DIR_KIND as unknown as Record<string, string>,
);

checkFamily(
  "attachment sorts",
  ATTACH_SORTS.map((s) => s.value as string),
  ATTACH_SORT_NATURAL as unknown as Record<string, string>,
  ATTACH_DIR_HINT as unknown as Record<string, Record<string, string>>,
  ATTACH_SORT_KIND as unknown as Record<string, string>,
);

if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\nall checks passed");
