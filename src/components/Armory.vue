<script setup lang="ts">
// THE ARMORY — the plugin's third screen, and the only one that isn't about
// things you already have.
//
// The loadout is a rack with fifteen holes to fill. The inventory is a drawer
// of what you own. Both are inward-facing: every tile on them is a possession,
// and both start from a slot. That made "I just want to make an AK skin" a
// four-step detour through a loadout position, and it made a sticker — which
// fits no slot at all — unreachable.
//
// So this is deliberately shaped as a place you WANDER rather than a form you
// complete: category rail on the left, everything CS2 ships in the middle, and
// one click into the editor from any of it.
//
// The one thing that isn't in the rest of the app is the HERO. Every other grid
// here is uniform tiles at uniform size, which is right for scanning what you
// own and wrong for browsing 10,000 things you don't — at 92px a Case Hardened
// and a Blue Laminate are the same blue smudge. So the band up top shows
// whatever you're pointing at, big, with the rarity bleeding into the backdrop.
// Browsing becomes inspecting, and the page announces itself as a different
// kind of surface without borrowing a single new colour or typeface to do it.
import { computed, inject, nextTick, ref, shallowRef, watch } from "vue";
import { makeRail, railTransition } from "../pill";
import { ChevronRight, Loader2, Search, X } from "lucide-vue-next";
import {
  fetchSkins,
  searchAttachments,
  type AttachFacet,
  type AttachKind,
  type CatalogWeapon,
  type Skin,
} from "../api";
import { CARD_ART, glowStyle, itemName, rarityName, rarityRank, stripName } from "../itemVisuals";
import {
  ATTACH_SORTS, DEFAULT_ATTACH_SORT, ATTACH_SORT_NATURAL, ATTACH_DIR_HINT, ATTACH_SORT_KIND,
  type AttachSortMode,
} from "../sortModes";
import { useSortControl } from "../composables/useSortControl";
import ItemName from "./ItemName.vue";
import InfiniteSentinel from "./InfiniteSentinel.vue";
import CatalogFilters, { type FacetAxis, type FacetOption } from "./CatalogFilters.vue";

const props = defineProps<{
  /** Already loaded by App — the armory never re-fetches the weapon list. */
  weapons: CatalogWeapon[];
  compact: boolean;
}>();
const emit = defineEmits<{
  (e: "pick", skin: Skin): void;
}>();

const tr = inject<(k: string, f: string) => string>("tr", (_k, f) => f);

// ---- what the rail lists -----------------------------------------------------
// `weapons` drills one level deeper than the rest (model, then finish); `slot`
// and `attach` land straight on items. Kept as data rather than nine branches
// so the rail, the fetch and the breadcrumb all read from one place.
type Section =
  | { key: string; label: string; kind: "weapons" }
  | { key: string; label: string; kind: "slot"; slot: string }
  | { key: string; label: string; kind: "attach"; attach: AttachKind };

const SECTIONS: Section[] = [
  { key: "weapon", label: "Weapons", kind: "weapons" },
  { key: "knife", label: "Knives", kind: "slot", slot: "knife" },
  { key: "gloves", label: "Gloves", kind: "slot", slot: "gloves" },
  { key: "agent", label: "Agents", kind: "slot", slot: "agent" },
  { key: "musickit", label: "Music Kits", kind: "slot", slot: "musickit" },
  { key: "graffiti", label: "Graffiti", kind: "slot", slot: "graffiti" },
  { key: "collectible", label: "Pins & Medals", kind: "slot", slot: "collectible" },
  { key: "sticker", label: "Stickers", kind: "attach", attach: "sticker" },
  { key: "charm", label: "Charms", kind: "attach", attach: "charm" },
  { key: "patch", label: "Patches", kind: "attach", attach: "patch" },
];
/**
 * The rail's two halves, NAMED — gear you equip, then things you stick on it.
 *
 * Headed groups rather than the bare hairline that was here before, matching the
 * panel's settings side-tabs: nine flat entries with a rule two-thirds down
 * leaves you to infer what the rule meant.
 */
const RAIL_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Gear", keys: ["weapon", "knife", "gloves", "agent", "musickit", "graffiti", "collectible"] },
  { label: "Attachments", keys: ["sticker", "charm", "patch"] },
];
const railGroups = computed(() =>
  RAIL_GROUPS.map((g) => ({
    label: g.label,
    items: g.keys.map((k) => SECTIONS.find((s) => s.key === k)!).filter(Boolean),
  })),
);

// CS2's own buy-menu grouping. Ordered as the buy menu orders it, because that
// is the order these weapons live in every player's head.
const WEAPON_GROUPS: { key: string; label: string }[] = [
  { key: "secondary", label: "Pistols" },
  { key: "smg", label: "SMGs" },
  { key: "rifle", label: "Rifles" },
  { key: "heavy", label: "Heavy" },
];

const sectionKey = ref("weapon");
const section = computed(() => SECTIONS.find((s) => s.key === sectionKey.value) ?? SECTIONS[0]);
// Vertical sibling of the tab pill every other strip in this app uses — the
// indicator travels on the same spring, and takes each entry's HEIGHT because a
// column's tabs aren't all one size.
//
// Declared AFTER sectionKey, and that is not cosmetic: `immediate` runs this
// getter during setup, and reading a `const` declared further down throws on the
// temporal dead zone — which takes the whole screen out, since a setup that
// throws mounts nothing. vue-tsc does not catch it; the access is in a closure.
const rail = makeRail();
watch(
  () => [sectionKey.value, props.compact] as const,
  () => nextTick(() => rail.sync(sectionKey.value)),
  { immediate: true },
);
/** The weapon drilled into, within the Weapons section. Null = still picking one. */
const model = ref<string | null>(null);
const weaponGroup = ref("");
const q = ref("");

// ---- results -----------------------------------------------------------------
// shallowRef: these lists run to thousands of plain data objects that are only
// ever replaced wholesale, and deep reactivity on them costs a proxy per row for
// nothing.
const rows = shallowRef<Skin[]>([]);
const total = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
/** Every response is checked against this, so a slow fetch for a section you
 *  have since navigated away from can't append its rows to another one's list. */
let token = 0;

const ATTACH_PAGE = 120;
const attachDone = computed(() => rows.value.length >= total.value);

// ---- facets ------------------------------------------------------------------
// Two sources, one shape. The attachment catalogs are faceted by the SERVER
// (they're too big to hold), everything else derives its facets from the rows it
// already has. `tabs`/`axes` below flatten that difference so CatalogFilters
// never has to know which kind it is looking at.
const group = ref("");
const facet = ref<Record<string, string>>({});
// Same control the inventory grid, loadout sheet and attachment picker use —
// see composables/useSortControl.ts. The refetch is already handled by the
// watcher below, so this one needs no `onChange`.
const {
  mode: sort, dir, setMode: setSort, setDir,
  kind: sortKind, hint: dirHint,
} = useSortControl<AttachSortMode>({
  scope: "armory",
  fallback: DEFAULT_ATTACH_SORT,
  natural: ATTACH_SORT_NATURAL,
  hints: ATTACH_DIR_HINT,
  kinds: ATTACH_SORT_KIND,
});

const srvGroups = ref<AttachFacet[]>([]);
const srvCollections = ref<AttachFacet[]>([]);
const srvRarities = ref<AttachFacet[]>([]);
const queryTotal = ref(0);
/** Graffiti ships its own splits; nothing else in the slot catalogs does. */
const sheetGroups = ref<{ value: string; label: string }[]>([]);
const sheetTints = ref<{ value: string; label: string; color: string }[]>([]);

/** Count of rows matching everything EXCEPT the given axis — so a control can
 *  say what picking it would leave without excluding itself. */
function countBy(pick: (s: Skin) => string | undefined, skip: string) {
  const seen = new Map<string, number>();
  for (const s of rows.value) {
    if (!passes(s, skip)) continue;
    const v = pick(s);
    if (v) seen.set(v, (seen.get(v) ?? 0) + 1);
  }
  return seen;
}
/** Does this row survive the active filters, optionally ignoring one axis? */
function passes(s: Skin, skip = "") {
  if (skip !== "group" && group.value && (s.group ?? "") !== group.value) return false;
  if (skip !== "rarity" && facet.value.rarity && s.rarity !== facet.value.rarity) return false;
  if (skip !== "collection" && facet.value.collection && (s.collection ?? "") !== facet.value.collection) return false;
  if (skip !== "tint" && facet.value.tint && (s.tintName ?? "") !== facet.value.tint) return false;
  return true;
}

const isAttach = computed(() => section.value.kind === "attach");
const tabs = computed<FacetOption[]>(() => {
  if (isAttach.value) {
    if (srvGroups.value.length < 2) return [];
    // "All" is the UI's own tab and goes LAST, counting matches for the text
    // query alone — summing the others double-counts, because "Logos & Art" is
    // a union of two of them.
    return [
      // `label` is optional on a facet (rarity facets are bare hexes the UI
      // names itself), so never let it reach the bar undefined — a tab with no
      // text is a tab you cannot tell from the next one.
      ...srvGroups.value.map((g) => ({ value: g.value, label: g.label ?? g.value, count: g.count })),
      { value: "", label: "All", count: queryTotal.value },
    ];
  }
  if (!sheetGroups.value.length) return [];
  const counts = countBy((s) => s.group, "group");
  return [
    { value: "", label: "All", count: rows.value.length },
    ...sheetGroups.value.map((g) => ({ value: g.value, label: g.label, count: counts.get(g.value) ?? 0 })),
  ];
});
const axes = computed<FacetAxis[]>(() => {
  if (isAttach.value) {
    const out: FacetAxis[] = [];
    if (srvCollections.value.length > 1) {
      out.push({ key: "collection", label: "Collection", options: srvCollections.value.map((c) => ({ value: c.value, label: c.label ?? c.value, count: c.count })) });
    }
    if (srvRarities.value.length > 1) {
      out.push({ key: "rarity", dots: true, options: srvRarities.value.map((r) => ({ value: r.value, label: rarityName(r.value), count: r.count, color: r.value })) });
    }
    return out;
  }
  const out: FacetAxis[] = [];
  // Colourways, for the catalogs that have them (graffiti).
  if (sheetTints.value.length > 1) {
    const counts = countBy((s) => s.tintName, "tint");
    out.push({
      key: "tint",
      label: "Colour",
      dots: true,
      options: sheetTints.value
        .filter((t) => counts.has(t.label))
        .map((t) => ({ value: t.label, label: t.label, count: counts.get(t.label), color: t.color })),
    });
  }
  // Rarity, derived. Every catalog has it, and until now only the two big
  // attachment ones could filter by it.
  const rc = countBy((s) => s.rarity, "rarity");
  if (rc.size > 1) {
    out.push({
      key: "rarity",
      dots: true,
      options: [...rc.entries()]
        .sort((a, b) => rarityRank(a[0]) - rarityRank(b[0]))
        .map(([hex, n]) => ({ value: hex, label: rarityName(hex), count: n, color: hex })),
    });
  }
  // Collections, where the catalog names them.
  const cc = countBy((s) => s.collection, "collection");
  if (cc.size > 1) {
    out.push({
      key: "collection",
      label: "Collection",
      options: [...cc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([v, n]) => ({ value: v, label: v, count: n })),
    });
  }
  return out;
});
function clearFacets() {
  group.value = "";
  facet.value = {};
}

/**
 * Sort a list this screen holds in full.
 *
 * The attachment catalogs sort on the SERVER — they are paged, so ordering a
 * page in the client would sort 120 of 10,565 rows and call it a catalog.
 */
function sortLocal(list: Skin[]): Skin[] {
  const flip = dir.value === "asc" ? -1 : 1;
  const byName = (a: Skin, b: Skin) => itemName(a).localeCompare(itemName(b));
  const arr = [...list];
  if (sort.value === "name") return arr.sort((a, b) => -flip * byName(a, b));
  if (sort.value === "rarity") {
    return arr.sort((a, b) => flip * (rarityRank(b.rarity) - rarityRank(a.rarity)) || byName(a, b));
  }
  return dir.value === "asc" ? arr.reverse() : arr; // "Collection" = catalog order
}

/** The weapon MODELS on offer, when the Weapons section hasn't been drilled into. */
const weaponModels = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return props.weapons
    .filter((w) => !weaponGroup.value || w.category === weaponGroup.value)
    .filter((w) => !needle || w.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));
});

/**
 * The tiles currently on screen, as one shape.
 *
 * Weapon models are not `Skin`s — they have no rarity and picking one drills
 * rather than crafts — so they are mapped in here rather than forced through
 * the same type, and `drill` is what the click handler switches on.
 */
type Tile = {
  key: string;
  name: string;
  image: string | null;
  rarity?: string;
  altName?: string | null;
  /** Set when clicking goes DEEPER instead of opening the editor. */
  drill?: string;
  skin?: Skin;
  /** Secondary line in the hero — "Rifle", "Classified", etc. */
  note?: string;
};

const tiles = computed<Tile[]>(() => {
  if (section.value.kind === "weapons" && !model.value) {
    return weaponModels.value.map((w) => ({
      key: `w-${w.model}`,
      name: w.name,
      image: w.image,
      drill: w.model,
      note: WEAPON_GROUPS.find((g) => g.key === w.category)?.label ?? w.category,
    }));
  }
  // Attachment catalogs are searched and faceted server-side; everything else
  // arrives whole and is narrowed here, which keeps typing instant on a 60-item
  // knife list and costs one pass over a few hundred rows at worst.
  const needle = isAttach.value ? "" : q.value.trim().toLowerCase();
  const local = isAttach.value
    ? rows.value
    : rows.value.filter((s) => passes(s) && (!needle || itemName(s).toLowerCase().includes(needle)));
  const sorted = isAttach.value ? local : sortLocal(local);
  return sorted
    .map((s) => ({
      key: `s-${s.id}`,
      name: itemName(s),
      image: s.image,
      rarity: s.rarity,
      altName: s.altName,
      skin: s,
      note: s.collection ?? undefined,
    }));
});

async function load(offset = 0) {
  const sec = section.value;
  const mine = ++token;
  if (offset === 0) {
    loading.value = true;
    rows.value = [];
    total.value = 0;
  } else {
    loadingMore.value = true;
  }
  try {
    if (sec.kind === "weapons" && !model.value) {
      // Nothing to fetch — the weapon list came with the catalog.
      return;
    }
    if (sec.kind === "attach") {
      // Faceted SERVER-side: 10.5k stickers is more than a browser should hold,
      // let alone filter. The narrowing controls are query params here, where
      // every other section filters a list it already has.
      const page = await searchAttachments(sec.attach, {
        q: q.value.trim(),
        group: group.value,
        collection: facet.value.collection ?? "",
        rarity: facet.value.rarity ?? "",
        sort: sort.value,
        dir: dir.value,
        offset,
        limit: ATTACH_PAGE,
      });
      if (mine !== token) return;
      rows.value = offset === 0 ? page.items : [...rows.value, ...page.items];
      total.value = page.total;
      srvGroups.value = page.groups ?? [];
      srvCollections.value = page.collections ?? [];
      srvRarities.value = page.rarities ?? [];
      queryTotal.value = page.queryTotal ?? page.total;
      return;
    }
    const slot = sec.kind === "weapons" ? model.value! : sec.slot;
    const res = await fetchSkins(slot);
    if (mine !== token) return;
    rows.value = res.skins;
    total.value = res.skins.length;
    // Graffiti is the one local catalog whose splits aren't in any item field,
    // so it ships them alongside the list. Everything else derives its facets
    // from the rows themselves (see localTabs / localAxes).
    sheetGroups.value = res.groups ?? [];
    sheetTints.value = res.tints ?? [];
  } catch {
    // A catalog that fails to load leaves an empty grid and its own message —
    // this screen is a browser, and a toast over a blank page says less than
    // the blank page does.
    if (mine === token) {
      rows.value = [];
      total.value = 0;
    }
  } finally {
    if (mine === token) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}
function loadMore() {
  if (section.value.kind !== "attach" || loading.value || loadingMore.value || attachDone.value) return;
  void load(rows.value.length);
}

// Section / drill changes reset the view AND its filters: a collection picked
// among stickers means nothing among knives, and carrying it over would show an
// empty grid with no visible cause.
watch([sectionKey, model], () => {
  hover.value = null;
  group.value = "";
  facet.value = {};
  scroller.value?.scrollTo({ top: 0 });
  void load();
});
// Only the server-faceted catalogs re-fetch. The rest hold their whole list, so
// search and facets are a local filter and re-fetching would be a round trip to
// arrive at the same rows.
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch([q, group, facet, sort, dir], () => {
  if (section.value.kind !== "attach") return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 220);
}, { deep: true });
void load();

function openSection(key: string) {
  if (sectionKey.value === key && !model.value) return;
  sectionKey.value = key;
  model.value = null;
  weaponGroup.value = "";
  q.value = "";
}
function onTile(t: Tile) {
  if (t.drill) {
    model.value = t.drill;
    q.value = "";
    return;
  }
  if (t.skin) emit("pick", t.skin);
}

// ---- the hero ----------------------------------------------------------------
// Whatever the cursor is on, falling back to the first tile so the band is never
// empty — an empty hero would make the page look broken on arrival, and the
// first row is a fair advertisement for what the section holds.
const hover = ref<Tile | null>(null);
const hero = computed<Tile | null>(() => hover.value ?? tiles.value[0] ?? null);

const crumbs = computed(() => {
  const out: { label: string; back?: () => void }[] = [{ label: section.value.label }];
  if (section.value.kind === "weapons" && model.value) {
    out[0].back = () => (model.value = null);
    const w = props.weapons.find((x) => x.model === model.value);
    out.push({ label: w?.name ?? model.value });
  }
  return out;
});

const scroller = ref<HTMLElement | null>(null);
const count = computed(() =>
  section.value.kind === "attach" ? total.value : tiles.value.length,
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- Header. Deliberately quieter than the loadout's — this screen's identity
         is carried by the hero below it, and two loud bands stacked would fight.
         No back-link: this is a top-level tab now, a peer of Loadout and
         Inventory, and a "‹ Inventory" on a sibling would claim you came from
         there and owe it a way back. The tab strip above is the way back. -->
    <div class="flex min-h-[44px] flex-none items-center gap-3 border-b border-border px-4 py-2">
      <span class="flex-none text-f11 font-semibold uppercase tracking-cs2">The Armory</span>
      <!-- No tagline. "Everything in the game" was a caption on a title that
           already says it, and with a facet bar underneath the header now has
           three rows of chrome competing before the first tile. -->
      <span
        v-if="!compact && crumbs.length > 1"
        class="flex-none text-f9 uppercase tracking-cs1 text-muted-foreground/50"
      >{{ crumbs[crumbs.length - 1].label }}</span>
      <div class="relative ml-auto w-[220px] min-w-[120px] shrink">
        <Search class="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="q"
          :placeholder="tr('inventory.armory.search', 'Search…')"
          class="h-8 w-full rounded-md border border-border bg-background py-1 pl-9 pr-8 text-f11 outline-none transition-colors focus:border-[color:var(--acc)]"
        />
        <button
          v-if="q"
          class="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
          title="Clear"
          @click="q = ''"
        ><X class="h-3.5 w-3.5" /></button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <!-- ============ RAIL ============
           A manifest, not a nav bar: uppercase micro-labels, the active one
           marked by an accent bar on its leading edge rather than a fill, so the
           column reads as a list of places and not a row of buttons. -->
      <nav
        v-if="!compact"
        :ref="(el) => rail.setListEl(el)"
        aria-label="Catalog sections"
        class="animate-rail-in relative flex w-[172px] flex-none flex-col gap-1 overflow-y-auto border-r border-border/70 py-2 pl-2 pr-2"
      >
        <!-- The travelling marker, on the rail's own edge. Sits at right:-1px so
             it lands ON the border rather than beside it, which is what makes the
             column read as a set of tabs and not a list of buttons.
             Inline transition/shadow: an arbitrary tailwind value carrying a
             decimal gets mangled in this remote's injected CSS, which is the same
             reason the fontSize and tracking tokens exist. -->
        <div
          v-show="rail.h.value > 0"
          class="pointer-events-none absolute -right-px top-0 z-10 w-0.5 rounded-full"
          :style="{
            transform: `translateY(${rail.y.value}px)`,
            height: rail.h.value + 'px',
            background: 'hsl(var(--tac-amber, 33 94% 58%))',
            boxShadow: '0 0 8px hsl(var(--tac-amber, 33 94% 58%) / 0.45)',
            transition: railTransition(rail.animated.value),
          }"
        ></div>

        <div
          v-for="(g, gi) in railGroups"
          :key="g.label"
          class="flex flex-col gap-1"
          :class="gi > 0 ? 'mt-4' : ''"
        >
          <!-- --tac-amber, NOT --acc. `--acc` is the TEAM accent and flips to
               CT blue with the side switch, which turned a piece of permanent
               furniture into a team readout — the rail says nothing about CT or
               T. The panel's settings side-tabs head their groups in the fixed
               tactical amber for the same reason, and the indicator below
               already uses it. -->
          <p
            class="px-3 pb-1 font-mono text-f9 font-semibold uppercase tracking-cs4"
            style="color: hsl(var(--tac-amber, 33 94% 58%))"
          >
            {{ g.label }}
          </p>
          <!-- Row styling stays the plugin's own (secondary tints, the same
               ones every other list here uses). What we borrowed from the
               panel's side-tabs is the INDICATOR — that is what makes a column
               of buttons read as tabs, and it is the part that was missing. -->
          <button
            v-for="s in g.items"
            :key="s.key"
            :ref="(el) => rail.setRef(s.key, el)"
            :aria-current="sectionKey === s.key ? 'page' : undefined"
            class="relative z-[1] flex h-9 w-full items-center justify-start overflow-hidden rounded-sm px-3 text-left text-f10 uppercase tracking-cs1 transition-colors duration-200"
            :class="sectionKey === s.key
              ? 'bg-secondary/60 text-foreground'
              : 'text-muted-foreground hover:bg-secondary/30 hover:text-foreground'"
            @click="openSection(s.key)"
          >
            <span class="truncate">{{ s.label }}</span>
          </button>
        </div>
      </nav>

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <!-- Compact rail: the same list as a horizontal scroller. -->
        <div v-if="compact" class="flex flex-none gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
          <button
            v-for="s in SECTIONS"
            :key="s.key"
            class="flex-none rounded-md border px-2.5 py-1 text-f9 uppercase tracking-cs1 transition-colors"
            :class="sectionKey === s.key ? 'border-[color:var(--acc)] text-foreground' : 'border-border text-muted-foreground'"
            @click="openSection(s.key)"
          >{{ s.label }}</button>
        </div>

        <!-- ============ HERO ============
             The page's one break from the app's uniform-tile rhythm. The rarity
             colour bleeds out of the artwork into the band behind it, so the
             thing you're pointing at tints its own surroundings — which is what
             a lit display case does, and what a grid of 92px thumbnails can
             never do. -->
        <div
          v-if="hero && !compact"
          class="relative flex h-[132px] flex-none items-center gap-5 overflow-hidden border-b border-border px-6"
        >
          <!-- Atmosphere, in two layers: the item's own rarity as a soft wash
               off to the left where the art sits, and a fine hatch over the
               whole band so the empty right-hand side has texture rather than
               being flat card colour. -->
          <span
            class="pointer-events-none absolute inset-0 transition-opacity duration-500"
            :style="glowStyle(hero.rarity, 0.16)"
          ></span>
          <span
            class="pointer-events-none absolute inset-0 opacity-[0.35]"
            style="
              background-image: repeating-linear-gradient(
                115deg,
                transparent 0 7px,
                hsl(var(--muted-foreground) / 0.05) 7px 8px
              );
            "
          ></span>
          <span class="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[color:var(--acc)] to-transparent opacity-40"></span>
          <!-- Where you are, set as a watermark. The band is 130px of full-bleed
               and the name only claims the first third of it; the rest read as
               forgotten space, worst of all on a grey sticker where there is no
               rarity wash to fill it. Ghosted this far down it registers as
               texture until you look straight at it, and then it answers "which
               shelf is this" without spending a row on a heading.
               Inline sizing and colour on purpose — arbitrary tailwind values
               carrying a decimal get mangled in this remote's injected CSS. -->
          <span
            class="pointer-events-none absolute right-6 top-1/2 z-[1] -translate-y-1/2 select-none whitespace-nowrap font-bold uppercase leading-none tracking-cs4"
            style="font-size: 62px; color: hsl(var(--foreground) / 0.045)"
          >{{ crumbs[crumbs.length - 1].label }}</span>

          <!-- overflow-hidden: art is clamped by max-h, which needs the image to
               declare an intrinsic size. Every real icon does; anything that
               doesn't would otherwise size to the well's WIDTH and spill out of
               the band top and bottom. -->
          <div class="relative z-[2] grid h-[104px] w-[188px] flex-none place-items-center overflow-hidden">
            <img
              :key="hero.key"
              :src="hero.image ?? undefined"
              alt=""
              class="animate-fade-in max-h-full max-w-full object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]"
            />
          </div>
          <div class="relative z-[2] flex min-w-0 flex-col gap-1">
            <!-- The one place in this plugin that sets a name at display size.
                 It earns it: at 22px a finish's name is legible from across the
                 desk, which is the difference between browsing and squinting. -->
            <span
              :key="hero.key"
              class="animate-fade-in truncate text-[22px] font-semibold uppercase leading-tight tracking-cs1"
            >{{ stripName(hero.name) }}</span>
            <!-- The rarity is NAMED and set in its own colour rather than
                 hinted by a swatch. Most finishes carry no phase and no
                 collection, so the swatch was routinely the entire second line:
                 a lone coloured dot under the title, reading as a rendering
                 fault rather than as "Classified". A word cannot be orphaned. -->
            <span class="flex items-center gap-2 text-f10 uppercase tracking-cs1 text-muted-foreground">
              <span v-if="hero.rarity" class="flex-none font-semibold" :style="{ color: hero.rarity }">{{ rarityName(hero.rarity) }}</span>
              <span v-if="hero.rarity && (hero.altName || hero.note)" class="text-muted-foreground/40">·</span>
              <span v-if="hero.altName" class="text-[color:var(--acc)]">{{ hero.altName }}</span>
              <span v-if="hero.altName && hero.note" class="text-muted-foreground/40">·</span>
              <span v-if="hero.note" class="truncate">{{ hero.note }}</span>
              <span v-if="hero.drill" class="text-muted-foreground/50">{{ tr('inventory.armory.drill', 'Browse finishes') }}</span>
            </span>
          </div>
        </div>

        <!-- Breadcrumb + count. One line, because depth here is never more than
             two and a full-height header for it would eat the grid. -->
        <div class="flex flex-none items-center gap-2 border-b border-border px-4 py-1.5">
          <template v-for="(c, i) in crumbs" :key="i">
            <ChevronRight v-if="i" class="h-3 w-3 flex-none text-muted-foreground/40" />
            <button
              v-if="c.back"
              class="flex-none text-f10 uppercase tracking-cs1 text-muted-foreground transition-colors hover:text-foreground"
              @click="c.back()"
            >{{ c.label }}</button>
            <span v-else class="flex-none text-f10 uppercase tracking-cs1" :class="i === crumbs.length - 1 ? 'text-foreground' : 'text-muted-foreground'">{{ c.label }}</span>
          </template>

          <!-- Buy-menu groups, only while choosing a weapon. -->
          <template v-if="section.kind === 'weapons' && !model">
            <span class="mx-1 h-3.5 w-px flex-none bg-border"></span>
            <button
              v-for="g in WEAPON_GROUPS"
              :key="g.key"
              class="flex-none rounded px-1.5 py-0.5 text-f9 uppercase tracking-cs1 transition-colors"
              :class="weaponGroup === g.key ? 'bg-secondary text-foreground' : 'text-muted-foreground/60 hover:text-foreground'"
              @click="weaponGroup = weaponGroup === g.key ? '' : g.key"
            >{{ g.label }}</button>
          </template>

          <span v-if="!loading" class="ml-auto flex-none font-mono text-f9 text-muted-foreground/50">{{ count }}</span>
        </div>

        <!-- Facets. The SAME bar the picker uses — one component, so a rarity
             dropdown behaves identically wherever you meet it. Hidden when the
             catalog on screen has nothing to split: the weapon LIST is 35 rows
             with no rarity of their own, and a bar of empty controls over it
             would be chrome pretending to be a tool. -->
        <div
          v-if="!loading && (tabs.length > 1 || axes.length)"
          class="flex flex-none items-center border-b border-border px-4 py-2"
        >
          <CatalogFilters
            class="w-full"
            :tabs="tabs"
            :tab="group"
            :axes="axes"
            :axis-values="facet"
            :sorts="ATTACH_SORTS"
            :sort="sort"
            :dir="dir"
            :sort-kind="sortKind"
            :dir-hint="dirHint"
            default-tab=""
            :compact="compact"
            @update:tab="group = $event"
            @update:axis="(k, v) => (facet = { ...facet, [k]: v })"
            @update:sort="setSort"
            @update:dir="setDir"
            @clear="clearFacets"
          />
        </div>

        <!-- ============ GRID ============ -->
        <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto p-3">
          <div v-if="loading" class="grid place-items-center py-16 text-muted-foreground">
            <Loader2 class="h-5 w-5 animate-spin" />
          </div>
          <template v-else>
            <div
              class="animate-grid-in grid gap-2"
              style="grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); grid-auto-rows: 136px"
            >
              <button
                v-for="(t, i) in tiles"
                :key="t.key"
                class="cv-tile group relative flex h-full flex-col items-center overflow-hidden rounded-md border border-border bg-background p-2 transition-colors hover:border-[color:var(--acc)]"
                :class="i < 120 ? 'animate-cell-in' : ''"
                :style="{ ...(t.rarity ? { borderBottom: `3px solid ${t.rarity}` } : {}), '--i': i, '--cis': '136px' }"
                :title="t.name"
                @mouseenter="hover = t"
                @focus="hover = t"
                @click="onTile(t)"
              >
                <span class="pointer-events-none absolute inset-0" :style="glowStyle(t.rarity, 0.2)"></span>
                <!-- Drilling in is a different act from crafting, so it gets a
                     different affordance: a chevron that slides out on hover
                     rather than the plain lift every craftable tile has. -->
                <span
                  v-if="t.drill"
                  class="pointer-events-none absolute right-1 top-1 z-[3] text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[color:var(--acc)]"
                ><ChevronRight class="h-3.5 w-3.5" /></span>
                <div :class="CARD_ART">
                  <img
                    :src="t.image ?? undefined"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="max-h-full max-w-full object-contain transition-transform duration-200 ease-out group-hover:scale-110"
                  />
                </div>
                <ItemName
                  v-if="t.skin"
                  :item="t.skin"
                  strip
                  class="relative z-[2] w-full text-center"
                />
                <span
                  v-else
                  class="relative z-[2] w-full truncate text-center text-f9 uppercase tracking-cs1 text-muted-foreground"
                >{{ t.name }}</span>
              </button>
            </div>

            <div v-if="!tiles.length" class="py-16 text-center text-f13 text-muted-foreground">
              <template v-if="q">No {{ section.label.toLowerCase() }} match “{{ q }}”.</template>
              <template v-else>Nothing here yet.</template>
            </div>

            <!-- Attachment catalogs are the only paged ones; everything else
                 arrived whole. -->
            <InfiniteSentinel
              v-if="section.kind === 'attach'"
              :count="rows.length"
              :done="attachDone"
              root-margin="1200px"
              @hit="loadMore"
            />
            <div v-if="loadingMore" class="flex items-center justify-center gap-2 py-4 text-f10 uppercase tracking-cs1 text-muted-foreground">
              <Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading more…
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
