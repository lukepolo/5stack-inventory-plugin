/** A pet's life stage (cs2-lib's upgrade level) by name — 0..3, egg to hen. */
export const PET_STAGE_NAMES: Record<number, string> = { 0: "Egg", 1: "Chick", 2: "Pullet", 3: "Hen" };

/**
 * What each body trait a pet's pattern draws is called — the `presets` keys in
 * the model's chicken_metadata, in the order the editor and the specs list them.
 */
export const PET_TRAIT_NAMES: Record<string, string> = {
  fatness: "Body",
  tail: "Tail",
  legs: "Legs",
  wing_size: "Wings",
  wing_width: "Span",
  neck: "Neck",
  head: "Head",
  comb_front: "Comb",
  wattle: "Wattle",
};

/** The seed generator's preset for a life stage — grown breeds only; the chick's
 *  generator is off in game, so it has none. */
export const petPresetKey = (stage: number | null | undefined) => {
  const s = stage ?? 3;
  return s === 2 ? "adolescent" : s === 3 ? "adult" : null;
};
