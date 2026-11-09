// The game server's StatTrak key is compared in constant time.
//
// Run: node --experimental-strip-types tools/server-key-check.ts
//
// `apiKey !== key` stops at the first wrong character, so its timing tells a
// caller how much of the key it has right.
import { readFileSync } from "node:fs";
import { sameServerKey } from "../backend/src/serverKey.ts";

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

const KEY = "a3f1c9e0b7d24c6e8f0a1b2c3d4e5f60";
check("the right key", sameServerKey(KEY, KEY), true);
check("a wrong key of the same length", sameServerKey(KEY.replace(/.$/, "1"), KEY), false);
check("a prefix of the key", sameServerKey(KEY.slice(0, 8), KEY), false);
check("the key with more after it", sameServerKey(`${KEY}x`, KEY), false);
check("no key sent", sameServerKey(undefined, KEY), false);
check("a number sent", sameServerKey(123, KEY), false);
check("no key generated, nothing sent", sameServerKey(undefined, null), false);
check("no key generated, empty sent", sameServerKey("", ""), false);

const main = readFileSync(new URL("../backend/src/main.ts", import.meta.url), "utf8");
const start = main.indexOf('"/api/increment-item-stattrak"');
const route = start < 0 ? "" : main.slice(start, main.indexOf("\n);\n", start));
check("the StatTrak route uses it", /if \(!sameServerKey\(apiKey, key\)\) \{/.test(route), true);
check("and no plain comparison is left", /apiKey\s*!==?\s*key|key\s*!==?\s*apiKey/.test(route), false);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall server key checks pass");
