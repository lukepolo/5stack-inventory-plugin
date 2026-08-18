# Open follow-ups

Parked work with enough context to pick up cold. Not a backlog of ideas — only
things that are half-done, blocked on a specific check, or deliberately deferred.

---

## Sticker rotation: confirm the flip in game, then apply the per-slot base angle

**Status: code landed, one in-game check outstanding.**

### What was wrong, and what changed

A craft that looked right in the panel came out of the in-game inspect rotated
the *other way*; the workaround was typing a `-` in front of every ROT value.
Two separate defects were behind it, both fixed 2026-08-05:

1. **The viewer turned stickers the wrong way.** The stored number is CS2's — it
   rides the equipped v5 feed and `buildInspectHex` straight to the game — so the
   fix is in the render, not the value: `STICKER_ROT_SIGN = -1` in `viewer3d.ts`,
   applied at both the UV cut and the legacy projector, with the drag delta
   negated so the gesture still turns a sticker the same way on screen.

   Proven to be *exactly* a negation: rendering the same sticker at ±45 on HEAD
   and on the fix, `HEAD(-45)` came back **pixel-identical** to `NEW(+45)` and
   `HEAD(+45)` to `NEW(-45)`, while `HEAD(+45)` vs `NEW(+45)` differed by 1885 px.

2. **Rotation was CLAMPED where an angle must be WRAPPED.** `normRotation` did
   `min(180, max(-180, r))`, so a sticker rotated to 286.5 reached the game as a
   flat `180` — and typing `-286.5` did not help either, because that clamped to
   `-180`. Now `normStickerRotation` in `catalog.ts` (moved there so
   `tools/inspect-roundtrip.ts` can test it without booting Fastify, which
   `main.ts` does on import). cs2-lib does the same wrap in
   `healBaseInventoryItem`. Covered by 9 cases in the round-trip harness.

### THE CHECK (this is the blocking bit)

Equip an item with stickers, **with the minus signs removed** — the panel and the
game should now agree on the same number. Confirm in the in-game inspect.

Two things to know while checking:

- Any sticker the old clamp pinned to exactly `180` has lost its original angle
  and needs re-setting by hand. The information is gone, not recoverable.
- Reload the panel first. `PluginRemote` only cache-busts on page load, so an
  already-open tab keeps running the old bundle through any number of rebuilds.

### THEN: apply `StickerSlot.rotation`

The model's own per-slot base rotation — radians, tops out ~0.19 (~11°) — is
parsed in `backend/src/stickerMarkup.ts` and then **never read**: `buildDecal`
uses only `mk.offset` and `mk.scale`. The game applies it, so every slot is
systematically off by up to 11°.

Deliberately deferred rather than forgotten: its sign is not independently
settled, and stacking a second unverified sign change on top of the first would
make a wrong result impossible to attribute. Fold it into `uvCut.rot` *after* the
check above passes, and verify it the same way — one asymmetric sticker, in game
and in the panel, same slot.

---

## Loadout presets: sharing, and the delete that reaches builds you can't see

**Status: presets landed; two follow-ups deliberately left out of that change.**

### Share a preset

`ideas/inventory-loadout-presets.md` asks for it and it is the half that makes a
preset "a shareable thing in a way *my current loadout* is not". Not built,
because sharing needs a decision this change had no business making: the public
endpoints (`/api/loadout/:steamId`, `/api/equipped/v5/:steamId`) serve the build
a player is *wearing*, and a shared preset is one they are not. So either

- a preset gets its own public flag and `/api/loadout/:steamId?preset=<id>`
  starts serving drafts, which is a visibility decision about a thing that is
  currently, by construction, private; or
- share links stay "what I am wearing" and the switcher is purely a private
  convenience.

Whichever way it goes, the link format is `src/routes.ts`' existing vocabulary —
the spec is explicit that this must not become a second link format. It also
collides with `[[inventory-public-showcase]]`: *which* preset is the public one
is the same question asked twice.

### Deleting an owned item silently empties slots in presets you aren't looking at

`ON DELETE CASCADE` on `loadout_preset_slots.item_instance_id` is the right
default and was chosen on purpose (see the comment in `schema.sql`), but the
delete confirmation still says only "anything they're equipped on falls back to
the default" — which now understates it, because "equipped on" no longer means
"visible on this screen". The honest version needs a count of the *parked* slots
about to be emptied, which `DELETE /api/inventory/:id` does not currently
compute. Cheap to add; left out so the cascade decision could be reviewed on its
own rather than bundled with a copy change.

---

## Charm | Butane Buddy

Not parked — see `tools/shadertest/BUTANE-BUDDY.md`, which carries the full
status, the ruled-out table and the open leads in priority order.

The one thing that needs a human: a **camera-matched reference render**.
csgoskins.gg sits behind a Cloudflare "verify you are human" challenge, so it
cannot be captured programmatically, and the inventory icon is at a different
camera — fine for colour, useless for silhouette or brightness. Everything
shape-related stays unfalsifiable until someone grabs the charm in game or in a
browser at a known angle.
