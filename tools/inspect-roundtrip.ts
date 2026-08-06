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
// This decodes with a generic protobuf reader that knows nothing about our
// writer, so it cannot inherit the writer's assumptions.
import { buildInspectHex } from "../backend/src/inspect.ts";
// From catalog.ts, not main.ts: main boots a Fastify server on import. This is
// the same function the craft save, the equipped v5 feed and buildInspectHex all
// run every rotation through.
import { normStickerRotation } from "../backend/src/catalog.ts";

const F_KEYCHAINS = 20;
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

// Values chosen to be distinguishable: a real AK-47 anchor, and a z that would
// be mangled by any accidental int truncation.
const OFF = { x: 8.567, y: 0.733, z: 2.24 };

const hex = buildInspectHex({
  defindex: 7, paintindex: 1023, paintseed: 67, paintwear: 0.0001,
  stattrak: true, killeatervalue: 0, nametag: "5stuck Sc Test",
  stickers: [],
  // wrappedSticker set because a Sticker Slab is 11,144 of the 11,224 charms:
  // `id` alone picks the blank hanger, and the slab's art rides field 12.
  keychains: [{ slot: 0, id: 14290, wrappedSticker: 1847, offsetX: OFF.x, offsetY: OFF.y, offsetZ: OFF.z, pattern: 0 }],
});

// buildInspectHex returns the payload as hex; strip the leading mask byte and
// the trailing CRC the same way a client would before parsing.
const bytes = Uint8Array.from((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const mask = bytes[0];
const unmasked = bytes.slice(1).map((b) => b ^ mask);
const body = unmasked.slice(0, unmasked.length - 4); // drop CRC

console.log(`link payload: ${bytes.length} bytes, mask 0x${mask.toString(16)}\n`);

let top: Field[] = [];
try {
  top = decode(body);
} catch (e) {
  // The outer message is itself wrapped in one length-delimited field on some
  // builds; retry one level in before giving up.
  const inner = decode(body.slice(0, body.length))[0];
  if (inner && inner.wire === 2) top = decode(inner.value as Uint8Array);
  else throw e;
}

const kc = top.filter((f) => f.field === F_KEYCHAINS && f.wire === 2);
check("keychain submessage present", kc.length === 1, `found ${kc.length}`);

if (kc.length === 1) {
  const fields = decode(kc[0].value as Uint8Array);
  const byId = new Map(fields.map((f) => [f.field, f]));

  check("keychain id survives", byId.get(SF.id)?.value === 14290, `got ${byId.get(SF.id)?.value}`);

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

// Straight through the encoder. `scale` is deliberately left null: the game
// treats an absent scale as the slot's authored one, and sending a 0 would
// collapse the sticker to nothing.
const rotHex = buildInspectHex({
  defindex: 7, paintindex: 1023,
  stickers: [{ slot: 0, id: 1847, rotation: normStickerRotation(286.5), offsetX: 0.0484, offsetY: 0.0292 }],
});
const rotBytes = Uint8Array.from((rotHex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const rotMask = rotBytes[0];
const rotBody = rotBytes.slice(1).map((b) => b ^ rotMask).slice(0, rotBytes.length - 5);
const F_STICKERS = 12;
const stick = decode(rotBody).filter((f) => f.field === F_STICKERS && f.wire === 2);
check("sticker submessage present", stick.length === 1, `found ${stick.length}`);
if (stick.length === 1) {
  const f = new Map(decode(stick[0].value as Uint8Array).map((x) => [x.field, x])).get(SF.rotation);
  if (!f) check("rotation present", false, "field absent — the game uses the slot's default angle");
  else {
    // Same trap as the offsets: a varint here lands in unknown-fields and the
    // game silently draws the sticker unrotated.
    check("rotation wire type is fixed32", f.wire === 5, `wire=${f.wire}`);
    check("rotation reaches the wire wrapped", Math.abs((f.value as number) - -73.5) < 1e-3,
          `got ${f.value}, want -73.5`);
  }
}

console.log(`\n${failures ? `${failures} FAILED` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
