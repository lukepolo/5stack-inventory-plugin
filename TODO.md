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

## Charm | Butane Buddy

Not parked — see `tools/shadertest/BUTANE-BUDDY.md`, which carries the full
status, the ruled-out table and the open leads in priority order.

The one thing that needs a human: a **camera-matched reference render**.
csgoskins.gg sits behind a Cloudflare "verify you are human" challenge, so it
cannot be captured programmatically, and the inventory icon is at a different
camera — fine for colour, useless for silhouette or brightness. Everything
shape-related stays unfalsifiable until someone grabs the charm in game or in a
browser at a known angle.
