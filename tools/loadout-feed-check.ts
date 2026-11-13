// Run: node --experimental-strip-types tools/loadout-feed-check.ts
import { isDeepStrictEqual } from "node:util";
import { GRID_DEFAULTS, feedGrids } from "../backend/src/loadoutGrid.ts";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  if (isDeepStrictEqual(got, want)) {
    console.log(`ok   ${label}`);
    return;
  }
  console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  failures++;
}

const usp = { team: "CT", slot: "sp", model: "usp_silencer" };
const awp = { team: "CT", slot: "r5", model: "awp" };
const ak = { team: "T", slot: "r2", model: "ak47" };
const knife = { team: "CT", slot: "knife", model: "knife_karambit" };

check("off, one CT skin: no gun is swapped", feedGrids([awp], false), {});
check("off, both teams skinned: no gun is swapped", feedGrids([usp, awp, ak], false), {});
check("on, one CT skin: the whole CT grid, T left alone", feedGrids([awp], true), { CT: GRID_DEFAULTS.CT });
check("on, a pick over a default", feedGrids([usp], true), { CT: { ...GRID_DEFAULTS.CT, sp: "usp_silencer" } });
check("on, both teams", feedGrids([usp, ak], true), {
  CT: { ...GRID_DEFAULTS.CT, sp: "usp_silencer" },
  T: GRID_DEFAULTS.T,
});
check("on, only a knife: nothing to send", feedGrids([knife], true), {});
check("on, nothing equipped", feedGrids([], true), {});

if (failures) {
  console.error(`\n${failures} loadout feed check(s) failed`);
  process.exit(1);
}
console.log("\nloadout feed checks passed");
