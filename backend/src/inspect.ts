// Builds "unmasked" CS2 inspect links — the kind that don't need the item to
// exist on Steam's backend:
//
//   steam://rungame/730/76561202255233023/+csgo_econ_action_preview <HEX>
//
// The hex payload is a protobuf-encoded CEconItemPreviewDataBlock, prefixed
// with a null byte and suffixed with a 4-byte checksum. Hand-rolled here
// because the whole encoder is smaller than a protobuf runtime dependency —
// we only ever write, never parse, and only a handful of fields.
//
// That leading byte is an XOR mask key, not a constant: links the CS2 client
// itself copies to the clipboard carry a random non-zero key and XOR every
// following byte (checksum included) with it. Zero means "no mask", which is
// why our plaintext links parse and theirs look encrypted. The checksum is
// CRC32 over the whole unmasked buffer (key byte included), mixed as
// `(crc & 0xffff) ^ (protobufLength * crc)` and written big-endian.

/** Protobuf field numbers on CEconItemPreviewDataBlock. */
const F = {
  defindex: 3,
  paintindex: 4,
  rarity: 5,
  quality: 6,
  paintwear: 7,
  paintseed: 8,
  killeaterscoretype: 9,
  killeatervalue: 10,
  customname: 11,
  stickers: 12,
  keychains: 20,
} as const;

/** Field numbers on the nested CEconItemPreviewDataBlock.Sticker. */
const SF = {
  slot: 1,
  sticker_id: 2,
  wear: 3,
  scale: 4,
  rotation: 5,
  tint_id: 6,
  offset_x: 7,
  offset_y: 8,
  offset_z: 9,
  pattern: 10,
} as const;

/** Item quality enum — 4 is the normal "Unique", 9 is Strange (StatTrak). */
const QUALITY_UNIQUE = 4;
const QUALITY_STRANGE = 9;

class Writer {
  private bytes: number[] = [];

  private varint(value: number) {
    let v = value >>> 0;
    while (v > 0x7f) {
      this.bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.bytes.push(v);
  }

  /**
   * Wire type 0 — plain integer field. Written whenever the value is present,
   * including explicit zeros: Valve's encoder emits `paintwear: 0` rather than
   * dropping it, and byte-for-byte parity with the links CS2 itself hands out
   * is the whole point.
   */
  uint32(field: number, value: number | null | undefined) {
    if (value == null) return this;
    this.varint((field << 3) | 0);
    this.varint(value);
    return this;
  }

  /** Wire type 2 — length-delimited (strings, nested messages). */
  bytes2(field: number, payload: Uint8Array) {
    this.varint((field << 3) | 2);
    this.varint(payload.length);
    for (const b of payload) this.bytes.push(b);
    return this;
  }

  string(field: number, value: string | null | undefined) {
    if (!value) return this;
    return this.bytes2(field, new TextEncoder().encode(value));
  }

  /**
   * Top-level `paintwear` is declared `optional uint32` on the preview block, so
   * the float rides inside a varint as raw IEEE-754 bits. This is specific to
   * that field — the nested Sticker message uses real protobuf floats, see
   * `float` below.
   */
  floatAsUint32(field: number, value: number | null | undefined) {
    if (value == null) return this;
    const buf = new DataView(new ArrayBuffer(4));
    buf.setFloat32(0, value);
    return this.uint32(field, buf.getUint32(0));
  }

  /**
   * Wire type 5 — fixed32, little-endian. CEconItemPreviewDataBlock.Sticker
   * declares wear/scale/rotation/offset_x/offset_y/offset_z as `optional float`,
   * and the game drops any of them that arrive as a varint: the wire type
   * mismatch pushes the field into unknown-fields and the sticker or keychain
   * silently falls back to its default placement.
   */
  float(field: number, value: number | null | undefined) {
    if (value == null) return this;
    this.varint((field << 3) | 5);
    const buf = new DataView(new ArrayBuffer(4));
    buf.setFloat32(0, value, true);
    for (let i = 0; i < 4; i++) this.bytes.push(buf.getUint8(i));
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface InspectSticker {
  /** 0-4 for stickers, 0 for the single keychain slot. */
  slot: number;
  /** Sticker kit id (or keychain defindex for keychains). */
  id: number;
  wear?: number | null;
  scale?: number | null;
  rotation?: number | null;
  offsetX?: number | null;
  offsetY?: number | null;
  offsetZ?: number | null;
  /** Keychain pattern seed. */
  pattern?: number | null;
}

export interface InspectItem {
  defindex: number;
  paintindex?: number | null;
  paintseed?: number | null;
  /** Float value, 0-1. */
  paintwear?: number | null;
  stattrak?: boolean;
  /** Overrides the quality derived from `stattrak`. */
  quality?: number | null;
  /** StatTrak kill count. Only emitted when set — omitting it still shows the orange StatTrak title. */
  killeatervalue?: number | null;
  nametag?: string | null;
  rarity?: number | null;
  stickers?: InspectSticker[];
  keychains?: InspectSticker[];
}

function encodeSticker(sticker: InspectSticker): Uint8Array {
  return new Writer()
    .uint32(SF.slot, sticker.slot)
    .uint32(SF.sticker_id, sticker.id)
    .float(SF.wear, sticker.wear)
    .float(SF.scale, sticker.scale)
    .float(SF.rotation, sticker.rotation)
    .float(SF.offset_x, sticker.offsetX)
    .float(SF.offset_y, sticker.offsetY)
    .float(SF.offset_z, sticker.offsetZ)
    .uint32(SF.pattern, sticker.pattern)
    .finish();
}

/** Encodes the item to the uppercase hex payload an inspect link carries. */
export function buildInspectHex(item: InspectItem): string {
  const writer = new Writer()
    .uint32(F.defindex, item.defindex)
    .uint32(F.paintindex, item.paintindex)
    .uint32(F.rarity, item.rarity)
    .uint32(F.quality, item.quality ?? (item.stattrak ? QUALITY_STRANGE : QUALITY_UNIQUE))
    .floatAsUint32(F.paintwear, item.paintwear)
    .uint32(F.paintseed, item.paintseed);

  if (item.killeatervalue != null) {
    // Score type 0 = kills; the counter only renders when both are present.
    writer.uint32(F.killeaterscoretype, 0).uint32(F.killeatervalue, item.killeatervalue);
  }

  writer.string(F.customname, item.nametag);
  for (const sticker of item.stickers ?? []) writer.bytes2(F.stickers, encodeSticker(sticker));
  for (const keychain of item.keychains ?? []) writer.bytes2(F.keychains, encodeSticker(keychain));

  const proto = writer.finish();

  // Leading null byte, then a checksum Valve derives from the CRC of the
  // whole (prefixed) buffer mixed with the protobuf's length.
  const payload = new Uint8Array(proto.length + 1);
  payload.set(proto, 1);
  const crc = crc32(payload);
  const checksum = ((crc & 0xffff) ^ (proto.length * crc)) >>> 0;

  const out = new Uint8Array(payload.length + 4);
  out.set(payload, 0);
  new DataView(out.buffer).setUint32(payload.length, checksum);

  return Array.from(out, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
}

/** Full steam:// URL that opens the item in CS2's inspect view. */
export function buildInspectLink(item: InspectItem): string {
  return `steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20${buildInspectHex(item)}`;
}
