/**
 * A sentinel a caller can compare against without loading the viewer.
 *
 * `snapshotModel` can answer "the assets aren't on the mount yet", and every
 * caller of it tests the result against this symbol. Identity is the whole
 * mechanism, so it has to be ONE symbol — which is why it can't simply be
 * re-declared on the light side of ./viewer3dLazy. It lives alone here instead,
 * imported by both sides, so a `blob === INCOMPLETE` in App.vue costs nothing
 * and viewer3d.ts still exports the same value it always did.
 */

/** "The assets aren't on the mount yet" — the render would be a white gun.
 *  Distinct from null (a real failure) so callers can keep the item queued and
 *  show a pending state instead of caching a wrong picture forever. */
export const INCOMPLETE = Symbol("incomplete");
