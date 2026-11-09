// Only an administrator fills the shared composite store.
//
// Run: node --experimental-strip-types tools/composite-store-check.ts
//
// Craft takes any in-range wear and seed, so a player can own an item matching
// any skin's tuple. The store is shared and served immutable, so the first
// upload of a slot is what every later viewer of that skin sees.
import { readFileSync } from "node:fs";
import { compositeUploadRefusal } from "../backend/src/compositeStore.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${label}\n  got  ${g}\n  want ${w}`);
    failures++;
  } else {
    console.log(`ok   ${label}  ${g}`);
  }
}

check("an administrator may store a composite", compositeUploadRefusal("administrator"), null);
for (const role of ["user", "verified_user", "streamer", "match_organizer", "tournament_organizer", ""]) {
  check(`a ${role || "roleless"} player may not`, typeof compositeUploadRefusal(role), "string");
}

const repoFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const main = repoFile("backend/src/main.ts");
const start = main.indexOf('app.post<{ Params: { gen: string; file: string } }>("/api/composite/:gen/:file"');
const route = start < 0 ? "" : main.slice(start, main.indexOf("\n});\n", start));
const refusedAt = route.indexOf("compositeUploadRefusal(identity.role)");
check("the upload route asks before anything else", refusedAt > 0 && refusedAt < route.indexOf("ownedBy("), true);
check("and answers admin_only so the client stops trying", /status\(403\)\.send\(\{ error: refused, admin_only: true \}\)/.test(route), true);

const client = repoFile("src/compositeStore.ts");
check("a refused client stops uploading for the session", /refusal\?\.admin_only\) \{\n\s+refusedForSession = true;/.test(client), true);
check(
  "uploads made before the gate are never read again",
  Number(/const STORE_FORMAT_VERSION = (\d+);/.exec(client)?.[1]) >= 2,
  true,
);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall composite store checks pass");
