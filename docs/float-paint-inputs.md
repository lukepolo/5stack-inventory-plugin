# Floating-point paint inputs

Source2Viewer exports floating-point position maps as OpenEXR. These are numeric
inputs whose precision must survive extraction, so the stage preserves their bytes and
writes `.exr` material references. Ordinary images still use the existing
`cwebp -exact -lossless` path.

Existing EXRs are reused on later runs. A legacy file containing EXR bytes under
a `.webp` name is copied to the correct name without modifying the live inode.
The reference changes only after the file is published. A failed float copy
stops extraction before materials can advertise a missing new input.

The frontend's generic sampler loader accepts EXR too: runtime position
overrides can have a shader name other than `g_tPosition`. It uses the existing
row correction, preserves sampler addressing, and defaults ordinary position
maps to linear data with clamped addressing. The backend fallback serves EXR
when the frontend pod cannot see the mount.

Pipeline version 35 requests regeneration of old paint output. Deploy the
frontend loader and backend together, then complete a full extraction to earn
the version stamp. Scoped development runs must not stamp completion.

`npm run check:paint-inputs` exercises the actual extraction functions, texture
loaders, and fallback route. It checks float byte preservation, cache migration,
hardlink safety, failure handling, row order, sampler state, and HTTP responses.

The three previously missing overrides in the tested archive are 1024-square
EXRs with values in 0..1. They remain floating-point data: normalization or an
8-bit conversion is unnecessary and would change their precision. Synthetic
loader fixtures also exercise negative values and values above one.

Format references: [OpenEXR file layout](https://openexr.com/en/latest/OpenEXRFileLayout.html)
and [Three.js EXRLoader](https://threejs.org/docs/pages/EXRLoader.html).
