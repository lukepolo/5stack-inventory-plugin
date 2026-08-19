// Do the two loadout-slot whitelists still agree?
//
// Run: node --experimental-strip-types tools/slot-whitelist-check.ts
//
// Why this exists
// ---------------
// The set of legal loadout slots is written down TWICE:
//
//   1. SLOT_RE in backend/src/main.ts — what the equip API will accept.
//   2. The `DELETE FROM inventory.loadout WHERE slot NOT IN (...)` in
//      backend/src/schema.sql — which rows survive a restart.
//
// schema.sql is re-applied on EVERY boot. So a slot the API accepts and that
// DELETE forgets is not a stale-data cleanup — it is a wipe, and it does not
// happen at deploy time where someone would connect it to the change. It
// happens on the next restart, hours later, and it looks like the equip
// silently failing. `graffiti` was exactly that: equippable from the day the
// graffiti sheet shipped, absent from the DELETE, and deleted on every backend
// restart until someone noticed.
//
// Both files carry a "KEEP IN STEP WITH..." comment. This is that comment,
// enforced — because the comment has already been read and not acted on once.
//
// Deliberately reads both files as TEXT rather than importing them. main.ts
// boots a Fastify server on import (the same reason tools/inspect-roundtrip.ts
// pulls normStickerRotation from catalog.ts instead), and schema.sql is not
// JavaScript at all. Parsing the source is the only way to see both.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = join(root, "backend/src/main.ts");
const SCHEMA = join(root, "backend/src/schema.sql");

let failures = 0;
function fail(msg: string): void {
  console.error(`FAIL ${msg}`);
  failures++;
}

/**
 * Every literal string SLOT_RE accepts.
 *
 * The regex is an alternation of literals and single bounded ranges
 * (`p[1-4]`), so it enumerates exactly. Anything more exotic THROWS rather than
 * guessing: a slot pattern this cannot expand is precisely the moment a human
 * should look at both lists, which is the whole point of the check.
 */
function expandSlotRe(src: string): string[] {
  const body = src.replace(/^\^\(/, "").replace(/\)\$$/, "");
  if (body === src) {
    throw new Error(`SLOT_RE is not the expected /^(...)$/ shape: ${src}`);
  }
  const out: string[] = [];
  for (const branch of body.split("|")) {
    const plain = /^[a-z0-9_]+$/.exec(branch);
    if (plain) {
      out.push(branch);
      continue;
    }
    const ranged = /^([a-z]+)\[(\d)-(\d)\]$/.exec(branch);
    if (ranged) {
      const [, stem, lo, hi] = ranged;
      for (let n = Number(lo); n <= Number(hi); n++) out.push(`${stem}${n}`);
      continue;
    }
    throw new Error(
      `cannot expand SLOT_RE branch ${JSON.stringify(branch)} — ` +
        `teach this tool the new shape, then re-check schema.sql by hand`,
    );
  }
  return out;
}

// ---- read SLOT_RE -----------------------------------------------------------

const mainSrc = readFileSync(MAIN, "utf8");
const reMatch = /const SLOT_RE\s*=\s*\/(.+?)\/;/.exec(mainSrc);
if (!reMatch) {
  fail(`could not find SLOT_RE in ${MAIN} — was it renamed or reformatted?`);
  process.exit(1);
}
const slotRe = new RegExp(reMatch[1]);
const accepted = expandSlotRe(reMatch[1]);

// The expander has to agree with the real regex, or everything below compares
// against a fiction.
for (const slot of accepted) {
  if (!slotRe.test(slot)) fail(`expander produced ${JSON.stringify(slot)}, which SLOT_RE rejects`);
}

// ---- read the schema whitelist ----------------------------------------------

const schemaSrc = readFileSync(SCHEMA, "utf8");

/**
 * The whitelist, however schema.sql currently spells it.
 *
 * TWO shapes are legal, because the file grew a second slot-bearing table and
 * writing the list twice would have been the same trap one table deeper:
 *
 *   inline  DELETE ... WHERE slot NOT IN ('sp','p1', ...)
 *   CTE     WITH legal_slot (slot) AS (VALUES ('sp'),('p1'), ...)
 *
 * The CTE form is preferred and checked first: it is the one that keeps the
 * list single-sourced no matter how many tables are cleaned through it.
 */
function readWhitelist(src: string): string[] | null {
  // Bounded by the next CTE (`), live AS (`) or the statement that consumes it,
  // NOT by the first `),` — a non-greedy stop there ends after ('sp') and reports
  // the other 22 slots as missing, which is a very convincing false alarm.
  const cte =
    /legal_slot\s*\(\s*slot\s*\)\s*AS\s*\(\s*VALUES([\s\S]*?)(?:\bAS\b|\bDELETE\b|;)/i.exec(src);
  if (cte) return [...cte[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const inline =
    /DELETE\s+FROM\s+inventory\.loadout\s+WHERE\s+slot\s+NOT\s+IN\s*\(([^)]*)\)/i.exec(src);
  if (inline) return [...inline[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return null;
}

const kept = readWhitelist(schemaSrc);
if (!kept || !kept.length) {
  fail(`could not read a slot whitelist from ${SCHEMA} — was it removed or reshaped?`);
  process.exit(1);
}

/**
 * Every table that STORES a slot must also be CLEANED by the whitelist.
 *
 * The original check only knew about inventory.loadout. Presets added
 * loadout_preset_slots, and a slot-bearing table nothing deletes from is the
 * same wipe-shaped bug wearing a different table name — except it fails the
 * other way: the row survives with a slot the API will not accept.
 */
const slotTables = [
  ...schemaSrc.matchAll(
    /CREATE TABLE IF NOT EXISTS (inventory\.\w+)\s*\(([\s\S]*?)\n\);/gi,
  ),
]
  .filter(([, , body]) => /^\s*slot\s+text/im.test(body))
  .map(([, name]) => name);

for (const t of slotTables) {
  const cleaned = new RegExp(
    `DELETE\\s+FROM\\s+${t.replace(".", "\\.")}[\\s\\S]{0,200}?slot\\s+NOT\\s+IN`,
    "i",
  ).test(schemaSrc);
  if (!cleaned) {
    fail(
      `${t} stores a slot but no DELETE cleans it — a row there can keep a slot ` +
        `SLOT_RE rejects, and nothing will ever remove it`,
    );
  }
}

// ---- compare ----------------------------------------------------------------

const acceptedSet = new Set(accepted);
const keptSet = new Set(kept);

// The dangerous direction. A slot here is accepted by the API, written to the
// database, and then deleted on the next boot.
for (const slot of accepted) {
  if (!keptSet.has(slot)) {
    fail(
      `'${slot}' is accepted by SLOT_RE but missing from schema.sql's DELETE — ` +
        `every equip into it is wiped on the next backend restart`,
    );
  }
}

// The harmless-but-wrong direction: dead entries, or a slot the API forgot.
for (const slot of kept) {
  if (!acceptedSet.has(slot)) {
    fail(
      `'${slot}' is preserved by schema.sql but rejected by SLOT_RE — ` +
        `either the API lost a slot, or this entry is dead`,
    );
  }
}

if (keptSet.size !== kept.length) {
  fail(`schema.sql lists a slot twice: ${kept.join(", ")}`);
}

if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log(`ok   ${accepted.length} slots agree in both files`);
console.log(`     cleaned tables: ${slotTables.join(", ") || "(none found)"}`);
console.log(`     ${accepted.join(" ")}`);
