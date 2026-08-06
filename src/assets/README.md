# Bundled viewer assets

## `venice_sunset_1k.hdr`

The 3D viewer's lighting environment. **CC0** (public domain) from Poly Haven —
<https://polyhaven.com/a/venice_sunset> — fetched from `dl.polyhaven.org`, not
from anyone's site who happens to also use it.

It is here rather than on the models mount because it is not a CS2 asset: the
extraction pipeline mirrors what is in the game install, and this is a lighting
choice. 1.4MB, 1024x512 Radiance HDR.

**Why this one specifically.** It is the environment csgoskins.gg light their
viewer with (read out of their bundle's scenery table alongside
`environmentIntensity` 0.8 and `environmentRotation` (0, 3.8, 0)), and their
renders are the ones that match what CS2 shows. Metal is nothing but an
environment reflection — three's `RoomEnvironment` is a flat neutral box, so
chrome rendered against it comes out flat grey no matter how correct the
metalness is. See `tools/shadertest/BUTANE-BUDDY.md`.
