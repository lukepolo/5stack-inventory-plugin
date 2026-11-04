import assert from "node:assert/strict";
import { STEAM_COOLDOWN_MS, SteamFetchError, createSteamInventoryFetcher } from "../backend/src/steamInventory.ts";

let cases = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  cases++;
  console.log(`ok  ${name}`);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function steam(...answers: Array<Response | Promise<Response>>) {
  const urls: string[] = [];
  let clock = Date.parse("2026-11-04T00:00:00Z");
  const fetchSteamInventory = createSteamInventoryFetcher(
    (async (url: string) => {
      urls.push(url);
      const answer = answers.shift();
      assert.ok(answer, `unexpected request ${url}`);
      return answer;
    }) as typeof fetch,
    () => clock,
  );
  return {
    fetchSteamInventory,
    urls,
    advance(ms: number) {
      clock += ms;
    },
  };
}

async function refused(sync: Promise<unknown>) {
  const error = await sync.then(
    () => assert.fail("the sync should have been refused"),
    (e: unknown) => e,
  );
  assert.ok(error instanceof SteamFetchError);
  return error;
}

const lastPage = { assets: [{ classid: "1", assetid: "10" }], descriptions: [{ classid: "1" }] };

await check("a 429 answers with the cooldown", async () => {
  const { fetchSteamInventory, urls } = steam(json({}, 429));
  const error = await refused(fetchSteamInventory("76561198000000001"));
  assert.equal(error.status, 429);
  assert.equal(error.retryAfterMs, STEAM_COOLDOWN_MS);
  assert.equal(error.message, "Steam is rate-limiting this server. Try again in 60 s.");
  assert.equal(urls.length, 1);
});

await check("a sync during the cooldown never reaches Steam", async () => {
  const { fetchSteamInventory, urls, advance } = steam(json({}, 429), json(lastPage));
  await refused(fetchSteamInventory("76561198000000001"));
  advance(15_000);
  const error = await refused(fetchSteamInventory("76561198000000002"));
  assert.equal(error.status, 429);
  assert.equal(error.retryAfterMs, STEAM_COOLDOWN_MS - 15_000);
  assert.equal(error.message, "Steam is rate-limiting this server. Try again in 45 s.");
  assert.equal(urls.length, 1);

  advance(STEAM_COOLDOWN_MS - 15_000);
  const inventory = await fetchSteamInventory("76561198000000002");
  assert.equal(inventory.complete, true);
  assert.equal(inventory.assets.length, 1);
  assert.equal(urls.length, 2);
});

await check("a sync already paging stops at the next page once another sync is refused", async () => {
  let firstPage!: (res: Response) => void;
  const { fetchSteamInventory, urls } = steam(
    new Promise<Response>((resolve) => {
      firstPage = resolve;
    }),
    json({}, 429),
  );
  const paging = fetchSteamInventory("76561198000000001");
  await refused(fetchSteamInventory("76561198000000002"));
  firstPage(json({ ...lastPage, more_items: 1, last_assetid: "10" }));
  const error = await refused(paging);
  assert.equal(error.status, 429);
  assert.equal(urls.length, 2);
});

await check("a 429 on a later page returns nothing and starts the cooldown", async () => {
  const { fetchSteamInventory, urls } = steam(json({ ...lastPage, more_items: 1, last_assetid: "10" }), json({}, 429));
  const error = await refused(fetchSteamInventory("76561198000000001"));
  assert.equal(error.status, 429);
  assert.match(urls[1], /&start_assetid=10$/);
  assert.equal((await refused(fetchSteamInventory("76561198000000002"))).status, 429);
  assert.equal(urls.length, 2);
});

await check("any other refusal starts no cooldown", async () => {
  const { fetchSteamInventory, urls } = steam(json({}, 500), json(lastPage));
  const error = await refused(fetchSteamInventory("76561198000000001"));
  assert.equal(error.status, 502);
  assert.equal((await fetchSteamInventory("76561198000000001")).complete, true);
  assert.equal(urls.length, 2);
});

console.log(`steam cooldown: ${cases} cases ok`);
