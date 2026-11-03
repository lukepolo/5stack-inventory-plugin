// The sticker glow, shared by the two places a sticker is handled in 3D: the
// item viewer's decals and the Sticker Crafts mat, so a sticker you can grab
// looks the same in both.
//
// Two effects on one channel (the sticker's emissive, tinted by its own art via
// emissiveMap), because they are the same pixel and must never fight over it:
// the FLASH announces a newly placed sticker against a loud paint, and the PULSE
// breathes on the sticker you are over or holding, so you can see what a press
// would grab before you press it. Purely visual — neither touches the saved
// placement, and the level always returns to 0 so a sticker cannot be left
// glowing.
//
// The material must be built with `emissiveMap` set to its own map and its
// emissive at 0: adding an emissiveMap later recompiles the program mid-drag.
import type * as ThreeNS from "three";

const FLASH_MS = 1100;
// Peak of the hover breath. Reads as a light source on the sticker rather than
// a tint on it — a subtler version was there first and got lost against a
// bright finish, which is exactly when you most need to know what you're about
// to grab. The trough is deliberately well below the peak (see below) so it
// pulses instead of just sitting bright.
const HOVER_GLOW = 1.15;
const HOVER_PERIOD_MS = 900;
/** Seconds to close the gap to the target level — a fade, so moving the
 *  pointer across a row of stickers reads as a sweep rather than a strobe. */
const GLOW_FADE = 0.11;

export interface StickerGlow<K> {
  /** Three quick pulses on this sticker, fading out. */
  flash(key: K): void;
  /** Forget a sticker that is gone: a flash outlives its mesh otherwise, and
   *  would then re-target whatever lands under the same key. */
  forget(key: K): void;
  /**
   * Advance every sticker's glow to `now` (performance.now()). `lit` says which
   * ones breathe. Returns true while anything is still changing — a caller that
   * draws only on demand keeps drawing until it is false.
   */
  step(now: number, stickers: Iterable<[K, ThreeNS.Mesh]>, lit: (key: K) => boolean): boolean;
}

export function createStickerGlow<K>(): StickerGlow<K> {
  const flashing = new Map<K, number>(); // key -> start timestamp
  const level = new Map<K, number>(); // key -> current emissive intensity
  let last = 0;
  return {
    flash: (key) => void flashing.set(key, performance.now()),
    forget(key) {
      flashing.delete(key);
      level.delete(key);
    },
    step(now, stickers, lit) {
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      let moving = false;
      for (const [key, mesh] of stickers) {
        const mat = mesh.material as ThreeNS.MeshStandardMaterial | undefined;
        if (!mat?.emissive) continue;
        let target = 0;
        const start = flashing.get(key);
        if (start != null) {
          const t = (now - start) / FLASH_MS;
          if (t >= 1) flashing.delete(key);
          // Three quick pulses that fade out over the flash's life.
          else target = Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) * 0.9;
        }
        if (lit(key)) {
          target = Math.max(target, HOVER_GLOW * (0.45 + 0.55 * (0.5 - 0.5 * Math.cos((now / HOVER_PERIOD_MS) * Math.PI * 2))));
        }
        if (start != null || lit(key)) moving = true;
        const cur = level.get(key) ?? 0;
        // Exponential approach, frame-rate independent: the same fade at 30fps
        // and at 144fps.
        const next = dt > 0 ? cur + (target - cur) * (1 - Math.exp(-dt / GLOW_FADE)) : target;
        if (next < 0.002 && cur < 0.002) {
          if (cur !== 0) {
            level.set(key, 0);
            mat.emissive.setScalar(0);
            mat.emissiveIntensity = 1;
          }
          continue;
        }
        moving = true;
        level.set(key, next);
        mat.emissive.setScalar(1);
        mat.emissiveIntensity = next;
      }
      return moving;
    },
  };
}
