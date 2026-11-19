// A pasted inspect code read back into the gun and stickers it names: the other
// direction of inspect.ts, for the Sticker Crafts mat's Import.
//
// Only a MASKED code carries the item in itself (csinspect.com's "Code", the
// bare `csgo_econ_action_preview <HEX>` command, or a steam:// link around one).
// An unmasked link (S…A…D…) only points at an item in someone's inventory, and
// reading that takes Steam's game coordinator.
//
// The text is a stranger's: it is bounded before any parsing, every length and
// field is checked against what is left of the buffer, and nothing of it is
// logged or sent back.
import { crc32 } from "node:zlib";

export const CODE_LIMITS = {
  maxChars: 2048,
  /** Key byte, a defindex field, and the four-byte checksum. */
  minBytes: 1 + 2 + 4,
  maxAttachments: 32,
} as const;

export type CodeRefusal = "too-long" | "unmasked" | "not-a-code" | "unreadable";

export interface CodeSticker {
  /** The anchor it is measured from; null when the code leaves it out. */
  slot: number | null;
  /** The game's sticker kit index, not a catalog id. */
  kit: number;
  x: number | null;
  y: number | null;
  r: number | null;
  wear: number | null;
}
export interface InspectCode {
  def: number;
  paint: number | null;
  stickers: CodeSticker[];
}
export type CodeRead = { ok: true; code: InspectCode } | { ok: false; reason: CodeRefusal };

const UNMASKED = /^(?:steam:\/\/rungame\/730\/\d{1,20}\/)?\+?csgo_econ_action_preview(?:%20|\s)+[SM]\d{1,20}A\d{1,20}D\d{1,20}$/i;
const MASKED = /^(?:steam:\/\/rungame\/730\/\d{1,20}\/)?(?:\+?csgo_econ_action_preview(?:%20|\s)+)?([0-9a-f]+)$/i;

/** CEconItemPreviewDataBlock and its Sticker message: the fields read here. */
const F = { defindex: 3, paintindex: 4, stickers: 12 } as const;
const SF = { slot: 1, id: 2, wear: 3, rotation: 5, offsetX: 7, offsetY: 8 } as const;
const WIRE = { varint: 0, fixed64: 1, bytes: 2, fixed32: 5 } as const;

class Unreadable extends Error {}

type Field = { field: number; wire: number; num: number; bytes: Uint8Array | null };

function readVarint(buf: Uint8Array, at: number): [number, number] {
  let value = 0;
  let mul = 1;
  for (let i = 0; i < 10; i++) {
    if (at >= buf.length) {
      throw new Unreadable();
    }
    const b = buf[at++];
    value += (b & 0x7f) * mul;
    if (!(b & 0x80)) {
      return [value, at];
    }
    mul *= 128;
  }
  throw new Unreadable();
}

function readMessage(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 0;
  while (at < buf.length) {
    let tag: number;
    [tag, at] = readVarint(buf, at);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (field < 1 || out.length >= 256) {
      throw new Unreadable();
    }
    if (wire === WIRE.varint) {
      let num: number;
      [num, at] = readVarint(buf, at);
      out.push({ field, wire, num, bytes: null });
    } else if (wire === WIRE.fixed32) {
      if (at + 4 > buf.length) {
        throw new Unreadable();
      }
      out.push({ field, wire, num: view.getFloat32(at, true), bytes: null });
      at += 4;
    } else if (wire === WIRE.fixed64) {
      if (at + 8 > buf.length) {
        throw new Unreadable();
      }
      at += 8;
    } else if (wire === WIRE.bytes) {
      let len: number;
      [len, at] = readVarint(buf, at);
      if (len > buf.length - at) {
        throw new Unreadable();
      }
      out.push({ field, wire, num: 0, bytes: buf.subarray(at, at + len) });
      at += len;
    } else {
      throw new Unreadable();
    }
  }
  return out;
}

/** The last value of a field, which is what protobuf keeps; a wrong wire type is unreadable. */
function last(msg: Field[], field: number, wire: number): Field | undefined {
  const all = msg.filter((m) => m.field === field);
  if (all.some((m) => m.wire !== wire)) {
    throw new Unreadable();
  }
  return all.at(-1);
}

function uint32(msg: Field[], field: number): number | null {
  const f = last(msg, field, WIRE.varint);
  if (!f) {
    return null;
  }
  if (f.num > 0xffffffff) {
    throw new Unreadable();
  }
  return f.num;
}

const float = (msg: Field[], field: number) => last(msg, field, WIRE.fixed32)?.num ?? null;

function sticker(bytes: Uint8Array): CodeSticker | null {
  const msg = readMessage(bytes);
  const kit = uint32(msg, SF.id);
  if (!kit) {
    return null;
  }
  return {
    slot: uint32(msg, SF.slot),
    kit,
    x: float(msg, SF.offsetX),
    y: float(msg, SF.offsetY),
    r: float(msg, SF.rotation),
    wear: float(msg, SF.wear),
  };
}

function hexBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 || hex.length / 2 < CODE_LIMITS.minBytes) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * The payload of a masked code, or null when it fails its checksum. Every byte
 * after the first is XORed with the first (0 on codes cs2-lib-inspect writes);
 * the last four are a CRC32 of the rest, mixed with the payload's length.
 */
function unmask(bytes: Uint8Array): Uint8Array | null {
  const key = bytes[0];
  const plain = bytes.map((b, i) => (i ? b ^ key : b));
  const body = plain.subarray(0, plain.length - 4);
  const sent = new DataView(plain.buffer, plain.byteOffset + plain.length - 4, 4).getUint32(0);
  const crc = crc32(body);
  const want = ((crc & 0xffff) ^ ((body.length - 1) * crc)) >>> 0;
  return sent === want ? body.subarray(1) : null;
}

export function readInspectCode(text: unknown): CodeRead {
  if (typeof text !== "string") {
    return { ok: false, reason: "not-a-code" };
  }
  if (text.length > CODE_LIMITS.maxChars) {
    return { ok: false, reason: "too-long" };
  }
  const t = text.trim();
  if (UNMASKED.test(t)) {
    return { ok: false, reason: "unmasked" };
  }
  const hex = MASKED.exec(t)?.[1];
  if (!hex) {
    return { ok: false, reason: "not-a-code" };
  }
  const bytes = hexBytes(hex);
  const payload = bytes && unmask(bytes);
  if (!payload) {
    return { ok: false, reason: "unreadable" };
  }
  try {
    const msg = readMessage(payload);
    const def = uint32(msg, F.defindex);
    const raw = msg.filter((m) => m.field === F.stickers);
    if (!def || raw.length > CODE_LIMITS.maxAttachments || raw.some((m) => m.wire !== WIRE.bytes)) {
      return { ok: false, reason: "unreadable" };
    }
    const stickers = raw.map((m) => sticker(m.bytes!)).filter((s): s is CodeSticker => !!s);
    return { ok: true, code: { def, paint: uint32(msg, F.paintindex), stickers } };
  } catch (e) {
    if (e instanceof Unreadable) {
      return { ok: false, reason: "unreadable" };
    }
    throw e;
  }
}
