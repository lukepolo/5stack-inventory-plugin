// Does a charm's offset actually survive onto the wire?
//
// Run: node --experimental-strip-types tools/inspect-roundtrip.ts
//
// Why this exists
// ---------------
// Charms kept landing on the game's DEFAULT attachment position, which is what
// CS2 falls back to when it cannot read offset_x/y/z. Two very different causes
// produce that same symptom: we never sent the offsets, or we sent them in a
// form the game discards (a varint where the proto declares `optional float`
// lands in unknown-fields and is silently dropped). Reading the encoder cannot
// tell those apart. Decoding the bytes we actually emit can.
//
// The encoder is @ianlucas/cs2-lib-inspect now, not ours — which makes this
// MORE worth running, not less: what it checks is that our rows reach the wire
// through buildInspectLink's adapter (repair, the rotation restore, the slab's
// displayed sticker), and that a library bump has not changed what lands there.
//
// This decodes with a generic protobuf reader that knows nothing about the
// encoder, so it cannot inherit the encoder's assumptions.
import { buildInspectLink } from "../backend/src/inspect.ts";
// From catalog.ts, not main.ts: main boots a Fastify server on import. This is
// the same function the craft save, the equipped v5 feed and the inspect link
// all run every rotation through. Importing it also loads the economy.
import { normStickerRotation } from "../backend/src/catalog.ts";

// Economy ids, not kit indexes: the adapter speaks cs2-lib's own item shape.
const AK47_REDLINE = 222;
const STICKER_RUSH_ATL17 = 3548; // sticker kit 1847
const SLAB_RUSH_ATL17 = 17144; // keychain 37, displays sticker kit 1847
const PET_CATALANA = 28163; // petindex 3, 13 styles
const PET_EGG = 28161; // petindex 1, upgrade level 0 only

const F = {
  paintindex: 4, paintseed: 8, customnames: 11, stickers: 12, petindex: 19,
  keychains: 20, style: 21, variations: 22, upgrade_level: 23,
} as const;
const F_KEYCHAINS = F.keychains;
// Deliberately a SECOND, independent copy of the wire numbers — importing
// inspect.ts's own map would make this test agree with the encoder by
// construction and prove nothing. Keep the literals.
const SF = {
  slot: 1, id: 2, wear: 3, scale: 4, rotation: 5,
  offset_x: 7, offset_y: 8, offset_z: 9, pattern: 10, wrapped_sticker: 12,
} as const;

interface Field { field: number; wire: number; value: number | Uint8Array }

/** Minimal, assumption-free protobuf field walker. */
function decode(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let i = 0;
  const varint = () => {
    let v = 0, shift = 0;
    while (i < buf.length) {
      const b = buf[i++];
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return v >>> 0;
  };
  while (i < buf.length) {
    const key = varint();
    const field = key >>> 3, wire = key & 7;
    if (wire === 0) out.push({ field, wire, value: varint() });
    else if (wire === 5) {
      const dv = new DataView(buf.buffer, buf.byteOffset + i, 4);
      out.push({ field, wire, value: dv.getFloat32(0, true) });
      i += 4;
    } else if (wire === 2) {
      const len = varint();
      out.push({ field, wire, value: buf.subarray(i, i + len) });
      i += len;
    } else if (wire === 1) { out.push({ field, wire, value: 0 }); i += 8; }
    else throw new Error(`unsupported wire type ${wire} at ${i}`);
  }
  return out;
}

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

/**
 * The protobuf body of a link: hex after the steam:// prefix (or the bare
 * console command cs2-lib-inspect falls back to past the launch-length limit),
 * minus the leading mask byte and the trailing CRC — the same way a client
 * strips it before parsing.
 */
function body(link: string | null): Uint8Array {
  if (!link) throw new Error("no link — buildInspectLink refused the item");
  const hex = link.replace(/^.*csgo_econ_action_preview(%20| )/, "");
  const bytes = Uint8Array.from((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  const mask = bytes[0];
  return bytes.slice(1, bytes.length - 4).map((b) => b ^ mask);
}

// Values chosen to be distinguishable: a real AK-47 anchor, and a z that would
// be mangled by any accidental int truncation.
const OFF = { x: 8.567, y: 0.733, z: 2.24 };

const link = buildInspectLink({
  id: AK47_REDLINE, wear: 0.15, seed: 67, statTrak: 0, nameTag: "5stuck Sc Test",
  // A Sticker Slab is 11,144 of the 11,224 charms: its id alone picks the blank
  // hanger, and the slab's art rides field 12, derived from the economy entry.
  keychains: { 0: { id: SLAB_RUSH_ATL17, x: OFF.x, y: OFF.y, z: OFF.z, seed: 1 } },
});
const unmaskedBody = body(link);

console.log(`link: ${link?.slice(0, 48)}…\n`);

let top: Field[] = [];
try {
  top = decode(unmaskedBody);
} catch (e) {
  // The outer message is itself wrapped in one length-delimited field on some
  // builds; retry one level in before giving up.
  const inner = decode(unmaskedBody.slice(0, unmaskedBody.length))[0];
  if (inner && inner.wire === 2) top = decode(inner.value as Uint8Array);
  else throw e;
}

const kc = top.filter((f) => f.field === F_KEYCHAINS && f.wire === 2);
check("keychain submessage present", kc.length === 1, `found ${kc.length}`);

if (kc.length === 1) {
  const fields = decode(kc[0].value as Uint8Array);
  const byId = new Map(fields.map((f) => [f.field, f]));

  check("keychain id survives", byId.get(SF.id)?.value === 37, `got ${byId.get(SF.id)?.value}`);

  // A VARINT here, unlike the offsets below — `optional uint32 wrapped_sticker
  // = 12`. Without it every Sticker Slab charm inspects as the same blank slab,
  // and cs2-lib's own parser cannot even resolve which slab it is. Must agree
  // with `keychains[].sticker` in the equipped v5 feed, or the gun you inspect
  // is not the gun the server builds.
  const ws = byId.get(SF.wrapped_sticker);
  check("wrapped_sticker present", !!ws, "field absent — every sticker slab inspects blank");
  if (ws) {
    check("wrapped_sticker survives", ws.value === 1847, `got ${ws.value}`);
    check("wrapped_sticker wire type is varint", ws.wire === 0, `wire=${ws.wire}`);
  }

  for (const [name, fieldNo, want] of [
    ["offset_x", SF.offset_x, OFF.x],
    ["offset_y", SF.offset_y, OFF.y],
    ["offset_z", SF.offset_z, OFF.z],
  ] as const) {
    const f = byId.get(fieldNo);
    if (!f) { check(`${name} present`, false, "field absent — game will use the default attachment"); continue; }
    // Wire type is the whole point: 0 (varint) is the failure that silently
    // drops the field on the game side even though the bytes are "there".
    check(`${name} wire type is fixed32`, f.wire === 5, `wire=${f.wire}`);
    check(`${name} value round-trips`, Math.abs((f.value as number) - want) < 1e-3,
          `got ${f.value}, want ${want}`);
  }
}

// ---- Sticker rotation --------------------------------------------------------
//
// Does the angle the user set actually reach the game?
//
// It did not. normStickerRotation used to CLAMP to ±180 where a rotation is an
// angle and wants WRAPPING, so every placement past a half turn arrived as a flat
// 180 — the sticker stopped turning partway through the drag, and typing the
// negative did not help because -286.5 clamped to -180 just the same.
//
// Checked at both ends: the arithmetic on its own, and then the same value out
// the far side of the protobuf writer, because a correct number that the encoder
// mangles is the failure this whole file exists to catch.
console.log("");
for (const [input, want, why] of [
  [286.5, -73.5, "past a half turn — used to clamp to 180"],
  [355, -5, "just short of a full turn"],
  [-286.5, 73.5, "the negative the workaround typed"],
  [180, 180, "the boundary stays put, it does not fold to -180"],
  [-180, -180, "and so does the other one"],
  [45, 45, "an ordinary angle is untouched"],
  [11.94, 11.9, "truncated to the 1dp the v5 feed carries"],
  [-159.7, -159.7, "already on the grid and in range"],
  [720, 0, "two full turns is no rotation at all"],
] as const) {
  const got = normStickerRotation(input);
  check(`rotation ${input} -> ${want}`, Object.is(got, want) || Math.abs(got - want) < 1e-9,
        `got ${got} (${why})`);
}

// Straight through the encoder. `scale` is deliberately left unset: the game
// treats an absent scale as the slot's authored one, and sending a 0 would
// collapse the sticker to nothing.
const stickerRotation = (r: number) => {
  const stick = decode(body(buildInspectLink({
    id: AK47_REDLINE,
    stickers: { 0: { id: STICKER_RUSH_ATL17, rotation: r, x: 0.0484, y: 0.0292 } },
  }))).filter((f) => f.field === F.stickers && f.wire === 2);
  if (stick.length !== 1) return { count: stick.length };
  return { count: 1, f: new Map(decode(stick[0].value as Uint8Array).map((x) => [x.field, x])).get(SF.rotation) };
};
const wrapped = stickerRotation(normStickerRotation(286.5));
check("sticker submessage present", wrapped.count === 1, `found ${wrapped.count}`);
if (wrapped.count === 1) {
  const f = wrapped.f;
  if (!f) check("rotation present", false, "field absent — the game uses the slot's default angle");
  else {
    // Same trap as the offsets: a varint here lands in unknown-fields and the
    // game silently draws the sticker unrotated.
    check("rotation wire type is fixed32", f.wire === 5, `wire=${f.wire}`);
    check("rotation reaches the wire wrapped", Math.abs((f.value as number) - -73.5) < 1e-3,
          `got ${f.value}, want -73.5`);
  }
}
// cs2-lib validates rotation on a 0.5° grid; we store and send 0.1°. The link
// must carry what the equipped feed carries, so the adapter puts the exact angle
// back after validation — if it stops doing that, inspect and server disagree.
const fine = stickerRotation(normStickerRotation(11.94)).f;
check("off-grid rotation keeps its 0.1° precision", !!fine && Math.abs((fine.value as number) - 11.9) < 1e-3,
      `got ${fine?.value}, want 11.9 (12 means cs2-lib's 0.5° snap leaked through)`);

// ---- Pets --------------------------------------------------------------------
//
// A pet is not a skin: it has no paint index, its seed is the PATTERN of a
// variation rather than a paint seed, and its life stage and look ride their
// own fields. Every one of those mistakes inspects as a different chicken.
console.log("");
const pet = new Map(decode(body(buildInspectLink({
  id: PET_CATALANA, seed: 4242, style: 5, upgradeLevel: 2, nameTag: "Nugget",
}))).map((f) => [f.field, f]));
check("pet index is the breed", pet.get(F.petindex)?.value === 3, `got ${pet.get(F.petindex)?.value}`);
check("pet carries no paint index", !pet.has(F.paintindex));
check("pet carries no paint seed", !pet.has(F.paintseed));
check("pet style survives", pet.get(F.style)?.value === 5, `got ${pet.get(F.style)?.value}`);
check("pet stage survives", pet.get(F.upgrade_level)?.value === 2, `got ${pet.get(F.upgrade_level)?.value}`);
const variation = pet.get(F.variations);
const pattern = variation?.wire === 2
  ? new Map(decode(variation.value as Uint8Array).map((x) => [x.field, x])).get(SF.pattern)?.value
  : undefined;
check("pet seed rides the variation pattern", pattern === 4242, `got ${pattern}`);
const name = pet.get(F.customnames);
check("pet name survives",
      name?.wire === 2 && new TextDecoder().decode(name.value as Uint8Array) === "Nugget");

// The game deploys a pet whose level is unset as a grown one, so an egg must
// always say it is an egg — upgrade_level 0, present, not omitted.
const egg = new Map(decode(body(buildInspectLink({ id: PET_EGG }))).map((f) => [f.field, f]));
check("egg says it is an egg", egg.get(F.upgrade_level)?.value === 0,
      egg.has(F.upgrade_level) ? `got ${egg.get(F.upgrade_level)?.value}` : "field absent");

console.log(`\n${failures ? `${failures} FAILED` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
