import { CS2Economy, CS2_ITEMS } from "@ianlucas/cs2-lib";
import { english } from "@ianlucas/cs2-lib/translations/english";
CS2Economy.load({ items: CS2_ITEMS, language: english });
const items = CS2Economy.itemsAsArray;
for (const t of ["melee", "glove"]) {
  const vanilla = items.filter((i) => i.type === t && !i.index);
  console.log(`\n=== ${t}: ${vanilla.length} vanilla (no paint index) ===`);
  for (const v of vanilla.slice(0, 40)) console.log(v.id, "|", v.model, "|", v.name, "|", v.image);
  const painted = items.filter((i) => i.type === t && i.index);
  const models = new Set(painted.map((i) => i.model));
  console.log(`painted models: ${models.size} ->`, [...models].slice(0, 30).join(", "));
}
