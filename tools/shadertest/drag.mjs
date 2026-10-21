// Orbit a LIVE viewer with the mouse after it has loaded, and screenshot it.
//
// `ve`/`va` on mount.html set the camera BEFORE the first frame, so anything
// that calibrates on its first frames (the charm cloth, the liquid) has already
// adapted by the time you look. Bugs that only appear when the camera moves
// AFTER load, like the Butane Buddy flooding as the view went over the top,
// need a real drag. Uses Playwright, like shoot-webkit.mjs:
//
//   npm i --no-save playwright && npx playwright install chromium webkit
//   node tools/shadertest/drag.mjs '<mount.html url with still=0&interactive=1&t=0,60>' out/orb_ \
//     --drags '0,120;0,120;0,120' [--after 50,1000,4000] [--wait 14000] [--browser webkit]
//
// Waits --wait ms for the mount, shoots <prefix>rest.png, then for each drag
// (dx,dy in px from the middle of the viewer, done in 12 moves) shoots
// <prefix><n>_<ms>.png at every --after delay. `t=0,60` keeps mount.html's
// live viewer open for the minute this takes.
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [url, prefix = "drag_"] = positional;
if (!url) {
  console.error("usage: node tools/shadertest/drag.mjs <url> [outPrefix] [--drags 'dx,dy;…'] [--after ms,…] [--wait ms] [--browser chromium|webkit]");
  process.exit(2);
}
let pw;
try {
  pw = await import("playwright");
} catch {
  console.error("playwright is not installed: npm i --no-save playwright && npx playwright install chromium webkit");
  process.exit(1);
}
const which = flag("browser", "chromium");
const drags = flag("drags", "0,120").split(";").map((d) => d.split(",").map(Number));
const after = flag("after", "4000").split(",").map(Number);
// Same reason as shoot.mjs: headless Chrome has no WebGL without SwiftShader.
const browser = await pw[which].launch(
  which === "chromium" ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("[exception]", e.message));
await page.goto(url);
await page.waitForTimeout(Number(flag("wait", 14000)));
await page.screenshot({ path: `${prefix}rest.png` });
console.log("wrote", `${prefix}rest.png`);
const [x0, y0] = [640, 300];
for (const [n, [dx, dy]] of drags.entries()) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x0 + (dx * i) / 12, y0 + (dy * i) / 12, { steps: 2 });
  await page.mouse.up();
  let waited = 0;
  for (const ms of after) {
    await page.waitForTimeout(ms - waited);
    waited = ms;
    await page.screenshot({ path: `${prefix}${n}_${ms}.png` });
    console.log("wrote", `${prefix}${n}_${ms}.png`);
  }
}
await browser.close();
