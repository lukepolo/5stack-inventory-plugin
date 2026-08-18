// Does a price feed actually reach the items people own?
//
// Run: node --experimental-strip-types tools/price-coverage.ts
//      node --experimental-strip-types tools/price-coverage.ts --live
//      PRICE_FEED_FILE=/tmp/latest.json node --experimental-strip-types tools/price-coverage.ts
//
// Why this exists
// ---------------
// Pricing hangs off one fragile join: Steam ships a `market_hash_name` and we
// have to turn it back into a catalog id. Every way that can fail is silent and
// looks identical from the outside — an item with no price on its tile is what
// you'd expect from a thinly traded skin, from a name we can't parse, and from a
// feed that 404'd into an HTML error page. Only a count can tell them apart.
//
// The same trap the Steam import has, for the same reason, so this is the same
// shape of check as tools/steam-sync-coverage.ts: run the REAL rules over the
// REAL catalog and say out loud what fell out.
//
// The default pass is offline and deterministic — it belongs in `npm run check`.
// `--live` additionally pulls the public upstream feed and sweeps the whole
// economy through it, which is the pass that catches an upstream rename.
import {
  catalogSummary,
  getItem,
  isOwnable,
  wearTierOf,
  wearTierIndex,
  priceGroupId,
} from "../backend/src/catalog.ts";
import {
  mapPriceFeed,
  mapSkinportItems,
  mapCsfloatItems,
  mapWaxpeerItems,
  mapBitskinsItems,
  PRICE_PROVIDERS,
  PRICE_SOURCES,
  providerUrl,
  DEFAULT_WINDOW,
  type PriceSource,
  ownedPriceKey,
  pickPrice,
  priceKey,
  priceFeedUrl,
  quoteItem,
  PRICE_FEED_UPSTREAM,
  type PriceRow,
} from "../backend/src/prices.ts";

const PRICE_WINDOWS_OK = (w: string) =>
  ["suggested", "median", "lowest", "last_24h", "last_7d", "last_30d", "last_90d"].includes(w);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

// ---- 1. the feed shape, entry by entry --------------------------------------
// Hand-written names off real Steam listings, with the four decorations in the
// combinations that actually occur. A generated fixture would only prove the
// generator and the parser agree with each other.
console.log("Feed entries -> price rows");
const FIXTURE = {
  "AK-47 | Redline (Field-Tested)": { steam: { last_24h: 12.5, last_7d: 12.9, last_30d: 13.4, last_90d: 14 } },
  "StatTrak™ AK-47 | Redline (Field-Tested)": { steam: { last_24h: 34, last_7d: 33.1, last_30d: 35, last_90d: 36 } },
  "Souvenir AWP | Dragon Lore (Factory New)": { steam: { last_24h: null, last_7d: null, last_30d: null, last_90d: 180000 } },
  "★ Karambit | Doppler (Factory New)": { steam: { last_24h: 900, last_7d: 910, last_30d: 905, last_90d: 890 } },
  "★ StatTrak™ Karambit | Fade (Factory New)": { steam: { last_24h: 2100, last_7d: 2050, last_30d: 2000, last_90d: 1980 } },
  "Sticker | Titan (Holo) | Katowice 2014": { steam: { last_24h: null, last_7d: 6900, last_30d: 7100, last_90d: 7000 } },
  "Charm | Die-cast AK": { steam: { last_24h: 4.55, last_7d: 4.6, last_30d: 4.7, last_90d: 5 } },
  "Patch | Crazy Banana": { steam: { last_24h: 0.9, last_7d: 0.95, last_30d: 1, last_90d: 1.1 } },
  "Sealed Graffiti | Recoil AWP (Cash Green)": { steam: { last_24h: 0.05, last_7d: 0.06, last_30d: 0.06, last_90d: 0.07 } },
  "Sir Bloody Miami Darryl | The Professionals": { steam: { last_24h: 18, last_7d: 19, last_30d: 20, last_90d: 21 } },
  "Music Kit | Daniel Sadowski, Crimson Assault": { steam: { last_24h: 2, last_7d: 2.1, last_30d: 2.2, last_90d: 2.3 } },
  "Kilowatt Case": { steam: { last_24h: 0.3, last_7d: 0.31, last_30d: 0.32, last_90d: 0.33 } },
  // Never traded — must not become a row at all, or the cache learns "priced,
  // at nothing", which renders as a confident $0.00.
  "AK-47 | Nonexistent Finish (Factory New)": { steam: { last_24h: null, last_7d: null, last_30d: null, last_90d: null } },
};

const mapped = mapPriceFeed(FIXTURE);
const byName = new Map(mapped.prices.map((p) => [p.marketHashName, p]));
const row = (name: string) => byName.get(name);

check("every priced fixture name resolved", mapped.unmatched.length === 0, mapped.unmatched.join("; "));
check(
  "a name with four null windows is dropped",
  !byName.has("AK-47 | Nonexistent Finish (Factory New)"),
);
check("wear bracket lands on the row", row("AK-47 | Redline (Field-Tested)")?.wearTier === 2, `got ${row("AK-47 | Redline (Field-Tested)")?.wearTier}`);
check("StatTrak is its own row", row("StatTrak™ AK-47 | Redline (Field-Tested)")?.stattrak === true);
check(
  "StatTrak and plain are different keys",
  priceKey(1, 2, true, false) !== priceKey(1, 2, false, false),
);
check("Souvenir is flagged, not stripped into the plain row", row("Souvenir AWP | Dragon Lore (Factory New)")?.souvenir === true);
check("★ StatTrak™ keeps both facts", row("★ StatTrak™ Karambit | Fade (Factory New)")?.stattrak === true);
check("an item with no wear bracket files under -1", row("Charm | Die-cast AK")?.wearTier === -1, `got ${row("Charm | Die-cast AK")?.wearTier}`);
check("agents resolve past the dropped `Agent | ` prefix", row("Sir Bloody Miami Darryl | The Professionals") !== undefined);
check("sealed graffiti resolves to the catalog's unsealed name", row("Sealed Graffiti | Recoil AWP (Cash Green)") !== undefined);

// ---- 2. the window fallback --------------------------------------------------
// ~38% of the real feed has a null last_24h. Without a fallback that is a third
// of an inventory rendering blank, which reads as "pricing is broken".
console.log("\nWindow fallback");
const dragonLore = row("Souvenir AWP | Dragon Lore (Factory New)")!;
const fell = pickPrice(dragonLore, "last_24h");
check("falls through to the first window with a number", fell?.window === "last_90d", `got ${fell?.window}`);
check("and reports the window it landed on", fell?.value === 180000, `got ${fell?.value}`);
const redline = row("AK-47 | Redline (Field-Tested)")!;
check("prefers the asked-for window when it has one", pickPrice(redline, "last_30d")?.window === "last_30d");
check(
  "widens, never narrows — a 30d ask never answers with 24h",
  pickPrice({ ...redline, last30d: null, last90d: null }, "last_30d") === null,
);
const empty = { last24h: null, last7d: null, last30d: null, last90d: null, suggested: null, median: null, lowest: null, marketHashName: "x" };
check("no data anywhere is null, not zero", pickPrice(empty) === null);

// ---- 3. owned item -> the row the feed wrote ---------------------------------
// The join that decides whether ANY of this shows up. A float has to land back
// in the bracket its market name came from, and a phase-specific id has to
// collapse onto the id the name produced.
console.log("\nOwned item -> price key");
const akRedlineFt = row("AK-47 | Redline (Field-Tested)")!;
check(
  "a 0.25 float finds the Field-Tested row",
  ownedPriceKey(akRedlineFt.itemId, 0.25, false) === priceKey(akRedlineFt.itemId, 2, false, false),
);
check("0.07 is Minimal Wear, not Factory New (exclusive upper bound)", wearTierOf(0.07) === "Minimal Wear", `got ${wearTierOf(0.07)}`);
check("0.0699 is Factory New", wearTierOf(0.0699) === "Factory New", `got ${wearTierOf(0.0699)}`);
check("1.0 is Battle-Scarred", wearTierOf(1) === "Battle-Scarred", `got ${wearTierOf(1)}`);
check("a floatless item asks for no bracket", wearTierIndex(wearTierOf(null)) === -1);

// Doppler phases: the user owns Phase 3; the feed only ever saw "Bayonet |
// Doppler". If this collapse breaks, 398 catalog items silently price as blank.
const dopplers = catalogSummary().filter((i) => i.name === "Bayonet | Doppler");
check("the catalog really does hold several ids under one Doppler name", dopplers.length > 1, `found ${dopplers.length}`);
check(
  "every Doppler phase collapses onto one price id",
  new Set(dopplers.map((i) => priceGroupId(i.id))).size === 1,
  `got ${new Set(dopplers.map((i) => priceGroupId(i.id))).size} distinct ids`,
);

// ---- 3b. bracket-less listings ------------------------------------------------
// Vanilla knives are sold as "★ Karambit" — no wear in the name — while the knife
// itself very much has a float. The row lands at wear_tier -1 and the lookup asks
// for the float's bracket, so for a while every one of them priced as blank: 22
// melee items, and the most valuable thing most inventories hold.
//
// The join is SQL (see lookupPrices), so what is pinned here is the shape it
// depends on: the name really does parse to a null bracket, and it really does
// resolve to the same catalog id an owned vanilla knife carries.
console.log("\nBracket-less listings (vanilla knives)");
const vanilla = mapSkinportItems([
  { market_hash_name: "★ Karambit", suggested_price: 480, min_price: 455, median_price: 470, quantity: 9 },
]);
const vanillaRow = vanilla.prices[0];
check("a name with no wear bracket resolves", vanilla.unmatched.length === 0, vanilla.unmatched.join("; "));
check("and files under -1, not a bracket", vanillaRow?.wearTier === -1, `got ${vanillaRow?.wearTier}`);
check(
  "while the owned knife asks for its float's bracket",
  ownedPriceKey(vanillaRow!.itemId, 0.02, false) === priceKey(vanillaRow!.itemId, 0, false, false),
);
check(
  "— so the two only meet if -1 is accepted as a fallback",
  ownedPriceKey(vanillaRow!.itemId, 0.02, false) !== priceKey(vanillaRow!.itemId, -1, false, false),
);

// ---- 4. an itemized quote ----------------------------------------------------
console.log("\nCraft quote");
const lookupFrom = (rows: PriceRow[]) => {
  const index = new Map(rows.map((r) => [priceKey(r.itemId, r.wearTier, r.stattrak, r.souvenir), r]));
  return (itemId: number, wear: number | null, stattrak: boolean) => {
    const found = index.get(ownedPriceKey(itemId, wear, stattrak));
    return found ? pickPrice(found, "last_7d") : null;
  };
};
const lookup = lookupFrom(mapped.prices);
const nameOf = (id: number) => getItem(id)?.name ?? null;
const titanId = row("Sticker | Titan (Holo) | Katowice 2014")!.itemId;
const charmId = row("Charm | Die-cast AK")!.itemId;
const quote = quoteItem(
  { itemId: akRedlineFt.itemId, wear: 0.25, stattrak: false, stickers: [{ id: titanId }, null, { id: titanId }], charmId },
  lookup,
  nameOf,
);
check("base priced from the weapon's own bracket", quote.baseTotal === 12.9, `got ${quote.baseTotal}`);
check("empty sticker slots are not lines", quote.attachments.length === 3, `got ${quote.attachments.length}`);
check("attachments total on their own", Math.round(quote.attachmentTotal) === 6900 * 2 + 5, `got ${quote.attachmentTotal}`);
check("total is base + attachments", quote.total === quote.baseTotal + quote.attachmentTotal);
check("nothing unpriced in a fully covered quote", quote.unpriced === 0, `got ${quote.unpriced}`);
const partial = quoteItem({ itemId: akRedlineFt.itemId, wear: 0.25, stickers: [{ id: 999999 }] }, lookup, nameOf);
check("an unpriced line is COUNTED, not silently dropped", partial.unpriced === 1 && partial.lines === 2, `unpriced=${partial.unpriced} lines=${partial.lines}`);
check("a StatTrak quote reads the StatTrak row", quoteItem({ itemId: akRedlineFt.itemId, wear: 0.25, stattrak: true }, lookup, nameOf).baseTotal === 33.1);

// ---- 4b. a market order book -------------------------------------------------
// The default source. Same names, different numbers: a live market has a
// reference price, a median and a cheapest listing, and no sale history.
console.log("\nSkinport items -> price rows");
const SKINPORT_FIXTURE = [
  { market_hash_name: "AK-47 | Redline (Field-Tested)", suggested_price: 41.38, min_price: 29.9, median_price: 52.73, quantity: 630 },
  { market_hash_name: "★ StatTrak™ Karambit | Fade (Factory New)", suggested_price: 2100, min_price: 1990, median_price: 2150, quantity: 4 },
  { market_hash_name: "Charm | Die-cast AK", suggested_price: 4.55, min_price: 4.1, median_price: 4.8, quantity: 88 },
  // The same knife, two phases, four times the price. Steam sells both under one
  // name; a real market does not, and neither should we.
  { market_hash_name: "★ Skeleton Knife | Doppler (Factory New)", version: "Phase 1", suggested_price: 668.67, min_price: 632.96, median_price: 660, quantity: 12 },
  { market_hash_name: "★ Skeleton Knife | Doppler (Factory New)", version: "Ruby", suggested_price: 2469.94, min_price: 2803.36, median_price: 2500, quantity: 3 },
  // Listed, never priced — must not become a confident $0.00.
  { market_hash_name: "Sticker | Never Sold", suggested_price: null, min_price: null, median_price: null, quantity: 0 },
];
const sp = mapSkinportItems(SKINPORT_FIXTURE);
const spByName = new Map(sp.prices.map((p) => [p.marketHashName, p]));
check("market names resolve through the same parser", sp.unmatched.length === 0, sp.unmatched.join("; "));
check("an unpriced listing is dropped", !spByName.has("Sticker | Never Sold"));
check("reference price is kept", spByName.get("AK-47 | Redline (Field-Tested)")?.suggested === 41.38);
check("so are the median and the cheapest ask", spByName.get("AK-47 | Redline (Field-Tested)")?.lowest === 29.9);
check("quantity rides along as a confidence signal", spByName.get("★ StatTrak™ Karambit | Fade (Factory New)")?.listings === 4);
check("StatTrak still keys separately", spByName.get("★ StatTrak™ Karambit | Fade (Factory New)")?.stattrak === true);
const phases = sp.prices.filter((p) => p.marketHashName === "★ Skeleton Knife | Doppler (Factory New)");
check("a phase-priced listing becomes its own row, not a collision", phases.length === 2, `got ${phases.length}`);
check("and the two phases are different catalog ids", new Set(phases.map((p) => p.itemId)).size === 2);
check(
  "so a Ruby is not priced as a Phase 1",
  Math.round(Math.max(...phases.map((p) => p.suggested ?? 0))) === 2470,
);
check("no collisions once phases resolve", sp.collisions.length === 0, sp.collisions.join("; "));
const spRow = spByName.get("AK-47 | Redline (Field-Tested)")!;
check("a market source defaults to its reference price", pickPrice(spRow, DEFAULT_WINDOW.skinport)?.window === "suggested");
check(
  "and falls sideways to the median when there is no reference",
  pickPrice({ ...spRow, suggested: null }, "suggested")?.window === "median",
);
check(
  "sold-averages and live asks never substitute for each other",
  pickPrice(spRow, "last_7d") === null && pickPrice(redline, "suggested") === null,
);

// ---- 4c. the other providers -------------------------------------------------
// Five interchangeable sources exist so one going down is a setting change, not
// an outage. They agree on names and disagree on everything else — cents vs
// dollars, arrays vs objects, phases beside the name vs inside it — so each one
// gets its own shape check.
console.log("\nProvider shapes");
const cf = mapCsfloatItems([
  { market_hash_name: "AK-47 | Redline (Field-Tested)", quantity: 42, min_price: 2990 },
]);
check("CSFloat cents become dollars", cf.prices[0]?.lowest === 29.9, `got ${cf.prices[0]?.lowest}`);
check("CSFloat listing count survives", cf.prices[0]?.listings === 42);

const wx = mapWaxpeerItems({
  success: true,
  items: [{ name: "AK-47 | Redline (Field-Tested)", count: 7, min: 3120, steam_price: 4100 }],
});
check("Waxpeer unwraps its `items` envelope", wx.prices.length === 1);
check("Waxpeer cents become dollars", wx.prices[0]?.lowest === 31.2, `got ${wx.prices[0]?.lowest}`);
check(
  "another market's steam_price is NOT folded into this row",
  wx.prices[0]?.suggested === null && wx.prices[0]?.median === null,
);

// Bitskins spells the phase into the name instead of sending it separately.
const bs = mapBitskinsItems([
  { name: "★ Skeleton Knife | Doppler Black Pearl (Factory New)", suggested_price: 337639 },
  { name: "★ Skeleton Knife | Doppler (Factory New)", suggested_price: 91422 },
  { name: "Glock-18 | Gamma Doppler Phase 4 (Well-Worn)", suggested_price: 51560 },
]);
check("an inline phase resolves to the variant, not to nothing", bs.unmatched.length === 0, bs.unmatched.join("; "));
check("inline phases are counted as variants", bs.variants === 2, `got ${bs.variants}`);
check("a phase-less listing still files under the family", bs.prices.length === 3);
check(
  "and the Black Pearl is not the plain Doppler",
  new Set(bs.prices.slice(0, 2).map((p) => p.itemId)).size === 2,
);
check("Bitskins suggested price converts from cents", bs.prices[0]?.suggested === 3376.39, `got ${bs.prices[0]?.suggested}`);

// A skin whose name merely ENDS in a phase word must not be mangled into a
// variant that doesn't exist — the inline path only runs after an exact miss.
const notAPhase = mapBitskinsItems([{ name: "AK-47 | Redline (Field-Tested)", suggested_price: 1290 }]);
check("an ordinary name never takes the inline-phase path", notAPhase.variants === 0);

for (const id of PRICE_SOURCES) {
  const provider = PRICE_PROVIDERS[id as PriceSource];
  check(`${id} declares a window it can actually fill`, PRICE_WINDOWS_OK(provider.window), provider.window);
}

// ---- 5. the live feed (opt-in) ----------------------------------------------
// Off by default so `npm run check` stays offline and deterministic. This is the
// pass that notices upstream renaming something under us.
const live = process.argv.includes("--live");
const feedFile = process.env.PRICE_FEED_FILE;
// --live sweeps one provider end to end; --provider=<id> picks which. Worth
// running against each before choosing one: they cover the catalog differently,
// and "which of these actually prices the things my players own" is a question
// only a sweep can answer.
const requested = process.argv.find((a) => a.startsWith("--provider="))?.split("=")[1];
const chosen = (PRICE_SOURCES as readonly string[]).includes(requested ?? "")
  ? (requested as PriceSource)
  : "skinport";
if (live || feedFile) {
  const provider = PRICE_PROVIDERS[chosen];
  const source = feedFile ?? providerUrl(chosen);
  console.log(`\nLive sweep — ${provider.label} — ${source}`);
  const payload = feedFile
    ? JSON.parse(await (await import("node:fs/promises")).readFile(feedFile, "utf8"))
    : await (
        await fetch(source, {
          headers: { Accept: "application/json", ...provider.headers },
          signal: AbortSignal.timeout(60_000),
        })
      ).json();
  const real = feedFile ? mapPriceFeed(payload) : provider.map(payload);
  const total = real.prices.length + real.unmatched.length;
  const unmatchedPct = (real.unmatched.length / total) * 100;
  console.log(
    `  ${total} listings — ${real.prices.length} mapped, ${real.unmatched.length} unmatched ` +
      `(${unmatchedPct.toFixed(1)}%), ${real.collisions.length} collisions, ${real.variants ?? 0} phase-specific`,
  );
  // Unmatched is EXPECTED to be non-zero: the feed carries cases, keys, tools,
  // capsules and pins we deliberately have no entry for. It is the RATE that
  // has to hold — a rename shows up as a step change, not a trickle.
  check("under a third of listings are unmatched", unmatchedPct < 33, `${unmatchedPct.toFixed(1)}%`);
  const sample = [...new Set(real.unmatched)].slice(0, 12);
  if (sample.length) console.log(`  unmatched sample: ${sample.join("; ")}`);
  if (real.collisions.length) console.log(`  collision sample: ${real.collisions.slice(0, 8).join("; ")}`);

  // What actually matters: of the things a user can OWN, how many can we price?
  const priced = new Set(real.prices.map((p) => priceKey(p.itemId, p.wearTier, p.stattrak, p.souvenir)));
  // Every bracket, not one sample float: "can this item be priced at all" is the
  // question. Probing at a single wear scores a Doppler — which only ever drops
  // Factory New and Minimal Wear — as unpriceable, which is an artefact of the
  // probe, not a gap in the feed.
  const anyBracket = (id: number) =>
    priced.has(ownedPriceKey(id, null, false)) ||
    [0.03, 0.1, 0.25, 0.4, 0.6].some((w) => priced.has(ownedPriceKey(id, w, false)));
  const byType = new Map<string, { total: number; priced: number; missing: string[] }>();
  for (const item of catalogSummary()) {
    if (!isOwnable(item.id)) continue;
    // cs2-lib types the 11,144 Sticker Slabs as `keychain`. They are crafted from
    // a sticker with the Sticker Slab tool and have no market listing of their
    // own, so folding them in buries the 80 real charms in a 1% bucket.
    const type = item.name.startsWith("Sticker Slab | ") ? "sticker-slab" : item.type;
    const bucket = byType.get(type) ?? { total: 0, priced: 0, missing: [] };
    bucket.total++;
    if (anyBracket(item.id)) bucket.priced++;
    else if (bucket.missing.length < 4) bucket.missing.push(item.name);
    byType.set(type, bucket);
  }
  console.log("\n  Ownable catalog coverage");
  for (const [type, b] of [...byType.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const pct = ((b.priced / b.total) * 100).toFixed(0);
    console.log(`    ${type.padEnd(12)} ${String(b.priced).padStart(6)}/${String(b.total).padEnd(6)} ${pct.padStart(3)}%${b.missing.length ? `  e.g. ${b.missing.slice(0, 2).join("; ")}` : ""}`);
  }
} else {
  console.log(
    `\n(offline pass only — --live sweeps ${PRICE_PROVIDERS.skinport.url!}, --live --feed sweeps ${priceFeedUrl(PRICE_FEED_UPSTREAM)})`,
  );
}

console.log(failures === 0 ? "\nAll price checks passed." : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
