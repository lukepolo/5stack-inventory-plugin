/**
 * A pet's STYLE: which of its model's material groups it wears.
 *
 * CS2 sets `m_materialGroup` on the chicken to the style number as a string, and
 * each breed names its groups "default", "1".."N" — N being cs2-lib's
 * styleCount. The glTF export only ever writes the default group, so the GLB
 * arrives in the stock look and every other group comes from
 * `models/pet-styles.json` (extract-models.sh, step pet-models): per model the
 * group -> material list, per material its texture params by their own names.
 *
 * A group lists one material per SLOT of the default group, in the same order,
 * so slot i of "default" is replaced by slot i of the chosen group. The GLB's
 * materials are named after the vmat they came from, which is how a slot is
 * found on the mesh.
 *
 * Only the colour and normal maps are swapped. The GLB's packed ORM is built
 * from the default group's AO + metalness, and the styles share the breed's AO;
 * their `g_tMetalness` differs, but as compiler-generated constants rather than
 * painted maps, so the stock roughness is the closer approximation until the
 * csgo_character shading is read properly.
 *
 * THREE is threaded in rather than imported — see charmMaterial.ts.
 */
import type * as ThreeNS from "three";
import { getAssetOrigin, withAssetVersion } from "./api";
import { type CharmShading, tuneCharmShading } from "./charmMaterial";
import { petSeedAttributes, runVfx, type PetSeedTable } from "./petPattern";

type Three = typeof ThreeNS;

interface PetMaterial {
  shader: string | null;
  features: string[];
  /** Param name -> path under /models/ (e.g. `pets/<stem>.webp`). */
  textures: Record<string, string | null>;
  /** The colour map's four dominant colours, heaviest first — the swatch. */
  palette?: { c: string; w: number }[];
  /** Baked float params — what stands where no expression overrides. */
  floats?: Record<string, number>;
  /** Seed-driven params as bytecode hex — see runVfx. */
  dynamic?: Record<string, string>;
}
interface PetStyles {
  models: Record<string, { groups: Record<string, string[]>; seed?: PetSeedTable }>;
  materials: Record<string, PetMaterial>;
}

/**
 * The sidecar's own shape version, in the URL. `withAssetVersion` only moves
 * when an extraction runs, so a change to what the step WRITES would otherwise
 * be served from every cache as the old shape (see CLIP_SCHEMA in
 * viewmodelClip.ts for the same trap). Bump with the JSON's shape.
 *
 * 2 — `palette` on each material.
 * 3 — `seed` (chicken_metadata) on each model.
 */
const PET_STYLES_SCHEMA = 3;

let stylesDoc: Promise<PetStyles | null> | null = null;
function petStyles(): Promise<PetStyles | null> {
  const url = withAssetVersion(`${getAssetOrigin()}/models/pet-styles.json`);
  stylesDoc ??= fetch(`${url}${url.includes("?") ? "&" : "?"}s=${PET_STYLES_SCHEMA}`)
    .then((r) => (r.ok ? (r.json() as Promise<PetStyles>) : null))
    .catch(() => null);
  return stylesDoc;
}

/** The model's seed table — matparams, characteristics, presets — or null on a
 *  mount extracted before it existed. */
export async function petSeedTable(model: string): Promise<PetSeedTable | null> {
  return (await petStyles())?.models[model]?.seed ?? null;
}

export interface PetStyleOption {
  /** null is the stock look — the model's "default" group. */
  style: number | null;
  /** From the material's own name — see styleName. */
  name: string;
  palette: { c: string; w: number }[];
}

/**
 * Valve's material names are the only names a style has: the game shows a
 * number, but the vmat behind style 7 on the catalana is
 * `chicken_catalan_blue`, and behind silkie 3 `chicken_silkie_blue_with_red_beard`.
 * Breed prefix off, a trailing `color` off, connectors kept lower-case.
 */
export function styleName(material: string): string {
  const words = material
    .replace(/^chicken_(catalana?|silkie|polish)_/, "")
    .replace(/_color$/, "")
    .split("_")
    .filter(Boolean);
  return words.map((w) => (/^(and|with)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}

/** Every look a pet model can wear, stock first. Empty when it has none. */
export async function petStyleOptions(model: string): Promise<PetStyleOption[]> {
  const doc = await petStyles();
  const groups = doc?.models[model]?.groups;
  if (!doc || !groups) return [];
  const option = (style: number | null, group: string[] | undefined): PetStyleOption | null => {
    const mat = group?.[0];
    return mat ? { style, name: styleName(mat), palette: doc.materials[mat]?.palette ?? [] } : null;
  };
  const numbered = Object.keys(groups)
    .filter((g) => /^\d+$/.test(g))
    .map(Number)
    .sort((a, b) => a - b);
  if (!numbered.length) return [];
  return [option(null, groups.default), ...numbered.map((n) => option(n, groups[String(n)]))].filter(
    (o): o is PetStyleOption => !!o,
  );
}

// NOT the viewer's shared loadTexture: that one leaves flipY at three's default
// (true) and caches the result for decals, while every map a GLB carries is
// flipY false. A style texture is replacing one of those, so it has to match or
// the whole coat lands upside down on the UV atlas.
const texCache = new Map<string, Promise<ThreeNS.Texture | null>>();
function loadPetTexture(THREE: Three, path: string, srgb: boolean) {
  const url = withAssetVersion(`${getAssetOrigin()}/models/${path}`);
  let cached = texCache.get(url);
  if (!cached) {
    cached = new THREE.TextureLoader()
      .loadAsync(url)
      .then((tex) => {
        tex.flipY = false;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        return tex;
      })
      .catch(() => null);
    texCache.set(url, cached);
  }
  return cached;
}

/**
 * Two things the glTF export gets wrong about the chick's fur, put right from
 * the vmat's own features. Both are written into the SHARED stock material on
 * purpose: unlike a style, they are the same correction for every viewer, and
 * they are idempotent.
 *
 * `F_ALPHA_TEST` — the fur is alpha-tested cards (cutoff 0.2) and the GLB says
 * so (alphaMode MASK), but writes the colour map as plain RGB, so the test has
 * nothing to cut and every card renders as a solid block. The pet-models step
 * keeps alpha on exactly these maps, so the material borrows that copy.
 *
 * `F_DONT_FLIP_BACKFACE_NORMALS` — the cards are double-sided, and three flips
 * the normal on a back face. CS2 does not for this material: a card is a sliver
 * of the coat and is lit as the coat, whichever side faces the camera. Flipped,
 * every card turned away from the viewer was lit as if facing into the body —
 * the pale blotches across the chick's wing.
 */
export async function correctPetMaterials(THREE: Three, object: ThreeNS.Object3D): Promise<void> {
  const doc = await petStyles();
  if (!doc) return;
  const jobs: Promise<void>[] = [];
  object.traverse((n) => {
    const mat = (n as ThreeNS.Mesh).material as ThreeNS.MeshStandardMaterial | undefined;
    // THE STOCK MATERIAL, recorded before anything replaces it. A style and the
    // seed's shading both swap in clones, and both have to be able to start over
    // from what the GLB carried — taking `mesh.material` at that moment instead
    // would build a style on top of the previous seed's clone.
    if (mat && !n.userData.petStock) n.userData.petStock = mat;
    const rec = mat ? doc.materials[mat.name] : undefined;
    if (!mat || !rec || mat.userData.petCorrected) return;
    mat.userData.petCorrected = true;
    const color = rec.textures.g_tColor;
    if (mat.alphaTest && color && rec.features.includes("F_ALPHA_TEST")) {
      jobs.push(
        loadPetTexture(THREE, color, true).then((tex) => {
          if (!tex) return;
          mat.map = tex;
          mat.needsUpdate = true;
        }),
      );
    }
    if (rec.features.includes("F_DONT_FLIP_BACKFACE_NORMALS")) {
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <normal_fragment_begin>",
          THREE.ShaderChunk.normal_fragment_begin.replace(
            "float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;",
            "float faceDirection = 1.0;",
          ),
        );
      };
      mat.customProgramCacheKey = () => "pet-noflip";
      mat.needsUpdate = true;
    }
  });
  await Promise.all(jobs);
}

/** Every mesh's material back to what the GLB carried. */
function restoreStock(object: ThreeNS.Object3D) {
  object.traverse((n) => {
    const mesh = n as ThreeNS.Mesh;
    const stock = mesh.userData?.petStock as ThreeNS.Material | undefined;
    if (!stock || mesh.material === stock) return;
    (mesh.material as ThreeNS.Material).dispose();
    mesh.material = stock;
  });
}

/**
 * Dress a mounted pet in `style`, from the stock look every time — so it is
 * equally the first dressing at mount and a later switch on a live viewer.
 * null is the stock "default" group.
 *
 * False when the style is unknown to the mount (an older extraction, or a style
 * number the model has no group for); the pet is left in the stock look, which
 * is what the game shows for an unset style.
 */
export async function dressPetStyle(
  THREE: Three,
  object: ThreeNS.Object3D,
  model: string,
  style: number | null,
): Promise<boolean> {
  // Newest request wins: a switch whose textures land after a later switch's
  // must not dress over it.
  const gen = (object.userData.petStyleGen = ((object.userData.petStyleGen as number) ?? 0) + 1);
  if (style == null) {
    restoreStock(object);
    return true;
  }
  const doc = await petStyles();
  if (object.userData.petStyleGen !== gen) return true;
  const groups = doc?.models[model]?.groups;
  const base = groups?.default;
  const want = groups?.[String(style)];
  if (!doc || !base || !want) {
    restoreStock(object);
    return false;
  }
  const swaps = new Map<string, PetMaterial>();
  base.forEach((from, i) => {
    const to = want[i];
    const mat = to && to !== from ? doc.materials[to] : undefined;
    if (mat) swaps.set(from, mat);
  });

  const prepared = new Map<string, { map: ThreeNS.Texture | null; normal: ThreeNS.Texture | null }>();
  await Promise.all(
    [...swaps].map(async ([from, mat]) => {
      const stock = doc.materials[from]?.textures ?? {};
      const color = mat.textures.g_tColor;
      const normal = mat.textures.g_tNormal;
      prepared.set(from, {
        map: color ? await loadPetTexture(THREE, color, true) : null,
        // Most styles share the breed's normal map; only load one that differs.
        normal: normal && normal !== stock.g_tNormal ? await loadPetTexture(THREE, normal, false) : null,
      });
    }),
  );

  if (object.userData.petStyleGen !== gen) return true;
  // After the loads, so a switch never shows a half-dressed pet in between.
  restoreStock(object);
  object.traverse((n) => {
    const mesh = n as ThreeNS.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const stock = (mesh.userData.petStock ?? mesh.material) as ThreeNS.MeshStandardMaterial;
    // One style per breed repeats the default group (catalana and silkie "1",
    // polish "2" — not always the first), so it has no swaps and stays stock.
    const got = prepared.get(stock?.name);
    if (!got?.map) return;
    // Cloned: the GLB comes out of a shared cache, and writing into its material
    // would restyle every other viewer holding the same model. The clone keeps
    // the stock's NAME, which is how the seed shading finds its slot.
    const mat = stock.clone();
    mat.map = got.map;
    if (got.normal) mat.normalMap = got.normal;
    // Material.clone does not carry onBeforeCompile (the fur's no-flip patch).
    mat.onBeforeCompile = stock.onBeforeCompile;
    mat.customProgramCacheKey = stock.customProgramCacheKey;
    mesh.userData.petStock = stock;
    mesh.material = mat;
  });
  return true;
}

const ADJUST = ["g_fHueShift", "g_fSaturation", "g_fBrightness", "g_fContrast"] as const;

/**
 * Grade a mounted pet's coat by its SEED — after dressPetStyle, every time.
 *
 * Each slot's effective material (the style's, else stock) is graded with the
 * colour adjust its F_ENABLE_ADJUSTMENTS params ask for, the seed-driven ones
 * evaluated from the pet's render attributes (petPattern.ts), the rest at their
 * baked values. The grade itself is the charm pipeline's — tuneCharmShading,
 * the decompiled csgo_weapon adjust and its tint mask — handed resolved numbers:
 * a constant is a valid expression tree there, so there is one implementation
 * of that shader maths, not two.
 *
 * Detail hue/UV offset and iridescence are seed-driven too and NOT applied: the
 * face-detail atlas and the iridescence mask are extracted but unused (see
 * TODO.md, Pets).
 */
export async function tunePetShading(
  THREE: Three,
  object: ThreeNS.Object3D,
  model: string,
  style: number | null,
  seed: number,
): Promise<void> {
  const doc = await petStyles();
  const entry = doc?.models[model];
  if (!doc || !entry) return;
  const base = entry.groups.default ?? [];
  const chosen = style != null ? entry.groups[String(style)] : null;
  const attrs = entry.seed ? petSeedAttributes(seed, entry.seed) : new Map<number, number>();
  const shading: Record<string, CharmShading> = {};
  const masks = new Map<string, ThreeNS.Texture>();
  await Promise.all(
    base.map(async (slot, i) => {
      const rec = doc.materials[chosen?.[i] ?? slot];
      if (!rec?.features.includes("F_ENABLE_ADJUSTMENTS")) return;
      const dynamic: Record<string, number> = {};
      for (const p of ADJUST) {
        const expr = rec.dynamic?.[p];
        const v = expr ? runVfx(expr, attrs)?.[0] : rec.floats?.[p];
        if (v != null && Number.isFinite(v)) dynamic[p] = v;
      }
      shading[slot] = { dynamic };
      const mask = rec.features.includes("F_TINT_MASK") ? rec.textures.g_tTintMask : null;
      if (mask) {
        const tex = await loadPetTexture(THREE, mask, false);
        if (tex) masks.set(slot, tex);
      }
    }),
  );
  tuneCharmShading(THREE, object, shading, seed, masks);
}
