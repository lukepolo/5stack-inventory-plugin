// Where something placed just under an object-contain picture goes, in px from
// the top of its stage. The <img> box is larger than the drawn picture.
export function belowContainedArt(
  img: { top: number; width: number; height: number },
  natural: { width: number; height: number },
  stageHeight: number,
  gap: number,
  room: number,
): number | null {
  if (!natural.width || !natural.height || !img.width || !img.height) {
    return null;
  }
  const drawn = natural.height * Math.min(img.width / natural.width, img.height / natural.height);
  const below = img.top + (img.height + drawn) / 2 + gap;
  return Math.max(0, Math.min(below, stageHeight - room));
}
