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

-- ---- Loadout presets --------------------------------------------------------
--
-- Named builds you switch between, the way CS2 ships five loadout slots. The
-- shape here is deliberately lopsided: the preset you are WEARING has no rows
-- of its own at all — its slots are `inventory.loadout`, unchanged, exactly the
-- rows every query in main.ts already reads. Only the presets you are not
-- wearing park their slots in `loadout_preset_slots`, and activating one swaps
-- the two sets over inside a transaction.
--
-- The obvious alternative — fold a preset_id into inventory.loadout's primary
-- key — was rejected for one reason: `GET /api/equipped/v5/:steamId` is the
-- hottest read in the system. Every CS2 game server hits it, unauthenticated,
-- for every player on every connect, and it is one index scan on (steam_id).
-- A preset_id in that key would make it carry a "which preset is active"
-- lookup forever, on every connect, to serve a feature the game server does not
-- know exists — and it would put a preset filter into five other loadout
-- queries besides, each of them a place to forget one and serve a player
-- somebody else's build. Keeping the live loadout a table of exactly the live
-- rows means none of those queries learned that presets exist.
CREATE TABLE IF NOT EXISTS inventory.loadout_presets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  steam_id bigint NOT NULL,
  name text NOT NULL,
  -- The pointer. Exactly one row per player carries it: the preset whose slots
  -- are the ones sitting in inventory.loadout right now.
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loadout_presets_steam_id_idx ON inventory.loadout_presets (steam_id);

-- "At most one active preset per player", enforced by the database rather than
-- by a code path that has to remember. Activation clears one flag and sets
-- another; two tabs racing, or a crash between the two statements, would
-- otherwise leave a player with two actives and nothing able to say which of
-- them inventory.loadout actually holds — an ambiguity that costs you a build
-- the next time you switch.
CREATE UNIQUE INDEX IF NOT EXISTS loadout_presets_active_idx
  ON inventory.loadout_presets (steam_id) WHERE active;

-- The parked slots of every preset that is NOT active: the same columns as
-- inventory.loadout, minus steam_id (the preset row owns that).
--
-- item_instance_id cascades on delete, matching the live loadout. That is a
-- decision, not an inherited default: the loadout is craft-gated, so a slot IS
-- a pointer at one specific owned instance, and once that instance is gone
-- there is nothing legal left for the slot to hold. RESTRICT would instead make
-- deleting a skin from your inventory fail because of a preset you are not
-- looking at, naming a slot you would then have to go and empty by hand. The
-- cost is that a delete now quietly empties that slot in every preset, not just
-- the one on screen — same behaviour as today, just reaching further.
CREATE TABLE IF NOT EXISTS inventory.loadout_preset_slots (
  preset_id bigint NOT NULL REFERENCES inventory.loadout_presets (id) ON DELETE CASCADE,
  team text NOT NULL,
  slot text NOT NULL,
  item_id integer,                 -- free vanilla weapon, same meaning as inventory.loadout.item_id
  item_instance_id bigint REFERENCES inventory.owned_items (id) ON DELETE CASCADE,
  wear real,
  seed integer,
  stattrak boolean NOT NULL DEFAULT false,
  nametag text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (preset_id, team, slot)
);

-- Backfill: every player who already has a loadout gets a preset that IS it.
--
-- This moves ZERO rows. The live loadout stays in inventory.loadout untouched;
-- all the new row does is give it a name and a handle. That is the property
-- worth having in a migration re-applied on every boot — there is no step in it
-- that can lose somebody's build, because there is no step in it that writes to
-- inventory.loadout at all.
--
-- Guarded on "has no ACTIVE preset" rather than "has no presets": a player left
-- with presets but no active one (a half-applied activation, say) has no live
-- loadout the backend can name, and every write path is stuck until one exists.
-- Self-healing beats stuck. main.ts mints the same row lazily for players who
-- have never equipped anything, so this only has to cover the ones who have.
INSERT INTO inventory.loadout_presets (steam_id, name, active)
SELECT DISTINCT l.steam_id, 'Loadout 1', true
  FROM inventory.loadout l
 WHERE NOT EXISTS (
   SELECT 1 FROM inventory.loadout_presets p WHERE p.steam_id = l.steam_id AND p.active
 );

-- CS2-style positional slots: sp (starting pistol), p1-p4 (other pistols),
-- m1-m5 (mid-tier), r1-r5 (rifles), knife, gloves, agent. Drop rows from the
-- legacy one-slot-per-weapon scheme.
--
-- KEEP THIS IN STEP WITH SLOT_RE IN main.ts. This file is re-applied on every
-- boot, so a slot the API accepts but this list forgets is not a stale-data
-- cleanup — it is a wipe on the next restart, and it looks like the equip
-- silently failing hours later. 'graffiti' was exactly that: equippable since
-- the graffiti sheet shipped, absent here, deleted on every backend restart.
--
-- Presets doubled the number of tables holding a `slot`, so the list is written
-- ONCE into a CTE and both are cleaned from it — two literal copies would just
-- have been the same trap again, one table deep. A data-modifying CTE always
-- runs to completion whether or not the outer query reads it, which is what
-- lets the first DELETE ride along inside a statement whose result is the
-- second one. It has to sit here, below both CREATE TABLEs, for that reason.
WITH legal_slot (slot) AS (
  VALUES ('sp'),('p1'),('p2'),('p3'),('p4'),
         ('m1'),('m2'),('m3'),('m4'),('m5'),
         ('r1'),('r2'),('r3'),('r4'),('r5'),
         ('knife'),('gloves'),('agent'),('zeus'),('c4'),
         ('musickit'),('graffiti'),('collectible')
), live AS (
  DELETE FROM inventory.loadout
   WHERE slot NOT IN (SELECT slot FROM legal_slot)
)
DELETE FROM inventory.loadout_preset_slots
 WHERE slot NOT IN (SELECT slot FROM legal_slot);

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
  -- timestamptz, not date. It is written from a feed's Last-Modified (a full
  -- instant) and read back with .toISOString(): a `date` column truncated the
  -- time, node-postgres parsed the bare date at LOCAL midnight, and the
  -- toISOString() then shifted it back across UTC — so in any America/* pod the
  -- panel reported yesterday's date for a feed published today. That date is
  -- exactly the signal an operator uses to judge whether a sync is stale.
  source_date timestamptz,
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
-- Was `date` on instances created before the note above. Conditional because
-- this file runs on EVERY boot and an unconditional ALTER TYPE takes an ACCESS
-- EXCLUSIVE lock each time for a column that is already right. The cast itself
-- is exact (midnight in the server's zone) and the next sync overwrites it.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'inventory' AND table_name = 'price_meta'
       AND column_name = 'source_date' AND data_type = 'date'
  ) THEN
    ALTER TABLE inventory.price_meta ALTER COLUMN source_date TYPE timestamptz;
  END IF;
END $$;

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
  -- NOT "window": that is a reserved word in Postgres (window functions), and an
  -- unquoted column by that name is a syntax error that fails the whole schema
  -- apply — which runs on every boot, so it took the backend down with it.
  period text NOT NULL,
  min real,
  max real,
  avg real,
  median real,
  volume integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_hash_name, version, period)
);
CREATE INDEX IF NOT EXISTS price_history_fetched_idx ON inventory.price_history (fetched_at);

-- ---- Wishlist --------------------------------------------------------------
-- Catalog items the caller wants but does not own — "I want that Fade one day".
--
-- Its own table rather than a flag on the item, because a wanted item is not a
-- row in owned_items and never will be until someone crafts it, so there is
-- nothing to flag. Keyed by the cs2-lib item id, which is why it cannot be a
-- nullable column on the inventory table.
--
-- No foreign key to anything: item_id addresses the economy, which lives in
-- cs2-lib and not in this database. An id cs2-lib later retires simply stops
-- resolving through getItem and the row reads as unknown, which is the same
-- degradation every other stored item_id already has.
CREATE TABLE IF NOT EXISTS inventory.wishlist (
  steam_id bigint NOT NULL,
  item_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (steam_id, item_id)
);
