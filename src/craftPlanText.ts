// A Sticker Craft's run on a gun, in words — the picker's tiles, its 3D
// preview and the editor's waiting card all say it the same way. Slots come in
// 0-based and go out numbered as the editor numbers them, from 1.
import type { CraftPlan } from "./composables/useAttachmentPicker";

/** "slot 3", "slots 1–2", "slots 1, 3 and 5". */
export function slotsText(slots: number[]): string {
  const s = [...slots].sort((a, b) => a - b).map((i) => i + 1);
  if (s.length === 1) return `slot ${s[0]}`;
  const run = s.every((v, i) => i === 0 || v === s[i - 1] + 1);
  return run ? `slots ${s[0]}–${s[s.length - 1]}` : `slots ${listText(s.map(String))}`;
}

/** "a", "a and b", "a, b and c". */
export function listText(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The tile's line: "Goes in slots 1–2 · moves 3 stickers along". */
export function planLine(p: CraftPlan): string {
  const n = p.moved.length;
  return `Goes in ${slotsText(p.slots)}` + (n ? ` · moves ${n} ${n === 1 ? "sticker" : "stickers"} along` : "");
}

/** The preview's sentence: "Goes in slots 1–2. Howling Dawn and Ace Devil move to slots 3–4." */
export function planSentence(p: CraftPlan): string {
  const head = `Goes in ${slotsText(p.slots)}.`;
  if (!p.moved.length) return head;
  const verb = p.moved.length === 1 ? "moves" : "move";
  return `${head} ${listText(p.moved.map((m) => m.name))} ${verb} to ${slotsText(p.moved.map((m) => m.to))}.`;
}
