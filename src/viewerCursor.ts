// A HUD reticle that replaces the native cursor inside the 3D viewer.
//
// The viewer supports five distinct gestures (orbit, pan, zoom, drag a sticker,
// grab the charm) on one surface, and the OS cursor set can express roughly two
// of them. So we hide the native cursor and draw our own: one SVG whose state is
// switched by a `data-mode` attribute, letting CSS own every transition.
//
// The part that matters for feel is DIRECTION. While you orbit, the arc-arrows
// rotate to the heading of your drag and a speed arc trails behind them, so the
// cursor tells you which way the weapon is about to spin before it visibly
// moves. Everything is driven off a rAF-smoothed velocity, not raw deltas —
// per-event rotation is jittery enough to read as broken.
//
// Consumes var(--acc), so the reticle crossfades with the team accent for free.

export type CursorMode =
  | "idle" // over empty space — the model can be spun
  | "orbit" // left-dragging the scene
  | "pan" // right/middle-dragging
  | "zoom" // transient, on wheel
  | "sticker" // hovering a sticker
  | "rotate" // hovering a sticker with shift held
  | "charm" // hovering the charm
  | "grab"; // holding a sticker or the charm

const LABELS: Record<CursorMode, string> = {
  idle: "SPIN",
  orbit: "SPIN",
  pan: "PAN",
  zoom: "ZOOM",
  sticker: "MOVE",
  rotate: "ROTATE",
  charm: "CHARM",
  grab: "HOLD",
};

const RING_R = 14;
const RING_C = 2 * Math.PI * RING_R; // dash math for the speed arc

const CSS = `
.cs2-cur-layer { position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:20; }
.cs2-cur {
  position:absolute; left:0; top:0; width:48px; height:48px; margin:-24px 0 0 -24px;
  opacity:0; transition:opacity 120ms linear;
  will-change:transform;
}
.cs2-cur[data-on="1"] { opacity:1; }
.cs2-cur svg { display:block; overflow:visible; }

/* Shared stroke language: hairlines, square caps — instrument, not illustration. */
.cs2-cur [stroke] { fill:none; stroke-linecap:square; stroke-linejoin:miter; vector-effect:non-scaling-stroke; }

.cs2-cur .g { opacity:0; transition:opacity 140ms ease, transform 180ms cubic-bezier(0.22,1,0.36,1); transform-origin:24px 24px; }
.cs2-cur .dot { fill:#fff; opacity:0.9; }
.cs2-cur .ring { stroke:#fff; stroke-width:1; opacity:0.22; transition:opacity 140ms ease, transform 200ms cubic-bezier(0.22,1,0.36,1); transform-origin:24px 24px; }

/* Orbit: two opposing arc-arrows that rotate to the drag heading. The wrapper
   takes the heading (no transition — JS lerps it), the inner group the state. */
.cs2-cur .head { transform-origin:24px 24px; }
.cs2-cur .orbit { stroke:#fff; stroke-width:1.25; opacity:0; }
.cs2-cur .sweep {
  stroke:var(--acc, #fff); stroke-width:1.5; opacity:0;
  stroke-dasharray:var(--sweep,0) ${RING_C.toFixed(2)};
  transform:rotate(-90deg); transform-origin:24px 24px;
}
.cs2-cur .chev { stroke:var(--acc, #fff); stroke-width:1.25; }
.cs2-cur .brk { stroke:var(--acc, #fff); stroke-width:1.25; }
.cs2-cur .rot { stroke:var(--acc, #fff); stroke-width:1.25; }
.cs2-cur .tick { stroke:#fff; stroke-width:1; opacity:0.5; }

.cs2-cur .label {
  fill:var(--acc, #fff); font:600 6px ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing:1.6px; text-anchor:middle; opacity:0; transition:opacity 140ms ease;
}

/* ---- states ---- */
.cs2-cur[data-mode="idle"] .orbit { opacity:0.4; }
.cs2-cur[data-mode="idle"] .head { animation:cs2CurDrift 9s linear infinite; }

.cs2-cur[data-mode="orbit"] .orbit { opacity:1; }
.cs2-cur[data-mode="orbit"] .sweep { opacity:0.9; }
.cs2-cur[data-mode="orbit"] .ring { opacity:0.4; }
.cs2-cur[data-mode="orbit"] .dot { opacity:0.35; }

.cs2-cur[data-mode="pan"] .pan { opacity:1; }
.cs2-cur[data-mode="pan"] .ring { opacity:0.15; transform:scale(0.7); }

.cs2-cur[data-mode="zoom"] .zoom { opacity:1; }
.cs2-cur[data-mode="zoom"] .ring { opacity:0.5; animation:cs2CurPulse 380ms cubic-bezier(0.22,1,0.36,1); }

/* Hover/hold on an attachment: a selection frame. It clamps inward on grab —
   the same visual verb as picking the thing up. */
.cs2-cur[data-mode="sticker"] .frame,
.cs2-cur[data-mode="charm"] .frame,
.cs2-cur[data-mode="grab"] .frame { opacity:1; }
.cs2-cur[data-mode="sticker"] .ring,
.cs2-cur[data-mode="charm"] .ring,
.cs2-cur[data-mode="rotate"] .ring,
.cs2-cur[data-mode="grab"] .ring { opacity:0; }
.cs2-cur[data-mode="charm"] .frame { transform:scale(0.82); }
.cs2-cur[data-mode="grab"] .frame { transform:scale(0.62); }
.cs2-cur[data-mode="grab"] .dot { opacity:1; }

.cs2-cur[data-mode="rotate"] .rotg { opacity:1; }

.cs2-cur[data-mode="orbit"] .label,
.cs2-cur[data-mode="pan"] .label,
.cs2-cur[data-mode="zoom"] .label,
.cs2-cur[data-mode="sticker"] .label,
.cs2-cur[data-mode="rotate"] .label,
.cs2-cur[data-mode="charm"] .label,
.cs2-cur[data-mode="grab"] .label { opacity:0.85; }

@keyframes cs2CurDrift { to { transform:rotate(360deg); } }
@keyframes cs2CurPulse { 0% { transform:scale(0.75); } 100% { transform:scale(1); } }

@media (prefers-reduced-motion: reduce) {
  .cs2-cur .g, .cs2-cur .ring { transition-duration:1ms; }
  .cs2-cur[data-mode="idle"] .head { animation:none; }
  .cs2-cur .sweep { opacity:0 !important; }
}
`;

/** Arc-arrow along the ring, centred on `mid` degrees and spanning `span`. */
function arcArrow(mid: number, span: number): string {
  const rad = (d: number) => ((d - 90) * Math.PI) / 180;
  const pt = (d: number, r = RING_R) => `${(24 + Math.cos(rad(d)) * r).toFixed(2)},${(24 + Math.sin(rad(d)) * r).toFixed(2)}`;
  const a = mid - span / 2;
  const b = mid + span / 2;
  // Arrowhead: two barbs struck back from the leading end, one inside the ring
  // and one outside, so the head reads at any rotation.
  const head = `M${pt(b - 11, RING_R - 4)} L${pt(b)} L${pt(b - 11, RING_R + 4)}`;
  return `<path d="M${pt(a)} A${RING_R},${RING_R} 0 0 1 ${pt(b)}"/><path d="${head}"/>`;
}

/** Chevron pointing away from centre along `deg`, tip at radius `r`. */
function chevron(deg: number, r: number): string {
  const rad = ((deg - 90) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const px = -sin;
  const py = cos;
  const p = (along: number, side: number) =>
    `${(24 + cos * along + px * side).toFixed(2)},${(24 + sin * along + py * side).toFixed(2)}`;
  return `<path d="M${p(r - 4.5, -4)} L${p(r, 0)} L${p(r - 4.5, 4)}"/>`;
}

const SVG = `
<svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
  <circle class="ring" cx="24" cy="24" r="${RING_R}"/>
  <circle class="sweep" cx="24" cy="24" r="${RING_R}"/>
  <g class="head">
    <g class="orbit">${arcArrow(90, 54)}${arcArrow(270, 54)}</g>
  </g>
  <g class="g pan chev">${chevron(0, 19)}${chevron(90, 19)}${chevron(180, 19)}${chevron(270, 19)}</g>
  <g class="g zoom chev">${chevron(45, 15)}${chevron(225, 15)}</g>
  <g class="g frame brk">
    <path d="M14 18.5V14h4.5M29.5 14H34v4.5M34 29.5V34h-4.5M18.5 34H14v-4.5"/>
  </g>
  <g class="g rotg">
    <g class="rot">${arcArrow(120, 150)}</g>
    <path class="tick" d="M24 6.5v3M41.5 24h-3M24 41.5v-3M6.5 24h3"/>
  </g>
  <circle class="dot" cx="24" cy="24" r="1.25"/>
  <text class="label" x="24" y="45">SPIN</text>
</svg>`;

export interface ViewerCursor {
  /** Switch state. `zoom` auto-reverts to the previous mode. */
  set(mode: CursorMode): void;
  /** Feed pointer position (client coords) — also drives the heading. */
  move(clientX: number, clientY: number): void;
  show(on: boolean): void;
  destroy(): void;
}

let styleRefs = 0;
let styleEl: HTMLStyleElement | null = null;

function acquireStyle(): void {
  if (styleRefs++ === 0) {
    styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
  }
}
function releaseStyle(): void {
  if (--styleRefs === 0) {
    styleEl?.remove();
    styleEl = null;
  }
}

/**
 * Mount the reticle into `container` (which must be able to host an absolutely
 * positioned child). Returns a no-op handle on coarse pointers — there is no
 * cursor to replace on touch, and hiding it there would strand the user.
 */
export function createViewerCursor(container: HTMLElement, surface: HTMLElement): ViewerCursor {
  const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  if (coarse) {
    return { set() {}, move() {}, show() {}, destroy() {} };
  }

  acquireStyle();
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  const prevCursor = surface.style.cursor;
  surface.style.cursor = "none";

  const layer = document.createElement("div");
  layer.className = "cs2-cur-layer";
  const node = document.createElement("div");
  node.className = "cs2-cur";
  node.dataset.mode = "idle";
  node.innerHTML = SVG;
  layer.appendChild(node);
  container.appendChild(layer);

  const head = node.querySelector(".head") as SVGGElement;
  const sweep = node.querySelector(".sweep") as SVGCircleElement;
  const label = node.querySelector(".label") as SVGTextElement;

  let mode: CursorMode = "idle";
  let prevMode: CursorMode = "idle";
  let zoomTimer = 0;

  // Position + smoothed velocity. `x/y` are the true pointer (the hotspot must
  // never lag), while `vx/vy` are eased — heading off raw deltas jitters.
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let lastX = 0;
  let lastY = 0;
  let havePos = false;
  // Unwrapped so the arrows always take the short way round; a raw atan2 fed
  // into a CSS transition spins the long way every time it crosses ±180°.
  let heading = 0;
  let raf = 0;
  let visible = false;

  // Coordinates are relative to the layer, not the canvas, so container padding
  // or a border can't offset the reticle from the real pointer. Cached because
  // pointermove fires far too often to afford a layout read each time.
  let rect = layer.getBoundingClientRect();
  const remeasure = () => {
    rect = layer.getBoundingClientRect();
  };
  const ro = new ResizeObserver(remeasure);
  ro.observe(layer);
  window.addEventListener("scroll", remeasure, { passive: true, capture: true });
  window.addEventListener("resize", remeasure);

  function tick() {
    raf = requestAnimationFrame(tick);
    vx += (lastX - vx) * 0.2;
    vy += (lastY - vy) * 0.2;
    lastX *= 0.82;
    lastY *= 0.82;
    const speed = Math.hypot(vx, vy);

    if (mode === "orbit" && speed > 0.35) {
      const target = (Math.atan2(vy, vx) * 180) / Math.PI;
      // Arrows sit at 90°/270° in the artwork, so the heading maps directly.
      heading += ((((target - heading) % 360) + 540) % 360) - 180;
      head.style.transform = `rotate(${heading.toFixed(1)}deg)`;
      sweep.style.setProperty("--sweep", Math.min(speed * 1.6, 26).toFixed(1));
      // A few px of lag opposite the drag — the reticle feels like it has mass.
      const lag = Math.min(speed * 0.22, 4);
      const ang = (heading * Math.PI) / 180;
      node.style.transform = `translate3d(${(x - Math.cos(ang) * lag).toFixed(1)}px,${(y - Math.sin(ang) * lag).toFixed(1)}px,0)`;
      return;
    }
    if (mode === "orbit") sweep.style.setProperty("--sweep", "0");
    node.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
  }
  raf = requestAnimationFrame(tick);

  function apply(next: CursorMode) {
    if (mode === next) return;
    mode = next;
    node.dataset.mode = next;
    label.textContent = LABELS[next];
    if (next !== "orbit") {
      // Park the arrows where they were left rather than snapping to 0 — the
      // idle drift picks up from the last heading.
      sweep.style.setProperty("--sweep", "0");
    }
  }

  return {
    set(next) {
      if (next === "zoom") {
        if (mode !== "zoom") prevMode = mode;
        apply("zoom");
        clearTimeout(zoomTimer);
        zoomTimer = window.setTimeout(() => apply(prevMode), 420);
        return;
      }
      clearTimeout(zoomTimer);
      apply(next);
    },
    move(clientX, clientY) {
      const nx = clientX - rect.left;
      const ny = clientY - rect.top;
      if (havePos) {
        lastX = nx - x;
        lastY = ny - y;
      }
      havePos = true;
      x = nx;
      y = ny;
      if (!visible) {
        // Jump to the new spot before revealing, or it flies in from 0,0.
        node.style.transform = `translate3d(${x}px,${y}px,0)`;
        visible = true;
        node.dataset.on = "1";
      }
    },
    show(on) {
      if (on) remeasure();
      visible = on;
      node.dataset.on = on ? "1" : "0";
      if (!on) havePos = false;
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(zoomTimer);
      ro.disconnect();
      window.removeEventListener("scroll", remeasure, { capture: true });
      window.removeEventListener("resize", remeasure);
      layer.remove();
      surface.style.cursor = prevCursor;
      releaseStyle();
    },
  };
}
