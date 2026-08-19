/**
 * Everything ONE loadout cell draws — LoadoutCell.vue's props, named.
 *
 * Split into its own module (rather than an inline `defineProps<{...}>`) when
 * the loadout grid became LoadoutGrid.vue: App's `cellFacts()` builds exactly
 * this shape and the grid passes it straight through with `v-bind`, so both
 * sides need to be able to SAY the type. Two hand-kept copies of seventeen
 * optional fields is how a cell quietly stops showing a float.
 */
import type { AttachSource, CatalogItem, InventoryItem, Team } from "../api";

export interface LoadoutCellProps {
  /** The slot's own caption — "AK-47", "Agent · CT", "Music Kit". */
  label?: string;
  item?: CatalogItem | null;
  /** The owned instance, or null for a free default. Drives the marks, the
   *  hover actions and the badges. */
  inst?: InventoryItem | null;
  /**
   * What is APPLIED to the occupant, when that is not an owned instance.
   *
   * Separate from `inst` because the two answer different questions: `inst` is
   * a row you can act on (edit, delete, inspect, bake a card for) and stays
   * owner-only, while this is just the facts to draw. Viewing someone else's
   * loadout has the second without the first — the public endpoint withholds
   * their row handle and sends the enriched attachments instead — and without
   * this prop their cells rendered with no StatTrak mark and no sticker or
   * charm thumbnails at all, which is most of what a loadout is worth looking
   * at. Falls back to `inst`, so your own loadout is unchanged.
   */
  badges?: AttachSource | null;
  image?: string | null;
  /**
   * MUSIC KITS only: the track this slot plays, equipped or stock.
   *
   * Its own fact rather than `item?.audio` because the slot's occupant is very
   * often the free default, which is not an `item` here — and a kit slot with no
   * transport is a picture of a record you cannot play. Absent everywhere else,
   * which is what keeps the overlay off the other fourteen cells.
   */
  audio?: string | null;
  /** Muted text when the slot holds nothing crafted. */
  fallback?: string;
  /** Drop the weapon prefix — weapon cells already say "AK-47" above. */
  strip?: boolean;
  teams?: Team[] | null;
  value?: number | null;
  valueTip?: string;
  /** The slot holds something the mirror couldn't price — see PriceTag. */
  valueMissing?: boolean;
  wear?: number | null;
  seed?: number | null;
  /** Rarity colour for the glow wash. The border stripe is the parent's, since
   *  it rides on the same style binding as the selection ring. */
  rarity?: string | null;
  /** Default/unskinned art sits back so a crafted slot reads as the filled one. */
  dim?: boolean;
  /** A card render is in flight for this instance. */
  baking?: boolean;
  queued?: boolean;
  /** Entrance stagger index, and the key that re-runs it — switching sides or
   *  replacing the weapon should sweep, not teleport. */
  index?: number;
  artKey?: string;
  /** Agents are waist-cropped and need the bottom feather. */
  fadeArt?: boolean;
  /** Equipment cells breathe a little more around the art. */
  padArt?: boolean;
  /** Weapon cells offer "focus" in the hover cluster; gear slots don't. */
  focusAction?: boolean;
  /** Weapon cells put the hover actions in the same corner as the marks, so
   *  the marks step aside on hover. */
  fadeStatusOnHover?: boolean;
  /** The tiny extras tiles: marks only, identity in the title attribute. */
  compact?: boolean;
  showName?: boolean;
  showWear?: boolean;
  showPrice?: boolean;
  showBadges?: boolean;
}
