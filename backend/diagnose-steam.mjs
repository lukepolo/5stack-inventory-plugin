// Throwaway diagnostic: replicates the /api/inventory/import-steam parsing
// against a real Steam inventory, WITHOUT touching the DB. Prints what the
// sync would decide for every asset.
//
//   node diagnose-steam.mjs <steamId64> [name filter]
//
// Delete this file once the sync bug is closed.

import { CS2Economy, CS2_ITEMS } from "@ianlucas/cs2-lib";
import { english } from "@ianlucas/cs2-lib/translations/english";

CS2Economy.load({ items: CS2_ITEMS, language: english });
const items = CS2Economy.itemsAsArray;

const nameIndex = new Map();
for (const i of items) if (!nameIndex.has(i.name)) nameIndex.set(i.name, i.id);
const getItemIdByName = (n) => nameIndex.get(n) ?? null;

function slotForItem(id) {
  const i = CS2Economy.getById(id);
  if (!i) return null;
  if (i.type === "melee") return "knife";
  if (i.type === "glove") return "gloves";
  if (i.type === "agent") return "agent";
  if (i.type === "musickit") return "musickit";
  if (i.type === "graffiti") return "graffiti";
  if (i.type === "weapon" && i.category === "c4") return "c4";
  if (i.type === "weapon" && i.model === "taser") return "zeus";
  if (i.type === "weapon" && i.model) return i.model;
  return null;
}

function attachmentIds(desc, label, prefix) {
  for (const d of desc?.descriptions ?? []) {
    const text = String(d.value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ");
    const line = text.match(new RegExp(`${label}:\\s*([^\\n]+)`))?.[1];
    if (!line) continue;
    return line.split(",").map((n) => {
      const raw = n.trim();
      return { raw, id: getItemIdByName(`${prefix} | ${raw}`) };
    }).slice(0, 5);
  }
  return [];
}

const steamId = process.argv[2];
const filter = (process.argv[3] ?? "").toLowerCase();
if (!steamId) {
  console.error("usage: node diagnose-steam.mjs <steamId64> [name filter]");
  process.exit(1);
}

const assets = [];
const byClass = new Map();
let start;
let complete = false;
for (let page = 0; page < 10; page++) {
  const url =
    `https://steamcommunity.com/inventory/${steamId}/730/2?l=english&count=1000` +
    (start ? `&start_assetid=${start}` : "");
  const res = await fetch(url, { headers: { "User-Agent": "5stack-inventory-plugin" } });
  console.log(`page ${page + 1}: HTTP ${res.status}${res.ok ? "" : " <-- FAILED"}`);
  if (!res.ok) break;
  const payload = await res.json();
  assets.push(...(payload.assets ?? []));
  for (const d of payload.descriptions ?? []) byClass.set(d.classid, d);
  if (!payload.more_items || !payload.last_assetid) { complete = true; break; }
  start = payload.last_assetid;
}
console.log(`\nassets: ${assets.length}  complete: ${complete}\n`);

let wouldSync = 0;
const skipReasons = new Map();
for (const asset of assets) {
  const desc = byClass.get(asset.classid);
  const market = desc?.market_hash_name ?? "";
  if (filter && !market.toLowerCase().includes(filter)) continue;

  let name = market;
  if (!name) { skipReasons.set("no market_hash_name", (skipReasons.get("no market_hash_name") ?? 0) + 1); continue; }
  name = name.replace(/^★ /, "").replace(/^StatTrak™ /, "").replace(/^Souvenir /, "");
  const wearMatch = name.match(/ \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/);
  if (wearMatch) name = name.slice(0, -wearMatch[0].length);
  const itemId = getItemIdByName(name) ?? getItemIdByName(`★ ${name}`);
  const slot = itemId == null ? null : slotForItem(itemId);

  const stickers = attachmentIds(desc, "Sticker", "Sticker");
  const patches = attachmentIds(desc, "Patch", "Patch");
  const charm = attachmentIds(desc, "Charm", "Charm")[0] ?? null;

  const ok = itemId != null && slot != null;
  if (ok) wouldSync++;
  else {
    const why = itemId == null ? `name not in catalog: "${name}"` : `no loadout slot (type=${CS2Economy.getById(itemId)?.type})`;
    skipReasons.set(why, (skipReasons.get(why) ?? 0) + 1);
  }

  // Print EVERY asset — a silent omission here is indistinguishable from the
  // item being absent from Steam, which is exactly the confusion to avoid.
  console.log(`${ok ? "SYNC " : "SKIP "} asset=${asset.assetid} ${market}`);
  console.log(`        itemId=${itemId} slot=${slot}`);
  if (stickers.length) console.log(`        stickers: ${stickers.map((s) => `${s.raw}=>${s.id ?? "UNRESOLVED"}`).join(" | ")}`);
  if (patches.length) console.log(`        patches:  ${patches.map((s) => `${s.raw}=>${s.id ?? "UNRESOLVED"}`).join(" | ")}`);
  if (charm) console.log(`        charm:    ${charm.raw}=>${charm.id ?? "UNRESOLVED"}`);
  if (!charm) {
    // No charm parsed. Dump the raw description blobs so we can see whether
    // Steam labels it something other than "Charm:" (the parser's assumption).
    const blobs = (desc?.descriptions ?? [])
      .map((d) => String(d.value ?? ""))
      .filter((v) => /keychain|charm/i.test(v));
    if (blobs.length) console.log(`        charm: UNPARSED, raw blob: ${JSON.stringify(blobs)}`);
  }
}

console.log(`\nwould sync: ${wouldSync}`);
if (skipReasons.size) {
  console.log("skip reasons:");
  for (const [why, n] of [...skipReasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x ${why}`);
}
