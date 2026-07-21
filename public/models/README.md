# 3D weapon models

Models are NOT bundled — they're served from a hostPath mount on the node:

    /opt/5stack/models/cs2-model-extract   →   /cs2-models (in the frontend pod)

`/models/<cs2-lib model key>.glb` is aliased to `<mount>/models/` (the renamed
output of `scripts/extract-models.sh`). If the mount is missing or empty every
lookup 404s and the UI simply never shows a 3D toggle — that's the gate.

The same mount also carries the skin paint chain at `<mount>/paints/` and econ
item icons at `<mount>/images/`, both extracted from this instance's own CS2
install. `/paints/*` and `/images/*` serve them. There is **no upstream
fallback**: a file that isn't on the mount 404s, and the viewer reports it.

The extraction also emits `<key>.inputs/` per weapon (composite input
textures: cavity/AO/noPaint, paint-by-number masks, base color, base
rough/metal + `meta.json`). The 3D viewer's CS2-exact paint compositor uses
these so worn skins reveal the weapon's true base textures; without them it
falls back to generic defaults (still renders, just generic gunmetal under
the wear).

To refresh models: rerun `scripts/extract-models.sh` on the node and copy
`cs2-model-extract/models/` into `/opt/5stack/models/cs2-model-extract/models/`.
No image rebuild or deploy needed — nginx/serve read the mount directly.
NOTE (2026-07-18): rerunning the extraction is required once to get the new
`.inputs/` bundles — until then the compositor runs on CDN defaults.
