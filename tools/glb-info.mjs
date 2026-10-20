// What is actually inside a model on the mount: nodes (the bone chain, with
// bind translation/rotation), meshes and their primitives (material, which UV
// sets, vertex count, UV ranges), and each material's vmat shader + params.
//
// Nearly every placement or texture-space bug in this repo was settled by
// reading one of these off the real file instead of reasoning about it — the
// knife bones turned at bind, the legacy AK's UV0 running to -4..3.4, the C4's
// panorama panel quad. Works on a local file or a URL.
//
//   node tools/glb-info.mjs https://inventory-dev.fulm.eu/models/ak47.glb
//   node tools/glb-info.mjs ak47.glb --uv          # per-primitive UV ranges
//   node tools/glb-info.mjs ak47.glb --vmat=ak47   # one material's full vmat
import { readFile } from "node:fs/promises";

const [src, ...flags] = process.argv.slice(2);
if (!src) {
  console.error("usage: node tools/glb-info.mjs <file.glb|url> [--uv] [--vmat=<material name>]");
  process.exit(2);
}
const buf = Buffer.from(/^https?:/.test(src) ? await (await fetch(src)).arrayBuffer() : await readFile(src));
if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error("not a .glb");
const jsonLen = buf.readUInt32LE(12);
const doc = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
const bin = buf.subarray(20 + jsonLen + 8);
const fmt = (v) => (Array.isArray(v) ? `[${v.map((x) => +Number(x).toFixed(4)).join(", ")}]` : v);

console.log("== nodes");
doc.nodes.forEach((n, i) => {
  const t = ["translation", "rotation", "scale", "matrix"].filter((k) => n[k]).map((k) => `${k}=${fmt(n[k])}`);
  console.log(`  ${i} ${n.name ?? "(unnamed)"}${n.mesh != null ? ` mesh=${n.mesh}` : ""}${n.children ? ` children=${fmt(n.children)}` : ""} ${t.join(" ")}`);
});
(doc.skins ?? []).forEach((s, i) => console.log(`== skin ${i}: joints ${s.joints.map((j) => doc.nodes[j].name).join(", ")}`));

function readVec2(accessorIndex) {
  const a = doc.accessors[accessorIndex];
  const v = doc.bufferViews[a.bufferView];
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = v.byteStride ?? 8;
  const out = [];
  for (let i = 0; i < a.count; i++) out.push([bin.readFloatLE(off + i * stride), bin.readFloatLE(off + i * stride + 4)]);
  return out;
}
console.log("== meshes");
doc.meshes.forEach((m, mi) => {
  m.primitives.forEach((p, pi) => {
    const mat = p.material != null ? doc.materials[p.material]?.name : null;
    const pos = doc.accessors[p.attributes.POSITION];
    console.log(`  ${mi}.${pi} ${m.name ?? ""} material=${mat} verts=${pos.count} attrs=${Object.keys(p.attributes).join(",")}`);
    console.log(`      bounds ${fmt(pos.min)} .. ${fmt(pos.max)}`);
    if (flags.includes("--uv")) {
      for (const set of ["TEXCOORD_0", "TEXCOORD_1"]) {
        if (p.attributes[set] == null) continue;
        const uv = readVec2(p.attributes[set]);
        const us = uv.map((t) => t[0]);
        const vs = uv.map((t) => t[1]);
        const outside = uv.filter(([u, v]) => u < 0 || u > 1 || v < 0 || v > 1).length;
        console.log(
          `      ${set} u ${Math.min(...us).toFixed(3)}..${Math.max(...us).toFixed(3)} v ${Math.min(...vs).toFixed(3)}..${Math.max(...vs).toFixed(3)} outside [0,1]: ${outside}/${uv.length}`,
        );
      }
    }
  });
});
console.log("== materials");
doc.materials.forEach((m, i) => {
  const v = m.extras?.vmat;
  console.log(`  ${i} ${m.name} shader=${v?.ShaderName ?? "?"} alphaMode=${m.alphaMode ?? "OPAQUE"}`);
  const want = flags.find((f) => f.startsWith("--vmat="))?.slice(7);
  if (v && want && m.name === want) console.log(JSON.stringify(v, null, 1));
});
