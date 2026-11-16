// A baked card is its silhouette's box plus this share of that box on every
// side (cropToContent). A card that came out wider than 3.6:1 is padded taller
// on top of that, evenly, so only its WIDTH still says how big the item is.
export const CARD_CROP_MARGIN = 0.03;

export function containedRect(
  img: { top: number; left: number; width: number; height: number },
  natural: { width: number; height: number },
): { x: number; y: number; w: number; h: number } | null {
  if (!natural.width || !natural.height || !img.width || !img.height) {
    return null;
  }
  const scale = Math.min(img.width / natural.width, img.height / natural.height);
  const w = natural.width * scale;
  const h = natural.height * scale;
  return { x: img.left + (img.width - w) / 2, y: img.top + (img.height - h) / 2, w, h };
}

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
