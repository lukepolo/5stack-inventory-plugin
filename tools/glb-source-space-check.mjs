// Bakes a 19.x-layout model the way Source 2 Viewer 20.x does (VRF's
// GltfModelExporter.Conversion.cs) and checks scripts/glb-source-space.mjs
// gives the original back, drops the animation-graph clip, and leaves 19.x
// output alone.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = new URL("../scripts/glb-source-space.mjs", import.meta.url).pathname;
const K = Math.fround(0.0254);
const C_19 = [3.027916e-9, 0, 0.025399996, 0, 0.025399996, 3.027916e-9, 0, 0, 0, 0.025399996, 3.027916e-9, 0, 0, 0, 0, 1];
const R = [-0.5, -0.5, -0.5, 0.5];
const rot = (v) => [v[1], v[2], v[0]];

function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) {
        out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
      }
    }
  }
  return out;
}

function quatMul([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function material(name, IntParams, TextureParams) {
  return {
    name,
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
    occlusionTexture: { index: 1 },
    extras: { vmat: { ShaderName: "csgo_character.vfx", IntParams, TextureParams: { g_tMetalness: "metal.vtex", ...TextureParams } } },
  };
}

function model(baked) {
  const floats = [];
  const views = [];
  const accessors = [];
  const add = (type, values, extra = {}) => {
    views.push({ buffer: 0, byteOffset: floats.length * 4, byteLength: values.flat().length * 4 });
    floats.push(...values.flat());
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count: values.length, type, ...extra });
    return accessors.length - 1;
  };
  const pos = [[1, 2, 3], [-4, 5, 6.5]];
  const nrm = [[0, 0, 1], [0.6, 0.8, 0]];
  const tan = [[1, 0, 0, 1], [0, 1, 0, -1]];
  const ibm = [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1], [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 4, -5, 6, 1]];
  const rootT = [1, 2, 3];
  const rootQ = [0.6285, 0.6449, -0.3652, 0.2362];
  const childT = [4, 5, 6];
  const keysT = [[1, 2, 3], [2, 3, 4]];
  const keysQ = [[0, 0, 0, 1], [0.6285, 0.6449, -0.3652, 0.2362]];
  const keysChild = [[4, 5, 6], [7, 8, 9]];
  const S = [K, 0, 0, 0, 0, K, 0, 0, 0, 0, K, 0, 0, 0, 0, 1];
  const C_INV = [0, 1 / K, 0, 0, 0, 0, 1 / K, 0, 1 / K, 0, 0, 0, 0, 0, 0, 1];
  const bake = (v, scale) => rot(v).map((x) => x * scale);
  const p = add("VEC3", baked ? pos.map((v) => bake(v, K)) : pos);
  const lo = (i) => Math.min(...(baked ? pos.map((v) => bake(v, K)) : pos).map((v) => v[i]));
  const hi = (i) => Math.max(...(baked ? pos.map((v) => bake(v, K)) : pos).map((v) => v[i]));
  accessors[p].min = [lo(0), lo(1), lo(2)];
  accessors[p].max = [hi(0), hi(1), hi(2)];
  const n = add("VEC3", baked ? nrm.map((v) => rot(v)) : nrm);
  const t = add("VEC4", baked ? tan.map((v) => [...rot(v), v[3]]) : tan);
  const ib = add("MAT4", baked ? ibm.map((m) => mul(mul(S, m), C_INV)) : ibm);
  const graphIn = baked ? add("SCALAR", [[0], [1]]) : null;
  const graphOut = baked ? add("VEC3", [[9, 9, 9], [9, 9, 9]]) : null;
  const time = add("SCALAR", [[0], [1]], { min: [0], max: [1] });
  const aT = add("VEC3", baked ? keysT.map((v) => bake(v, K)) : keysT);
  const aQ = add("VEC4", baked ? keysQ.map((q) => quatMul(R, q)) : keysQ);
  const aC = add("VEC3", baked ? keysChild.map((v) => v.map((x) => x * K)) : keysChild);
  const animations = [{
    name: "idle",
    samplers: [{ input: time, output: aT }, { input: time, output: aQ }, { input: time, output: aC }],
    channels: [
      { sampler: 0, target: { node: 1, path: "translation" } },
      { sampler: 1, target: { node: 1, path: "rotation" } },
      { sampler: 2, target: { node: 2, path: "translation" } },
    ],
  }];
  if (baked) {
    animations.push({
      name: "animation/anims/test/world/idle01",
      samplers: [{ input: graphIn, output: graphOut }],
      channels: [{ sampler: 0, target: { node: 2, path: "translation" } }],
    });
  }
  const doc = {
    asset: { generator: `Source 2 Viewer ${baked ? "20.1" : "19.2"}.0.0`, version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, 3, 4] }],
    nodes: [
      { name: "m.vmdl_c", children: [1], matrix: baked ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : C_19 },
      { name: "root", children: [2], translation: baked ? bake(rootT, K) : rootT, rotation: baked ? quatMul(R, rootQ) : rootQ },
      { name: "child", translation: baked ? childT.map((x) => x * K) : childT },
      { name: "m.vmdl_c.body", mesh: 0, skin: 0 },
      { name: "m.vmdl_c.static", mesh: 1, ...(baked ? {} : { matrix: C_19 }) },
    ],
    meshes: [
      { primitives: [{ attributes: { POSITION: p, NORMAL: n, TANGENT: t } }] },
      { primitives: [{ attributes: { POSITION: p, NORMAL: n } }] },
    ],
    skins: [{ joints: [1, 2], inverseBindMatrices: ib }],
    materials: [material("hair", { F_ANISOTROPIC_GLOSS: 1 }, { g_tAnisoGloss: "hair_gloss.vtex" }), material("skin", { F_ANISOTROPIC_GLOSS: 0 }, { g_tAnisoGloss: "unused.vtex" })],
    textures: [{ source: 0 }, { source: 1 }],
    images: [{ uri: "color.png" }, { uri: "orm.png" }],
    animations,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: floats.length * 4 }],
  };
  return { doc, floats };
}

function glb({ doc, floats }) {
  const bin = Buffer.alloc(floats.length * 4);
  floats.forEach((f, i) => bin.writeFloatLE(f, i * 4));
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.write("glTF", 0, "ascii");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(28 + json.length + bin.length, 8);
  head.writeUInt32LE(json.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, json, binHead, bin]);
}

function read(file) {
  const buf = fs.readFileSync(file);
  const jl = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.toString("utf8", 20, 20 + jl));
  const bin = buf.subarray(28 + jl);
  const values = (i) => {
    const a = doc.accessors[i];
    const bv = doc.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    return Array.from({ length: a.count * n }, (_, k) => bin.readFloatLE((bv.byteOffset ?? 0) + (a.byteOffset ?? 0) + k * 4));
  };
  return { doc, values, size: buf.length };
}

const close = (a, b, what) => {
  assert.equal(a.length, b.length, `${what}: length`);
  a.forEach((x, i) => assert(Math.abs(x - b[i]) <= 1e-5 * Math.max(1, Math.abs(b[i])), `${what}[${i}]: ${x} vs ${b[i]}`));
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glb-source-space-"));
try {
  const want = model(false);
  const bakedFile = path.join(dir, "baked.glb");
  const oldFile = path.join(dir, "old.glb");
  fs.writeFileSync(bakedFile, glb(model(true)));
  fs.writeFileSync(oldFile, glb(want));
  const oldBytes = fs.readFileSync(oldFile);
  const bakedSize = fs.statSync(bakedFile).size;

  const run = spawnSync("node", [script, dir], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /1 converted, 1 already in source space, 1 graph clips dropped .*, 1 anisotropic-gloss materials made matte/);
  assert(fs.readFileSync(oldFile).equals(oldBytes), "a 19.x file must be left byte for byte");

  const got = read(bakedFile);
  assert(got.size < bakedSize, "dropping the graph clip must shrink the buffer");
  assert.deepEqual(got.doc.animations.map((a) => a.name), ["idle"]);
  close(got.doc.nodes[0].matrix, C_19, "vmdl root carries the conversion");
  close(got.doc.nodes[4].matrix, C_19, "static mesh node carries the conversion");
  assert.equal(got.doc.nodes[3].matrix, undefined, "skinned mesh node stays identity");
  close(got.doc.nodes[1].translation, want.doc.nodes[1].translation, "root bone translation");
  close(got.doc.nodes[1].rotation, want.doc.nodes[1].rotation, "root bone rotation");
  close(got.doc.nodes[2].translation, want.doc.nodes[2].translation, "child bone translation");
  const [hair, skin] = got.doc.materials;
  assert.deepEqual(hair.pbrMetallicRoughness, { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, "anisotropic gloss is matte, as 19.x wrote it");
  assert.deepEqual(hair.occlusionTexture, { index: 1 }, "anisotropic gloss keeps its occlusion");
  assert.deepEqual(skin, want.doc.materials[1], "other materials keep the roughness 20.x reads");

  const w = read(oldFile);
  const prim = (d, m) => d.doc.meshes[m].primitives[0].attributes;
  for (const attr of ["POSITION", "NORMAL", "TANGENT"]) {
    close(got.values(prim(got, 0)[attr]), w.values(prim(w, 0)[attr]), attr);
  }
  close(got.doc.accessors[prim(got, 0).POSITION].min, w.doc.accessors[prim(w, 0).POSITION].min, "POSITION min");
  close(got.doc.accessors[prim(got, 0).POSITION].max, w.doc.accessors[prim(w, 0).POSITION].max, "POSITION max");
  close(got.values(got.doc.skins[0].inverseBindMatrices), w.values(w.doc.skins[0].inverseBindMatrices), "inverse bind matrices");
  got.doc.animations[0].channels.forEach((ch, i) => {
    const out = (d) => d.values(d.doc.animations[0].samplers[ch.sampler].output);
    close(out(got), out(w), `idle channel ${i} (${ch.target.path})`);
  });

  const again = spawnSync("node", [script, dir], { encoding: "utf8" });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /0 converted, 2 already in source space/);
  console.log("glb-source-space: a 20.x bake comes back to the 19.x layout, graph clips dropped, anisotropic gloss matte, 19.x output untouched");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
