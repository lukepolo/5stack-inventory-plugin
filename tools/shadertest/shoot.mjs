// Render a rig page in headless Chrome and pull the results back as PNGs.
//
// Why this exists
// ---------------
// Every fixture in this directory ends in "look at the picture", and until now
// that meant a human with a browser, or the Chrome MCP extension. Neither is
// available in a headless session, and the extension in particular is a thing
// that can simply be disconnected — which is how a shader change ends up shipped
// on a typecheck and a hope. This is ~100 lines of CDP over node's built-in
// WebSocket and needs nothing installed.
//
//   node tools/shadertest/shoot.mjs 'http://localhost:5199/item3d.html?image=/images/kc_db_lighter_d10214d2.webp&seed=1' out/butane
//   node tools/shadertest/shoot.mjs '…&lqprobe=31' out/probe31 --wait 14000
//
// Writes <prefix>0.png, <prefix>1.png … one per <img> the page produced, and
// prints the page's own #out text plus anything that looked like an error.
//
// THE GL FLAGS ARE NOT OPTIONAL. Without --use-angle=swiftshader and
// --enable-unsafe-swiftshader a headless Chrome has no WebGL context at all;
// mountViewer then fails or draws nothing and every render comes back blank,
// which reads exactly like a broken shader.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [url, prefix = "shot"] = positional;
if (!url) {
  console.error("usage: node tools/shadertest/shoot.mjs <url> [outPrefix] [--wait ms] [--port n] [--chrome path]");
  process.exit(2);
}
// Generous by default: a mount fetches a GLB, its textures and (for a weapon) a
// composite, and item3d itself sleeps 1.8s before snapshotting. A short wait
// silently photographs an untextured model.
const WAIT = Number(flag("wait", 14000));
const PORT = Number(flag("port", 9333));
const CHROME = flag("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

const profile = mkdtempSync(join(tmpdir(), "shadertest-cdp-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--window-size=1280,900",
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
chrome.on("error", (e) => {
  console.error(`!!! could not launch Chrome at ${CHROME}: ${e.message}`);
  process.exit(1);
});
chrome.stderr.on("data", () => {}); // Chrome is chatty on stderr even when healthy

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function debuggerUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome never opened its debugging port");
}

const ws = new WebSocket(await debuggerUrl());
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
  if (m.method === "Runtime.consoleAPICalled")
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
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url });
await sleep(WAIT);

console.log("---- page ----\n" + (await evaluate("document.getElementById('out')?.innerText ?? '(no #out element)'")));

const srcs = JSON.parse((await evaluate("JSON.stringify([...document.querySelectorAll('#out img')].map(i => i.src))")) ?? "[]");
mkdirSync(dirname(prefix) || ".", { recursive: true });
let wrote = 0;
srcs.forEach((src, i) => {
  if (!src.startsWith("data:image")) return;
  const file = `${prefix}${i}.png`;
  writeFileSync(file, Buffer.from(src.split(",")[1], "base64"));
  console.log("wrote " + file);
  wrote++;
});

// A blank page is the failure worth naming: it is almost never the shader. Two
// causes dominate — vite failed the transform (a backtick inside a GLSL comment
// terminates the TS template literal, so `npm run typecheck` names it instantly),
// or Chrome has no WebGL context.
if (!wrote) {
  console.log("---- NO IMAGES RENDERED ----");
  console.log("     run `npm run typecheck` first: a module that fails to transform");
  console.log("     renders a completely blank page, not an error.");
}

const noise = /Clock: This module has been deprecated/;
const interesting = logs.filter((l) => /error|exception|shader|fail|WARN/i.test(l) && !noise.test(l));
if (interesting.length) console.log("---- console ----\n" + interesting.join("\n"));

chrome.kill();
process.exit(wrote ? 0 : 1);
