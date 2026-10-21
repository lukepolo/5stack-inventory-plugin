// The REAL viewer, mounted from the URL, photographed — for anything that
// hangs on a model: stickers, StatTrak, name tags, holo/lenticular, masks.
//
// Every rig in this directory started life as a throwaway page for one bug. This
// is the shape those pages kept converging on, kept so the next one is a URL
// instead of a file. Collect it with shoot.mjs (it appends #done when finished):
//
//   node tools/shadertest/shoot.mjs \
//     'http://localhost:5199/mount.html?model=knife_flip&stattrak=12345&va=0,3.1416&plain=1' \
//     out/flip_ --wait 120000
//
// Query parameters (all optional except model):
//
//   model=ak47            model key, as the GLBs are named on the mount
//   kind=glove            viewer kind for non-weapons (glove, agent, charm…)
//   pm=/materials/….json  paint material (an item's paintMaterial)
//   legacy=1              legacy body — only takes effect WITH a legacy paint
//   wear=0.1 seed=1       float and pattern
//   st=/images/a.webp,…   stickers, slot 0, 1, … in order
//   xy=x,y,r;x,y,r;…      per-sticker offsets/rotation (game offset units)
//   sw=0.5 or sw=0,0.5,…  sticker wear (scratch), one for all or per slot
//   nomask=1              draw stickers without the weapon's sticker mask
//   stattrak=1337         StatTrak count ("dark" = the card's unlit module)
//   nametag=Some%20Name   name tag
//   decal=/images/….webp  a STANDALONE sticker (model=__sticker&kind=sticker)
//   va=0,1.57             camera orbit angles (radians), one shot each
//   ve=0.8                raise the camera this many radians (look down)
//   charm=/images/….webp  hang a charm (charmseed= its pattern)
//   t=0,1.5,3             seconds after load to shoot, per angle (live only)
//   still=0               the LIVE viewer (render loop, holo drift, inspect
//                         idle) instead of the card/bake path (default 1)
//   interactive=1         edit mode — the live camera holds still (no idle spin)
//   plain=1               also shoot without stickers/StatTrak/name tag, for
//                         diffing: the difference bbox IS the feature
//   size=1400             host width in CSS px (height 9/14 of it)
//   settle=3000           ms to wait after mount before the first shot
//   pre=/materials/….json mount the same model with THIS paint first and
//                         dispose it — for state leaking from one item to the
//                         next (shared caches, reused shader materials)
//
// Viewer debug switches read the same query string, so e.g. &stickerlog=1 logs
// every sticker build (collect with shoot.mjs --log '\[sticker\]').
//
// Images come out as <img data-id="<model>_<va>_<t>[_plain]">.
import { mountViewer } from "../../src/viewer3d";

const out = document.getElementById("out")!;
const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const list = (k: string, d: string) => (q.get(k) ?? d).split(",").filter((s) => s !== "");

const model = q.get("model") ?? "ak47";
const still = q.get("still") !== "0";
const size = num("size", 1400);
const settle = num("settle", 3000);
const angles = list("va", "0").map(Number);
const times = list("t", "0").map(Number);
const images = list("st", "");
// An empty field is "default", not 0: Number("") is 0, which pinned a sticker at the slot origin.
const offsets = (q.get("xy") ?? "").split(";").map((p) => p.split(",").map((v) => (v.trim() === "" ? NaN : Number(v))));
const stattrak = q.get("stattrak");
const stickerWear = list("sw", "").map(Number);
const note = (s: string) => {
  const d = document.createElement("div");
  d.textContent = s;
  out.appendChild(d);
};

const bounds = images.length || q.get("charm")
  ? await fetch(`/api/catalog/sticker-bounds/${model}`).then((r) => r.json()).catch(() => ({}))
  : {};

if (q.get("pre")) {
  const host = document.createElement("div");
  host.style.cssText = `width:${size}px;height:${Math.round((size * 9) / 14)}px;position:fixed;top:0;left:-9999px`;
  document.body.appendChild(host);
  try {
    const handle = await mountViewer(host, model, {
      ...(q.get("kind") ? { kind: q.get("kind") } : {}),
      paintMaterial: q.get("pre"),
      wear: 0.1,
      seed: 7,
      interactive: false,
      still: true,
    } as never);
    await new Promise((r) => setTimeout(r, settle));
    await handle.snapshot();
    handle.dispose();
  } catch (e) {
    note(`pre-mount failed: ${String(e)}`);
  } finally {
    host.remove();
  }
}

async function shoot(va: number, plain: boolean) {
  const host = document.createElement("div");
  // On screen for the LIVE path: an off-screen host can be treated as hidden
  // and its render loop throttled.
  host.style.cssText = `width:${size}px;height:${Math.round((size * 9) / 14)}px;position:fixed;top:0;left:${still ? -9999 : 0}px`;
  document.body.appendChild(host);
  try {
    const handle = await mountViewer(host, model, {
      ...(q.get("kind") ? { kind: q.get("kind") } : {}),
      paintMaterial: q.get("pm"),
      legacyPaint: q.get("legacy") === "1",
      wear: num("wear", 0.05),
      seed: num("seed", 1),
      // Edit mode: also the one way to hold a LIVE camera still (no idle spin).
      interactive: q.get("interactive") === "1",
      still,
      viewAngle: va || undefined,
      viewElevation: num("ve", 0) || undefined,
      stickers: plain
        ? []
        : images.map((image, i) => ({
            slot: i,
            image,
            x: Number.isFinite(offsets[i]?.[0]) ? offsets[i][0] : null,
            y: Number.isFinite(offsets[i]?.[1]) ? offsets[i][1] : null,
            r: Number.isFinite(offsets[i]?.[2]) ? offsets[i][2] : null,
            w: stickerWear[i] ?? stickerWear[0] ?? null,
          })),
      stickerSlots: bounds.slots,
      stickerBounds: bounds.bounds,
      stickerMasks: q.get("nomask") ? undefined : bounds.masks,
      stattrak: plain || stattrak == null ? null : { count: stattrak === "dark" ? null : Number(stattrak) },
      nametag: plain ? null : q.get("nametag"),
      charm: plain || !q.get("charm") ? null : { image: q.get("charm")!, x: null, y: null, z: null, seed: num("charmseed", 1) },
      charmSurfaces: bounds.charmQuads,
      // A standalone sticker/patch: model=__sticker&kind=sticker&decal=/images/….webp
      decal: q.get("decal") ? { image: q.get("decal")!, wear: num("decalwear", 0) } : null,
    } as never);
    await new Promise((r) => setTimeout(r, settle));
    let last = 0;
    for (const t of plain ? [times[0]] : times) {
      await new Promise((r) => setTimeout(r, Math.max(0, t - last) * 1000));
      last = t;
      const blob = await handle.snapshot();
      if (!blob) {
        note(`${model} va=${va} t=${t}: snapshot() returned null`);
        continue;
      }
      const img = document.createElement("img");
      img.src = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(blob);
      });
      img.dataset.id = `${model}_${va}_${t}${plain ? "_plain" : ""}`;
      out.appendChild(img);
    }
    handle.dispose();
  } catch (e) {
    note(`FAIL ${model} va=${va}: ${String((e as Error)?.stack ?? e)}`);
  } finally {
    host.remove();
  }
}

for (const va of angles) {
  await shoot(va, false);
  if (q.get("plain") === "1") await shoot(va, true);
}
note(`done: ${out.querySelectorAll("img").length} image(s)`);
const done = document.createElement("div");
done.id = "done";
out.appendChild(done);
