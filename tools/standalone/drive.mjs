// Click through the real UI in headless Chrome and screenshot it — a scripted
// user for mock-server.mjs (or any URL).
//
//   node tools/standalone/drive.mjs http://127.0.0.1:8787/ tools/standalone/steps.example.json out/ [width height]
//
// A steps file is a JSON array of { name?, js?, reload?, wait?, shot? }: `js`
// runs in the page (a returned Promise is awaited and its value printed),
// `reload: true` reloads the page (a fresh session, same server state — do not
// call location.reload() from `js`, the evaluate never returns), then the
// driver waits `wait` ms (default 1500) and, with `shot`, writes <out>/<shot>.png.
// DPR=2 in the environment renders at device pixel ratio 2.
//
// Console errors and uncaught exceptions are printed at the end; LOG=<regex> in
// the environment also prints every console line matching it as it arrives.
// The Chrome profile is a temp directory, deleted on exit.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, stepsFile, out, W = "1280", H = "900"] = process.argv.slice(2);
if (!url || !stepsFile || !out) {
  console.error("usage: node tools/standalone/drive.mjs <url> <steps.json> <outdir> [width height]");
  process.exit(2);
}
const steps = JSON.parse(readFileSync(stepsFile, "utf8"));
mkdirSync(out, { recursive: true });
const PORT = Number(process.env.CDP_PORT ?? 9344);
const profile = mkdtempSync(join(tmpdir(), "drive-cdp-"));
const chrome = spawn(
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    // Without these a headless Chrome has no WebGL and every 3D view is blank.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    // A scripted click is not a user gesture, so without this every audio
    // preview's play() is refused and the player reads "Preview unavailable".
    "--autoplay-policy=no-user-gesture-required",
    `--window-size=${W},${H}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
chrome.stderr.on("data", () => {});
process.on("exit", () => {
  try {
    chrome.kill("SIGKILL");
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) {
  console.error("Chrome never opened its debugging port");
  process.exit(1);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.consoleAPICalled" && process.env.LOG) {
    const fmt = (a) =>
      a.preview?.properties ? `{${a.preview.properties.map((p) => `${p.name}: ${p.value}`).join(", ")}}` : (a.value ?? a.description ?? "");
    const line = m.params.args.map(fmt).join(" ");
    if (new RegExp(process.env.LOG).test(line)) console.log(`[console] ${line}`);
  }
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning"))
    logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
  if (m.method === "Runtime.exceptionThrown")
    logs.push("[exception] " + (m.params.exceptionDetails?.exception?.description ?? ""));
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: +W,
  height: +H,
  deviceScaleFactor: Number(process.env.DPR ?? 1),
  mobile: false,
});
await send("Page.navigate", { url });
await sleep(6000);
for (const [i, st] of steps.entries()) {
  if (st.reload) await send("Page.reload", { ignoreCache: true });
  const v = st.js ? await evaluate(st.js) : undefined;
  if (v !== undefined) console.log(`step ${i} ${st.name ?? ""}:`, typeof v === "string" ? v : JSON.stringify(v));
  await sleep(st.wait ?? 1500);
  if (st.shot) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, `${st.shot}.png`), Buffer.from(shot.result.data, "base64"));
    console.log("wrote", join(out, `${st.shot}.png`));
  }
}
console.log("---- console errors ----\n" + (logs.slice(0, 30).join("\n") || "(none)"));
ws.close();
process.exit(0);
