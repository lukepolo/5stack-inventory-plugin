/**
 * The routes that write something every other player is then served: the paint
 * composite store and the sticker mat's weapon outlines.
 *
 * Their own module so tools/composite-store-check.ts can drive the real
 * handlers. main.ts owns Postgres, the catalog and ImageMagick, and hands them
 * in through SharedStoreDeps.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { compositeStem } from "./compositeStore.ts";
import type { Identity } from "./identity.ts";

// Only the caps the client can actually composite at (see MAX_COMPOSITE_SIZE and
// MAX_COMPOSITE_SIZE_PROJECTED). Bounded so a client cannot invent an unlimited
// number of variants of the same skin.
const COMPOSITE_CAPS = new Set([1024, 2048, 4096]);
// A lossless 4096 projected style is the worst case; 48MB leaves headroom over
// the largest PNG that can legitimately arrive.
export const COMPOSITE_MAX_BYTES = 48 * 1024 * 1024;

export type CompositeClaim = { model: string; legacy: boolean; material: string; wear: number; seed: number };

export interface SharedStoreDeps {
  identity(request: FastifyRequest): Promise<Identity | null>;
  compositeDir(gen: string): Promise<string | null>;
  ownsComposite(steamId: string, claim: CompositeClaim): Promise<boolean>;
  losslessWebp(png: Buffer, dir: string): Promise<Buffer | null>;
  composited(): void;
  isWeapon(model: string): boolean;
  weaponOutline(body: unknown, model: string): unknown;
  saveWeaponOutline(model: string, outline: unknown): Promise<void>;
}

export const SHARED_WRITE_REFUSAL = "Only an administrator stores what every player is shown.";

// Craft takes any in-range wear and seed, so owning a matching item proves nothing
// about a slot every viewer reads; only an administrator writes one.
async function sharedWriter(deps: SharedStoreDeps, request: FastifyRequest, reply: FastifyReply) {
  const identity = await deps.identity(request);
  if (!identity) {
    reply.status(401).send({ error: "not signed in" });
    return null;
  }
  if (identity.role !== "administrator") {
    reply.status(403).send({ error: SHARED_WRITE_REFUSAL, admin_only: true });
    return null;
  }
  return identity;
}

export function registerSharedStores(app: FastifyInstance, deps: SharedStoreDeps) {
  // Fastify's default bodyLimit is 1MB, which silently 413s every composite
  // before the handler ever runs — a lossless 2k pair is a few MB and a 4k
  // projected style more. Raised per route rather than globally so nothing else
  // gains the right to accept a 48MB body.
  //
  // The same limit exists OUTSIDE the pod: ingress-nginx also defaults to 1MB, and
  // the `inventory-api` Ingress carries no proxy-body-size annotation. That one
  // cannot be fixed from this repo — the deploy manifests live in the panel repo.
  app.post<{ Params: { gen: string; file: string } }>("/api/composite/:gen/:file", {
    bodyLimit: COMPOSITE_MAX_BYTES,
  }, async (request, reply) => {
    const identity = await sharedWriter(deps, request, reply);
    if (!identity) {
      return reply;
    }

    const q = request.query as Record<string, string | undefined>;
    const kind = q.kind;
    const cap = Number(q.cap);
    const wear = Number(q.wear);
    const seed = Number(q.seed);
    const model = q.model ?? "";
    const material = q.material ?? "";
    const legacy = q.legacy === "1";
    const dir = await deps.compositeDir(request.params.gen);
    if (
      !dir ||
      (kind !== "albedo" && kind !== "rm") ||
      !COMPOSITE_CAPS.has(cap) ||
      !Number.isFinite(wear) || wear < 0 || wear > 1 ||
      !Number.isInteger(seed) || seed < 0 ||
      !model || !material
    ) {
      return reply.status(400).send({ error: "bad composite identity" });
    }

    const body = request.body as Buffer;
    const ext = /^\x89PNG/.test(body?.subarray?.(0, 4).toString("latin1") ?? "")
      ? "png"
      : body?.subarray?.(0, 4).toString("latin1") === "RIFF" &&
        body.subarray(8, 12).toString("latin1") === "WEBP"
        ? "webp"
        : null;
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > COMPOSITE_MAX_BYTES || !ext) {
      return reply.status(400).send({ error: "bad composite" });
    }

    // The store is SHARED, so even an administrator's client does not get to
    // choose which skin its pixels land on: the tuple has to describe an item the
    // caller owns.
    if (!(await deps.ownsComposite(identity.steamId, { model, legacy, material, wear, seed }))) {
      return reply.status(403).send({ error: "not your item" });
    }

    const stem = compositeStem({ model, legacy, material, wear, seed, cap });
    try {
      await fs.mkdir(dir, { recursive: true });
      // A client that could not produce lossless WebP fell back to PNG (see
      // encoderFormat in src/compositeStore.ts). Transcode it here so the store
      // does not end up permanently holding a ~3x larger file. LOSSLESS, so this
      // re-encode cannot change a pixel; without ImageMagick the PNG is kept.
      let out = body;
      let outExt: string = ext;
      if (ext === "png") {
        const converted = await deps.losslessWebp(body, dir);
        if (converted) {
          out = converted;
          outExt = "webp";
        }
      }
      const file = `${stem}.${kind}.${outExt}`;
      const dest = path.join(dir, file);
      // First write wins: re-uploading is pure cost, and leaving the original in
      // place means a client that somehow produces different pixels cannot
      // overwrite a bake other viewers are already caching hard.
      if (await fs.access(dest).then(() => true, () => false)) {
        return { ok: true, file, existed: true };
      }
      // Write-then-rename so a reader never sees a half-written image.
      const tmp = `${dest}.${process.pid}.tmp`;
      await fs.writeFile(tmp, out);
      await fs.rename(tmp, dest);
      deps.composited();
      return { ok: true, file };
    } catch {
      return reply.status(500).send({ error: "composite store unavailable" });
    }
  });

  // Served under both paths for the same reason renders are: /api/* provably
  // reaches this pod, bare /composites/* backs nginx's static-miss fallback.
  for (const route of ["/api/composites/:gen/:file", "/composites/:gen/:file"]) {
    app.get<{ Params: { gen: string; file: string } }>(route, async (request, reply) => {
      const { gen, file } = request.params;
      const dir = await deps.compositeDir(gen);
      if (!dir || !/^[\w.-]+\.(png|webp)$/.test(file)) {
        return reply.status(404).send({ error: "not found" });
      }
      try {
        const buf = await fs.readFile(path.join(dir, file));
        // Genuinely immutable: the generation directory covers the shader and the
        // extraction, and the stem covers the item — so this URL can never change
        // meaning.
        reply.header("Cache-Control", "public, max-age=31536000, immutable");
        return reply.type(file.endsWith(".webp") ? "image/webp" : "image/png").send(buf);
      } catch {
        return reply.status(404).send({ error: "not found" });
      }
    });
  }

  /**
   * Store a gun's traced outline for the mat. An administrator's trace replaces
   * whatever is there; DELETE in main.ts clears one for re-tracing.
   */
  app.put<{ Params: { model: string }; Body: unknown }>(
    "/api/catalog/weapon-outline/:model",
    { bodyLimit: 200_000 },
    async (request, reply) => {
      const identity = await sharedWriter(deps, request, reply);
      if (!identity) {
        return reply;
      }
      const model = request.params.model;
      if (!deps.isWeapon(model)) {
        return reply.status(400).send({ error: "That isn't a weapon." });
      }
      const outline = deps.weaponOutline(request.body, model);
      if (!outline) {
        return reply.status(400).send({ error: "That isn't a weapon outline." });
      }
      await deps.saveWeaponOutline(model, outline);
      return { ok: true };
    },
  );
}
