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
DELETE FROM inventory.loadout WHERE slot NOT IN
  ('sp','p1','p2','p3','p4','m1','m2','m3','m4','m5','r1','r2','r3','r4','r5','knife','gloves','agent','zeus','c4','musickit');

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

-- Plugin settings (single-row values). Holds the panel-generated server API
-- key used by the CS2 game-server plugin (invsim_apikey).
CREATE TABLE IF NOT EXISTS inventory.settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
