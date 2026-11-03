/**
 * Sticker Crafts storage — the sticker board (src/components/
 * StickerCrafts.vue), kept per account so it follows you across browsers and
 * devices instead of living in one browser's localStorage.
 *
 * Three kinds of private document, one row each in inventory.sticker_crafts:
 *   board  — the mat: every sticker on it and the groupings drawn there (key "").
 *   craft  — one saved Sticker Craft, keyed by its own id.
 *   group  — a craft placed on an owned item, keyed by the item's instance id,
 *            so the editor can bring the group back when that item is opened.
 *
 * The bodies are the client's documents as sent. The server does not interpret
 * them beyond "a JSON object of a sensible size": the shapes belong to the
 * client and are still moving, nothing queries their contents, and the client
 * already validates everything it reads back (stickerCraftsModel.ts). The caps
 * are what stop one account from filling the table.
 *
 * THE CRAFT STORE. A craft its author publishes is copied into
 * inventory.sticker_craft_store, with their name and picture from the panel, for
 * everyone on the panel to browse, rate (one vote each, up or down) and use. The
 * copy is refreshed whenever the author saves the craft again and removed when
 * they delete it or unpublish it. Panel administrators can take any craft down.
 *
 * Its own module, registered from main.ts with one line, so the feature
 * stays out of main.ts's way.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.ts";
import { getIdentity, type Identity } from "./identity.ts";

type Kind = "board" | "craft" | "group";

/** Largest body per kind, in bytes of JSON. A craft carries a ~30 kB JPEG preview. */
const MAX_BYTES: Record<Kind, number> = { board: 256_000, craft: 160_000, group: 8_000 };
/** Most rows per account, per kind. */
const MAX_ROWS: Record<Kind, number> = { board: 1, craft: 200, group: 5_000 };
/** Craft ids are the client's UUIDs; item ids are the inventory's integers. */
const CRAFT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ITEM_ID = /^\d{1,19}$/;

async function whoIs(request: FastifyRequest, reply: FastifyReply): Promise<Identity | null> {
  const identity = await getIdentity(request);
  if (!identity) void reply.status(401).send({ error: "unauthorized" });
  return identity;
}
async function caller(request: FastifyRequest, reply: FastifyReply) {
  return (await whoIs(request, reply))?.steamId ?? null;
}

const GRAPHQL_URL = process.env.FIVESTACK_GRAPHQL_URL ?? "http://hasura.5stack.svc.cluster.local:8080/v1/graphql";

/**
 * The author as the panel shows them: name and picture from its players table,
 * asked with the caller's own session (panel.ts does the same for its writes).
 * The identity's name, and no picture, when the panel can't be asked.
 */
async function authorOf(identity: Identity, cookie: string | undefined) {
  const fallback = { name: identity.name || "Player", avatar: null as string | null };
  if (!cookie) return fallback;
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        query: "query ($id: bigint!) { players_by_pk(steam_id: $id) { name avatar_url custom_avatar_url } }",
        variables: { id: identity.steamId },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const payload = (await response.json()) as {
      data?: { players_by_pk?: { name?: string; avatar_url?: string | null; custom_avatar_url?: string | null } | null };
    };
    const p = payload.data?.players_by_pk;
    if (!p) return fallback;
    const web = (u?: string | null) => (u && /^https?:\/\//.test(u) ? u : null);
    return { name: p.name || fallback.name, avatar: web(p.custom_avatar_url) ?? web(p.avatar_url) };
  } catch {
    return fallback;
  }
}

/** Refresh a published craft's copy from its author's saved one. */
async function refreshStoreCopy(steamId: string, craftId: string, body: unknown) {
  const stickers = (body as { stickers?: unknown[] } | null)?.stickers;
  await pool.query(
    `UPDATE inventory.sticker_craft_store
        SET body = $3::jsonb, sticker_count = $4, updated_at = now()
      WHERE craft_id = $1 AND steam_id = $2`,
    [craftId, steamId, JSON.stringify(body), Array.isArray(stickers) ? stickers.length : 0],
  );
}
async function unpublish(craftId: string) {
  await pool.query(`DELETE FROM inventory.sticker_craft_votes WHERE craft_id = $1`, [craftId]);
  await pool.query(`DELETE FROM inventory.sticker_craft_store WHERE craft_id = $1`, [craftId]);
}

/** Upsert one document, refusing an oversized body or one row too many. */
async function put(steamId: string, kind: Kind, key: string, body: unknown, reply: FastifyReply) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply.status(400).send({ error: "Expected a JSON object." });
  }
  const json = JSON.stringify(body);
  if (json.length > MAX_BYTES[kind]) {
    return reply.status(413).send({ error: `That ${kind} is too large to save.` });
  }
  const { rows } = await pool.query<{ n: string; mine: boolean }>(
    `SELECT count(*) AS n, bool_or(doc_key = $3) AS mine
       FROM inventory.sticker_crafts WHERE steam_id = $1 AND kind = $2`,
    [steamId, kind, key],
  );
  if (!rows[0]?.mine && Number(rows[0]?.n ?? 0) >= MAX_ROWS[kind]) {
    return reply.status(409).send({ error: `You have the most ${kind}s this can keep (${MAX_ROWS[kind]}).` });
  }
  await pool.query(
    `INSERT INTO inventory.sticker_crafts (steam_id, kind, doc_key, body, updated_at)
          VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (steam_id, kind, doc_key) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
    [steamId, kind, key, json],
  );
  return { ok: true };
}

async function remove(steamId: string, kind: Kind, key: string) {
  await pool.query(`DELETE FROM inventory.sticker_crafts WHERE steam_id = $1 AND kind = $2 AND doc_key = $3`, [
    steamId,
    kind,
    key,
  ]);
  return { ok: true };
}

export function registerStickerCraftRoutes(app: FastifyInstance) {
  /** Everything at once: the board and the library open together. Groups are
   *  fetched per item, when that item is opened. */
  app.get("/api/sticker-crafts", async (request, reply) => {
    const steamId = await caller(request, reply);
    if (!steamId) return reply;
    const { rows } = await pool.query<{ kind: Kind; body: unknown }>(
      `SELECT kind, body FROM inventory.sticker_crafts
        WHERE steam_id = $1 AND kind IN ('board', 'craft')
        ORDER BY updated_at DESC`,
      [steamId],
    );
    const published = await pool.query<{ craft_id: string }>(
      `SELECT craft_id FROM inventory.sticker_craft_store WHERE steam_id = $1`,
      [steamId],
    );
    return {
      board: rows.find((r) => r.kind === "board")?.body ?? null,
      crafts: rows.filter((r) => r.kind === "craft").map((r) => r.body),
      published: published.rows.map((r) => r.craft_id),
    };
  });

  app.put("/api/sticker-crafts/board", { bodyLimit: MAX_BYTES.board + 1024 }, async (request, reply) => {
    const steamId = await caller(request, reply);
    if (!steamId) return reply;
    return put(steamId, "board", "", request.body, reply);
  });

  app.put<{ Params: { id: string } }>(
    "/api/sticker-crafts/crafts/:id",
    { bodyLimit: MAX_BYTES.craft + 1024 },
    async (request, reply) => {
      const steamId = await caller(request, reply);
      if (!steamId) return reply;
      if (!CRAFT_ID.test(request.params.id)) return reply.status(400).send({ error: "Bad craft id." });
      const result = await put(steamId, "craft", request.params.id, request.body, reply);
      // A published craft's store copy follows its author's edits.
      if (!reply.sent) await refreshStoreCopy(steamId, request.params.id, request.body);
      return result;
    },
  );
  app.delete<{ Params: { id: string } }>("/api/sticker-crafts/crafts/:id", async (request, reply) => {
    const steamId = await caller(request, reply);
    if (!steamId) return reply;
    if (!CRAFT_ID.test(request.params.id)) return reply.status(400).send({ error: "Bad craft id." });
    // Deleting a craft takes it out of the store too.
    const { rowCount } = await pool.query(
      `SELECT 1 FROM inventory.sticker_craft_store WHERE craft_id = $1 AND steam_id = $2`,
      [request.params.id, steamId],
    );
    if (rowCount) await unpublish(request.params.id);
    return remove(steamId, "craft", request.params.id);
  });

  // ---- the Craft Store ------------------------------------------------------

  /**
   * Published crafts, newest or best first, with each one's score and the
   * caller's own vote. `max` keeps to crafts of at most that many stickers (what
   * the gun has room for), `count` to exactly that many; `q` matches the craft's
   * name or its author's.
   */
  app.get<{ Querystring: { sort?: string; max?: string; count?: string; q?: string; offset?: string; limit?: string } }>(
    "/api/sticker-crafts/store",
    async (request, reply) => {
      const identity = await whoIs(request, reply);
      if (!identity) return reply;
      const q = request.query;
      const max = Math.min(5, Math.max(1, Number(q.max) || 5));
      const count = Number(q.count) || 0;
      const limit = Math.min(100, Math.max(1, Number(q.limit) || 60));
      const offset = Math.max(0, Number(q.offset) || 0);
      const order = q.sort === "new" ? "s.published_at DESC" : "score DESC, s.published_at DESC";
      const search = typeof q.q === "string" && q.q.trim() ? `%${q.q.trim().slice(0, 60)}%` : null;
      const { rows } = await pool.query<{
        craft_id: string;
        steam_id: string;
        author_name: string;
        author_avatar: string | null;
        body: Record<string, unknown>;
        sticker_count: number;
        published_at: string;
        ups: string;
        downs: string;
        score: string;
        my_vote: number | null;
      }>(
        `SELECT s.craft_id, s.steam_id::text AS steam_id, s.author_name, s.author_avatar, s.body,
                s.sticker_count, s.published_at,
                count(*) FILTER (WHERE v.vote = 1) AS ups,
                count(*) FILTER (WHERE v.vote = -1) AS downs,
                coalesce(sum(v.vote), 0) AS score,
                max(v.vote) FILTER (WHERE v.steam_id = $1) AS my_vote
           FROM inventory.sticker_craft_store s
           LEFT JOIN inventory.sticker_craft_votes v ON v.craft_id = s.craft_id
          WHERE s.sticker_count <= $2
            AND ($3 = 0 OR s.sticker_count = $3)
            AND ($4::text IS NULL OR s.body->>'name' ILIKE $4 OR s.author_name ILIKE $4)
          GROUP BY s.craft_id
          ORDER BY ${order}
          LIMIT $5 OFFSET $6`,
        [identity.steamId, max, count, search, limit, offset],
      );
      return {
        items: rows.map((r) => ({
          ...r.body,
          id: r.craft_id,
          stickerCount: r.sticker_count,
          publishedAt: r.published_at,
          author: { steamId: r.steam_id, name: r.author_name, avatar: r.author_avatar },
          ups: Number(r.ups),
          downs: Number(r.downs),
          score: Number(r.score),
          myVote: r.my_vote ?? 0,
          mine: r.steam_id === String(identity.steamId),
        })),
      };
    },
  );

  /** Publish one of the caller's saved crafts, as it is saved now. */
  app.put<{ Params: { id: string } }>("/api/sticker-crafts/store/:id", async (request, reply) => {
    const identity = await whoIs(request, reply);
    if (!identity) return reply;
    const id = request.params.id;
    if (!CRAFT_ID.test(id)) return reply.status(400).send({ error: "Bad craft id." });
    const craft = await pool.query<{ body: { stickers?: unknown[] } }>(
      `SELECT body FROM inventory.sticker_crafts WHERE steam_id = $1 AND kind = 'craft' AND doc_key = $2`,
      [identity.steamId, id],
    );
    const body = craft.rows[0]?.body;
    if (!body) return reply.status(404).send({ error: "Save the craft before publishing it." });
    const author = await authorOf(identity, request.headers.cookie);
    const { rowCount } = await pool.query(
      `INSERT INTO inventory.sticker_craft_store (craft_id, steam_id, author_name, author_avatar, body, sticker_count)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (craft_id) DO UPDATE
             SET author_name = EXCLUDED.author_name, author_avatar = EXCLUDED.author_avatar,
                 body = EXCLUDED.body, sticker_count = EXCLUDED.sticker_count, updated_at = now()
           WHERE inventory.sticker_craft_store.steam_id = EXCLUDED.steam_id`,
      [id, identity.steamId, author.name, author.avatar, JSON.stringify(body), Array.isArray(body.stickers) ? body.stickers.length : 0],
    );
    if (!rowCount) return reply.status(409).send({ error: "That craft id is taken." });
    return { ok: true };
  });

  /** Take a craft out of the store: its author, or a panel administrator. */
  app.delete<{ Params: { id: string } }>("/api/sticker-crafts/store/:id", async (request, reply) => {
    const identity = await whoIs(request, reply);
    if (!identity) return reply;
    const id = request.params.id;
    if (!CRAFT_ID.test(id)) return reply.status(400).send({ error: "Bad craft id." });
    const owner = await pool.query<{ steam_id: string }>(
      `SELECT steam_id::text AS steam_id FROM inventory.sticker_craft_store WHERE craft_id = $1`,
      [id],
    );
    if (!owner.rows[0]) return { ok: true };
    if (owner.rows[0].steam_id !== String(identity.steamId) && identity.role !== "administrator") {
      return reply.status(403).send({ error: "Only its author or an administrator can take a craft down." });
    }
    await unpublish(id);
    return { ok: true };
  });

  /** Vote a published craft up (1), down (-1), or take the vote back (0). */
  app.post<{ Params: { id: string }; Body: { vote?: number } }>(
    "/api/sticker-crafts/store/:id/vote",
    async (request, reply) => {
      const identity = await whoIs(request, reply);
      if (!identity) return reply;
      const id = request.params.id;
      const vote = Number(request.body?.vote);
      if (!CRAFT_ID.test(id) || ![1, -1, 0].includes(vote)) return reply.status(400).send({ error: "Bad vote." });
      const owner = await pool.query<{ steam_id: string }>(
        `SELECT steam_id::text AS steam_id FROM inventory.sticker_craft_store WHERE craft_id = $1`,
        [id],
      );
      if (!owner.rows[0]) return reply.status(404).send({ error: "That craft isn't published." });
      if (owner.rows[0].steam_id === String(identity.steamId)) {
        return reply.status(400).send({ error: "You can't vote on your own craft." });
      }
      if (vote === 0) {
        await pool.query(`DELETE FROM inventory.sticker_craft_votes WHERE craft_id = $1 AND steam_id = $2`, [id, identity.steamId]);
      } else {
        await pool.query(
          `INSERT INTO inventory.sticker_craft_votes (craft_id, steam_id, vote) VALUES ($1, $2, $3)
           ON CONFLICT (craft_id, steam_id) DO UPDATE SET vote = EXCLUDED.vote`,
          [id, identity.steamId, vote],
        );
      }
      const { rows } = await pool.query<{ ups: string; downs: string }>(
        `SELECT count(*) FILTER (WHERE vote = 1) AS ups, count(*) FILTER (WHERE vote = -1) AS downs
           FROM inventory.sticker_craft_votes WHERE craft_id = $1`,
        [id],
      );
      const ups = Number(rows[0]?.ups ?? 0);
      const downs = Number(rows[0]?.downs ?? 0);
      return { ups, downs, score: ups - downs, myVote: vote };
    },
  );

  app.get<{ Params: { itemId: string } }>("/api/sticker-crafts/groups/:itemId", async (request, reply) => {
    const steamId = await caller(request, reply);
    if (!steamId) return reply;
    if (!ITEM_ID.test(request.params.itemId)) return reply.status(400).send({ error: "Bad item id." });
    const { rows } = await pool.query<{ body: unknown }>(
      `SELECT body FROM inventory.sticker_crafts WHERE steam_id = $1 AND kind = 'group' AND doc_key = $2`,
      [steamId, request.params.itemId],
    );
    return { group: rows[0]?.body ?? null };
  });
  app.put<{ Params: { itemId: string } }>(
    "/api/sticker-crafts/groups/:itemId",
    { bodyLimit: MAX_BYTES.group + 1024 },
    async (request, reply) => {
      const steamId = await caller(request, reply);
      if (!steamId) return reply;
      if (!ITEM_ID.test(request.params.itemId)) return reply.status(400).send({ error: "Bad item id." });
      // Only on the caller's own items: the key is an item id, and a group on
      // someone else's would be a row nothing could ever read or clear.
      const { rowCount } = await pool.query(
        `SELECT 1 FROM inventory.owned_items WHERE id = $1 AND steam_id = $2`,
        [request.params.itemId, steamId],
      );
      if (!rowCount) return reply.status(404).send({ error: "No such item." });
      return put(steamId, "group", request.params.itemId, request.body, reply);
    },
  );
  app.delete<{ Params: { itemId: string } }>("/api/sticker-crafts/groups/:itemId", async (request, reply) => {
    const steamId = await caller(request, reply);
    if (!steamId) return reply;
    if (!ITEM_ID.test(request.params.itemId)) return reply.status(400).send({ error: "Bad item id." });
    return remove(steamId, "group", request.params.itemId);
  });
}
