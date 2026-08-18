// Would this schema actually apply?
//
// `applySchema` runs schema.sql on EVERY boot, so one bad identifier is not a
// migration that fails — it is the backend refusing to start. That is exactly
// what a column named `window` did: reserved in Postgres for window functions,
// legal-looking to everyone else, and invisible until deploy.
//
// No Postgres is needed to catch the common case. This flags column names that
// are reserved words, which is the class of mistake you make while naming a
// column after the thing it holds — window, order, user, end, check.
//
// NOT exhaustive, and not trying to be: it covers the reserved words anyone
// would plausibly reach for as a column name. A word missing from this list is
// a gap, not a false negative worth trusting.
//
// Run: node tools/schema-lint.mjs
import { readFileSync } from "node:fs";

const RESERVED = new Set([
  "all", "and", "any", "array", "as", "asc", "both", "case", "cast", "check", "collate",
  "column", "constraint", "default", "desc", "distinct", "do", "else", "end", "except",
  "false", "for", "foreign", "from", "grant", "group", "having", "in", "initially",
  "intersect", "into", "leading", "like", "limit", "not", "null", "offset", "on", "only",
  "or", "order", "placing", "primary", "references", "returning", "select", "some",
  "symmetric", "table", "then", "to", "trailing", "true", "union", "unique", "user",
  "using", "variadic", "when", "where", "window", "with",
]);
/** Lines that open a table CONSTRAINT rather than a column. */
const CONSTRAINT = /^(primary|foreign|unique|check|constraint|exclude)\b/i;

const sql = readFileSync("backend/src/schema.sql", "utf8");
const problems = [];

for (const [, body] of sql.matchAll(/CREATE TABLE[^(]*\(([\s\S]*?)\n\);/g)) {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("--") || CONSTRAINT.test(line)) continue;
    const name = line.split(/\s+/)[0].replace(/[",]/g, "");
    if (RESERVED.has(name.toLowerCase())) problems.push(name);
  }
}
for (const [, name] of sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)) {
  if (RESERVED.has(name.toLowerCase())) problems.push(name);
}

if (problems.length) {
  for (const name of [...new Set(problems)]) {
    console.log(`  FAIL  column "${name}" is a reserved word — quote it or rename it.`);
  }
  console.log(`\n${new Set(problems).size} reserved-word column(s). schema.sql applies on every boot, so this fails startup.`);
  process.exit(1);
}
console.log("schema.sql: no reserved-word columns.");
