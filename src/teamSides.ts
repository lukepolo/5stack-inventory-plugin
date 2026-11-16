export type Side = "CT" | "T";

// Where Equip goes when nobody has picked: your side if the item isn't there
// yet, else the side it is missing, so Equip stays live until the item is on
// every side it can be.
export function defaultEquipSides(can: Side[], on: Side[], current: Side): Side[] {
  if (can.includes(current) && !on.includes(current)) {
    return [current];
  }
  const missing = can.find((t) => !on.includes(t));
  return missing ? [missing] : [];
}

export function onEverySide(can: Side[], on: Side[]): boolean {
  return can.every((t) => on.includes(t));
}
