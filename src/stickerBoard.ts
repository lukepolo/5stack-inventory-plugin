// THE STICKER BOARD — the 3D half of Sticker Crafts (StickerCrafts.vue).
//
// A cutting mat, measured in centimetres, with stickers lying flat on it. The
// mat is the measuring tool: a 1 cm grid, bolder lines every 5 cm and ruled
// edges, so a layout can be read off it the way you would read one off a real
// mat before committing anything to a weapon.
//
// The board owns NO layout state. StickerCrafts holds the list of stickers and
// hands it over whole on every change (`sync`); the board only draws it and
// reports what the pointer did. That keeps grouping, ordering and the saved
// library in one place, and lets this file stay a renderer.
//
// The stickers are drawn with the weapon decals' own art and material path
// (loadStickerTexture + applyStickerSfx), so a holo or a foil looks here the way
// it does on a gun, and the board can never disagree with the editor about
// which artwork a sticker has. Each one fills a STICKER_CM square exactly as a
// decal fills its slot's square: the art is already letterboxed to a square by
// loadStickerTexture, so stretching the quad to the ink's proportions (as this
// first did) squashed every sticker that isn't square.
//
// The stickers glow the way the weapon editor's decals do — the same breath on
// the one under the pointer and on the selection, the same flash on one just
// added (stickerGlow.ts) — so a sticker you can grab looks the same in both.
import type * as ThreeNS from "three";
import { applyStickerSfx, setStickerWear } from "./stickerShader";
import { createStickerGlow } from "./stickerGlow";
import { paintTextureUrl } from "./paintComposite";
import { loadStickerTexture, loadThree, stickerArtInfo, type ThreeBundle } from "./viewer3d";
import type { WeaponOutline } from "./outlineTrace";
import { GRID_H, GRID_W, HOME_LAYOUT, MARGIN, STICKER_CM, type BoardSticker, type CraftSticker, type MatLayout } from "./stickerCraftsModel";

/** Texture resolution of the mat. 40 px per cm keeps the mm ticks crisp. */
const PX_PER_CM = 40;



export interface BoardCallbacks {
  /** A press on a sticker (uid) or on the empty mat (null). Fired on pointer
   *  DOWN for a sticker, so a drag starts on what was just selected; on pointer
   *  UP for the mat, so orbiting the camera never clears the selection. */
  pick(uid: string | null, mods: { shift: boolean; alt: boolean }): void;
  /** A sticker drag, as a running offset in cm from where it started. */
  dragStart(uid: string): void;
  drag(dx: number, dy: number): void;
  dragEnd(): void;
  /** Shift + drag: turn the selection, as a running angle in degrees from where
   *  the gesture started (right = clockwise). */
  turnStart(): void;
  turn(deg: number): void;
  turnEnd(): void;
  /** Alt + wheel over the mat: rotate the selection by this many degrees. */
  rotate(deg: number): void;
  /** The view became another by hand: tilting out of Top (a drag on the mat)
   *  makes it Angled, where it already is — no flight. */
  viewChanged(view: "angled" | "top"): void;
  /** The browser took the board's WebGL context away (GPU reset, too many
   *  contexts). The board has stopped drawing; the caller mounts a new one. */
  contextLost(): void;
}

export interface StickerBoard {
  /** Draw this list. Order is draw order: later ones lie on top. */
  sync(stickers: BoardSticker[], selected: ReadonlySet<string>): void;
  /** "angled" is the default three-quarter look; "top" is straight down, for measuring. */
  setView(view: "angled" | "top"): void;
  /** The view it is in now (it changes by hand: see BoardCallbacks.viewChanged). */
  view(): "angled" | "top";
  /** A top-down picture of a craft on the mat, as a PNG — the library card and
   *  the weapon picker's tile. Rendered by this board, so it is the board's own
   *  look and not an approximation of it. */
  snapshot(stickers: CraftSticker[]): Promise<Blob>;
  /** The "it's over here" flash on stickers just put on the mat — once each is drawn. */
  flash(uids: string[]): void;
  /** The point of the mat in the middle of the view, in cm on the grid — where
   *  a sticker added now should land. Clamped to the grid. */
  viewCentre(): { x: number; y: number };
  /** A weapon's side outline chalked on the mat at sticker scale, its box
   *  centred on the home grid's middle, or none. */
  setOutline(outline: WeaponOutline | null): void;
  /**
   * The craft (these stickers, at their places on the mat) on the chalked
   * weapon, top-down, framed on the weapon, the weapon's name chalked in a
   * corner: the proposed use a published craft carries. A PNG, or null with no
   * weapon chalked.
   */
  useCaseShot(stickers: CraftSticker[], weapon: string): Promise<Blob | null>;
  /** Grow or shrink the mat to this, animated — and with `refit`, fly the
   *  view out (or in) to fit it, on the same beat. */
  setLayout(layout: MatLayout, refit: boolean): void;
  /** Each slot's sticker size on the chalked gun, as a share of STICKER_CM
   *  ([] = all STICKER_CM): the mat draws a craft the size the gun will. */
  setSlotSizes(sizes: number[]): void;
  dispose(): void;
}

/** The dashed box round a group: neutral, so it reads apart from the glow and
 *  the team accent, as the layer list draws a group. */
const GROUP_LINE = 0xd9e4de;
/** Degrees of turn per pixel of a Shift-drag. */
const TURN_PER_PX = 0.5;
/** Snapshot size. 2:1, the shape of the library card and the picker tile. */
const SNAP_W = 360;
const SNAP_H = 180;
/** A canvas as the PNG a craft picture is uploaded from (uploadCraftPicture
 *  sends a WebP of it when this browser can make one). */
const pngOf = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no picture"))), "image/png"));

/** Every snapshot's width on the mat, in cm: one scale for every craft — five
 *  stickers in a row — so a picture says how big a craft is next to another.
 *  Only a craft wider than this is framed to fit. */
const SNAP_SPAN_CM = 26;

/**
 * The reflections the stickers see.
 *
 * A soft light box: a lit ceiling and four broad, gentle softboxes, one along
 * each edge of the mat. Foils and holos are mirrors, so they look as bright as
 * whatever they reflect. RoomEnvironment hung hot panels overhead, and a
 * camera looking straight down sees exactly overhead in a flat sticker, so the
 * Top view flared white; one softbox on the far edge alone fixed that and left
 * every foil reflecting a dark room, bright only at its edges. Nothing here is
 * a hot spot, and nothing is dark.
 */
function studioEnv(THREE: typeof ThreeNS) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(120, 70, 120),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.52, 0.55), side: THREE.BackSide }),
  );
  room.position.y = 30;
  env.add(room);
  const panel = (w: number, h: number, rgb: number, at: [number, number, number]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb, rgb, rgb), side: THREE.DoubleSide }),
    );
    m.position.set(...at);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  // One along each edge, low enough that straight down never looks into one.
  panel(90, 30, 1.5, [0, 26, -48]);
  panel(90, 30, 1.25, [0, 26, 48]);
  panel(90, 30, 1.35, [-48, 26, 0]);
  panel(90, 30, 1.35, [48, 26, 0]);
  // And one gentle lamp overhead, OFF the centre (toward the top-right of the
  // mat), so a foil or a holo has something bright to catch as it turns. Off
  // centre is what keeps it from being the old glare: straight up from the mat
  // misses it, and only stickers on that side of the Top view pick up a glint.
  panel(22, 22, 1.6, [12, 55, -10]);
  return env;
}

/** Draw the mat into a canvas: grid, rulers, numbers and the angle guides. */
function drawMat(l: MatLayout, ppc: number): HTMLCanvasElement {
  const gwU = l.x1 - l.x0;
  const ghU = l.y1 - l.y0;
  const cv = document.createElement("canvas");
  cv.width = Math.max(2, Math.round((gwU + MARGIN * 2) * ppc));
  cv.height = Math.max(2, Math.round((ghU + MARGIN * 2) * ppc));
  const g = cv.getContext("2d")!;
  const px = (u: number) => u * ppc;
  const f = l.cmPerUnit;
  // A self-healing mat's deep green, a touch cooler than the classic so it
  // sits with the panel's dark chrome instead of glowing out of it.
  g.fillStyle = "#183a31";
  g.fillRect(0, 0, cv.width, cv.height);
  // The border band reads as a separate strip on a real mat.
  g.fillStyle = "#14322a";
  g.fillRect(0, 0, cv.width, px(MARGIN));
  g.fillRect(0, cv.height - px(MARGIN), cv.width, px(MARGIN));
  g.fillRect(0, 0, px(MARGIN), cv.height);
  g.fillRect(cv.width - px(MARGIN), 0, px(MARGIN), cv.height);

  const ox = px(MARGIN);
  const oy = px(MARGIN);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  const gw = px(gwU);
  const gh = px(ghU);
  // No 45°/60° angle guides: a real cutting mat has them, but here they only
  // crossed the layout as noise (Luke). The grid alone measures.
  // The grid: every (real) centimetre, stronger every five.
  const cmW = gwU * f;
  const cmH = ghU * f;
  const at = (cm: number) => px(cm / f);
  for (let c = 0; c <= cmW + 1e-6; c++) {
    const major = c % 5 === 0;
    g.strokeStyle = major ? "rgba(190, 230, 210, 0.42)" : "rgba(190, 230, 210, 0.17)";
    g.lineWidth = Math.max(0.75, (major ? 3 : 1.5) * (ppc / PX_PER_CM));
    line(ox + at(c), oy, ox + at(c), oy + gh);
  }
  for (let r = 0; r <= cmH + 1e-6; r++) {
    const major = r % 5 === 0;
    g.strokeStyle = major ? "rgba(190, 230, 210, 0.42)" : "rgba(190, 230, 210, 0.17)";
    g.lineWidth = Math.max(0.75, (major ? 3 : 1.5) * (ppc / PX_PER_CM));
    line(ox, oy + at(r), ox + gw, oy + at(r));
  }
  // Millimetre ticks along the edges, the ones you measure from — when a
  // millimetre is wide enough to see (not in the quick frames of a resize).
  if (at(0.1) >= 2) {
    g.strokeStyle = "rgba(220, 240, 230, 0.55)";
    g.lineWidth = 1.5;
    for (let mm = 0; mm <= cmW * 10 + 1e-6; mm++) {
      const len = mm % 10 === 0 ? 0.55 : mm % 5 === 0 ? 0.38 : 0.22;
      const x = ox + at(mm / 10);
      line(x, oy, x, oy - px(len));
      line(x, oy + gh, x, oy + gh + px(len));
    }
    for (let mm = 0; mm <= cmH * 10 + 1e-6; mm++) {
      const len = mm % 10 === 0 ? 0.55 : mm % 5 === 0 ? 0.38 : 0.22;
      const y = oy + at(mm / 10);
      line(ox, y, ox - px(len), y);
      line(ox + gw, y, ox + gw + px(len), y);
    }
  }
  // Numbers along the top and down the left: every centimetre where there is
  // room for one, else every 2, 5 or 10.
  const fontPx = px(0.42);
  const labelEvery = [1, 2, 5, 10].find((n) => at(n) >= fontPx * 1.9) ?? 10;
  g.fillStyle = "rgba(220, 240, 230, 0.7)";
  g.font = `600 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  g.textBaseline = "bottom";
  g.textAlign = "center";
  for (let c = 0; c <= cmW + 1e-6; c += labelEvery) g.fillText(String(c), ox + at(c), oy - px(0.6));
  g.textBaseline = "middle";
  g.textAlign = "right";
  for (let r = 0; r <= cmH + 1e-6; r += labelEvery) g.fillText(String(r), ox - px(0.62), oy + at(r));
  // The maker's mark, bottom-right in the border — and, sized to a weapon,
  // what a sticker measures on it.
  g.fillStyle = "rgba(220, 240, 230, 0.35)";
  g.font = `600 ${px(0.45)}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "middle";
  const mark = f === 1 ? "STICKER CRAFTS  ·  CM" : `STICKER CRAFTS  ·  CM  ·  1 STICKER = ${(STICKER_CM * f).toFixed(1)} CM`;
  g.fillText(mark, ox + gw, oy + gh + px(MARGIN * 0.62));
  return cv;
}

/** A renderer with the board's colour pipeline, its canvas in `container`. */
function makeRenderer(THREE: typeof ThreeNS, container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  canvas.style.userSelect = "none";
  canvas.style.setProperty("-webkit-user-select", "none");
  canvas.style.setProperty("-webkit-touch-callout", "none");
  container.appendChild(canvas);
  return { renderer, canvas };
}

/** The studio's reflections, prefiltered for this renderer. */
function makeEnv(THREE: typeof ThreeNS, renderer: ThreeNS.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = studioEnv(THREE);
  const envTex = pmrem.fromScene(envScene, 0.04).texture;
  envScene.traverse((o) => {
    const m = o as ThreeNS.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as ThreeNS.Material).dispose();
  });
  return { pmrem, envTex };
}

/** The board's light: the reflections, four soft lamps and the overhead one. */
function addLights(THREE: typeof ThreeNS, s: ThreeNS.Scene, envTex: ThreeNS.Texture) {
  s.environment = envTex;
  s.environmentIntensity = 1;
  // Four soft lamps, one over each edge, matching the softboxes: even light
  // with no single direction for a sticker to flare in.
  for (const [x, z, k] of [[0, -1, 0.55], [0, 1, 0.4], [-1, 0, 0.45], [1, 0, 0.45]] as const) {
    const lamp = new THREE.DirectionalLight(0xffffff, k);
    lamp.position.set(x * 30, 26, z * 30);
    s.add(lamp);
  }
  // The overhead lamp's direct share, as off-centre as its softbox.
  const overhead = new THREE.DirectionalLight(0xffffff, 0.35);
  overhead.position.set(12, 55, -10);
  s.add(overhead);
  s.add(new THREE.HemisphereLight(0xeef6f2, 0x1a2a24, 0.55));
}

/**
 * A sticker's material: its art and the real sticker shading at this wear.
 * The ink fractions come back with it, for the group box and framing.
 */
async function stickerMaterial(THREE: typeof ThreeNS, image: string, wear: number) {
  const [loaded, info] = await Promise.all([loadStickerTexture(image), stickerArtInfo(image)]);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    // Every sticker skips the depth buffer, so draw order alone decides which
    // lies on top — the same rule as slot order on a gun.
    depthWrite: false,
    roughness: 0.55,
    metalness: 0,
  });
  let inkW = 1;
  let inkH = 1;
  if (loaded) {
    mat.map = loaded.tex;
    // The glow tints by the sticker's own art. Set now, never later: adding an
    // emissiveMap to a built material recompiles it mid-drag.
    mat.emissiveMap = loaded.tex;
    inkW = loaded.aspect >= 1 ? 1 : loaded.aspect;
    inkH = loaded.aspect >= 1 ? 1 / loaded.aspect : 1;
    await applyStickerSfx(THREE, mat, info.sfx, wear, paintTextureUrl, { expandAlpha: loaded.realStickerArt });
  } else {
    mat.color.set(0x55605c);
  }
  return { mat, inkW, inkH, backing: info.sfx?.backing ?? null };
}

/** Texture resolution of the chalk outline layer. */
const CHALK_PX_PER_CM = 24;
/** Chalk room round the outline on its own layer, in units. */
const CHALK_PAD = 1;
/**
 * A weapon's side outline in chalk, on a canvas the size of the outline (and
 * CHALK_PAD round it): its baked paths (outlineTrace) at the mat's scale — one
 * sticker on the gun is STICKER_CM on the mat — and each slot's default spot as
 * a dashed, numbered sticker square.
 */
function drawChalkOutline(o: WeaponOutline): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const k = CHALK_PX_PER_CM;
  c.width = Math.round((o.w + CHALK_PAD * 2) * k);
  c.height = Math.round((o.h + CHALK_PAD * 2) * k);
  const g = c.getContext("2d")!;
  const X = (u: number) => (u + CHALK_PAD) * k;
  const shape = new Path2D();
  for (const p of o.paths) {
    shape.moveTo(X(p[0]), X(p[1]));
    for (let i = 2; i < p.length; i += 2) shape.lineTo(X(p[i]), X(p[i + 1]));
    shape.closePath();
  }
  // A whisper of fill, so the shape reads at a glance under the stickers.
  g.fillStyle = "rgba(235, 242, 236, 0.05)";
  g.fill(shape, "evenodd");
  // The line, in chalk: dots along it, a little uneven in place and in
  // strength, which is what makes a line read as drawn rather than printed.
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const chalkLoops = (loops: number[][]) => {
    for (const p of loops) {
      const n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const x0 = X(p[i * 2]);
        const y0 = X(p[i * 2 + 1]);
        const x1 = X(p[((i + 1) % n) * 2]);
        const y1 = X(p[((i + 1) % n) * 2 + 1]);
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 1.3));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          g.fillStyle = `rgba(240, 245, 238, ${0.45 + rnd() * 0.45})`;
          g.beginPath();
          g.arc(x0 + (x1 - x0) * t + (rnd() - 0.5) * 1.2, y0 + (y1 - y0) * t + (rnd() - 0.5) * 1.2, 1.1 + rnd() * 0.9, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  };
  chalkLoops(o.paths);
  // Each slot's default spot: a dashed sticker square, numbered.
  const side = STICKER_CM * k;
  g.setLineDash([7, 6]);
  g.lineWidth = 2;
  g.strokeStyle = "rgba(240, 245, 238, 0.55)";
  g.fillStyle = "rgba(240, 245, 238, 0.75)";
  g.font = `600 ${Math.round(k * 1.1)}px sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const a of o.anchors) {
    // At the slot's own sticker size on the chalked gun, when it differs.
    const sq = side * (a.size ?? 1);
    g.strokeRect(X(a.x) - sq / 2, X(a.y) - sq / 2, sq, sq);
    g.fillText(String(a.index + 1), X(a.x), X(a.y));
  }
  // The StatTrak counter, where the editor puts it on this gun: in the same
  // chalk, over everything else (it covers a sticker under it on the gun too),
  // with a firmer wash than the gun's so it reads as a part bolted on — and,
  // where there is room, its name.
  const st = o.stattrak ?? [];
  if (st.length) {
    g.setLineDash([]);
    const counter = new Path2D();
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of st) {
      counter.moveTo(X(p[0]), X(p[1]));
      for (let i = 0; i < p.length; i += 2) {
        counter.lineTo(X(p[i]), X(p[i + 1]));
        bx0 = Math.min(bx0, X(p[i]));
        bx1 = Math.max(bx1, X(p[i]));
        by0 = Math.min(by0, X(p[i + 1]));
        by1 = Math.max(by1, X(p[i + 1]));
      }
      counter.closePath();
    }
    g.fillStyle = "rgba(235, 242, 236, 0.14)";
    g.fill(counter, "evenodd");
    chalkLoops(st);
    const font = Math.min(k * 0.5, (bx1 - bx0) / 7.5, (by1 - by0) * 0.45);
    if (font >= 7) {
      g.fillStyle = "rgba(240, 245, 238, 0.7)";
      g.font = `700 ${Math.round(font)}px sans-serif`;
      g.fillText("STATTRAK", (bx0 + bx1) / 2, (by0 + by1) / 2);
    }
  }
  return c;
}

/** The turn handle's picture: a dark disc with a light rim and a turning arrow. */
function drawTurnHandle(): HTMLCanvasElement {
  const n = 96;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(16, 22, 20, 0.92)";
  g.beginPath();
  g.arc(n / 2, n / 2, n / 2 - 4, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = "#d9e4de";
  g.stroke();
  // Three quarters of a circle, and its head.
  const r = n * 0.24;
  const a0 = -Math.PI * 0.35;
  const a1 = a0 + Math.PI * 1.45;
  g.lineWidth = 7;
  g.lineCap = "round";
  g.beginPath();
  g.arc(n / 2, n / 2, r, a0, a1);
  g.stroke();
  const hx = n / 2 + r * Math.cos(a1);
  const hy = n / 2 + r * Math.sin(a1);
  const t = a1 + Math.PI / 2;
  g.fillStyle = "#d9e4de";
  g.beginPath();
  g.moveTo(hx + Math.cos(t) * 13, hy + Math.sin(t) * 13);
  g.lineTo(hx + Math.cos(t + 2.2) * 11, hy + Math.sin(t + 2.2) * 11);
  g.lineTo(hx + Math.cos(t - 2.2) * 11, hy + Math.sin(t - 2.2) * 11);
  g.closePath();
  g.fill();
  return c;
}

/** A sticker's footprint on the mat — its ink box, turned, at its slot's size
 *  (`size`, see StickerBoard.setSlotSizes) — as an extent about its centre. */
function extent(rot: number, inkW: number, inkH: number, size = 1) {
  const hw = (STICKER_CM * inkW * size) / 2;
  const hh = (STICKER_CM * inkH * size) / 2;
  const a = (rot * Math.PI) / 180;
  return {
    ex: Math.abs(hw * Math.cos(a)) + Math.abs(hh * Math.sin(a)),
    ey: Math.abs(hw * Math.sin(a)) + Math.abs(hh * Math.cos(a)),
  };
}

/** One sticker's scene node: a flat quad. */
type Node = {
  root: ThreeNS.Group;
  mesh: ThreeNS.Mesh;
  /** The INK's share of the footprint, per axis — the art is centred in its
   *  square, so this is what the group box hugs. */
  inkW: number;
  inkH: number;
  /** What the material was last built for; a new image or wear rebuilds it. */
  image: string;
  wear: number;
  /** Bumped per rebuild, so a slow load can't land on a newer one. */
  token: number;
  /** Its slot's size on the chalked gun (setSlotSizes), 1 = STICKER_CM. */
  size: number;
  /** A wear change waits for the slider to settle before it rebuilds. */
  wearTimer?: ReturnType<typeof setTimeout>;
};

export async function mountStickerBoard(container: HTMLElement, cb: BoardCallbacks, start: MatLayout = HOME_LAYOUT): Promise<StickerBoard> {
  const bundle: ThreeBundle = await loadThree();
  const { THREE, OrbitControls } = bundle;

  const { renderer, canvas } = makeRenderer(THREE, container);
  const { pmrem, envTex } = makeEnv(THREE, renderer);

  // The mat: a thin slab, its top face printed, its edges plain. Sized and
  // printed for a layout (MatLayout), which can change under you: `layout` is
  // where it is going, `shown` where it is this frame.
  let layout: MatLayout = start;
  let shown: MatLayout = start;
  /** The texture's resolution for a mat this size: as sharp as a texture may be. */
  const ppcFor = (l: MatLayout) =>
    Math.min(PX_PER_CM, Math.floor(Math.min(4096, renderer.capabilities.maxTextureSize) / (Math.max(l.x1 - l.x0, l.y1 - l.y0) + MARGIN * 2)));
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x10261f, roughness: 0.9 });
  const topMat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  function printMat(l: MatLayout, ppc: number) {
    const tex = new THREE.CanvasTexture(drawMat(l, ppc));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    topMat.map?.dispose();
    topMat.map = tex;
    topMat.needsUpdate = true;
  }
  printMat(shown, ppcFor(shown));
  const slabGeom = new THREE.BoxGeometry(1, 0.3, 1);
  /** A slab over a layout's grid and its ruled border, in world space. */
  const fitSlab = (slab: ThreeNS.Mesh, l: MatLayout) => {
    slab.scale.set(l.x1 - l.x0 + MARGIN * 2, 1, l.y1 - l.y0 + MARGIN * 2);
    slab.position.set((l.x0 + l.x1) / 2 - GRID_W / 2, -0.15, (l.y0 + l.y1) / 2 - GRID_H / 2);
  };

  /** A lit scene holding the mat: the board's, and a snapshot's of its own. */
  const stage = () => {
    const s = new THREE.Scene();
    addLights(THREE, s, envTex);
    const slab = new THREE.Mesh(slabGeom, [edgeMat, edgeMat, topMat, edgeMat, edgeMat, edgeMat]);
    fitSlab(slab, shown);
    s.add(slab);
    return s;
  };
  const scene = stage();
  const mainSlab = scene.children.find((o) => (o as ThreeNS.Mesh).geometry === slabGeom) as ThreeNS.Mesh;

  const camera = new THREE.PerspectiveCamera(35, 1, 1, 600);
  // Each view is a direction to look from; the distance is worked out from the
  // pane's shape, so the whole mat fits whether the window is wide or tall.
  const VIEWS = {
    angled: { dir: new THREE.Vector3(0, 50, 41.5).normalize(), target: new THREE.Vector3(0, 0, 1.5), margin: 1.22 },
    top: { dir: new THREE.Vector3(0, 1, 0.0002).normalize(), target: new THREE.Vector3(0, 0, 0), margin: 1.06 },
  };
  const viewPose = (v: keyof typeof VIEWS) => {
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const matW = layout.x1 - layout.x0 + MARGIN * 2;
    const matH = layout.y1 - layout.y0 + MARGIN * 2;
    const fit = Math.max(matH / 2 / t, matW / 2 / (t * camera.aspect)) * VIEWS[v].margin;
    const target = VIEWS[v].target
      .clone()
      .add(new THREE.Vector3((layout.x0 + layout.x1) / 2 - GRID_W / 2, 0, (layout.y0 + layout.y1) / 2 - GRID_H / 2));
    return { pos: target.clone().addScaledVector(VIEWS[v].dir, fit), target };
  };
  /** The view last asked for — refitted to the mat when the mat changes. */
  let currentView: keyof typeof VIEWS = "angled";

  // The board's own pointer handling is registered BEFORE the controls, so a
  // press that lands on a sticker can switch the controls off before they see
  // it (OrbitControls bails out of a press while disabled) and a wheel that
  // rotates the selection can stop them zooming on the same notch.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const nodes = new Map<string, Node>();
  let order: string[] = [];
  /** The list as last synced, by uid, and which of it is selected. */
  let current = new Map<string, BoardSticker>();
  let selectedNow: ReadonlySet<string> = new Set();
  let disposed = false;
  let dirty = true;
  /** The sticker under the mouse, for the glow. */
  let hoverUid: string | null = null;
  const glow = createStickerGlow<string>();
  /** Added stickers whose flash waits for their material (dress). */
  const flashWhenDrawn = new Set<string>();
  // Breathes under the pointer and while held, as a sticker does on a gun
  // (viewer3d's stepDecalGlow) — not for as long as it is selected: a lit
  // sticker keeps the glow "moving", and that kept the board drawing every
  // frame for as long as anything was picked.
  const held = () => gesture?.kind === "move" || gesture?.kind === "turn" || gesture?.kind === "spin";
  const lit = (uid: string) => uid === hoverUid || (held() && selectedNow.has(uid));
  function* glowing(): Generator<[string, ThreeNS.Mesh]> {
    for (const [uid, node] of nodes) yield [uid, node.mesh];
  }

  const setNdc = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  /** The top-most sticker under the pointer — later in the list wins, as drawn. */
  const hitSticker = (): string | null => {
    const meshes = order.map((uid) => nodes.get(uid)?.mesh).filter((m): m is ThreeNS.Mesh => !!m);
    let best: string | null = null;
    let bestIdx = -1;
    for (const hit of raycaster.intersectObjects(meshes, false)) {
      const uid = hit.object.userData.uid as string;
      const idx = order.indexOf(uid);
      if (idx > bestIdx) {
        bestIdx = idx;
        best = uid;
      }
    }
    return best;
  };
  const boardPoint = (): { x: number; y: number } | null => {
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(boardPlane, p)) return null;
    return { x: p.x + GRID_W / 2, y: p.z + GRID_H / 2 };
  };

  /**
   * What the held pointer is doing.
   *   move  — pressed on a sticker: drag the selection across the mat.
   *   turn  — Shift held: left/right turns the selection about its centre. A
   *           Shift press that never moves is still a Shift-click, settled on
   *           release (`uid` / `wasSelected`).
   *   press — pressed on the empty mat: a click, unless it moves — then a
   *           mouse press becomes `view` (a finger's stays OrbitControls').
   *   view  — a left drag on the empty mat: turn and tilt the view about the
   *           middle of the screen, the way a left drag spins a gun in the item
   *           viewer, so the mat and the gun take the same mouse (right-drag
   *           pans, the wheel zooms — OrbitControls'). Tilting out of Top makes
   *           the view Angled where it is (BoardCallbacks.viewChanged), which is
   *           why it is ours and not OrbitControls' rotate.
   */
  type Gesture =
    | { kind: "move"; id: number; uid: string; from: { x: number; y: number }; moved: boolean }
    /** The turn handle: around the selection's centre `c`, `d` cm out. */
    | { kind: "spin"; id: number; c: { x: number; y: number }; d: number; last: number; total: number; moved: boolean }
    | { kind: "turn"; id: number; x0: number; moved: boolean; uid: string | null; wasSelected: boolean; alt: boolean }
    | { kind: "press"; id: number; x: number; y: number }
    | { kind: "view"; id: number; x: number; y: number; phi0: number };
  let gesture: Gesture | null = null;
  const capture = (id: number) => {
    controls.enabled = false;
    canvas.setPointerCapture(id);
  };
  const release = (id: number) => {
    controls.enabled = true;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };

  const onDown = (e: PointerEvent) => {
    if (gesture) return;
    // The right button is OrbitControls' pan; only the left is ours.
    if (e.button !== 0) return;
    setNdc(e);
    // The turn handle sits over everything, so it is asked first.
    if (handle.visible && raycaster.intersectObject(handle, false).length) {
      const f = selectionFrame();
      const at = boardPoint();
      if (f && at) {
        gesture = { kind: "spin", id: e.pointerId, c: f.c, d: f.d, last: angleAt(f.c, at), total: 0, moved: false };
        capture(e.pointerId);
        return;
      }
    }
    const uid = hitSticker();
    if (e.shiftKey && (uid || selectedNow.size)) {
      const wasSelected = !!uid && selectedNow.has(uid);
      // Pressed on one that isn't picked yet: add it now, so the turn carries it.
      if (uid && !wasSelected) cb.pick(uid, { shift: true, alt: e.altKey });
      gesture = { kind: "turn", id: e.pointerId, x0: e.clientX, moved: false, uid, wasSelected, alt: e.altKey };
      capture(e.pointerId);
      return;
    }
    if (uid) {
      const from = boardPoint();
      cb.pick(uid, { shift: false, alt: e.altKey });
      if (from) {
        gesture = { kind: "move", id: e.pointerId, uid, from, moved: false };
        capture(e.pointerId);
      }
      return;
    }
    gesture = { kind: "press", id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  /** Radians of turn per pixel dragged: a drag the canvas's height is a full turn, as OrbitControls. */
  const turnPerPx = () => (2 * Math.PI) / Math.max(1, canvas.clientHeight);
  const onMove = (e: PointerEvent) => {
    setNdc(e);
    const g = gesture;
    if (g && e.pointerId === g.id) {
      if (g.kind === "move") {
        const at = boardPoint();
        if (!at) return;
        if (!g.moved) {
          g.moved = true;
          cb.dragStart(g.uid);
        }
        cb.drag(at.x - g.from.x, at.y - g.from.y);
      } else if (g.kind === "turn") {
        const dx = e.clientX - g.x0;
        if (!g.moved && Math.abs(dx) < 4) return;
        if (!g.moved) {
          g.moved = true;
          cb.turnStart();
        }
        cb.turn(dx * TURN_PER_PX);
      } else if (g.kind === "press") {
        // A mouse press on the empty mat that moves turns the view. A finger's
        // is OrbitControls' one-finger orbit already.
        if (e.pointerType !== "mouse" || Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5) return;
        land();
        const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
        gesture = { kind: "view", id: g.id, x: e.clientX, y: e.clientY, phi0: sph.phi };
        capture(g.id);
      } else if (g.kind === "view") {
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        g.x = e.clientX;
        g.y = e.clientY;
        const off = camera.position.clone().sub(controls.target);
        const sph = new THREE.Spherical().setFromVector3(off);
        sph.theta -= dx * turnPerPx();
        // Drag down to look more from above, as OrbitControls does.
        sph.phi = Math.min(controls.maxPolarAngle, Math.max(0.0002, sph.phi - dy * turnPerPx()));
        // Out of Top by a few pixels' worth, not by a wobble of the hand.
        if (currentView === "top" && Math.abs(sph.phi - g.phi0) > 0.05) {
          currentView = "angled";
          cb.viewChanged("angled");
        }
        camera.position.copy(controls.target).add(off.setFromSpherical(sph));
        camera.lookAt(controls.target);
        dirty = true;
      } else if (g.kind === "spin") {
        const at = boardPoint();
        if (!at) return;
        const a = angleAt(g.c, at);
        // Accumulated, so a full circle and more is a full circle and more.
        let step = a - g.last;
        if (step > 180) step -= 360;
        else if (step < -180) step += 360;
        g.last = a;
        g.total += step;
        if (!g.moved) {
          g.moved = true;
          cb.turnStart();
        }
        cb.turn(g.total);
        dirty = true;
      }
      return;
    }
    if (e.pointerType === "mouse" && !gesture) {
      if (handle.visible && raycaster.intersectObject(handle, false).length) {
        canvas.style.cursor = "grab";
        hoverUid = null;
        return;
      }
      const hit = hitSticker();
      canvas.style.cursor = e.shiftKey && (hit || selectedNow.size) ? "ew-resize" : hit ? "grab" : "";
      hoverUid = hit;
    }
  };
  const onLeave = () => {
    hoverUid = null;
  };
  const onUp = (e: PointerEvent) => {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return;
    gesture = null;
    if (g.kind === "move") {
      if (g.moved) cb.dragEnd();
      release(e.pointerId);
    } else if (g.kind === "spin") {
      if (g.moved) cb.turnEnd();
      release(e.pointerId);
      dirty = true;
    } else if (g.kind === "view") {
      release(e.pointerId);
    } else if (g.kind === "turn") {
      if (g.moved) cb.turnEnd();
      // A Shift-click on one that was already picked takes it back out.
      else if (g.uid && g.wasSelected && e.type === "pointerup") cb.pick(g.uid, { shift: true, alt: g.alt });
      release(e.pointerId);
    } else if (e.type === "pointerup" && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5) {
      // A press that went nowhere is a click on the empty mat; a finger's that
      // moved was the camera orbiting, and must leave the selection alone.
      cb.pick(null, { shift: e.shiftKey, alt: e.altKey });
    }
  };
  const onWheel = (e: WheelEvent) => {
    if (!e.altKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cb.rotate(e.deltaY > 0 ? 5 : -5);
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  // The right button pans: never the browser's menu (OrbitControls only holds
  // it back while it is enabled, and a turn disables it).
  const onMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener("contextmenu", onMenu);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;
  // The item viewer's mouse: left-drag on the empty mat turns and tilts (the
  // board's own `view` gesture — see Gesture), right-drag pans, the wheel zooms.
  // Touch keeps OrbitControls' own: one finger orbits, two pan and pinch.
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.minDistance = 10;
  controls.maxDistance = 240;
  // Never under the mat: it is a slab on a table, not a model to turn over.
  controls.maxPolarAngle = Math.PI * 0.42;

  // ---- view changes: eased, not cut ---------------------------------------
  /** A camera move in progress: `at` places the camera at eased progress k.
   *  Eased out unless it says otherwise. */
  type Flight = { t0: number; ms: number; at: (k: number) => void; ease?: (t: number) => number; done?: () => void };
  let fly: Flight | null = null;
  const land = () => {
    fly?.done?.();
    fly = null;
  };
  const setView = (v: "angled" | "top") => {
    currentView = v;
    land();
    const fromPos = camera.position.clone();
    const fromTarget = controls.target.clone();
    const to = viewPose(v);
    fly = {
      t0: performance.now(),
      ms: 450,
      at: (k) => {
        camera.position.lerpVectors(fromPos, to.pos, k);
        controls.target.lerpVectors(fromTarget, to.target, k);
      },
    };
  };
  // Grabbing the camera mid-flight hands it over: the flight stops where it is
  // rather than dragging the view back out from under the pointer.
  controls.addEventListener("start", land);

  // ---- stickers -------------------------------------------------------------
  const quadGeom = new THREE.PlaneGeometry(1, 1);
  quadGeom.rotateX(-Math.PI / 2);
  const groupMat = new THREE.LineDashedMaterial({ color: GROUP_LINE, dashSize: 0.5, gapSize: 0.35, depthTest: false, transparent: true });
  const groupLines = new THREE.Group();
  scene.add(groupLines);

  // ---- the chalk outline ------------------------------------------------------------
  // A plane the size of the outline, just above the mat's face and under every
  // sticker, centred on the home grid's middle (world origin) — where the mat
  // is sized round it (StickerCrafts' matLayout). Redrawn per weapon.
  const chalkMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
  const chalk = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), chalkMat);
  chalk.position.y = 0.02;
  chalk.renderOrder = 0;
  chalk.visible = false;
  scene.add(chalk);
  /** The weapon chalked now, for the use-case shot. */
  let outlineNow: WeaponOutline | null = null;
  function setOutline(o: WeaponOutline | null) {
    outlineNow = o;
    chalkMat.map?.dispose();
    chalkMat.map = null;
    chalk.visible = !!o;
    if (o) {
      chalk.geometry.dispose();
      chalk.geometry = new THREE.PlaneGeometry(o.w + CHALK_PAD * 2, o.h + CHALK_PAD * 2).rotateX(-Math.PI / 2);
      const tex = new THREE.CanvasTexture(drawChalkOutline(o));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      chalkMat.map = tex;
    }
    chalkMat.needsUpdate = true;
    dirty = true;
  }

  // ---- the mat's size ----------------------------------------------------------------
  /** A resize in progress: the mat eases from `from` to `to`, its rulers
   *  redrawn each frame at a quick resolution and once, sharp, at the end. */
  let matAnim: { t0: number; from: MatLayout; to: MatLayout } | null = null;
  const MAT_MS = 650;
  const QUICK_PPC = 10;
  const sameLayout = (a: MatLayout, b: MatLayout) =>
    a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1 && a.cmPerUnit === b.cmPerUnit;
  function setLayout(next: MatLayout, refit: boolean) {
    if (sameLayout(next, layout)) return;
    layout = next;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown = next;
      fitSlab(mainSlab, shown);
      printMat(shown, ppcFor(shown));
      matAnim = null;
    } else {
      matAnim = { t0: performance.now(), from: shown, to: next };
    }
    if (refit) setView(currentView);
    dirty = true;
  }
  function stepMat(now: number) {
    const m = matAnim;
    if (!m) return;
    const t = Math.min(1, (now - m.t0) / MAT_MS);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const mix = (a: number, b: number) => a + (b - a) * k;
    shown = t >= 1 ? m.to : {
      x0: mix(m.from.x0, m.to.x0),
      y0: mix(m.from.y0, m.to.y0),
      x1: mix(m.from.x1, m.to.x1),
      y1: mix(m.from.y1, m.to.y1),
      cmPerUnit: mix(m.from.cmPerUnit, m.to.cmPerUnit),
    };
    fitSlab(mainSlab, shown);
    printMat(shown, t >= 1 ? ppcFor(shown) : QUICK_PPC);
    if (t >= 1) matAnim = null;
    dirty = true;
  }
  /** The mat under the middle of the view (see StickerBoard.viewCentre). */
  function viewCentre(): { x: number; y: number } {
    const at = new THREE.Vector3();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = raycaster.ray.intersectPlane(boardPlane, at) ?? controls.target.clone();
    return {
      x: Math.min(layout.x1, Math.max(layout.x0, hit.x + GRID_W / 2)),
      y: Math.min(layout.y1, Math.max(layout.y0, hit.z + GRID_H / 2)),
    };
  }

  // ---- the turn handle ------------------------------------------------------------
  // A round grip above the selection, on a stem from its top edge: drag it round
  // to turn the selection about its centre — what Shift + drag does with a
  // mouse, for a finger that has no Shift. Drawn over everything and kept the
  // same size on screen, so it is a target a thumb can hit at any zoom.
  const HANDLE_PX = 36;
  const HANDLE_GAP_PX = 30;
  const handleTex = new THREE.CanvasTexture(drawTurnHandle());
  handleTex.colorSpace = THREE.SRGBColorSpace;
  const handleMat = new THREE.SpriteMaterial({ map: handleTex, depthTest: false, transparent: true });
  const handle = new THREE.Sprite(handleMat);
  handle.renderOrder = 10_003;
  handle.visible = false;
  scene.add(handle);
  const stemGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const stemMat = new THREE.LineBasicMaterial({ color: GROUP_LINE, depthTest: false, transparent: true, opacity: 0.75 });
  const stem = new THREE.Line(stemGeom, stemMat);
  stem.renderOrder = 10_002;
  stem.visible = false;
  scene.add(stem);
  /** Degrees from +x toward +y (down the mat) — clockwise seen from above. */
  const angleAt = (c: { x: number; y: number }, p: { x: number; y: number }) =>
    (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
  /** World units per CSS pixel at a point, for this camera and pane. */
  const worldPerPx = (p: ThreeNS.Vector3) => {
    const h = Math.max(1, canvas.clientHeight);
    return (2 * camera.position.distanceTo(p) * Math.tan((camera.fov * Math.PI) / 360)) / h;
  };
  /**
   * The selection's turning centre — the mean of its centres, the pivot
   * StickerCrafts turns about — and how far above it (toward the mat's top
   * edge) the handle stands: past the selection's box by HANDLE_GAP_PX.
   */
  function selectionFrame(): { c: { x: number; y: number }; d: number } | null {
    const list = [...selectedNow].map((uid) => current.get(uid)).filter((s): s is BoardSticker => !!s);
    if (!list.length) return null;
    const c = { x: list.reduce((a, s) => a + s.x, 0) / list.length, y: list.reduce((a, s) => a + s.y, 0) / list.length };
    let top = Infinity;
    for (const s of list) {
      const node = nodes.get(s.uid);
      top = Math.min(top, s.y - extent(s.rot, node?.inkW ?? 1, node?.inkH ?? 1, node?.size ?? 1).ey);
    }
    const at = new THREE.Vector3(c.x - GRID_W / 2, 0, top - GRID_H / 2);
    return { c, d: c.y - top + HANDLE_GAP_PX * worldPerPx(at) };
  }
  /** Stand the handle where it belongs this frame: above the selection, or —
   *  mid-turn — swung round with the pointer. */
  function placeHandle() {
    const g = gesture?.kind === "spin" ? gesture : null;
    const f = g ? { c: g.c, d: g.d } : selectionFrame();
    handle.visible = stem.visible = !!f && !!selectedNow.size;
    if (!f || !handle.visible) return;
    // (0, -d) turned clockwise by the turn so far.
    const a = ((g?.total ?? 0) * Math.PI) / 180;
    const hx = f.c.x + f.d * Math.sin(a);
    const hy = f.c.y - f.d * Math.cos(a);
    handle.position.set(hx - GRID_W / 2, 0.3, hy - GRID_H / 2);
    handle.scale.setScalar(HANDLE_PX * worldPerPx(handle.position));
    // The stem runs from the selection's top edge, along the same line.
    const gap = HANDLE_GAP_PX * worldPerPx(handle.position);
    const ex = f.c.x + (f.d - gap) * Math.sin(a);
    const ey = f.c.y - (f.d - gap) * Math.cos(a);
    const pos = stemGeom.getAttribute("position") as ThreeNS.BufferAttribute;
    pos.setXYZ(0, ex - GRID_W / 2, 0.2, ey - GRID_H / 2);
    pos.setXYZ(1, handle.position.x, 0.2, handle.position.z);
    pos.needsUpdate = true;
    stemGeom.computeBoundingSphere();
  }

  const placeholderMat = () =>
    new THREE.MeshBasicMaterial({ color: 0x9fb8ad, transparent: true, opacity: 0.25, depthWrite: false });

  function makeNode(s: BoardSticker): Node {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(quadGeom, placeholderMat());
    mesh.userData.uid = s.uid;
    mesh.scale.set(STICKER_CM, 1, STICKER_CM);
    root.add(mesh);
    scene.add(root);
    return { root, mesh, inkW: 1, inkH: 1, size: 1, image: "", wear: -1, token: 0 };
  }

  /** (Re)build a node's material for its image and wear. */
  async function dress(node: Node, s: BoardSticker) {
    const token = ++node.token;
    node.image = s.image;
    node.wear = s.wear;
    const built = await stickerMaterial(THREE, s.image, s.wear).catch(() => null);
    if (!built) return;
    if (token !== node.token || disposed) {
      built.mat.dispose();
      return;
    }
    (node.mesh.material as ThreeNS.Material).dispose();
    node.mesh.material = built.mat;
    node.inkW = built.inkW;
    node.inkH = built.inkH;
    place(node, current.get(node.mesh.userData.uid) ?? s);
    drawGroups();
    if (flashWhenDrawn.delete(s.uid)) glow.flash(s.uid);
    dirty = true;
  }

  /** Transform a node to its sticker's spot on the mat. */
  function place(node: Node, s: BoardSticker) {
    node.root.position.set(s.x - GRID_W / 2, 0.05, s.y - GRID_H / 2);
    node.root.rotation.y = (-s.rot * Math.PI) / 180;
  }

  /** A dashed box round every group that has a member selected. */
  function drawGroups() {
    for (const l of groupLines.children) (l as ThreeNS.Line).geometry.dispose();
    groupLines.clear();
    const groups = new Map<string, BoardSticker[]>();
    for (const s of current.values()) {
      if (!s.group) continue;
      const list = groups.get(s.group) ?? [];
      list.push(s);
      groups.set(s.group, list);
    }
    for (const members of groups.values()) {
      if (!members.some((m) => selectedNow.has(m.uid))) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const m of members) {
        const node = nodes.get(m.uid);
        const { ex, ey } = extent(m.rot, node?.inkW ?? 1, node?.inkH ?? 1, node?.size ?? 1);
        minX = Math.min(minX, m.x - ex);
        maxX = Math.max(maxX, m.x + ex);
        minY = Math.min(minY, m.y - ey);
        maxY = Math.max(maxY, m.y + ey);
      }
      const pad = 0.4;
      const pts = [
        [minX - pad, minY - pad],
        [maxX + pad, minY - pad],
        [maxX + pad, maxY + pad],
        [minX - pad, maxY + pad],
        [minX - pad, minY - pad],
      ].map(([x, y]) => new THREE.Vector3(x - GRID_W / 2, 0.08, y - GRID_H / 2));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), groupMat);
      line.computeLineDistances();
      line.renderOrder = 10_001;
      groupLines.add(line);
    }
  }

  /**
   * Each slot's sticker size on the chalked gun, as a share of STICKER_CM (the
   * HD body's usual sticker): CS2 sizes stickers per slot and per body — the
   * AWP's legacy body draws slot 2 at scale 20 and the rest at 22, against 19.6
   * on the HD body — and the mat draws a craft's stickers as the gun will.
   * [] = all the same.
   */
  let slotSizes: number[] = [];
  function sync(stickers: BoardSticker[], selected: ReadonlySet<string>) {
    current = new Map(stickers.map((s) => [s.uid, s]));
    selectedNow = selected;
    order = stickers.map((s) => s.uid);
    for (const [uid, node] of nodes) {
      if (current.has(uid)) continue;
      node.token++;
      clearTimeout(node.wearTimer);
      scene.remove(node.root);
      (node.mesh.material as ThreeNS.Material).dispose();
      nodes.delete(uid);
      glow.forget(uid);
      flashWhenDrawn.delete(uid);
      if (hoverUid === uid) hoverUid = null;
    }
    stickers.forEach((s, i) => {
      let node = nodes.get(s.uid);
      if (!node) {
        node = makeNode(s);
        nodes.set(s.uid, node);
      }
      if (node.image !== s.image) void dress(node, s);
      else if (node.wear !== s.wear && setStickerWear(node.mesh.material as ThreeNS.Material, s.wear)) {
        // Live wear (setStickerWear): the scratch repaints as the slider moves.
        node.wear = s.wear;
        dirty = true;
      } else if (node.wear !== s.wear) {
        // A material with no live wear (plain icon art): build a fresh one once
        // the slider stops moving, not one per tick.
        const n = node;
        clearTimeout(n.wearTimer);
        n.wearTimer = setTimeout(() => {
          const now = current.get(s.uid);
          if (now && nodes.get(s.uid) === n && now.wear !== n.wear) void dress(n, now);
        }, 120);
      }
      place(node, s);
      node.mesh.renderOrder = i + 1;
      // Its slot (i) at that slot's size on the chalked gun.
      node.size = slotSizes[i] ?? 1;
      node.mesh.scale.set(STICKER_CM * node.size, 1, STICKER_CM * node.size);
    });
    drawGroups();
    dirty = true;
  }
  function setSlotSizes(sizes: number[]) {
    slotSizes = sizes;
    sync([...current.values()].sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid)), selectedNow);
  }

  // ---- snapshots ------------------------------------------------------------------
  /** Stickers into a scene of their own, at world (x, z) = `at(s)`; and the box round their ink. */
  async function layStickers(into: ThreeNS.Scene, list: CraftSticker[], at: (s: CraftSticker) => { x: number; z: number }, sizes: number[] = []) {
    const made = await Promise.all(list.map((s) => stickerMaterial(THREE, s.image, s.wear).catch(() => null)));
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    list.forEach((s, i) => {
      const built = made[i];
      if (!built) return;
      const p = at(s);
      const mesh = new THREE.Mesh(quadGeom, built.mat);
      const size = sizes[i] ?? 1;
      mesh.scale.set(STICKER_CM * size, 1, STICKER_CM * size);
      mesh.position.set(p.x, 0.05, p.z);
      mesh.rotation.y = (-s.rot * Math.PI) / 180;
      mesh.renderOrder = i + 1;
      into.add(mesh);
      const { ex, ey } = extent(s.rot, built.inkW, built.inkH, size);
      box.minX = Math.min(box.minX, p.x - ex);
      box.maxX = Math.max(box.maxX, p.x + ex);
      box.minY = Math.min(box.minY, p.z - ey);
      box.maxY = Math.max(box.maxY, p.z + ey);
    });
    return { box, dispose: () => made.forEach((m) => m?.mat.dispose()) };
  }
  /**
   * Render a scene top-down onto a canvas of its own, (cx, cz) in the middle
   * and halfW of the mat either side. The drawing buffer is borrowed at the
   * picture's size and handed back with the board redrawn in the same task, so
   * the page never composites a frame of it.
   */
  function shootTopDown(snap: ThreeNS.Scene, cx: number, cz: number, halfW: number, w: number, h: number): HTMLCanvasElement {
    const halfH = halfW / (w / h);
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 300);
    // Screen-up is the mat's top edge (-z), as in the Top view.
    cam.up.set(0, 0, -1);
    cam.position.set(cx, 120, cz);
    cam.lookAt(cx, 0, cz);
    const size = renderer.getSize(new THREE.Vector2());
    const ratio = renderer.getPixelRatio();
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      renderer.render(snap, cam);
      out.getContext("2d")!.drawImage(canvas, 0, 0, w, h);
    } finally {
      renderer.setPixelRatio(ratio);
      renderer.setSize(size.x, size.y, false);
      renderer.render(scene, camera);
    }
    return out;
  }
  /**
   * Render a craft top-down, framed on itself, into a PNG.
   *
   * Its own scene (the same mat, light and reflections), so whatever else is on
   * the board stays out of the picture.
   */
  async function snapshot(list: CraftSticker[]): Promise<Blob> {
    const snap = stage();
    const laid = await layStickers(snap, list, (s) => ({ x: s.x, z: s.y }));
    let { minX, minY, maxX, maxY } = laid.box;
    if (!Number.isFinite(minX)) [minX, maxX, minY, maxY] = [-2.5, 2.5, -2.5, 2.5];
    const aspect = SNAP_W / SNAP_H;
    const pad = 1;
    const halfW = Math.max(SNAP_SPAN_CM / 2, (maxX - minX) / 2 + pad, ((maxY - minY) / 2 + pad) * aspect);
    try {
      return await pngOf(shootTopDown(snap, (minX + maxX) / 2, (minY + maxY) / 2, halfW, SNAP_W, SNAP_H));
    } finally {
      laid.dispose();
    }
  }
  async function useCaseShot(list: CraftSticker[], weapon: string): Promise<Blob | null> {
    const o = outlineNow;
    if (!o || !chalkMat.map) return null;
    const snap = stage();
    // The chalk, shared with the board's (a mesh lives in one scene; its
    // geometry and material can be in many).
    const ch = new THREE.Mesh(chalk.geometry, chalkMat);
    ch.position.y = chalk.position.y;
    snap.add(ch);
    const laid = await layStickers(snap, list, (s) => ({ x: s.x - GRID_W / 2, z: s.y - GRID_H / 2 }), slotSizes);
    try {
      // The weapon's box (centred on the world origin) and the craft, a little room round both.
      const b = laid.box;
      const minX = Math.min(-o.w / 2, b.minX);
      const maxX = Math.max(o.w / 2, b.maxX);
      const minY = Math.min(-o.h / 2, b.minY);
      const maxY = Math.max(o.h / 2, b.maxY);
      const pad = 2;
      const spanW = maxX - minX + pad * 2;
      const spanH = maxY - minY + pad * 2;
      const aspect = Math.min(3.2, Math.max(1.6, spanW / spanH));
      const W = 800;
      const H = Math.round(W / aspect);
      const halfW = Math.max(spanW / 2, (spanH / 2) * aspect);
      const shot = shootTopDown(snap, (minX + maxX) / 2, (minY + maxY) / 2, halfW, W, H);
      // The weapon's name, chalked in the bottom-left corner.
      const g = shot.getContext("2d")!;
      g.font = "600 26px ui-sans-serif, system-ui, sans-serif";
      g.textBaseline = "bottom";
      g.fillStyle = "rgba(240, 245, 238, 0.85)";
      g.shadowColor = "rgba(0, 0, 0, 0.45)";
      g.shadowBlur = 6;
      g.fillText(weapon.toUpperCase(), 18, H - 14);
      return await pngOf(shot);
    } finally {
      laid.dispose();
    }
  }

  // ---- size and loop ------------------------------------------------------------
  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  // The opening pose needs the pane's real shape, which resize has just read.
  //
  // THE WAY IN: the first look at the mat comes down onto it — from high above
  // and further out, turned a little, the camera sinks and swings into the
  // angled view while the mat fades up. Once, at mount; reduced motion lands
  // on the angled view at once, and grabbing the camera stops it where it is.
  {
    const pose = viewPose("angled");
    controls.target.copy(pose.target);
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) camera.position.copy(pose.pos);
    else {
      const end = new THREE.Spherical().setFromVector3(pose.pos.clone().sub(pose.target));
      const from = new THREE.Spherical(end.radius * 1.9, end.phi * 0.2, end.theta - 0.55);
      const at = new THREE.Spherical();
      // It starts beyond the zoom limit; the limit comes back when it lands.
      const maxDistance = controls.maxDistance;
      controls.maxDistance = Infinity;
      fly = {
        t0: performance.now(),
        ms: 1400,
        // In AND out: the start is under the fade, and an eased-out start
        // spent its biggest move where nobody could see it yet.
        ease: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
        at: (k) => {
          at.set(
            from.radius + (end.radius - from.radius) * k,
            from.phi + (end.phi - from.phi) * k,
            from.theta + (end.theta - from.theta) * k,
          );
          camera.position.setFromSpherical(at).add(pose.target);
        },
        // Grabbed mid-flight it may still be past the limit: keep it reachable
        // rather than snapping the camera in under the pointer.
        done: () => (controls.maxDistance = Math.max(maxDistance, camera.position.distanceTo(controls.target))),
      };
      fly.at(0);
      canvas.style.opacity = "0";
      canvas.style.transition = "opacity 500ms ease-out";
      // After the first frame is on the canvas, so the fade shows the mat.
      requestAnimationFrame(() => requestAnimationFrame(() => (canvas.style.opacity = "1")));
    }
    controls.update();
  }

  let raf = 0;
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    stepMat(now);
    if (fly) {
      const t = Math.min(1, (now - fly.t0) / fly.ms);
      fly.at((fly.ease ?? ease)(t));
      if (t >= 1) land();
      dirty = true;
    }
    // update() reports whether damping is still carrying the camera.
    if (controls.update()) dirty = true;
    if (glow.step(now, glowing(), lit)) dirty = true;
    if (!dirty) return;
    dirty = false;
    placeHandle();
    renderer.render(scene, camera);
  };
  controls.addEventListener("change", () => (dirty = true));
  raf = requestAnimationFrame(frame);
  // A dead context draws nothing ever again: stop, and let the caller remount.
  const onContextLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    raf = 0;
    cb.contextLost();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  return {
    sync,
    setView,
    snapshot,
    useCaseShot,
    view: () => currentView,
    flash(uids) {
      for (const uid of uids) flashWhenDrawn.add(uid);
    },
    viewCentre,
    setOutline,
    setLayout,
    setSlotSizes,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("contextmenu", onMenu);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      controls.dispose();
      // Only what this board made. The sticker textures belong to the shared
      // cache in viewer3d and the weapon viewers are still using them.
      for (const node of nodes.values()) {
        clearTimeout(node.wearTimer);
        (node.mesh.material as ThreeNS.Material).dispose();
      }
      for (const l of groupLines.children) (l as ThreeNS.Line).geometry.dispose();
      quadGeom.dispose();
      groupMat.dispose();
      handleTex.dispose();
      handleMat.dispose();
      chalkMat.map?.dispose();
      chalkMat.dispose();
      chalk.geometry.dispose();
      topMat.map?.dispose();
      stemGeom.dispose();
      stemMat.dispose();
      slabGeom.dispose();
      topMat.dispose();
      edgeMat.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
