/**
 * Steam's public inventory endpoint is rate-limited per IP, not per account, so
 * every player on a deployment shares one budget with this pod. Once it answers
 * 429, asking again only keeps the block alive: the next click has to be
 * answered here, with how long to wait, instead of being passed on to Steam.
 * Process-local for the same reason as the sale-history cooldown: it describes
 * this pod's recent behaviour towards Steam.
 */
export const STEAM_COOLDOWN_MIN_MS = 60_000;
export const STEAM_COOLDOWN_MAX_MS = 10 * 60_000;

/** Retry-After is either delta-seconds or an HTTP date. Anything else, or a
 *  time already past, means Steam gave no usable hint. */
export function parseRetryAfter(header: string | null | undefined, now: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const ms = Number(value) * 1000;
    return ms > 0 ? ms : null;
  }
  const at = Date.parse(value);
  if (Number.isNaN(at) || at <= now) return null;
  return at - now;
}

export function createSteamCooldown() {
  let until = 0;
  return {
    remainingMs(now: number) {
      return Math.max(0, until - now);
    },
    /** Steam refused us: go quiet for as long as it asked, within bounds. A
     *  hint shorter than the minimum is not trusted, because Steam's own blocks
     *  last minutes and a few seconds' wait would only extend them. */
    trip(retryAfter: string | null | undefined, now: number) {
      const asked = parseRetryAfter(retryAfter, now) ?? 0;
      const ms = Math.min(STEAM_COOLDOWN_MAX_MS, Math.max(STEAM_COOLDOWN_MIN_MS, asked));
      until = Math.max(until, now + ms);
      return until - now;
    },
  };
}

export function steamWaitText(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.ceil(seconds / 60)} min`;
}

export function steamRateLimitedMessage(ms: number) {
  return `Steam is rate-limiting this server. Try again in ${steamWaitText(ms)}.`;
}
