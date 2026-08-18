import { pool } from "./db.ts";

// The StatTrak kill ledger — `inventory.stattrak_kills`, one row per counted
// kill, plus the match context resolved for it at write time.
//
// The rule this whole file is arranged around: `owned_items.stattrak_count` is
// what a player sees, and nothing here may ever be in a position to cost them
// one. The counter's UPDATE is a separate, already-committed statement by the
// time recordKill runs, and recordKill does not throw. See the ordering note on
// /api/increment-item-stattrak.

/** Just enough of the Fastify logger to report with. Structural on purpose —
 *  the server owns its logger, this module only borrows one. */
type Log = {
  info(msg: string): void;
  error(obj: object, msg: string): void;
};

export interface MatchContext {
  matchId: string | null;
  matchMapId: string | null;
  mapName: string | null;
}

/** A kill we could not attribute. Still a kill, still worth a row. */
const NO_CONTEXT: MatchContext = { matchId: null, matchMapId: null, mapName: null };

// ---- Match context ---------------------------------------------------------
//
// The panel's match tables are in the SAME database — this backend already
// writes `public.match_type_cfgs` in syncGameConfigs — so working out which
// match a kill belonged to is a join, not an integration.
//
// It has to happen NOW, though. The game-server plugin's payload is
// `{ apiKey, targetUid, userId }` and nothing else: no match id, no map, not
// even which server it came from. The only moment anyone can answer "which
// match?" cheaply is while that match is still running and the player is still
// in its lineup. An hour later it is guesswork against timestamps.

/**
 * Set once the panel's tables turn out not to be reachable, after which the
 * join below is never attempted again.
 *
 * They are not ours and we cannot create them. `DATABASE_URL` is *normally* the
 * panel's own connection string, but this plugin is installable against any
 * Postgres the role can make a schema in — and there the join raises 42P01 on
 * every single kill, forever. One undefined table (or column, if the panel's
 * schema moves under us) is enough to stop asking.
 *
 * Deliberately not persisted anywhere. A restart re-probes, and a restart is
 * also when a panel upgrade would have landed, so it heals exactly when it
 * should. Kills keep being logged either way, just with a null match.
 */
let panelMatchTablesMissing = false;

/**
 * The live match this player is in, if any.
 *
 * Driven from the LIVE matches rather than from the player. Starting at
 * `match_lineup_players` and filtering on steam_id reads every match that
 * account has ever been in — hundreds of rows for a regular, thousands for an
 * admin — and then probes `matches` once per row. Starting from
 * `status = 'Live'` bounds the work by how many matches are running right now,
 * which is the number that should govern it, and the panel keeps a partial
 * index on exactly that predicate (idx_matches_status_lineup).
 *
 * Matched through `matches.lineup_1_id` / `lineup_2_id` rather than
 * `match_lineups.match_id`: those two are NOT NULL and unique, while
 * match_id was added to match_lineups later and is nullable — and going this
 * way keeps the lineup table out of the query entirely.
 *
 * `mm` is the current leg, defined the way the panel itself defines it in
 * `public.get_current_match_map`: the lowest-ordered map that has not finished.
 * Inlined rather than called, so a panel that predates that function still
 * resolves and so the planner can see into it.
 *
 * No timestamp predicate anywhere. That is the point of resolving at write
 * time: "which match is live for this player" needs no `t BETWEEN` because t is
 * now.
 */
const LIVE_MATCH_SQL = `
  SELECT m.id::text  AS match_id,
         mm.id::text AS match_map_id,
         mp.name     AS map_name
    FROM public.matches m
    LEFT JOIN LATERAL (
      SELECT x.id, x.map_id
        FROM public.match_maps x
       WHERE x.match_id = m.id AND x.status <> 'Finished'
       ORDER BY x."order" ASC
       LIMIT 1
    ) mm ON true
    LEFT JOIN public.maps mp ON mp.id = mm.map_id
   WHERE m.status = 'Live'
     AND EXISTS (
       SELECT 1
         FROM public.match_lineup_players mlp
        WHERE mlp.steam_id = $1::bigint
          AND mlp.match_lineup_id IN (m.lineup_1_id, m.lineup_2_id)
     )
   ORDER BY m.started_at DESC NULLS LAST
   LIMIT 1
`;

/**
 * How long a resolved context is reused for one player.
 *
 * Both directions of this number matter. Long enough that a player mid-match
 * answers from memory for most of their kills — a competitive half is a few
 * hundred kills across ten accounts, and thirty seconds turns that into one
 * lookup each. Short enough that a map change inside a best-of-three mis-files
 * at most half a minute of kills onto the leg that just ended, which is the
 * error this is really trading against.
 *
 * Misses are cached too, and that is the case that pays for this: a player on a
 * pickup server with no panel match is otherwise running the join above on
 * every kill they get, forever, to be told "no" every time.
 *
 * In-flight lookups are NOT deduplicated, deliberately. Two kills arriving in
 * the same instant both miss and both run the join — but the window is one
 * round trip wide, the loser computes an identical answer, and a second map of
 * pending promises to keep correct buys less than it costs.
 */
const CONTEXT_TTL_MS = 30_000;
const CONTEXT_CACHE_MAX = 1024;
const contextCache = new Map<string, { context: MatchContext; expires: number }>();

async function resolveMatchContext(steamId: string, log: Log): Promise<MatchContext> {
  if (panelMatchTablesMissing) {
    return NO_CONTEXT;
  }
  const cached = contextCache.get(steamId);
  if (cached && cached.expires > Date.now()) {
    return cached.context;
  }

  let context = NO_CONTEXT;
  try {
    const { rows } = await pool.query<{
      match_id: string | null;
      match_map_id: string | null;
      map_name: string | null;
    }>(LIVE_MATCH_SQL, [steamId]);
    const row = rows[0];
    if (row) {
      context = {
        matchId: row.match_id,
        matchMapId: row.match_map_id,
        // The canonical `maps.name` ("de_mirage"), not `maps.label`. The label
        // is the panel's display string and theirs to restyle; the name is the
        // map's identity and what a player calls it.
        mapName: row.map_name,
      };
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42P01" || code === "42703") {
      panelMatchTablesMissing = true;
      log.info(
        "[stattrak] no panel match tables in this database — kills will be logged without match context",
      );
    } else {
      log.error({ err: error }, "[stattrak] live match lookup failed");
    }
    // Deliberately NOT cached. A missing table is remembered by the flag above;
    // anything else is a timeout or a blip, and caching it as "no match" would
    // blank out the context for every kill in the next half minute.
    return NO_CONTEXT;
  }

  if (contextCache.size >= CONTEXT_CACHE_MAX) {
    // Bounded, because this map is keyed by steam id and would otherwise hold
    // every account that has killed anything since boot. Sweeping the expired
    // entries is enough: they all expire within CONTEXT_TTL_MS, so a map that
    // stays full is a burst of genuinely concurrent players rather than a leak.
    const now = Date.now();
    for (const [key, entry] of contextCache) {
      if (entry.expires <= now) contextCache.delete(key);
    }
  }
  contextCache.set(steamId, { context, expires: Date.now() + CONTEXT_TTL_MS });
  return context;
}

// ---- Writing ---------------------------------------------------------------

/**
 * Append one kill to the ledger.
 *
 * NEVER THROWS. Every failure inside — a missing table, a slow join, a full
 * disk, a bug in here — is caught and logged, because by the time this is
 * called the counter has already been incremented by its own separate,
 * committed statement. There is no transaction spanning the two on purpose:
 * wrapping them would make a broken ledger able to roll back a kill a player
 * has already seen tick over on their gun, and the endpoint is fire-and-forget
 * from the game server's side, so nothing would ever retry it.
 */
export async function recordKill(instanceId: number, steamId: string, log: Log): Promise<void> {
  try {
    const context = await resolveMatchContext(steamId, log);
    await pool.query(
      `INSERT INTO inventory.stattrak_kills
         (item_instance_id, steam_id, match_id, match_map_id, map_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [instanceId, steamId, context.matchId, context.matchMapId, context.mapName],
    );
  } catch (error) {
    log.error({ err: error }, "[stattrak] kill ledger insert failed");
  }
}

// ---- Reading ---------------------------------------------------------------

export interface KillHistory {
  counted: number;
  logged: number;
  first_at: string | null;
  last_at: string | null;
  match_count: number;
  matches: {
    match_id: string | null;
    match_map_id: string | null;
    map: string | null;
    kills: number;
    first_at: string;
    last_at: string;
  }[];
  maps: { map: string; kills: number }[];
  days: { day: string; kills: number }[];
}

/** The trend window the item view draws. Kept in step with KILL_TREND_DAYS in
 *  App.vue — sending the whole history to fill thirty bars would be a row per
 *  day for the life of the item. */
const TREND_DAYS = 30;
/** Recent legs, for the "where it has been lately" list. The rollups above it
 *  are computed over everything; this is only the tail, and a gun used in five
 *  hundred matches should not put five hundred rows on the wire for a panel
 *  that shows three. */
const LEG_LIMIT = 20;

/**
 * One item's record.
 *
 * Every query here filters on BOTH the instance and the owner. The steam_id on
 * the ledger is denormalised precisely so that scoping is a predicate on this
 * table rather than a join through owned_items — one fewer place for a mistake
 * to hand somebody else's kill history out. The caller still has to prove
 * ownership to get `counted` at all; this is the second lock on the same door.
 */
export async function killHistory(
  instanceId: number,
  steamId: string,
  counted: number,
): Promise<KillHistory> {
  const args = [instanceId, steamId];
  // The two interpolations below are the module constants above and nothing
  // else — never a value from a request. Postgres will not take a placeholder
  // in a LIMIT clause's sibling `interval` literal, and naming the numbers is
  // worth more than inlining them.
  //
  // Four aggregates over the same index range, issued together. This is a
  // person opening one item, not a hot path — the alternative is a single query
  // of stacked CTEs that nobody can read or explain a plan for.
  const [summary, legs, maps, days] = await Promise.all([
    pool.query<{
      logged: number;
      first_at: Date | null;
      last_at: Date | null;
      match_count: number;
    }>(
      // count(DISTINCT match_id) ignores NULLs, which is exactly right:
      // unattributed kills are not a match of their own.
      `SELECT count(*)::int                AS logged,
              min(killed_at)               AS first_at,
              max(killed_at)               AS last_at,
              count(DISTINCT match_id)::int AS match_count
         FROM inventory.stattrak_kills
        WHERE item_instance_id = $1 AND steam_id = $2`,
      args,
    ),
    pool.query<{
      match_id: string | null;
      match_map_id: string | null;
      map: string | null;
      kills: number;
      first_at: Date;
      last_at: Date;
    }>(
      // Grouped per LEG — one match on one map — not per match. A best-of-three
      // played on three maps is three rows here, and that is the interesting
      // grain: "42 kills on Mirage that night" says more than a match id does.
      `SELECT match_id, match_map_id, map_name AS map,
              count(*)::int  AS kills,
              min(killed_at) AS first_at,
              max(killed_at) AS last_at
         FROM inventory.stattrak_kills
        WHERE item_instance_id = $1 AND steam_id = $2
        GROUP BY match_id, match_map_id, map_name
        ORDER BY max(killed_at) DESC
        LIMIT ${LEG_LIMIT}`,
      args,
    ),
    pool.query<{ map: string; kills: number }>(
      // Best map. Unattributed kills are excluded rather than bucketed as an
      // anonymous map — "your best map is (unknown)" is not a fact about the gun.
      `SELECT map_name AS map, count(*)::int AS kills
         FROM inventory.stattrak_kills
        WHERE item_instance_id = $1 AND steam_id = $2 AND map_name IS NOT NULL
        GROUP BY map_name
        ORDER BY count(*) DESC, map_name
        LIMIT 10`,
      args,
    ),
    pool.query<{ day: string; kills: number }>(
      // Bucketed in UTC explicitly, and emitted as a plain YYYY-MM-DD string.
      // The client builds its dense series by generating the same keys, so both
      // ends have to agree on where a day starts — left to the session timezone
      // this would silently shift the newest bar by however the container is
      // configured.
      `SELECT to_char(killed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              count(*)::int AS kills
         FROM inventory.stattrak_kills
        WHERE item_instance_id = $1 AND steam_id = $2
          AND killed_at >= now() - interval '${TREND_DAYS} days'
        GROUP BY 1
        ORDER BY 1`,
      args,
    ),
  ]);

  const head = summary.rows[0];
  return {
    counted,
    logged: head?.logged ?? 0,
    first_at: head?.first_at?.toISOString() ?? null,
    last_at: head?.last_at?.toISOString() ?? null,
    match_count: head?.match_count ?? 0,
    matches: legs.rows.map((row) => ({
      match_id: row.match_id,
      match_map_id: row.match_map_id,
      map: row.map,
      kills: row.kills,
      first_at: row.first_at.toISOString(),
      last_at: row.last_at.toISOString(),
    })),
    maps: maps.rows,
    days: days.rows,
  };
}
