# Changelog

Changes in the LCrew fork of `lukepolo/5stack-inventory-plugin`, all made on 2026-10-20.
The 3D model extraction is now at pipeline version 37; run it once to get every asset listed below.

## Crafting & Editing

### Features

- **StatTrak kill count in the editor**: the craft editor shows the item's kill count under the StatTrak switch, and the 3D preview shows it on the module. It is read-only: only the game server writes kills.
- **Craftable C4**: the C4's Craft tab now offers the plain C4, which takes stickers, a charm and a name tag. Items with no finishes, the C4 included, are no longer offered a float, pattern or StatTrak they can't have.
- **Glove pattern control**: every painted glove gets the same pattern tools as weapons: type a number, roll the dice, scrub the rail with a live 3D preview, and "Compare with another". Newer (Gen2) finishes whose artwork moves with the pattern also get Placement bars (Shift X, Shift Y, Rotation).
- **Knife and glove Craft tab by model**: every finish is still one scroll, now grouped by model with a header per model that stays pinned while you're in it. A rail of model silhouettes above the grid scrolls sideways, follows where you are, and jumps to a model on a click; a Jump menu beside it lists every model with a filter. Cards carry the grey model label and the price, like owned cards.
- **Leaner Replace list**: Replace lists only the base weapons that can take the slot on that side and aren't already in the loadout.
- **Reorder stickers**: drag sticker tiles onto each other to change slot order, which decides which sticker is drawn on top. A moved sticker stays where it was on the weapon.
- **Music kit preview in the editor**: Edit on a music kit plays the full song and, separately, its round-MVP anthem, each with play/pause and seek. One volume control sits above both and shares the level with every other player.
- **One volume bar per music kit list**: the music kit sheet's Owned and Craft tabs have a single volume control in the toolbar instead of a slider on every card.
- **Precise sticker dragging**: a sticker picked up in the 3D editor keeps the point where you grabbed it. Small nudges no longer jump the sticker's centre to the pointer.

### Removed

- The stock T and CT knives are no longer listed as crafts; they remain the knife slot's default.
- Replace no longer shows a second "Owned" tab of skins.

### Bug Fixes

- Editing or duplicating an owned item keeps its finish's float range. Owned Dopplers could be dragged to 1.00, and the save then failed.
- Craft & Equip defaults to the team you are crafting from instead of "Both teams".
- The glove Craft list no longer includes ten gloves nobody can own: the eight bare models and the two stock pairs.

## 3D Viewer & Lighting

### Features

- **CS2 lighting preset (new default)**: neutral daylight and the main menu's blue-grey haze, measured against in-game inspect screenshots. Items no longer come out pink-tinted and dull.
- **CS2 scene presets**: Ancient (night), Italy and Italy (alley) place the item in front of a blurred in-game screenshot of the map. The same image lights the item's reflections.
- **Knife StatTrak counter**: the kill count is scratched into the blade as in game, at each knife's exact spot from the game's own attachment data. The digits use the game's own cut-out texture and stay sharp however close you zoom.
- **C4 name tag**: the name label sits over the top of the C4's LCD, on top of any stickers, as in game.
- **Live holo and lenticular stickers**: in the 3D viewer, holo colours and lenticular frames follow the camera angle the way the game computes them, with a light fixed to the camera and a faint glint. Nothing moves unless the camera does, and a lenticular shows one clean frame at a time.
- **Sticker masks**: stickers are hidden wherever the game hides them, such as under the C4's LCD module, wires and tape.
- **Live Gen2 glove patterns**: on the 22 newer glove finishes, the 3D model repaints as you change the pattern. First-person arms wear the equipped glove's pattern too.
- **Charm detail textures**: charms with a detail layer now show it, such as the pattern-coloured triangle in 8 Ball IGL's window.
- **Butane Buddy fill level**: the liquid level follows the pattern, from 45% to 80% full and repeating every 1,000 patterns, as the game's material defines it.
- **C4 in 3D**: the C4 has a 3D model with its sticker slots and charm position.

### Bug Fixes

- In Safari, Doppler, Gamma Doppler, Marble Fade and other region-painted finishes showed the bare weapon on 23 models, including the Bayonet, Butterfly Knife, M9 Bayonet and AWP. Safari empties a fully transparent image on its way to the GPU, which is how those models' paint-region masks are stored, so Safari now decodes them byte-exact itself.
- The Butane Buddy's liquid filled the whole ball once the camera was turned to look down at the gun. It now settles against the same gravity the charm hangs by, so the fill stays level and sloshes as you turn the gun.
- Holo and lenticular stickers had their effect layers upside down and offset, and holo colour was stuck on a single band. Lenticular stickers such as Econometer now show the right frame.
- Legacy-body finishes such as AK-47 | Redline dropped the fourth sticker on the handguard.
- Foil, gold and other metal stickers came out flat grey or the wrong colour; hovering one brought the colour back. They now keep their artwork's colours, and gold stickers turn gold, matching the game's own icons.
- Every sticker rendered fully matte, so foil and gold never reflected the light, and stickers with deep relief (Bolt Charge (Foil)) threw white spikes at some angles. Both came from reading the sticker's normal and roughness texture in the game's packed format after the extractor had already unpacked it.
- Newer (Gen2) glove patterns sat in the wrong place: Specialist Gloves | Blackbook #30 showed a different part of the artwork than in game. The pattern is now placed as the game places it, checked against an in-game #30.
- Knife name tags lay diagonally across the handle (Karambit) or stood on edge (Bayonet). They now lie flat along the handle.
- Older glove finishes drew no print: Crimson Web had no web, and the DDPAT, kimono, snakeskin, leopard and Fade prints were missing.
- Eight weapon finishes drew their pattern two to four times too large, including P90 | Death by Kitty, M4A4 | Jungle Tiger and Nova | Tempest.
- AWP | LongDog's body rendered near-black because finishes with their own material mask ignored it. This also fixes Desert Eagle | Heat Treated's grip colour.
- 23 community charms, such as Lil' Happy, had their artwork upside down. The 22 Dr. Boom charms were drawn side-on.

## Cards & Asset Cache

### Features

- **Glove model cards**: the eight bare glove models get cards baked from their 3D model, kept in the shared card store.

### Bug Fixes

- Editing an item's stickers or charm now re-renders its card. Card files were named only by wear, pattern and StatTrak, so moving, swapping or scratching a sticker kept the old picture until the cache was cleared.
- A card whose paint failed to load, or which came out black, is retried instead of stored. This caused the Driver Gloves card to be black.
- Paint composites saved to the shared store before the Safari fix are no longer used, since Safari could have stored a bare weapon for a Doppler there.

## Performance

### Bug Fixes

- Scrubbing glove patterns no longer stutters: each repaint went from 60–100 ms to about 1 ms with identical output.

## Model Extraction

### Features

- **v34, sticker masks**: each weapon body's sticker mask is extracted, which is what hides stickers under modelled parts.
- **v35, charm detail textures**: each charm material's detail layer and its placement are recorded, and the texture is extracted.
- **v37, MVP anthems**: each music kit's round-MVP anthem is extracted beside its menu theme, with its own manifest.
- **v36, StatTrak art and knife data**: the knife digit texture is extracted with its cut-out channel intact. Every knife's attachment points and bone chain are written out as the source for knife counter and name tag placement.
- **C4 model**: the extraction publishes the C4 model with its sticker slots and charm surfaces.

## Backend & API

### Features

- **StatTrak count**: craft and edit accept a StatTrak kill count, capped at six digits. An edit that leaves it out keeps the count the game server maintains.
- **MVP anthem**: music kits in the catalog and inventory carry an `mvpAudio` URL next to `audio`, once the mount has the anthems.
- **Base model on listings**: knife and glove catalog listings carry their base model's id, name and image.
- **Sticker masks endpoint**: the sticker bounds endpoint returns each weapon body's sticker mask.
- **Bake lighting**: the catalog reports which lighting the server bakes cards under. Charm shading data includes detail textures.

## Dev Tooling & Deployment

### Features

- **Debugging guide**: `docs/DEBUGGING.md` explains where the ground truth lives and how each class of rendering and placement bug was diagnosed. It also covers the tools below.
- **Test tools**: `mount.html` renders any item with any options from the URL, `tools/standalone` runs the real UI against a fake inventory, and `glb-info`/`knife-anchors` read and apply the game's model data.
- **Safari test runner**: `shoot-webkit.mjs` renders the same test pages in Safari's engine (WebKit) headlessly, for bugs that only Safari shows.
- **Live camera drags**: `drag.mjs` turns the camera with the mouse after a viewer has loaded and screenshots each step, for bugs that only appear once the view moves.

### Removed

- The upstream workflow that publishes Docker images is disabled in the fork.

### Bug Fixes

- The headless render runner (`shoot.mjs`) now deletes its temporary Chrome profile and finishes as soon as the page is done. Leftover profiles had grown to several gigabytes.
