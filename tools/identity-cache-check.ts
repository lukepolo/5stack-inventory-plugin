// The sign-in cache stays small however many cookies arrive.
//
// Run: node --experimental-strip-types tools/identity-cache-check.ts
//
// It is keyed by the Cookie header, which any caller picks, so a cache that
// only ever adds is memory anyone can grow.
import { getIdentity, identityCacheSize } from "../backend/src/identity.ts";

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

let asked = 0;
globalThis.fetch = (async (_url: string, init: { headers: { cookie: string } }) => {
  asked++;
  return new Response(JSON.stringify({ steam_id: init.headers.cookie, role: "user", name: "" }));
}) as unknown as typeof fetch;
let now = 1_000_000;
Date.now = () => now;
const ask = (cookie: string) => getIdentity({ headers: { cookie } } as never);

for (let i = 0; i < 1000; i++) {
  await ask(`flood=${i}`);
}
check("a thousand cookies keep at most 200 entries", identityCacheSize() <= 200, true);

for (let i = 0; i < 150; i++) {
  await ask(`old=${i}`);
}
now += 6_000;
const before = identityCacheSize();
for (let i = 0; i < 60; i++) {
  await ask(`new=${i}`);
}
check("expired entries go before live ones", identityCacheSize() <= before + 60 && identityCacheSize() >= 60, true);

asked = 0;
const first = await ask("new=59");
check("a live entry still answers without asking the panel", [first?.steamId, asked], ["new=59", 0]);
now += 6_000;
await ask("new=59");
check("an expired one asks again", asked, 1);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall identity cache checks pass");
