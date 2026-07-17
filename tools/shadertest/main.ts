// Single-skin entry point. Params: ?model=&pm=&wear=&seed=
import { runOne } from "./rig";
const q = new URLSearchParams(location.search);
const model = q.get("model") ?? "famas";
const pm = q.get("pm") ?? "/materials/hye_firework_patches_famas_ef491eaa.vcompmat.json";
const wear = Number(q.get("wear") ?? "0.41");
const seed = Number(q.get("seed") ?? "821");
const out = document.getElementById("log")!;
runOne(model, pm, wear, seed).then((r) => {
  out.textContent = JSON.stringify(r, null, 2);
  (window as any).__result = r;
  (window as any).__done = true;
});
