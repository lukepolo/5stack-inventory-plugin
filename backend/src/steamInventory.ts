export interface SteamAsset {
  classid: string;
  assetid: string;
}
export interface SteamDescription {
  classid: string;
  market_hash_name?: string;
  descriptions?: { value?: string; name?: string }[];
  fraudwarnings?: string[];
}
interface SteamPage {
  assets?: SteamAsset[];
  descriptions?: SteamDescription[];
  more_items?: number;
  last_assetid?: string;
}

// Steam serves the inventory oldest-first in pages, so the newest items are on
// the LAST page — we have to walk them all or recent acquisitions never sync.
const STEAM_PAGE = 1000;
const STEAM_MAX_PAGES = 10;
// Steam's 429 carries no Retry-After; its per-IP blocks last minutes and every
// request during one keeps it alive.
export const STEAM_COOLDOWN_MS = 60_000;

// NB: plain field assignment, not a constructor parameter property — node's
// --experimental-strip-types only erases types, so it can't emit the implicit
// `this.status = status` a parameter property relies on.
export class SteamFetchError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function steamRateLimited(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return new SteamFetchError(429, `Steam is rate-limiting this server. Try again in ${seconds} s.`, ms);
}

export function createSteamInventoryFetcher(fetchPage: typeof fetch = fetch, now: () => number = Date.now) {
  let cooldownUntil = 0;

  return async function fetchSteamInventory(steamId: string) {
    const assets: SteamAsset[] = [];
    const byClass = new Map<string, SteamDescription>();
    let start: string | undefined;
    let complete = false;
    for (let page = 0; page < STEAM_MAX_PAGES; page++) {
      const waiting = cooldownUntil - now();
      if (waiting > 0) {
        throw steamRateLimited(waiting);
      }
      const url =
        `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=${STEAM_PAGE}` +
        (start ? `&start_assetid=${start}` : "");
      let payload: SteamPage;
      try {
        const res = await fetchPage(url, {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": "5stack-inventory-plugin" },
        });
        if (res.status === 403 || res.status === 401) {
          throw new SteamFetchError(
            400,
            "Your Steam inventory is private. Set it to Public in Steam privacy settings and retry — we only ever read public data.",
          );
        }
        if (res.status === 429) {
          cooldownUntil = now() + STEAM_COOLDOWN_MS;
          throw steamRateLimited(STEAM_COOLDOWN_MS);
        }
        if (!res.ok) {
          throw new SteamFetchError(502, `Steam responded ${res.status} — try again in a minute.`);
        }
        payload = (await res.json()) as SteamPage;
      } catch (error) {
        if (error instanceof SteamFetchError) {
          throw error;
        }
        throw new SteamFetchError(502, "Couldn't reach Steam — try again in a minute.");
      }
      assets.push(...(payload.assets ?? []));
      for (const d of payload.descriptions ?? []) {
        byClass.set(d.classid, d);
      }
      if (!payload.more_items || !payload.last_assetid) {
        complete = true;
        break;
      }
      start = payload.last_assetid;
    }
    // `complete` gates the prune step — a truncated read must never be mistaken
    // for "the user no longer owns these".
    return { assets, byClass, complete };
  };
}
