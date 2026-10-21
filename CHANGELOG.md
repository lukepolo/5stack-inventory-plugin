# Changelog

Changes in the LCrew fork of `lukepolo/5stack-inventory-plugin`, all made on 2026-10-20.
The 3D model extraction is now at pipeline version 39; run it once to get every asset listed below.

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
- **Agent pose and motion in the sidebar**: an agent's pose (Ready, Stand, Open) moved from the top-left corner of the 3D view into the right-hand column, like the pet's controls. A new Motion setting makes the agent breathe and look around (Idle), move through all three poses in turn (Cycle), or hold still for placing patches (Still).
- **Precise sticker dragging**: a sticker picked up in the 3D editor keeps the point where you grabbed it. Small nudges no longer jump the sticker's centre to the pointer.

### Removed

- The stock T and CT knives are no longer listed as crafts; they remain the knife slot's default.
- Replace no longer shows a second "Owned" tab of skins.

### Bug Fixes

- Editing or duplicating an owned item keeps its finish's float range. Owned Dopplers could be dragged to 1.00, and the save then failed.
- Craft & Equip defaults to the team you are crafting from instead of "Both teams".
- On a short window the item details panel ran down over the 3D view's first-person and screenshot buttons, StatTrak under the toggle. The panel now ends above them and scrolls.
- A charm's pattern in the details panel's Applied list sat on a line of its own, reading as one more attachment. It now sits under the charm's name.
- The focus view of a default-finish weapon showed Float and Pattern as "—", with a line across the bottom of the 3D view. A default finish has neither, so the row is gone.
- The glove Craft list no longer includes ten gloves nobody can own: the eight bare models and the two stock pairs.
- While editing, the item's name and estimated value sat on the very corner of the 3D view. They now stand clear of the edge, as in the focus view.

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

- In first person the agent's sleeve wore the equipped glove's finish up to the elbow. Only the gloves take the finish now, and the sleeve keeps the agent's own look.
- Stickers and charms disappeared in first person. They stay on the gun now, hidden only where the hand covers them, and a charm swings as the gun moves through reloads and shots.
- A placed charm hung about a centimetre from where the game draws it. On the AK-47 a charm the game hangs in the hole under the receiver hung from the receiver's edge. Charm offsets are now mapped exactly like the game's own charm surfaces, so the 3D view shows the charm where the game will.
- A charm could be dragged anywhere on a gun, the trigger included. Dragging now keeps it on the surfaces the game allows a charm (its authored charm surfaces, lit up while you drag); pointing elsewhere slides it to the nearest allowed spot.
- In first person a sticker on a moving part stayed behind when the part moved: the AK-47's magazine sticker hung in the air during a reload. A sticker now moves with the part it is on.
- The first-person reload threw the magazine around: on the AK-47 it spun 180 degrees and back and flew 20-28 inches from the gun, away from the hand holding it. Guns now take their moving parts from the first-person clip itself, so the magazine stays in the hand from the pull to the insert.
- The C4 was held like a rifle in first person, with a rifle's reload and shot. It now plays its own draw, idle and inspect, after the next run of the first-person animation step (see Model Extraction).
- First person offered Fire and Reload for items that can do neither. The buttons now match the item: the C4 is inspected and drawn only, the Zeus fires but has no reload, and knives have no fire or reload. An agent opened after holding a weapon no longer gets the weapon's buttons.
- In first person the C4's name tag hung in the air off the bomb's end. Name tags and StatTrak modules now sit on the held weapon where they sit in the item view; a Butterfly Knife's plate no longer hangs below its handle either.
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

- **True sizes on the models mount**: Asset Cache lists the compressed copies and the 2048 px input copies in their own rows and gives the mount's size without them. Rows whose files have a compressed copy also say what they cost to download, such as the models' "sent as" size.
- **Glove model cards**: the eight bare glove models get cards baked from their 3D model, kept in the shared card store.
- **Smaller cards**: new cards are stored as WebP, about a tenth of the size of the PNG they replace, so the inventory grid loads much faster with no visible difference. Cards already stored keep showing as they are, and cards baked in Safari are converted by the server.

### Bug Fixes

- Switching "Verify composites" off in the Developer tab left it on, so that browser compared paint composites with the shared store but never saved any. Off now means off.
- Editing an item's stickers or charm now re-renders its card. Card files were named only by wear, pattern and StatTrak, so moving, swapping or scratching a sticker kept the old picture until the cache was cleared.
- A card whose paint failed to load, or which came out black, is retried instead of stored.
- A tab left open while a model extraction finished showed "Render SAVED (backend OK) but /renders/ doesn't serve it back" and went on baking cards from the previous models under the new version's name. The server now refuses those cards, and the tab stops baking and asks for a reload. This caused the Driver Gloves card to be black.
- Paint composites saved to the shared store before the Safari fix are no longer used, since Safari could have stored a bare weapon for a Doppler there.

## Performance

### Features

- **Compressed models and data**: the plugin's web server compresses 3D models, animations and other data files, and sends the extraction's ready-made compressed copies when they exist. An AK-47's model goes from 3.3 MB to 1.1 MB on the wire, and its inspect animation from 273 KB to 32 KB.
- **Lighter HD skin downloads**: HD gun finishes load their weapon textures at 2048 instead of 4096 pixels where the skin is drawn at 2048 anyway, so an AK-47 skin fetches about 10MB instead of 35MB with no visible difference. Spray-paint and airbrushed finishes keep the full-size textures on desktop, where they are drawn at 4096.
- **Lighter first load**: the 3D viewer, the editor's pattern rails, the item spec panel, the Craft catalog and the sticker and charm picker now download when first used instead of at startup. Before any 3D view opens, the plugin loads about a third less code (218 kB compressed instead of 335 kB).
- **Faster first 3D view**: the default CS2 lighting no longer waits for the studio lighting file, and the 3D engine downloads alongside the viewer instead of after it. Opening the first item in 3D downloads about 1 MB less.
- **Smaller studio lighting**: the lighting behind the Studio, Showcase, Warm and Dark presets is 371 kB instead of 1.4 MB, and is fetched only when one of them is in use. Test renders are unchanged to within 1 level in 99% of pixels.
- **3D views load ahead of the click**: resting the pointer on an item card starts downloading what its 3D view needs, so a Bayonet | Doppler then opens in Edit in 0.7 s instead of 2 s on a 100 Mbit/s connection. Moving off the card before a download starts cancels it.
- **Edit starts every download at once**: pressing Edit or View in 3D fetches the model, its textures and the paint together, instead of one after another as the viewer reaches each.
- **Equipped items warm in the background**: once the loadout has loaded, the equipped items' 3D models are fetched while the page is idle, up to a fixed memory budget. Not on phones, where it would spend mobile data nobody asked for.
- Prefetching stays out of the way: it is off under Save-Data and on 2G, and pauses while the tab is hidden or a 3D view is loading. The large paint inputs are only fetched once Edit or View in 3D is pressed, never on hover.

### Bug Fixes

- Scrubbing glove patterns no longer stutters: each repaint went from 60–100 ms to about 1 ms with identical output.
- Models, EXR maps, HDR lighting and WAV music kits are served with their real file types instead of as unknown binary data.
- When the web server had to hand a file to the backend, unversioned models and textures were kept by browsers for a year, and a re-check downloaded the whole file. They are now re-checked like everywhere else, with a tiny "not modified" answer, and first-person animations and projected-finish position maps no longer come back missing on that path.

## Model Extraction

### Features

- **v34, sticker masks**: each weapon body's sticker mask is extracted, which is what hides stickers under modelled parts.
- **v35, charm detail textures**: each charm material's detail layer and its placement are recorded, and the texture is extracted.
- **v37, MVP anthems**: each music kit's round-MVP anthem is extracted beside its menu theme, with its own manifest.
- **v39, lighter assets**: composite inputs larger than 2048 pixels get a 2048 copy beside the original, and every model and data file gets a gzip copy. No existing file changes, so older clients keep loading what they always did.
- **v36, StatTrak art and knife data**: the knife digit texture is extracted with its cut-out channel intact. Every knife's attachment points and bone chain are written out as the source for knife counter and name tag placement.
- **C4 model**: the extraction publishes the C4 model with its sticker slots and charm surfaces.
- **C4 first-person clips**: the animation step takes the C4's own clips (the game keeps them under equipment, not with the guns). A re-run also removes clips an action no longer has, and a one-weapon run keeps every other weapon's entry in the clip index.

## Backend & API

### Features

- **StatTrak count**: craft and edit accept a StatTrak kill count, capped at six digits. An edit that leaves it out keeps the count the game server maintains.
- **MVP anthem**: music kits in the catalog and inventory carry an `mvpAudio` URL next to `audio`, once the mount has the anthems.
- **Base model on listings**: knife and glove catalog listings carry their base model's id, name and image.
- **Sticker masks endpoint**: the sticker bounds endpoint returns each weapon body's sticker mask.
- **Bake lighting**: the catalog reports which lighting the server bakes cards under. Charm shading data includes detail textures.
- **WebP cards**: card uploads accept WebP as well as PNG, checked by their magic bytes, and a PNG upload is converted to WebP when `cwebp` is installed. The catalog lists the accepted formats as `cardFormats`, and a card is served in whichever format is stored, under the same `.png` URL.

## Dev Tooling & Deployment

### Features

- **Debugging guide**: `docs/DEBUGGING.md` explains where the ground truth lives and how each class of rendering and placement bug was diagnosed. It also covers the tools below.
- **Test tools**: `mount.html` renders any item with any options from the URL, `tools/standalone` runs the real UI against a fake inventory, and `glb-info`/`knife-anchors` read and apply the game's model data.
- **Safari test runner**: `shoot-webkit.mjs` renders the same test pages in Safari's engine (WebKit) headlessly, for bugs that only Safari shows.
- **Live camera drags**: `drag.mjs` turns the camera with the mouse after a viewer has loaded and screenshots each step, for bugs that only appear once the view moves.
- **Caching guide**: `docs/CACHING.md` explains how files are cached and compressed, how to check it, and how to add an optional Cloudflare cache rule safely.
- **Card store in the mock server**: `tools/standalone` keeps baked cards (`CARDS_DIR` saves them between runs) and can play a backend from before WebP cards (`MOCK_CARD_FORMATS=png`).
- **Composite store in the standalone mock**: `tools/standalone/mock-server.mjs` accepts composite uploads after checking their names the way the backend does, and serves them back.
- **Bundle report**: `tools/bundle-report.config.ts` builds the plugin and lists what each chunk contains and what loads with it.
- **Prefetch switches**: **Prefetch log** in the Developer tab logs every prefetch and whether the viewer used it, and **No prefetch** turns prefetching off to time a cold open.
- **Load-time testing in the standalone UI**: `MOCK_CARDS=stub` stops the card backfill, whose bakes would otherwise pre-load the model being timed. The mock keeps the paint composites it is sent, so a second session opens with a store hit, and `MOCK_COMPOSITES=keep` also reads the dev server's store for the rest.

### Removed

- The upstream workflow that publishes Docker images is disabled in the fork.

### Bug Fixes

- The headless render runner (`shoot.mjs`) now deletes its temporary Chrome profile and finishes as soon as the page is done. Leftover profiles had grown to several gigabytes.
- The hot-swap dev server answered a refresh on any page below the plugin (such as `/admin`) with an error instead of the app.
