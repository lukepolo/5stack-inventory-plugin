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
const cache = new Map<string, { identity: Identity | null; expires: number }>();

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

  const cached = cache.get(cookie);
  if (cached && cached.expires > Date.now()) {
    return cached.identity;
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

  cache.set(cookie, { identity, expires: Date.now() + CACHE_TTL_MS });
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
