export type Vec2 = { x: number; y: number };

// The pan that keeps the point under `anchor` (CSS px from the pane's centre)
// still while the orthographic zoom scales by `ratio`. applyPan draws an image
// point p at p + pan - inset/2 across and p + pan down, so solve for the new pan.
export function panAfterZoom(anchor: Vec2, pan: Vec2, inset: number, ratio: number): Vec2 {
  return {
    x: anchor.x + inset / 2 - ratio * (anchor.x - pan.x + inset / 2),
    y: anchor.y - ratio * (anchor.y - pan.y),
  };
}

export function pointerMidpoint(points: Iterable<Vec2>): Vec2 | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}
