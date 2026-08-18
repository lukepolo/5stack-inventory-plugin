CREATE SCHEMA IF NOT EXISTS inventory;

-- Owned item instances — the user's crafted inventory. A user can own several
-- instances of the same cs2-lib `item_id` (each with its own float / pattern /
-- StatTrak / nametag), so instances have their own surrogate id.
-- NB: named `owned_items` (not `items`) to avoid colliding with any pre-existing
-- `inventory.items` table in a shared cluster Postgres.
CREATE TABLE IF NOT EXISTS inventory.owned_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  steam_id bigint NOT NULL,
  item_id integer NOT NULL,        -- cs2-lib economy item id (skin/knife/glove/agent)
  wear real,
  seed integer,
  stattrak boolean NOT NULL DEFAULT false,
  nametag text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owned_items_steam_id_idx ON inventory.owned_items (steam_id);
ALTER TABLE inventory.owned_items ADD COLUMN IF NOT EXISTS stickers jsonb;   -- up to 5 sticker item ids
ALTER TABLE inventory.owned_items ADD COLUMN IF NOT EXISTS charm_id integer; -- keychain item id
ALTER TABLE inventory.owned_items ADD COLUMN IF NOT EXISTS patches jsonb;    -- up to 5 patch item ids (agents)
ALTER TABLE inventory.owned_items ADD COLUMN IF NOT EXISTS stattrak_count integer NOT NULL DEFAULT 0;
ALTER TABLE inventory.owned_items ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'crafted'; -- crafted | steam | copied
ALTER TABLE inventory.owned_items ADD COLUMN IF NOT EXISTS steam_asset_id text; -- Steam asset id for import dedupe
ALTER TABLE inventory.owned_items ADD COLUMN IF NOT EXISTS charm_offset jsonb;  -- {x,y,z} keychain placement
CREATE UNIQUE INDEX IF NOT EXISTS owned_items_steam_asset_idx
  ON inventory.owned_items (steam_id, steam_asset_id) WHERE steam_asset_id IS NOT NULL;

-- One row per equipped loadout slot. `slot` is a weapon model (e.g. "ak47") or a
-- special slot ("knife" | "gloves" | "agent"); team is 'CT' or 'T'. The loadout
-- is craft-gated: a slot points at one of the user's owned item instances.
CREATE TABLE IF NOT EXISTS inventory.loadout (
  steam_id bigint NOT NULL,
  team text NOT NULL,
  slot text NOT NULL,
  item_id integer,                 -- legacy (pre-inventory); kept nullable for back-compat
  wear real,
  seed integer,
  stattrak boolean NOT NULL DEFAULT false,
  nametag text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (steam_id, team, slot)
);
CREATE INDEX IF NOT EXISTS loadout_steam_id_idx ON inventory.loadout (steam_id);

-- CS2-style positional slots: sp (starting pistol), p1-p4 (other pistols),
-- m1-m5 (mid-tier), r1-r5 (rifles), knife, gloves, agent. Drop rows from the
-- legacy one-slot-per-weapon scheme.
--
-- KEEP THIS IN STEP WITH SLOT_RE IN main.ts. This file is re-applied on every
-- boot, so a slot the API accepts but this list forgets is not a stale-data
-- cleanup — it is a wipe on the next restart, and it looks like the equip
-- silently failing hours later. 'graffiti' was exactly that: equippable since
-- the graffiti sheet shipped, absent here, deleted on every backend restart.
DELETE FROM inventory.loadout WHERE slot NOT IN
  ('sp','p1','p2','p3','p4','m1','m2','m3','m4','m5','r1','r2','r3','r4','r5',
   'knife','gloves','agent','zeus','c4','musickit','graffiti','collectible');

-- Migration: point the loadout at an owned instance instead of an inline item.
ALTER TABLE inventory.loadout ADD COLUMN IF NOT EXISTS item_instance_id bigint;
ALTER TABLE inventory.loadout ALTER COLUMN item_id DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'loadout_item_instance_fk'
  ) THEN
    ALTER TABLE inventory.loadout
      ADD CONSTRAINT loadout_item_instance_fk
      FOREIGN KEY (item_instance_id) REFERENCES inventory.owned_items (id) ON DELETE CASCADE;
  END IF;
END $$;

-- Attachments become owned instances.
--
-- Stickers and charms used to live on the weapon as bare catalog ids, so the
-- sticker on your AK was not a thing you owned and could not carry its own
-- scratch. Each spec now also stores `inst`: the owned_items row it IS. This
-- backfills the ones that predate the link, so an existing collection keeps its
-- charms and stickers instead of only new crafts getting them.
--
-- IDEMPOTENT, which matters because this file is re-applied on every boot (see
-- applySchema): the only branch that mints is the one for a spec with no
-- `inst`, and after the first pass there aren't any.
--
-- Steam-origin rows are deliberately skipped. Their attachments are SCRAPED out
-- of a description blob and rewritten wholesale on every re-sync, which would
-- drop the links and mint a fresh set each time — the inventory would grow a
-- new copy of every sticker on every sync. Those keep their inline `w` forever,
-- which is exactly what that fallback is for.
DO $$
DECLARE
  r       RECORD;
  el      jsonb;
  out_arr jsonb;
  new_id  bigint;
BEGIN
  FOR r IN
    SELECT id, steam_id, stickers, patches, charm_id, charm_offset
      FROM inventory.owned_items
     WHERE origin <> 'steam'
       AND (jsonb_typeof(stickers) = 'array'
         OR jsonb_typeof(patches) = 'array'
         OR charm_id IS NOT NULL)
  LOOP
    IF jsonb_typeof(r.stickers) = 'array' THEN
      out_arr := '[]'::jsonb;
      FOR el IN SELECT value FROM jsonb_array_elements(r.stickers) LOOP
        IF jsonb_typeof(el) = 'null' THEN
          out_arr := out_arr || 'null'::jsonb;
        ELSIF jsonb_typeof(el) = 'number' THEN
          -- Legacy entry: the slot stored a plain item id, no placement at all.
          INSERT INTO inventory.owned_items (steam_id, item_id, origin)
          VALUES (r.steam_id, (el #>> '{}')::int, 'crafted') RETURNING id INTO new_id;
          out_arr := out_arr || jsonb_build_object('id', (el #>> '{}')::int, 'inst', new_id);
        ELSIF jsonb_typeof(el->'inst') = 'number' THEN
          out_arr := out_arr || el;
        ELSE
          INSERT INTO inventory.owned_items (steam_id, item_id, wear, origin)
          VALUES (r.steam_id, (el->>'id')::int, (el->>'w')::real, 'crafted') RETURNING id INTO new_id;
          out_arr := out_arr || (el || jsonb_build_object('inst', new_id));
        END IF;
      END LOOP;
      UPDATE inventory.owned_items SET stickers = out_arr WHERE id = r.id;
    END IF;

    IF jsonb_typeof(r.patches) = 'array' THEN
      out_arr := '[]'::jsonb;
      FOR el IN SELECT value FROM jsonb_array_elements(r.patches) LOOP
        IF jsonb_typeof(el) = 'null' THEN
          out_arr := out_arr || 'null'::jsonb;
        ELSIF jsonb_typeof(el) = 'number' THEN
          INSERT INTO inventory.owned_items (steam_id, item_id, origin)
          VALUES (r.steam_id, (el #>> '{}')::int, 'crafted') RETURNING id INTO new_id;
          out_arr := out_arr || jsonb_build_object('id', (el #>> '{}')::int, 'inst', new_id);
        ELSIF jsonb_typeof(el->'inst') = 'number' THEN
          out_arr := out_arr || el;
        ELSE
          INSERT INTO inventory.owned_items (steam_id, item_id, origin)
          VALUES (r.steam_id, (el->>'id')::int, 'crafted') RETURNING id INTO new_id;
          out_arr := out_arr || (el || jsonb_build_object('inst', new_id));
        END IF;
      END LOOP;
      UPDATE inventory.owned_items SET patches = out_arr WHERE id = r.id;
    END IF;

    -- The charm's own PATTERN moves onto its row, same as a sticker's scratch.
    -- IS DISTINCT FROM, not <>: a charm_offset with no `inst` key gives SQL
    -- NULL, and `NULL <> 'number'` is NULL rather than true — so a plain <>
    -- silently skipped every unlinked charm, which is the exact set this is
    -- here to convert.
    IF r.charm_id IS NOT NULL AND jsonb_typeof(COALESCE(r.charm_offset, '{}'::jsonb)->'inst') IS DISTINCT FROM 'number' THEN
      INSERT INTO inventory.owned_items (steam_id, item_id, seed, origin)
      VALUES (r.steam_id, r.charm_id, (r.charm_offset->>'seed')::int, 'crafted') RETURNING id INTO new_id;
      UPDATE inventory.owned_items
         SET charm_offset = COALESCE(r.charm_offset, '{}'::jsonb) || jsonb_build_object('inst', new_id)
       WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Plugin settings (single-row values). Holds the panel-generated server API
-- key used by the CS2 game-server plugin (invsim_apikey).
CREATE TABLE IF NOT EXISTS inventory.settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- "This account has run a Steam sync at least once." Deliberately its own row
-- rather than inferred from owned_items: a sync that imports NOTHING (private
-- inventory, or nothing CS2 in it) still counts as done, and the UI nags with
-- an orange dot until it is. A row here says the user has been through it.
CREATE TABLE IF NOT EXISTS inventory.steam_sync (
  steam_id bigint PRIMARY KEY,
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only StatTrak kill ledger: one row per counted kill.
--
-- `owned_items.stattrak_count` remains the source of truth for the NUMBER — it
-- is what the module renders, what the equipped feed carries and what a player
-- actually sees. This table is the STORY behind that number, and the two are
-- written by separate statements on purpose (see /api/increment-item-stattrak):
-- a ledger that is missing, slow or broken must never cost somebody a kill.
--
-- Consequence worth stating plainly: `count(*)` here is normally LOWER than
-- stattrak_count, and that is correct rather than drift. Every kill counted
-- before this table existed has no row, and never will — the information was
-- discarded at the time. The history view says "of N" against the real counter
-- instead of pretending the ledger is complete.
CREATE TABLE IF NOT EXISTS inventory.stattrak_kills (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_instance_id bigint NOT NULL REFERENCES inventory.owned_items (id) ON DELETE CASCADE,
  -- Denormalised owner. The endpoint has already proved this pair (the increment
  -- is scoped to `id = $1 AND steam_id = $2`), and carrying it means a history
  -- read is a filter on this table rather than a join through owned_items —
  -- one fewer way for a scoping bug to hand somebody else's kills out.
  steam_id bigint NOT NULL,
  killed_at timestamptz NOT NULL DEFAULT now(),
  -- Panel match context, resolved AT WRITE TIME. The game-server plugin sends
  -- no match id, so the only moment anyone can tell which match this kill
  -- belonged to is while it is still running; an hour later the join is
  -- guesswork against a finished match's timestamps.
  --
  -- A SNAPSHOT, deliberately not a foreign key. `public.matches` belongs to the
  -- panel, not to this plugin: a real FK would make our boot-time schema depend
  -- on their tables existing (this plugin is also installable against a database
  -- that has no panel in it), tie our rows to their retention policy, and put
  -- our table in the way of their deletes. text rather than uuid for the same
  -- reason — we do not own that column's type and should not encode a bet on it.
  --
  -- All three are nullable and stay nullable. "Kill 1,204, and we could not tell
  -- you where" is a perfectly good ledger row; a kill on a pickup server or with
  -- the panel unreachable still happened.
  match_id text,
  match_map_id text,
  map_name text
);
-- The one index this table needs, and it is the only read path: every history
-- query enters through an item the caller owns and walks that item's rows in
-- time order (first kill, per-match rollup, the daily trend). Leading with
-- item_instance_id also gives the ON DELETE CASCADE above an index to use, so
-- scrapping a gun with a long history stays a lookup rather than a table scan.
--
-- Nothing here indexes steam_id on its own. There is no "all kills by player"
-- read — the loadout rollup sums owned_items.stattrak_count instead — and an
-- index nobody reads is pure write cost on the hottest insert in the app.
CREATE INDEX IF NOT EXISTS stattrak_kills_item_idx
  ON inventory.stattrak_kills (item_instance_id, killed_at);
