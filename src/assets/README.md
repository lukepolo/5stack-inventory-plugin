# Bundled viewer assets

## `venice_sunset_512.hdr`

The 3D viewer's studio lighting environment (the Studio, Showcase, Warm and
Dark rigs, and every card bake). **CC0** (public domain) from Poly Haven —
<https://polyhaven.com/a/venice_sunset> — fetched from `dl.polyhaven.org`, not
from anyone's site who happens to also use it.

It is here rather than on the models mount because it is not a CS2 asset: the
extraction pipeline mirrors what is in the game install, and this is a lighting
choice. 371kB, 512x256 Radiance HDR: Poly Haven's 1k file (1024x512, 1.4MB)
halved with a 2x2 box filter in linear light by `tools/hdr-half.py`, which
reproduces it byte for byte. The viewer widens it back to 1024 before it
prefilters it (`upsampleStudioHdr` in `src/viewer3d.ts`); measured on card
bakes against the 1k file, 99% of the item's pixels moved by at most 1 level
(of 255) and at most 0.02% by more than 2. Re-measure any change to it the same
way (docs/DEBUGGING.md, §4.15).

It is fetched only by a viewer whose rig reflects it. The default CS2 rig lights
by its own painted sky and never downloads it.

**Why this one specifically.** It is the environment csgoskins.gg light their
viewer with (read out of their bundle's scenery table alongside
`environmentIntensity` 0.8 and `environmentRotation` (0, 3.8, 0)), and their
renders are the ones that match what CS2 shows. Metal is nothing but an
environment reflection — three's `RoomEnvironment` is a flat neutral box, so
chrome rendered against it comes out flat grey no matter how correct the
metalness is. See `tools/shadertest/BUTANE-BUDDY.md`.
