// Does a pasted inspect code come back as the gun and stickers it names, and is
// anything else refused before it is parsed?
//
// Run: node --experimental-strip-types tools/inspect-decode-check.ts
//
// The Sticker Crafts mat's Import reads a stranger's text. Codes are written
// here two independent ways: by cs2-lib-inspect through our own encoder
// (buildInspectLink), and by a small protobuf writer below for what no encoder
// will write (unknown stickers, bad anchors, broken bytes). The writer's framing
// is pinned to cs2-lib-inspect's in both directions before anything trusts it.
import { crc32 } from "node:zlib";
import { buildInspectLink } from "../backend/src/inspect.ts";
import { craftFromCode, type CodeCraft } from "../backend/src/catalog.ts";
import { CODE_LIMITS, readInspectCode, type CodeRead } from "../backend/src/inspectDecode.ts";

const lib = await import(new URL("../backend/node_modules/@ianlucas/cs2-lib-inspect/dist/index.js", import.meta.url).href);
const { CS2Economy } = await import(new URL("../backend/node_modules/@ianlucas/cs2-lib/dist/index.mjs", import.meta.url).href);

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
    failures++;
  } else {
    console.log(`ok   ${label}`);
  }
}

const AK47 = 7;
const AK47_REDLINE = 222;
const AWP = 9;
const AWP_SNAKE_CAMO = 30;
const AWP_LIGHTNING_STRIKE = 51;
const KNIFE = 42;
const STICKER_DEF = 1209;
const CROWN_FOIL = { id: 1880, kit: 37 };
const HOWLING_DAWN = { id: 1944, kit: 103 };
const IBP_HOLO = { id: 1901, kit: 60 };
const TITAN_HOLO = { id: 1917, kit: 76 };
const NO_SUCH_KIT = 999_999;

const varint = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const u32 = (field: number, n: number) => [...varint(field * 8), ...varint(n)];
const f32 = (field: number, x: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, x, true);
  return [...varint(field * 8 + 5), ...b];
};
const sub = (field: number, body: number[]) => [...varint(field * 8 + 2), ...varint(body.length), ...body];
type Raw = { slot?: number; kit: number; x?: number; y?: number; r?: number; wear?: number };
const rawSticker = (s: Raw) =>
  sub(12, [
    ...(s.slot !== undefined ? u32(1, s.slot) : []),
    ...u32(2, s.kit),
    ...(s.wear !== undefined ? f32(3, s.wear) : []),
    ...(s.r !== undefined ? f32(5, s.r) : []),
    ...(s.x !== undefined ? f32(7, s.x) : []),
    ...(s.y !== undefined ? f32(8, s.y) : []),
  ]);
const gun = (def: number, paint: number | null, stickers: Raw[]) => [
  ...u32(3, def),
  ...(paint !== null ? u32(4, paint) : []),
  ...stickers.flatMap(rawSticker),
];
/** [key, payload…, checksum], everything after the key XORed with it. */
function frame(payload: number[], key = 0): string {
  const body = Uint8Array.from([key, ...payload]);
  const crc = crc32(body);
  const sum = ((crc & 0xffff) ^ (payload.length * crc)) >>> 0;
  const all = [...body, sum >>> 24, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff];
  return all.map((b, i) => (i ? b ^ key : b).toString(16).padStart(2, "0")).join("").toUpperCase();
}
const command = (hex: string) => `csgo_econ_action_preview ${hex}`;
const hexOf = (link: string) => link.replace(/^.*csgo_econ_action_preview(%20| )/, "");

function read(text: unknown): CodeRead {
  return readInspectCode(text);
}
function craft(text: unknown): CodeCraft | null | string {
  const r = read(text);
  return r.ok ? craftFromCode(r.code) : r.reason;
}
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const placed = (c: CodeCraft | null | string) =>
  c && typeof c === "object" ? c.stickers.map((s) => [s.id, s.slot, r4(s.x), r4(s.y), s.r, r4(s.w)]) : c;

// ---- the writer agrees with cs2-lib-inspect ---------------------------------------
const ours = buildInspectLink({
  id: AK47_REDLINE,
  stickers: {
    0: { id: CROWN_FOIL.id, schema: 0, x: 0.1, y: 0.05, rotation: 30, wear: 0.2 },
    1: { id: HOWLING_DAWN.id, schema: 1, x: -0.05, y: 0.02 },
    2: { id: IBP_HOLO.id, schema: 2, rotation: -45.5 },
  },
});
if (!ours) throw new Error("buildInspectLink refused the AK-47 | Redline");
const oursHex = hexOf(ours);
const oursPayload = [...Buffer.from(oursHex, "hex")].slice(1, -4);
check("the writer frames a payload byte for byte as cs2-lib-inspect does", frame(oursPayload), oursHex.toUpperCase());
const keyed = frame(oursPayload, 0x5a);
check("cs2-lib-inspect reads the writer's XOR-keyed code (the game's own format)",
  Object.keys(lib.parseInspectLink(CS2Economy, command(keyed)).stickers ?? {}).length, 3);

// ---- valid codes -------------------------------------------------------------------
const redline = [
  [CROWN_FOIL.id, 0, 0.1, 0.05, 30, 0.2],
  [HOWLING_DAWN.id, 1, -0.05, 0.02, 0, 0],
  [IBP_HOLO.id, 2, 0, 0, -45.5, 0],
];
check("a steam:// link reads back as its stickers, anchors, places and turns", placed(craft(ours)), redline);
check("the bare console command", placed(craft(command(oursHex))), redline);
check("just the hex", placed(craft(oursHex)), redline);
check("lower-case hex, padded with whitespace and a newline", placed(craft(`  ${oursHex.toLowerCase()}\n`)), redline);
check("the command with a leading +", placed(craft(`+${command(oursHex)}`)), redline);
check("a steam:// link with a space for %20", placed(craft(ours.replace("%20", " "))), redline);
check("an XOR-keyed code reads the same", placed(craft(command(keyed))), redline);
const ak = craft(ours) as CodeCraft;
check("the gun, its finish and the finish's body", [ak.model, ak.name, ak.legacy, ak.skipped], ["ak47", "AK-47 | Redline", true, 0]);
check("each sticker comes with its catalog name and art", [ak.stickers[0].name, typeof ak.stickers[0].image], ["Sticker | Crown (Foil)", "string"]);
const plain = craft(frame(gun(AK47, null, [{ slot: 0, kit: TITAN_HOLO.kit }])));
check("a plain gun with no finish is named for the gun", [typeof plain === "object" && plain?.name, typeof plain === "object" && plain?.legacy], ["AK-47", false]);
const unknownFinish = craft(frame(gun(AK47, 99_999, [{ slot: 0, kit: TITAN_HOLO.kit }])));
check("a finish the catalog lacks still imports, named for the gun", typeof unknownFinish === "object" && unknownFinish?.name, "AK-47");
check("an anchor the code leaves out is the next one", placed(craft(frame(gun(AK47, null, [{ kit: TITAN_HOLO.kit }, { kit: IBP_HOLO.kit }])))), [
  [TITAN_HOLO.id, 0, 0, 0, 0, 0],
  [IBP_HOLO.id, 1, 0, 0, 0, 0],
]);
check("a turn past a half turn wraps, as the editor stores it", placed(craft(frame(gun(AK47, null, [{ slot: 0, kit: TITAN_HOLO.kit, r: 286.5 }])))), [
  [TITAN_HOLO.id, 0, 0, 0, -73.5, 0],
]);
check("an offset past the gun's bounds is clamped to them, as cs2-lib's parser does",
  placed(craft(frame(gun(AK47, null, [{ slot: 0, kit: TITAN_HOLO.kit, x: 5, y: -5 }])))), [[TITAN_HOLO.id, 0, 0.6392, -0.0298, 0, 0]]);

// ---- partial: unknown stickers and positions ----------------------------------------------
const partly = craft(frame(gun(AK47, null, [
  { slot: 0, kit: CROWN_FOIL.kit },
  { slot: 1, kit: NO_SUCH_KIT },
  { slot: 2, kit: HOWLING_DAWN.kit },
])));
check("a sticker the catalog lacks is left out and counted", [placed(partly), typeof partly === "object" && partly?.skipped], [
  [[CROWN_FOIL.id, 0, 0, 0, 0, 0], [HOWLING_DAWN.id, 2, 0, 0, 0, 0]],
  1,
]);
const offGun = craft(frame(gun(AK47, null, [{ slot: 0, kit: CROWN_FOIL.kit }, { slot: 4, kit: IBP_HOLO.kit }, { slot: 31, kit: TITAN_HOLO.kit }])));
check("an anchor the gun doesn't have is left out and counted (the AK-47 has four)", [placed(offGun), typeof offGun === "object" && offGun?.skipped], [
  [[CROWN_FOIL.id, 0, 0, 0, 0, 0]],
  2,
]);
const hd = craft(frame(gun(AWP, AWP_SNAKE_CAMO, [{ slot: 4, kit: CROWN_FOIL.kit }])));
const legacy = craft(frame(gun(AWP, AWP_LIGHTNING_STRIKE, [{ slot: 4, kit: CROWN_FOIL.kit }])));
check("anchors are the finish's body's: the AWP's fifth is on its legacy body only", [
  typeof hd === "object" && hd?.skipped,
  typeof legacy === "object" && legacy?.stickers.length,
  typeof legacy === "object" && legacy?.legacy,
], [1, 1, true]);
const nan = craft(frame(gun(AK47, null, [{ slot: 0, kit: CROWN_FOIL.kit, x: NaN }, { slot: 1, kit: IBP_HOLO.kit, r: Infinity }, { slot: 2, kit: TITAN_HOLO.kit }])));
check("a place or turn that isn't a number is left out and counted", [placed(nan), typeof nan === "object" && nan?.skipped], [
  [[TITAN_HOLO.id, 2, 0, 0, 0, 0]],
  2,
]);
const seven = craft(frame(gun(AK47, null, Array.from({ length: 7 }, (_, i) => ({ slot: i % 4, kit: CROWN_FOIL.kit })))));
check("past five stickers, the rest are left out and counted", [typeof seven === "object" && seven?.stickers.length, typeof seven === "object" && seven?.skipped], [5, 2]);
const none = craft(frame(gun(AK47, null, [{ slot: 0, kit: NO_SUCH_KIT }])));
check("a code with no sticker the catalog knows has none to lay out", [placed(none), typeof none === "object" && none?.skipped], [[], 1]);
check("an empty sticker (kit 0) is not a sticker", placed(craft(frame(gun(AK47, null, [{ slot: 0, kit: 0 }, { slot: 1, kit: CROWN_FOIL.kit }])))), [
  [CROWN_FOIL.id, 1, 0, 0, 0, 0],
]);

// ---- not a gun that takes stickers -------------------------------------------------------
check("a code for a sticker itself", craft(frame(gun(STICKER_DEF, null, [{ slot: 0, kit: CROWN_FOIL.kit }]))), null);
check("a code for a knife", craft(frame(gun(KNIFE, null, []))), null);
check("a defindex no item has", craft(frame(gun(65_000, null, [{ slot: 0, kit: CROWN_FOIL.kit }]))), null);

// ---- refused before parsing ----------------------------------------------------------------
check("an unmasked steam:// link points at an inventory item", read("steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S76561198000000000A40000000000D1234567890123456789"), { ok: false, reason: "unmasked" });
check("an unmasked market link", read("csgo_econ_action_preview M4520000000000000A40000000000D1234567890"), { ok: false, reason: "unmasked" });
check("over the limit is too long, before anything else is looked at", read("a".repeat(CODE_LIMITS.maxChars + 1)), { ok: false, reason: "too-long" });
check("a valid code buried in padding past the limit is too long", read(oursHex + " ".repeat(CODE_LIMITS.maxChars)), { ok: false, reason: "too-long" });
check("hex past the limit is too long", read("AB".repeat(CODE_LIMITS.maxChars)), { ok: false, reason: "too-long" });
check("words are not a code", read("hello there"), { ok: false, reason: "not-a-code" });
check("an empty paste is not a code", read("   "), { ok: false, reason: "not-a-code" });
check("a number is not a code", read(1234), { ok: false, reason: "not-a-code" });
check("an object is not a code", read({ code: oursHex }), { ok: false, reason: "not-a-code" });
check("a web link is not a code", read("https://csinspect.com/craft/123"), { ok: false, reason: "not-a-code" });
check("a stray character inside the hex", read(oursHex.slice(0, 10) + "G" + oursHex.slice(11)), { ok: false, reason: "not-a-code" });

// ---- malformed --------------------------------------------------------------------------------
const flip = (hex: string, at: number) => hex.slice(0, at) + (hex[at] === "0" ? "1" : "0") + hex.slice(at + 1);
check("an odd number of hex digits", read(oursHex.slice(0, -1)), { ok: false, reason: "unreadable" });
check("cut short by a byte", read(oursHex.slice(0, -2)), { ok: false, reason: "unreadable" });
check("one digit changed fails the checksum", read(flip(oursHex, 20)), { ok: false, reason: "unreadable" });
check("a good payload under a wrong checksum", read(flip(oursHex, oursHex.length - 1)), { ok: false, reason: "unreadable" });
check("a good payload XOR-keyed under a wrong checksum", read(flip(keyed, keyed.length - 1)), { ok: false, reason: "unreadable" });
check("too short to hold a gun", read("00AABBCC"), { ok: false, reason: "unreadable" });
check("a field longer than what is left", read(frame([...u32(3, AK47), ...varint(12 * 8 + 2), 50, 1, 2])), { ok: false, reason: "unreadable" });
check("a varint that never ends", read(frame([...varint(3 * 8), ...Array(11).fill(0xff)])), { ok: false, reason: "unreadable" });
check("a group wire type", read(frame([...u32(3, AK47), ...varint(5 * 8 + 3)])), { ok: false, reason: "unreadable" });
check("field number 0", read(frame([0x00, 0x01, ...u32(3, AK47)])), { ok: false, reason: "unreadable" });
check("stickers sent as a number", read(frame([...u32(3, AK47), ...u32(12, 5)])), { ok: false, reason: "unreadable" });
check("a sticker id sent as a float", read(frame([...u32(3, AK47), ...sub(12, [...u32(1, 0), ...f32(2, 37)])])), { ok: false, reason: "unreadable" });
check("a defindex past 32 bits", read(frame([...varint(3 * 8), ...varint(2 ** 40)])), { ok: false, reason: "unreadable" });
check("no gun at all", read(frame([...u32(4, 282)])), { ok: false, reason: "unreadable" });
check("more sticker entries than any gun", read(frame([...u32(3, AK47), ...Array.from({ length: CODE_LIMITS.maxAttachments + 1 }, () => rawSticker({ slot: 0, kit: 37 })).flat()])), { ok: false, reason: "unreadable" });
check("unknown fields are skipped, not refused", placed(craft(frame([...u32(3, AK47), ...u32(99, 1), ...f32(98, 1.5), ...sub(97, [1, 2, 3]), ...rawSticker({ slot: 0, kit: 37 })]))), [
  [CROWN_FOIL.id, 0, 0, 0, 0, 0],
]);

if (failures) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log("\ninspect codes read back as written, and everything else is refused");
