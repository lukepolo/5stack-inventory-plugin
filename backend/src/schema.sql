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

-- ---- Market prices ---------------------------------------------------------
-- A mirror of a Steam market price feed, resolved onto catalog ids. Rebuilt
-- wholesale on each sync (the feed is a full snapshot, not a delta), which is
-- why there is no updated_at per row — `price_meta.source_date` dates the whole
-- table at once.
--
-- The primary key is the four facts a market listing is keyed by. `wear_tier`
-- is an INDEX into the five Steam wear brackets with -1 for "this name carries
-- no bracket" (agents, charms, music kits), rather than a nullable column: a
-- NULL in a primary key would let the same floatless item in twice. Same reason
-- `souvenir` is stored even though nothing here mints souvenirs yet — dropping
-- the distinction would file a Souvenir AWP's price on the plain one, and those
-- are different items with wildly different prices.
CREATE TABLE IF NOT EXISTS inventory.prices (
  item_id integer NOT NULL,
  wear_tier smallint NOT NULL,
  stattrak boolean NOT NULL,
  souvenir boolean NOT NULL,
  market_hash_name text NOT NULL,
  -- Trailing sold-averages. Only a sale-history feed fills these in.
  last_24h real,
  last_7d real,
  last_30d real,
  last_90d real,
  -- A live order book fills these instead: the market's own reference price,
  -- the middle of what is listed, and the cheapest ask. Deliberately separate
  -- columns rather than one `price`, because "sold for, on average, last week"
  -- and "is on sale right now for" are different claims and a UI has to be able
  -- to say which one it is showing.
  suggested real,
  median real,
  lowest real,
  -- How many are listed. Not a price — the thing that makes a four-figure ask
  -- with one listing behind it readable as the outlier it is.
  listings integer,
  source text NOT NULL DEFAULT 'skinport',
  PRIMARY KEY (item_id, wear_tier, stattrak, souvenir)
);
ALTER TABLE inventory.prices ADD COLUMN IF NOT EXISTS suggested real;
ALTER TABLE inventory.prices ADD COLUMN IF NOT EXISTS median real;
ALTER TABLE inventory.prices ADD COLUMN IF NOT EXISTS lowest real;
ALTER TABLE inventory.prices ADD COLUMN IF NOT EXISTS listings integer;
ALTER TABLE inventory.prices ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'skinport';
-- No secondary index: every lookup joins on the full primary key (item_id +
-- bracket + stattrak + souvenir), which the PK's own index already serves. A
-- spare index on item_id alone would only cost write time on the ~27k-row
-- wholesale rewrite each sync does.
DROP INDEX IF EXISTS inventory.prices_item_id_idx;

-- item_id -> the id its price is filed under.
--
-- The mirror is keyed by market NAME, and 398 catalog items share a name with
-- another (every Doppler and Gamma Doppler phase, most collectible variants), so
-- a price row can only ever carry the first of them. An owned row points at the
-- specific one — you own Phase 3, not "Doppler" — so something has to bridge the
-- two, and it has to live where the JOIN can reach it. In JS that bridge is
-- priceGroupId(); this is the same collapse, in a table.
--
-- Derived from cs2-lib, not authored: rebuilt on boot, because a catalog bump
-- changes it. Only ids that actually differ get a row; the join COALESCEs.
CREATE TABLE IF NOT EXISTS inventory.price_aliases (
  item_id integer PRIMARY KEY,
  price_item_id integer NOT NULL
);

-- One row. Every sync outcome, success or failure, so an operator looking at a
-- blank price column can tell "never ran", "ran and the source 404'd" and "ran
-- fine, that item just doesn't trade" apart — three states that look identical
-- from the UI and have completely different fixes.
CREATE TABLE IF NOT EXISTS inventory.price_meta (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  source_url text,
  source_name text,
  source_date date,
  synced_at timestamptz,
  attempted_at timestamptz,
  failed_at timestamptz,
  failure text,
  rows integer NOT NULL DEFAULT 0,
  -- Names the catalog had no answer for. Small and boring while the mapping
  -- works; a jump here is the whole early warning — see tools/price-coverage.ts.
  unmatched integer NOT NULL DEFAULT 0,
  unmatched_sample text
);
ALTER TABLE inventory.price_meta ADD COLUMN IF NOT EXISTS source_name text;

-- ---- Sale history, per market listing --------------------------------------
-- What copies of ONE listing actually sold for, and the spread between them.
--
-- The price table answers "what is this worth" with a single figure for a whole
-- wear bracket. That is the wrong shape for a knife: a Factory New Karambit
-- Doppler covers everything from a 0.0001 Phase 4 to a 0.069 one, and those are
-- different items to anyone buying. The MIN and MAX of recent sales bound that
-- spread — not perfectly (stickers and patterns move price too, and no public
-- feed exposes per-listing floats) but honestly, and it is the difference
-- between "$1,400" and "$1,205 to $1,520 across ten sales".
--
-- Cached in Postgres rather than per process because the source rate-limits to a
-- handful of calls per five minutes: every replica shares one row, and
-- `fetched_at` is what stops a player clicking through twenty knives from
-- spending the whole budget.
CREATE TABLE IF NOT EXISTS inventory.price_history (
  market_hash_name text NOT NULL,
  -- Doppler phase / gem, or '' for the listings that have none. Part of the key
  -- because the source reports a row per phase and they differ by thousands.
  version text NOT NULL DEFAULT '',
  window text NOT NULL,
  min real,
  max real,
  avg real,
  median real,
  volume integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_hash_name, version, window)
);
CREATE INDEX IF NOT EXISTS price_history_fetched_idx ON inventory.price_history (fetched_at);
