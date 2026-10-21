// shoot.mjs for Safari's engine: render a rig page in headless WebKit and pull
// the results back as PNGs.
//
// Chrome is not a stand-in for Safari. WebKit decodes and uploads images
// differently enough to change what composites (see src/rawPng.ts: a fully
// transparent PNG reaches WebGL as all zeros), and a bug like that is invisible
// to every Chrome-based runner in this directory.
//
// Playwright is deliberately not a dependency of the repo. Install it next to
// the runner once, outside the lockfile:
//
//   npm i --no-save playwright && npx playwright install webkit
//   node tools/shadertest/shoot-webkit.mjs 'http://localhost:5199/mount.html?model=bayonet&pm=…' out/bay_
//
// Same contract as shoot.mjs: waits for #done (or --wait ms), writes every
// `#out img` as <prefix><data-id>.png, prints #out and the console. --log regex
// prints matching console lines as they arrive; --headed shows the window.
// Failed requests and HTTP errors are listed too: an asset that 404s only in
// one browser is exactly the kind of thing this runner is for.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [url, prefix = "shot"] = positional;
if (!url) {
  console.error("usage: node tools/shadertest/shoot-webkit.mjs <url> [outPrefix] [--wait ms] [--log regex] [--headed]");
  process.exit(2);
}
let webkit;
try {
  ({ webkit } = await import("playwright"));
} catch {
  console.error("playwright is not installed: npm i --no-save playwright && npx playwright install webkit");
  process.exit(1);
}
const WAIT = Number(flag("wait", 60000));
const LOG = flag("log", null);

const browser = await webkit.launch({ headless: !args.includes("--headed") });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on("console", (m) => {
  const line = `[${m.type()}] ${m.text()}`;
  logs.push(line);
  if (LOG && new RegExp(LOG).test(line)) console.log(line);
});
page.on("pageerror", (e) => logs.push(`[exception] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[request failed] ${r.url()} ${r.failure()?.errorText ?? ""}`));
page.on("response", (r) => {
  if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`);
});

await page.goto(url);
await page.waitForSelector("#done", { timeout: WAIT, state: "attached" }).catch(() => console.log("(no #done before --wait)"));
console.log("---- page ----\n" + (await page.evaluate(() => document.getElementById("out")?.innerText ?? "(no #out element)")));
const srcs = await page.evaluate(() => [...document.querySelectorAll("#out img")].map((i) => [i.dataset.id ?? null, i.src]));
srcs.forEach(([id, src], n) => {
  const m = /^data:image\/\w+;base64,(.*)$/.exec(src);
  if (!m) return;
  const file = `${prefix}${id ?? n}.png`;
  writeFileSync(file, Buffer.from(m[1], "base64"));
  console.log("wrote", file);
});
if (!srcs.length) console.log("---- NO IMAGES RENDERED ----");
console.log("---- console ----\n" + (logs.slice(0, 60).join("\n") || "(none)"));
await browser.close();
