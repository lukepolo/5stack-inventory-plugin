// Does the prefetch store keep its contract with the loaders?
//
// Run: node --experimental-strip-types tools/prefetch-check.ts
//
// Why this exists
// ---------------
// src/prefetchStore.ts sits between every 3D loader and the network, and the
// whole point of it is a promise to those loaders: a file that was warmed is
// never downloaded a second time, and a file that was NOT warmed (or failed,
// or 404'd) is fetched exactly as it would have been without the store. Both
// halves fail silently — a duplicate download is just a slower open, and a
// swallowed error is a white gun several layers away — so they are checked
// here against a fake network that counts requests.
import {
  HOVER,
  IDLE,
  Intent,
  URGENT,
  cancelIntent,
  prefetchStats,
  prefetchedFetch,
  prefetchedUrl,
  prefetchedUrlSync,
  setBusyProbe,
  settlePrefetched,
  warmUrl,
} from "../src/prefetchStore.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
    failures++;
  } else {
    console.log(`ok   ${label}  ${JSON.stringify(got)}`);
  }
}

// ---- A fake network --------------------------------------------------------
// Every URL answers after `delay` ms; "/missing" ones 404. `inFlight` tracks
// how many requests are open at once.
const requests: string[] = [];
let inFlight = 0;
let peak = 0;
const delay = 30;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.startsWith("blob:")) throw new Error("the store must never fetch a blob: URL itself");
  requests.push(url);
  inFlight++;
  peak = Math.max(peak, inFlight);
  await new Promise((r) => setTimeout(r, delay));
  inFlight--;
  if (url.includes("/missing")) return new Response("nope", { status: 404 });
  return new Response(new Blob([`bytes of ${url}`], { type: "image/webp" }), { status: 200 });
}) as typeof fetch;
const count = (url: string) => requests.filter((r) => r === url).length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- 1. A warmed file is taken, not fetched again --------------------------
await warmUrl("https://a/models/one.glb", HOVER);
const r1 = await prefetchedFetch("https://a/models/one.glb");
check("warmed GLB: one request in total", count("https://a/models/one.glb"), 1);
check("warmed GLB: the loader gets its bytes", await r1.text(), "bytes of https://a/models/one.glb");

// ---- 2. A warm in flight is waited for, not duplicated ---------------------
void warmUrl("https://a/models/two.webp", HOVER);
await sleep(5); // started, not finished
const u2 = await prefetchedUrl("https://a/models/two.webp");
check("in-flight texture: still one request", count("https://a/models/two.webp"), 1);
check("in-flight texture: handed over as a blob: URL", u2.startsWith("blob:"), true);

// ---- 3. A repeat load of a taken URL gets the SAME blob: URL ---------------
// Two loadTex calls for one pattern (Valve's combo and the port) must still
// pair up in the browser's image cache, which keys on the URL.
const u2again = await prefetchedUrl("https://a/models/two.webp");
check("repeat load: same blob: URL, no request", [u2again === u2, count("https://a/models/two.webp")], [true, 1]);

// ---- 4. Nothing warmed: the loader's own request, unchanged ----------------
const u4 = await prefetchedUrl("https://a/paints/cold.webp");
check("never warmed: the real URL comes back", u4, "https://a/paints/cold.webp");
check("never warmed: the store made no request of its own", count("https://a/paints/cold.webp"), 0);
const r4 = await prefetchedFetch("https://a/models/cold.glb");
check("never warmed: prefetchedFetch is a plain fetch", [count("https://a/models/cold.glb"), r4.status], [1, 200]);

// ---- 5. A 404 the store learned ---------------------------------------------
// prefetchedUrl rejects (the composite store lookup reads that as "not
// stored", exactly like a 404) without another request; prefetchedFetch goes
// to the network so the loader sees the real status.
await warmUrl("https://a/api/composites/g/missing.albedo.webp", HOVER);
let rejected = false;
await prefetchedUrl("https://a/api/composites/g/missing.albedo.webp").catch(() => (rejected = true));
check("known 404: rejected without a second request", [rejected, count("https://a/api/composites/g/missing.albedo.webp")], [true, 1]);
await warmUrl("https://a/models/missing.glb", HOVER);
const r5 = await prefetchedFetch("https://a/models/missing.glb");
check("known 404 through prefetchedFetch: the loader's own 404", [r5.status, count("https://a/models/missing.glb")], [404, 2]);

// ---- 6. Background warms: at most two at a time ----------------------------
peak = 0;
await Promise.all(Array.from({ length: 6 }, (_, i) => warmUrl(`https://a/models/bg${i}.webp`, HOVER)));
check("background concurrency", peak, 2);
peak = 0;
await Promise.all(Array.from({ length: 6 }, (_, i) => warmUrl(`https://a/models/urgent${i}.webp`, URGENT)));
check("urgent warms run in parallel", peak > 2, true);

// ---- 7. Leaving drops only what has not started -----------------------------
const hover = new Intent();
const results = Array.from({ length: 5 }, (_, i) => warmUrl(`https://a/models/h${i}.webp`, HOVER, hover));
await sleep(1);
cancelIntent(hover);
const states = await Promise.all(results);
check("cancel: two started and finished, three dropped", states, ["ready", "ready", "dropped", "dropped", "dropped"]);
check("cancel: dropped warms made no request", count("https://a/models/h4.webp"), 0);

// ---- 8. Leaving one tile keeps what another still wants ---------------------
const left = new Intent();
const stayed = new Intent();
const fill = [warmUrl("https://a/models/f0.webp", HOVER, left), warmUrl("https://a/models/f1.webp", HOVER, left)];
const sharedLeft = warmUrl("https://a/models/shared.webp", HOVER, left); // queued behind the two
const sharedStayed = warmUrl("https://a/models/shared.webp", HOVER, stayed);
cancelIntent(left);
check("cancel keeps a queued file another intent wants", [await sharedLeft, await sharedStayed], ["ready", "ready"]);
await Promise.all(fill);

// ---- 9. A busy viewer holds background warms back ---------------------------
let busy = true;
setBusyProbe(() => busy);
const held = warmUrl("https://a/models/later.webp", IDLE);
await sleep(100);
check("viewer building: background warm not started", count("https://a/models/later.webp"), 0);
busy = false;
check("viewer done: it starts", await held, "ready");
setBusyProbe(() => false);

// ---- 10. A loader asking for a QUEUED warm starts it at once ---------------
busy = true;
setBusyProbe(() => busy);
void warmUrl("https://a/models/q.webp", HOVER);
await settlePrefetched(["https://a/models/q.webp"]);
check("queued + loader asks: promoted, one request", count("https://a/models/q.webp"), 1);
check("then handed over synchronously", prefetchedUrlSync("https://a/models/q.webp")?.startsWith("blob:"), true);
setBusyProbe(() => false);

console.log("stats", JSON.stringify(prefetchStats()));
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all prefetch store checks passed");
// Timers (blob: URL revocation, the unused-entry sweep) would keep node alive.
process.exit(0);
