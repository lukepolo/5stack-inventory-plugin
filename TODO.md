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

## `copy-from` copies the sticker, not the placement

**Status: newly reachable, and the two defects below predate it.**

`POST /api/loadout/copy-from/:steamId` had no UI until the Copy loadout button
landed in the viewer header, so nothing exercised it. Two things it gets wrong,
both in the `INSERT INTO inventory.owned_items` at `backend/src/main.ts`:

1. **`charm_offset` is not in the column list.** `charm_id` is, so a copied gun
   gets the charm — hanging at the default offset, at the default pattern. The
   seed rides in that same jsonb (see the `ItemRow.charm_offset` comment), so a
   Butane Buddy copies across as a differently-graded one.
2. **The source user's `inst` handles are copied verbatim** inside the
   `stickers`/`patches` jsonb. They resolve to nothing on the copier's side —
   `instFactsFor` scopes its lookup to the owner, which is what stops it being a
   read of someone else's rows — so the sticker falls back to its inline wear.
   But the dead handle is now stored, and `enrichAttachments` hands it to the
   copier's UI, which sends it straight back on the next save.

Deferred rather than folded into the public-showcase work: the fix belongs with
the wider attachment-fidelity pass, and copying a placement correctly wants the
same "what does the copy own?" answer as minting one does. The confirm dialog is
written to what the copy actually delivers today — the skins and the stickers on
them — and promises nothing about the charm's placement.
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

---

## StatTrak ledger: confirm the match join, then decide whether it needs partitioning

**Status: shipped, two things outstanding — one check, one measurement.**

### THE CHECK (this is the blocking bit)

`resolveMatchContext` in `backend/src/killLedger.ts` was written against the
panel's Hasura migrations, not against a running database — this repo has no
Postgres and the backend cannot be booted here. The shape it assumes:

- `public.matches (id uuid, status text, started_at, lineup_1_id, lineup_2_id)`,
  where live is the literal string `'Live'`
- `public.match_lineup_players (steam_id bigint, match_lineup_id uuid)` — joined
  through `matches.lineup_1_id`/`lineup_2_id` rather than
  `match_lineups.match_id`, which is nullable
- `public.match_maps (id, match_id, map_id, status, "order")`, current leg being
  the lowest-ordered row whose status is not `'Finished'`
- `public.maps (id, name)`

Get a kill on a live 5stack match with a StatTrak weapon equipped, then read the
row back:

```sql
SELECT * FROM inventory.stattrak_kills ORDER BY id DESC LIMIT 5;
```

Three nulls means the join missed, and the two ways it can miss are worth
separating before changing anything: the backend logs
`[stattrak] no panel match tables in this database` exactly once if the tables
are not reachable at all, and says nothing whatsoever if they are there and the
predicate simply did not match.

Worth confirming in the same sitting: the role behind `DATABASE_URL` can
actually `SELECT` from `public.*`. Today this backend only ever touches
`public.match_type_cfgs`, and a role narrowed to just that would produce a
perfectly healthy-looking ledger of entirely null matches.

The other half of the check is the count itself: kill something with a StatTrak
gun and confirm `stattrak_count` and a new ledger row move together. They are
separate statements on purpose (a failed insert must not cost the counter), so
"the number went up and no row appeared" is a real, expected state and not
automatically a bug — read the log line before assuming otherwise.

### THEN: decide whether this needs partitioning

Deliberately not partitioned and deliberately not pruned, because the
arithmetic says it does not need to be yet. An MR12 match is ~150 kills across
ten players, only the ones holding a StatTrak weapon log a row, and a row is
~100 bytes with its one index — a hundred matches a day lands in single-digit
millions of rows a year. The only read path is a range scan of one item's rows
on `(item_instance_id, killed_at)`, which does not care about table size.

It is still the first table here that breaks the "a few hundred rows"
assumption `main.ts` flags, so measure rather than assume:

```sql
SELECT count(*),
       pg_size_pretty(pg_total_relation_size('inventory.stattrak_kills'))
  FROM inventory.stattrak_kills;
```

If it does start to matter, monthly `PARTITION BY RANGE (killed_at)` is the
move — never a retention policy, since a gun's first kill staying readable years
later is the entire point of the feature. One thing to plan for when that
happens: a partitioned table's primary key has to include the partition key, so
`id` alone stops being usable as the PK and becomes `(id, killed_at)`.
## Inspect animation: confirm the clip, then decide about moving parts

**Status: code landed, never seen running.** It was written without access to a
CS2 models mount, so every claim below about what a weapon GLB contains is
inference from the comments already in `viewer3d.ts`, not observation.

### What landed

The viewer plays the model's own inspect clip by turning the CAMERA and the
whole light rig, rather than the weapon — which is exactly equivalent to turning
the weapon under a fixed rig, and is the only version available: a weapon's
geometry is CPU-skinned into a static mesh at mount (`bakePose`), and its
stickers, charm pivot, collision grid and game-space offsets are all stated in
world coordinates and measured once. The full reasoning is in the `Inspect
motion` block in `viewer3d.ts`.

Clip choice is `PRESENTATION.inspectClips` — an explicit per-tree list with no
generic fallback — and every candidate then has to MEASURE as moving the body
bone by more than `INSPECT_MIN_DEGREES` before it is accepted. A model that
matches nothing, or matches a single-key pose, stays exactly as static as it is
today.

### THE CHECKS (this is the blocking bit)

1. **Which clip actually gets picked.** Open a rifle in the 3D viewer with
   `?perf=1` and read the `inspect` line: it prints the chosen clip, the play
   head, the current turn in degrees, and — the important half — every clip the
   GLB shipped. `inspectClips` currently names `inspect_loop` and
   `inventory_inspect` on the strength of the elite measurement in `bakePose`
   ("icon/inspect/dropped" vs "shoot/reload") and of the glove tree's clip
   names. If the real names are different, that HUD line is where they are read
   off, and `?inspectclip=<name>` tries any one of them without a rebuild.
2. **Which way the environment turns.** The three lamps and the environment map
   are rotated by the same quaternion; the lamps are unambiguous, but the env
   goes through `scene.environmentRotation`, whose sign was derived from three's
   shader (`envMapRotation` is the inverse of the Euler you set) rather than
   observed. On a mirror-finish skin — Doppler, a chrome knife — the reflection
   should sweep the SAME way as the specular highlight. If it sweeps the other
   way, invert `envQuat` in `applyInspect` and nothing else changes.
3. **What the charm does.** Gravity is already camera-relative, so a charm
   swings under this for free and by the physics that was here. An inspect clip
   turns several times faster than the 0.9 turntable it replaces, though, so
   watch `charm … substeps/f` and `contacts/f` on `?perf=1` and watch for the
   charm passing through the body (`reseatIfBehind` is the existing guard and
   runs every awake frame). If it flails, the lever is the playback rate, not
   the solver — nothing about the clip requires it to play at game speed.

### THEN: moving parts

What plays is the body's RIGID motion. A slide pull or a magazine drop lives in
bones that `bakePose` has already resolved into static vertices, so they cannot
move, and the same limitation is why gloves are listed with an empty
`inspectClips` even though they ship `inspect_loop` — a hand's motion is
per-finger and there is no rigid part of it worth playing.

Undoing that for a live viewer means keeping the SkinnedMeshes and skinning on
the GPU, which is cheaper per frame than the bake it replaces — but it moves the
body in world space, and every world-space measurement listed above would have
to move with it. Do not start this as "just don't call bakePose": start by
listing what reads world coordinates after the mount.
