// Puts a Source 2 Viewer 20.x model GLB back in the layout 19.x wrote, which the
// viewer, pet clips, charm physics and StatTrak all read: Source inches and axes
// below one root node that carries the inch->metre scale and Z-up->Y-up swap.
// 20.x bakes that conversion into vertices, root bones, keyframes and inverse
// bind matrices instead (VRF #1193); this is its exact inverse.
//
// It also drops the animation-graph clips 20.x adds to every export, named by
// resource path (`animation/anims/chicken/world/chick_idle01`); a model's own
// animations never contain "/". A file that already has the conversion on a node
// (19.x output, or the _physics.glb 20.x still writes the old way) is skipped.
//
// And it makes anisotropic-gloss materials (agent hair, the chicken's feathers)
// matte again. 20.x reads their roughness from the metalness texture, which is
// 0 in all 64 of them, so they rendered as glass; the game takes their gloss
// from g_tAnisoGloss, which no version exports. 19.x left them fully rough.
//
//   node scripts/glb-source-space.mjs <file.glb|dir>...
import fs from "node:fs";
import path from "node:path";

const K = Math.fround(0.0254);
const C_19 = [3.027916e-9, 0, 0.025399996, 0, 0.025399996, 3.027916e-9, 0, 0, 0, 0.025399996, 3.027916e-9, 0, 0, 0, 0, 1];
const C = [0, 0, K, 0, K, 0, 0, 0, 0, K, 0, 0, 0, 0, 0, 1];
const S_INV = [1 / K, 0, 0, 0, 0, 1 / K, 0, 0, 0, 0, 1 / K, 0, 0, 0, 0, 1];
const R_INV = [0.5, 0.5, 0.5, 0.5];
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + r] * b[c * 4 + k];
      }
      out[c * 4 + r] = sum;
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

function trsMatrix(n) {
  if (n.matrix) {
    return n.matrix;
  }
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

const isIdentity = (m) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-6);
const isConversion = (m) => m.every((v, i) => Math.abs(v - C[i]) < 1e-6);
const unswizzle = (v) => [v[2], v[0], v[1]];

function readGlb(buf) {
  if (buf.toString("ascii", 0, 4) !== "glTF") {
    throw new Error("not a GLB");
  }
  const jsonLen = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const binStart = 20 + jsonLen;
  const bin = binStart + 8 <= buf.length ? Buffer.from(buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart))) : Buffer.alloc(0);
  return { doc, bin };
}

function writeGlb(doc, bin) {
  let json = Buffer.from(JSON.stringify(doc), "utf8");
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const parts = [Buffer.alloc(12), Buffer.alloc(8), json];
  if (binPadded.length) {
    parts.push(Buffer.alloc(8), binPadded);
  }
  const out = Buffer.concat(parts);
  out.write("glTF", 0, "ascii");
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  if (binPadded.length) {
    out.writeUInt32LE(binPadded.length, 20 + json.length);
    out.writeUInt32LE(0x004e4942, 24 + json.length);
  }
  return out;
}

function floatAccessor(doc, bin, index, expectType) {
  const a = doc.accessors[index];
  if (a.componentType !== 5126 || a.sparse || a.normalized || a.type !== expectType) {
    throw new Error(`accessor ${index} is ${a.type}/${a.componentType}${a.sparse ? " sparse" : ""}, expected float ${expectType}`);
  }
  const bv = doc.bufferViews[a.bufferView];
  if ((bv.buffer ?? 0) !== 0) {
    throw new Error(`accessor ${index} is not in the GLB buffer`);
  }
  const comps = COMPONENTS[a.type];
  const stride = bv.byteStride ?? comps * 4;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return {
    a,
    comps,
    get: (i, c) => bin.readFloatLE(base + i * stride + c * 4),
    set: (i, c, v) => bin.writeFloatLE(v, base + i * stride + c * 4),
  };
}

function convertAccessor(doc, bin, index, kind) {
  if (kind === "mat4") {
    const acc = floatAccessor(doc, bin, index, "MAT4");
    for (let i = 0; i < acc.a.count; i++) {
      const m = [];
      for (let c = 0; c < 16; c++) {
        m.push(acc.get(i, c));
      }
      mul(mul(S_INV, m), C).forEach((v, c) => acc.set(i, c, v));
    }
    return;
  }
  if (kind === "quat") {
    const acc = floatAccessor(doc, bin, index, "VEC4");
    for (let i = 0; i < acc.a.count; i++) {
      const q = quatMul(R_INV, [0, 1, 2, 3].map((c) => acc.get(i, c)));
      q.forEach((v, c) => acc.set(i, c, v));
    }
    return;
  }
  const acc = floatAccessor(doc, bin, index, kind === "tangent" ? "VEC4" : "VEC3");
  const rotate = kind === "position" || kind === "direction" || kind === "tangent" || kind === "rootTranslation";
  const scale = kind === "position" || kind === "translation" || kind === "rootTranslation" ? 1 / K : 1;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < acc.a.count; i++) {
    let v = [acc.get(i, 0), acc.get(i, 1), acc.get(i, 2)];
    if (rotate) {
      v = unswizzle(v);
    }
    for (let c = 0; c < 3; c++) {
      const out = Math.fround(v[c] * scale);
      acc.set(i, c, out);
      min[c] = Math.min(min[c], out);
      max[c] = Math.max(max[c], out);
    }
  }
  if (acc.a.min && acc.a.max && acc.a.count) {
    acc.a.min = [...min, ...acc.a.min.slice(3)];
    acc.a.max = [...max, ...acc.a.max.slice(3)];
  }
}

function compact(doc, bin) {
  const usedAccessors = new Set();
  for (const mesh of doc.meshes ?? []) {
    for (const p of mesh.primitives) {
      Object.values(p.attributes).forEach((i) => usedAccessors.add(i));
      if (p.indices !== undefined) {
        usedAccessors.add(p.indices);
      }
      (p.targets ?? []).forEach((t) => Object.values(t).forEach((i) => usedAccessors.add(i)));
    }
  }
  (doc.skins ?? []).forEach((s) => s.inverseBindMatrices !== undefined && usedAccessors.add(s.inverseBindMatrices));
  (doc.animations ?? []).forEach((an) => an.samplers.forEach((s) => usedAccessors.add(s.input).add(s.output)));

  const accessorMap = new Map();
  const accessors = [];
  (doc.accessors ?? []).forEach((a, i) => {
    if (usedAccessors.has(i)) {
      accessorMap.set(i, accessors.length);
      accessors.push(a);
    }
  });
  const usedViews = new Set(accessors.filter((a) => a.bufferView !== undefined).map((a) => a.bufferView));
  (doc.images ?? []).forEach((im) => im.bufferView !== undefined && usedViews.add(im.bufferView));

  const viewMap = new Map();
  const views = [];
  const chunks = [];
  let offset = 0;
  (doc.bufferViews ?? []).forEach((bv, i) => {
    if (!usedViews.has(i)) {
      return;
    }
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    chunks.push(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    viewMap.set(i, views.length);
    views.push({ ...bv, byteOffset: offset });
    offset += bv.byteLength;
  });

  accessors.forEach((a) => a.bufferView !== undefined && (a.bufferView = viewMap.get(a.bufferView)));
  (doc.images ?? []).forEach((im) => im.bufferView !== undefined && (im.bufferView = viewMap.get(im.bufferView)));
  for (const mesh of doc.meshes ?? []) {
    for (const p of mesh.primitives) {
      for (const k of Object.keys(p.attributes)) {
        p.attributes[k] = accessorMap.get(p.attributes[k]);
      }
      if (p.indices !== undefined) {
        p.indices = accessorMap.get(p.indices);
      }
      for (const t of p.targets ?? []) {
        for (const k of Object.keys(t)) {
          t[k] = accessorMap.get(t[k]);
        }
      }
    }
  }
  (doc.skins ?? []).forEach((s) => s.inverseBindMatrices !== undefined && (s.inverseBindMatrices = accessorMap.get(s.inverseBindMatrices)));
  (doc.animations ?? []).forEach((an) => an.samplers.forEach((s) => {
    s.input = accessorMap.get(s.input);
    s.output = accessorMap.get(s.output);
  }));
  doc.accessors = accessors;
  doc.bufferViews = views;
  const out = Buffer.concat(chunks);
  if (doc.buffers?.length) {
    doc.buffers[0].byteLength = out.length;
  }
  return out;
}

function matteAnisoGloss(doc) {
  let n = 0;
  for (const m of doc.materials ?? []) {
    const pbr = m.pbrMetallicRoughness;
    if (!m.extras?.vmat?.IntParams?.F_ANISOTROPIC_GLOSS || !pbr?.metallicRoughnessTexture) {
      continue;
    }
    delete pbr.metallicRoughnessTexture;
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 1;
    n++;
  }
  return n;
}

function toSourceSpace(buf) {
  const { doc, bin } = readGlb(buf);
  const nodes = doc.nodes ?? [];
  const major = Number(/Source 2 Viewer (\d+)\./.exec(doc.asset?.generator ?? "")?.[1] ?? 0);
  if (major < 20 || !nodes.length || nodes.some((n) => n.matrix && isConversion(n.matrix))) {
    return null;
  }
  if ((doc.buffers ?? []).length > 1 || doc.buffers?.[0]?.uri) {
    throw new Error("expected one embedded buffer");
  }
  if (nodes.some((n) => /\.empty_mesh_reference$/.test(n.name ?? ""))) {
    throw new Error("secondary skeletons from animation-graph clips: export with --gltf_animation_list");
  }

  const dropped = (doc.animations ?? []).filter((an) => (an.name ?? "").includes("/")).length;
  doc.animations = (doc.animations ?? []).filter((an) => !(an.name ?? "").includes("/"));
  if (!doc.animations.length) {
    delete doc.animations;
  }

  const joints = new Set((doc.skins ?? []).flatMap((s) => s.joints));
  const parent = new Map();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const isRootJoint = (i) => joints.has(i) && !joints.has(parent.get(i));

  const kinds = new Map();
  const claim = (index, kind) => {
    const had = kinds.get(index);
    if (had && had !== kind) {
      throw new Error(`accessor ${index} is used as both ${had} and ${kind}`);
    }
    kinds.set(index, kind);
  };

  for (const mesh of doc.meshes ?? []) {
    for (const p of mesh.primitives) {
      const at = p.attributes;
      at.POSITION !== undefined && claim(at.POSITION, "position");
      at.NORMAL !== undefined && claim(at.NORMAL, "direction");
      at.TANGENT !== undefined && claim(at.TANGENT, "tangent");
      for (const t of p.targets ?? []) {
        t.POSITION !== undefined && claim(t.POSITION, "position");
        t.NORMAL !== undefined && claim(t.NORMAL, "direction");
        t.TANGENT !== undefined && claim(t.TANGENT, "direction");
      }
    }
  }
  (doc.skins ?? []).forEach((s) => s.inverseBindMatrices !== undefined && claim(s.inverseBindMatrices, "mat4"));

  for (const an of doc.animations ?? []) {
    const delta = an.extras?.additive === true && an.extras?.additive_composed !== true;
    for (const ch of an.channels) {
      const target = ch.target.node;
      const output = an.samplers[ch.sampler].output;
      if (ch.target.path === "scale" || ch.target.path === "weights") {
        continue;
      }
      if (!joints.has(target)) {
        throw new Error(`animation "${an.name}" moves non-bone node ${target} (${nodes[target]?.name})`);
      }
      if (ch.target.path === "translation") {
        claim(output, isRootJoint(target) ? "rootTranslation" : "translation");
      } else if (ch.target.path === "rotation" && isRootJoint(target) && !delta) {
        claim(output, "quat");
      }
    }
  }

  nodes.forEach((n, i) => {
    const p = parent.get(i);
    if (joints.has(i)) {
      if (n.matrix) {
        throw new Error(`bone node ${i} (${n.name}) has a matrix, expected TRS`);
      }
      if (p === undefined) {
        throw new Error(`bone node ${i} (${n.name}) is a scene root, so nothing can carry the conversion`);
      }
      if (n.translation) {
        const t = isRootJoint(i) ? unswizzle(n.translation) : n.translation;
        n.translation = t.map((v) => Math.fround(v / K));
      }
      if (isRootJoint(i)) {
        n.rotation = quatMul(R_INV, n.rotation ?? [0, 0, 0, 1]).map((v) => Math.fround(v));
      }
      return;
    }
    if (p !== undefined && joints.has(p)) {
      throw new Error(`node ${i} (${n.name}) hangs off bone ${p}, a layout this has not been checked against`);
    }
    if (p === undefined) {
      if (n.skin !== undefined) {
        return;
      }
      const m = trsMatrix(n);
      delete n.translation;
      delete n.rotation;
      delete n.scale;
      n.matrix = isIdentity(m) ? [...C_19] : mul(m, C);
      return;
    }
    const m = trsMatrix(n);
    if (!isIdentity(m)) {
      delete n.translation;
      delete n.rotation;
      delete n.scale;
      n.matrix = mul(mul(mul(S_INV, [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1]), m), C);
    }
  });

  for (const [index, kind] of kinds) {
    convertAccessor(doc, bin, index, kind);
  }

  const matte = matteAnisoGloss(doc);
  const outBin = dropped ? compact(doc, bin) : bin;
  return { glb: writeGlb(doc, outBin), dropped, matte };
}

function walk(target, out) {
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(target)) {
      walk(path.join(target, e), out);
    }
  } else if (target.endsWith(".glb")) {
    out.push(target);
  }
  return out;
}

{
  const files = process.argv.slice(2).flatMap((t) => walk(t, []));
  let converted = 0;
  let skipped = 0;
  let clips = 0;
  let saved = 0;
  let matte = 0;
  const failed = [];
  for (const f of files) {
    try {
      const before = fs.statSync(f).size;
      const res = toSourceSpace(fs.readFileSync(f));
      if (!res) {
        skipped++;
        continue;
      }
      fs.writeFileSync(`${f}.tmp`, res.glb);
      fs.renameSync(`${f}.tmp`, f);
      converted++;
      clips += res.dropped;
      matte += res.matte;
      saved += before - res.glb.length;
    } catch (e) {
      failed.push(`${f}: ${e.message}`);
    }
  }
  console.log(`--- glb-source-space: ${converted} converted, ${skipped} already in source space, ${clips} graph clips dropped (${(saved / 1048576).toFixed(0)}MB), ${matte} anisotropic-gloss materials made matte`);
  for (const f of failed) {
    console.error(`!! glb-source-space: ${f}`);
  }
  process.exit(failed.length ? 1 : 0);
}
