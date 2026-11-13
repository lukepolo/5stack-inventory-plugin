// The 15-position weapon grid, shared by the panel and /api/equipped/v5.
//
// The panel draws an empty position as the gun CS2 would put there, and since
// the plugin's "Add loadouts" (cs2-ss2-inventory-simulator#60) the feed tells the
// game server which gun sits in every position of a team the player has set up.
// Both read this one table, so what a player sees in a cell is what the buy menu
// hands them. Two copies is how they drifted before: the panel showed MP7/UMP-45
// in the mid tier and an M4A4 in r2 while the game gave a Nova, an XM1014 and an
// M4A1-S.
//
// Imported by src/loadoutModel.ts too, so this file must stay dependency-free:
// the backend image ships only backend/, and the frontend build reaches in here.

export type GridTeam = "CT" | "T";

// The five-wide groups a weapon can move within. sp stands alone because only a
// starting pistol fits it, and no starting pistol fits p1-p4.
export const GRID_GROUPS = [
  ["sp"],
  ["p1", "p2", "p3", "p4"],
  ["m1", "m2", "m3", "m4", "m5"],
  ["r1", "r2", "r3", "r4", "r5"],
] as const;
export const GRID_SLOTS: readonly string[] = GRID_GROUPS.flat();

/**
 * Valve's default loadout, from items_game.txt: the base weapon carrying
 * `"flexible_loadout_default" "1"` for each `flexible_loadout_slot`
 * (secondary0-4, smg0-4, rifle0-4). Model keys are cs2-lib's.
 */
export const GRID_DEFAULTS: Record<GridTeam, Record<string, string>> = {
  CT: {
    sp: "hkp2000", p1: "elite", p2: "p250", p3: "fiveseven", p4: "deagle",
    m1: "nova", m2: "xm1014", m3: "mp5sd", m4: "p90", m5: "mp9",
    r1: "famas", r2: "m4a1_silencer", r3: "ssg08", r4: "aug", r5: "awp",
  },
  T: {
    sp: "glock", p1: "elite", p2: "p250", p3: "tec9", p4: "deagle",
    m1: "nova", m2: "xm1014", m3: "mp5sd", m4: "p90", m5: "mac10",
    r1: "galilar", r2: "ak47", r3: "ssg08", r4: "sg556", r5: "awp",
  },
};

/**
 * The plugin's `loadout_slot_t` for each position: SECONDARY0 is 2, SMG0 is 8,
 * RIFLE0 is 14, and the grid uses the first five of each. sp and p1-p4 are one
 * column in the game (secondary0-4).
 */
export const GRID_SLOT_IDS: Record<string, number> = {
  sp: 2, p1: 3, p2: 4, p3: 5, p4: 6,
  m1: 8, m2: 9, m3: 10, m4: 11, m5: 12,
  r1: 14, r2: 15, r3: 16, r4: 17, r5: 18,
};

/**
 * The model in every grid position for one team: the player's own pick where
 * they made one, otherwise a default.
 *
 * An empty position doesn't always get its OWN default. If you put the Nova in
 * m3, m1 (the Nova's home) can't show a second Nova. It shows the MP5-SD you
 * displaced instead, which is the swap CS2 does when you move a gun. In general
 * each group's unused defaults first go back to their own positions, and what's
 * left fills the remaining gaps in order. A group always has enough: k picks use
 * up at most k of its defaults and leave 5 - k positions open.
 */
export function resolveGrid(team: GridTeam, picks: Record<string, string | undefined>): Record<string, string> {
  const defaults = GRID_DEFAULTS[team];
  const used = new Set(GRID_SLOTS.map((s) => picks[s]).filter((m): m is string => !!m));
  const out: Record<string, string> = {};
  for (const group of GRID_GROUPS) {
    const spare = group.map((s) => defaults[s]).filter((m) => !used.has(m));
    const open: string[] = [];
    for (const slot of group) {
      const pick = picks[slot];
      if (pick) out[slot] = pick;
      else if (spare.includes(defaults[slot])) out[slot] = defaults[slot];
      else open.push(slot);
    }
    const leftover = spare.filter((m) => !Object.values(out).includes(m));
    open.forEach((slot, i) => {
      if (leftover[i]) out[slot] = leftover[i];
    });
  }
  return out;
}

export interface GridRow {
  team: string;
  slot: string;
  model: string | undefined;
}

export function feedGrids(rows: GridRow[]): Partial<Record<GridTeam, Record<string, string>>> {
  const out: Partial<Record<GridTeam, Record<string, string>>> = {};
  for (const team of ["CT", "T"] as const) {
    const picks: Record<string, string | undefined> = {};
    for (const row of rows) {
      if (row.team !== team || !GRID_SLOTS.includes(row.slot) || !row.model) {
        continue;
      }
      picks[row.slot] = row.model;
    }
    if (Object.keys(picks).length) {
      out[team] = resolveGrid(team, picks);
    }
  }
  return out;
}
