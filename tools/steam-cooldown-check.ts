import assert from "node:assert/strict";
import {
  STEAM_COOLDOWN_MIN_MS,
  STEAM_COOLDOWN_MAX_MS,
  createSteamCooldown,
  parseRetryAfter,
  steamRateLimitedMessage,
  steamWaitText,
} from "../backend/src/steamCooldown.ts";

const now = Date.parse("2026-10-29T00:00:00Z");
let cases = 0;
function check(actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  cases++;
}

// Retry-After, both shapes, and the ones that carry no hint.
check(parseRetryAfter("120", now), 120_000);
check(parseRetryAfter(" 5 ", now), 5_000);
check(parseRetryAfter("0", now), null);
check(parseRetryAfter(new Date(now + 90_000).toUTCString(), now), 90_000);
check(parseRetryAfter(new Date(now - 1_000).toUTCString(), now), null);
check(parseRetryAfter("soon", now), null);
check(parseRetryAfter("", now), null);
check(parseRetryAfter(null, now), null);
check(parseRetryAfter("-5", now), null);

// No hint, or a short one, still waits the minimum: Steam's blocks last minutes.
{
  const cooldown = createSteamCooldown();
  check(cooldown.remainingMs(now), 0);
  check(cooldown.trip(null, now), STEAM_COOLDOWN_MIN_MS);
  check(cooldown.remainingMs(now + 15_000), STEAM_COOLDOWN_MIN_MS - 15_000);
  check(cooldown.remainingMs(now + STEAM_COOLDOWN_MIN_MS), 0);
}
{
  const cooldown = createSteamCooldown();
  check(cooldown.trip("3", now), STEAM_COOLDOWN_MIN_MS);
}
// A longer hint is honoured, but never past the cap.
{
  const cooldown = createSteamCooldown();
  check(cooldown.trip("300", now), 300_000);
  check(cooldown.trip("86400", now), STEAM_COOLDOWN_MAX_MS);
}
// A second, shorter refusal never shortens a wait already promised.
{
  const cooldown = createSteamCooldown();
  cooldown.trip("300", now);
  check(cooldown.trip(null, now + 10_000), 290_000);
}

check(steamWaitText(0), "1 s");
check(steamWaitText(45_000), "45 s");
check(steamWaitText(59_001), "1 min");
check(steamWaitText(61_000), "2 min");
check(steamRateLimitedMessage(45_000), "Steam is rate-limiting this server. Try again in 45 s.");

console.log(`steam cooldown: ${cases} cases ok`);
