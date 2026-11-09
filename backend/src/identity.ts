import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";

export interface Identity {
  steamId: string;
  role: string;
  name: string;
}

const AUTH_URL =
  process.env.FIVESTACK_AUTH_URL ??
  "http://api.5stack.svc.cluster.local:5585/plugins/authorize";

const CACHE_TTL_MS = 5_000;
const CACHE_MAX = 200;
const cache = new Map<string, { identity: Identity | null; expires: number }>();

export function identityCacheSize() {
  return cache.size;
}

function remember(key: string, identity: Identity | null) {
  const now = Date.now();
  if (cache.size >= CACHE_MAX) {
    for (const [k, v] of cache) {
      if (v.expires <= now) {
        cache.delete(k);
      }
    }
  }
  if (cache.size >= CACHE_MAX) {
    cache.clear();
  }
  cache.set(key, { identity, expires: now + CACHE_TTL_MS });
}

// The plugin never decodes the 5stack session cookie -- it hands it back to the
// panel, which is the only thing that can validate the signature. Anything but a
// 200 is treated as anonymous, so a misconfigured deployment fails closed.
export async function getIdentity(
  request: FastifyRequest,
): Promise<Identity | null> {
  const cookie = request.headers.cookie;
  if (!cookie) {
    return devIdentity();
  }

  const key = createHash("sha256").update(cookie).digest("hex");
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.identity;
  }
  if (cached) {
    cache.delete(key);
  }

  let identity: Identity | null = null;
  try {
    const response = await fetch(AUTH_URL, { headers: { cookie } });
    if (response.ok) {
      const body = (await response.json()) as {
        steam_id: string;
        role: string;
        name: string;
      };
      identity = {
        steamId: body.steam_id,
        role: body.role ?? "user",
        name: body.name ?? "",
      };
    }
  } catch {
    return devIdentity();
  }

  remember(key, identity);
  return identity ?? devIdentity();
}

function devIdentity(): Identity | null {
  // The NODE_ENV check is the guard -- without it, a DEV_STEAM_ID leaking into a
  // real environment is an unauthenticated administrator.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_STEAM_ID) {
    return {
      steamId: process.env.DEV_STEAM_ID,
      role: "administrator",
      name: "Dev User",
    };
  }
  return null;
}
