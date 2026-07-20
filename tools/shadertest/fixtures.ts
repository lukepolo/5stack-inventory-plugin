// Skins to regression-test, chosen to cover every paint style and the traps
// that have actually broken rendering before.
//
// `ref` is the official CDN render for the skin. It is a LIT render and this
// rig reads an UNLIT albedo atlas, so absolute values are not comparable —
// only use it for hue/chroma sanity, never for a brightness assertion.
export interface Fixture {
  name: string;
  model: string;
  pm: string;
  wear: number;
  seed: number;
  /** F_PAINT_STYLE we expect to resolve. Guards against template regressions. */
  style: number;
  /** Does this skin legitimately enable g_bUseOverlay? */
  overlay: boolean;
  /** Genuinely muted skin — exempt from the grey-detection threshold. */
  lowChroma?: boolean;
  /**
   * Override the grey-detection floor. The grey check asks "did the composite
   * collapse", but a fixture pinned at Battle-Scarred has legitimately stripped
   * most of its paint to bare metal, so a low atlas saturation is the CORRECT
   * answer there and the generic floor produces a false failure. Only lower
   * this for a fixture whose wear explains it, and say so in the note.
   */
  greyFloor?: number;
  /** Style carries no palette; the [0.5,0.5,0.5] fallback is correct. */
  paletteFallbackOk?: boolean;
  ref?: string;
  note?: string;
}

export const FIXTURES: Fixture[] = [
  {
    name: "FAMAS | Byproduct",
    model: "famas", pm: "/materials/hye_firework_patches_famas_ef491eaa.vcompmat.json",
    wear: 0.4082, seed: 821, style: 2, overlay: false,
    ref: "weapon_famas_hye_firework_patches_famas_5c0338e7",
    note: "REGRESSION GUARD: g_bUseOverlay=0 but ships a 1x1 grey g_tOverlay. " +
          "With F_OVERLAY_MASK=0 and BLEND_MODE=0 that replaced the entire paint " +
          "with flat grey (sat 5.0). If sat drops near 0 here, the overlay gate broke.",
  },
  {
    name: "P90 | Desert Halftone",
    model: "p90", pm: "/materials/ht_simple_camo_35a9b53a.vcompmat.json",
    wear: 0.11, seed: 637, style: 2, overlay: false,
    ref: "weapon_p90_ht_simple_camo_9da81e0d",
    note: "noPaint + F_SPRAYPAINT_HALFTONE reference case. noPaint = ao.a, UNGATED — " +
          "the old base-metalness gate painted the polymer sights/barrel and left only " +
          "the serial markings bare (see README); halftone thresholds pattern channels against the dot screen " +
          "in pattern.a (that is where the crisp posterised camo comes from — without " +
          "it the render is soft mid-tone mush at 16% contrast). If this fixture's sat " +
          "drops toward ~23, the halftone gate regressed. Known residual: sight towers " +
          "take paint (geometry, not shader — see README).",
  },
  {
    name: "Five-SeveN | Autumn Thicket",
    model: "fiveseven", pm: "/materials/soo_branches_1bfe8683.vcompmat.json",
    wear: 0.265, seed: 871, style: 0, overlay: true,
    note: "The one skin here that DOES enable g_bUseOverlay. If overlay goes false, " +
          "the gate is over-eager and real overlay finishes are being dropped.",
  },
  {
    name: "MAG-7 | Navy Shine",
    model: "mag7", pm: "/materials/am_navy_shine_122024d8.vcompmat.json",
    wear: 0.415, seed: 100, style: 4, overlay: false,
    ref: "weapon_mag7_am_navy_shine_df15b9ff",
    note: "Style 4 (anodized). Was compositing far too bright until palette colours " +
          "were converted sRGB->linear; keep as a guard on that conversion.",
  },
  {
    name: "AK-47 | Safari Mesh",
    model: "ak47", pm: "/materials/sp_mesh_tan_a6d0e8e8.vcompmat.json",
    wear: 0.265, seed: 624, style: 2, overlay: false,
    ref: "weapon_ak47_sp_mesh_tan_cf3d00ad",
    note: "CHROMA GUARD. Carries its palette in a dedicated compiled vmat (sRGB 0-1), " +
          "not as loose m_cValueColor4 — so it is the fixture that catches the " +
          "sRGB->linear palette conversion regressing. Before that fix it rendered " +
          "pale grey-green (sat 16.3 vs the reference's 29.9); after, warm olive at 23.9.",
  },
  {
    name: "M4A4 | Tooth Fairy",
    model: "m4a1", pm: "/materials/cu_m4a4_queenfairy_db75e394.vcompmat.json",
    wear: 0.11, seed: 567, style: 6, overlay: false, paletteFallbackOk: true,
    ref: "weapon_m4a1_cu_m4a4_queenfairy_154b05fb",
    note: "Style 6 takes its colour straight from the pattern texture, so it carries no " +
          "g_vColor palette — the [0.5,0.5,0.5] fallback is expected here, not a bug.",
  },
  {
    name: "XM1014 | XOXO",
    model: "xm1014", pm: "/materials/aq_xm1014_punk_faab7aa5.vcompmat.json",
    wear: 0.725, seed: 295, style: 7, overlay: false,
    ref: "weapon_xm1014_aq_xm1014_punk_17e62d76",
    note: "Style 7 (antiqued) patina path, at high float.",
  },
  {
    name: "P90 | Tangled",
    model: "p90", pm: "/materials/gs_p90_tangled_9ba92d28.vcompmat.json",
    wear: 0.265, seed: 311, style: 8, overlay: false, lowChroma: true,
    ref: "weapon_p90_gs_p90_tangled_4ac647b8",
    note: "Style 8 (gunsmith). Reference is itself near-monochrome (sat 8.3).",
  },
  {
    name: "M249 | Sage Camo",
    model: "m249", pm: "/materials/hyo_jungle_desat_28ddab92.vcompmat.json",
    wear: 0.725, seed: 231, style: 1, overlay: true, lowChroma: true, greyFloor: 1,
    ref: "weapon_m249_hyo_jungle_desat_47d5846e",
    note: "Style 1 (hydrographic) at Battle-Scarred. Legitimately enables an overlay " +
          "(m249_spray_overlay: flat dark RGB, shape in alpha) and uses F_OVERLAY_MASK=6. " +
          "Kept as the mode-6 canary. NOTE: noPaint is no longer pinned to 0 (the " +
          "metalness gate came off), so mode 6's gate = 1-noPaint is live here now.\n" +
          "greyFloor is lowered because the atlas SHOULD be near-grey at this wear. " +
          "MEASURED through runViewer against the CDN reference (lit-render saturation): " +
          "wear 0.02 -> 12.1, 0.35 -> 9.4, 0.725 -> 4.6, reference 8.7 — the reference is " +
          "a moderately-worn render, and our wear response is smooth and monotonic across " +
          "the range. Atlas sat at 0.725 is 1.9. It read 3.4 before the HD composite-input " +
          "switch, and that was the BUG: with the legacy cavity map (mean 0.229, 6% above " +
          "0.5 vs the HD map's 0.306 / 27.7%) this skin barely wore at all — Battle-Scarred " +
          "looked almost like Factory New. Do NOT 'fix' a low number here by restoring the " +
          "old inputs; check the wear sweep instead.",
  },
];

/** Wear values swept per fixture when checking that wear actually does something. */
export const WEAR_SWEEP = [0.0, 0.11, 0.38, 0.62, 0.95];

/** Seeds swept per fixture when checking that the pattern seed does something.
 *  0 and 1 are deliberately NOT both here: CUniformRandomStream maps them to the
 *  same stream (idum = -seed, then idum <= 0 is forced to 1), so a 0-vs-1 pair
 *  renders identically by design and would read as a false failure. */
export const SEED_SWEEP = [1, 387, 661, 955];
