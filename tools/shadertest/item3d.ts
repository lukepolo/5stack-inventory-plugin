// Item KIND suite: what PRESENTATION actually did to a mounted model.
//
// Why this exists
// ---------------
// The viewer used to know one thing: "this is a weapon". Pose clip, body prune,
// holster cull, paint compositor and camera vector were all inlined against that
// assumption. Adding gloves/agents/charms/stickers meant lifting those into a
// table keyed by kind — and a refactor like that has exactly two failure modes,
// both silent:
//
//   1. It changes weapons. Every gun and knife in the app renders through this
//      path, so a stray behaviour change is a regression across the whole
//      inventory that nothing else would catch. `?regress` asserts that a mount
//      with `kind` UNSET is byte-identical to one with `kind:"weapon"`.
//
//   2. A new kind picks the wrong pose clip. Glove rigs ship `bindpose` and the
//      patch mesh ships `ref`; either winning the fallback renders a splayed
//      T-hand or an untransformed slab that still LOOKS like a model, so it does
//      not throw and does not read as broken in a screenshot. `?kind=` prints
//      the clip that won next to every clip on offer, which turns that into a
//      thing you can read rather than squint at.
//
// The measurements come from the viewer itself (globalThis.__item3d, gated on
// __item3dDebug) rather than being re-derived here — re-deriving them would
// only prove this file agrees with itself, which is the failure the whole rig
// exists to avoid. See DEBUGGING-SKINS.md.
//
//   ?regress            weapons: kind unset vs kind:"weapon" must match (default)
//   ?kind=agent&model=… mount one thing and dump its presentation + a snapshot
//   ?image=/images/kc_… resolve an ITEM the way the app does, then mount it —
//                       this is the only mode that exercises resolveViewerModel,
//                       which is where a charm's material and shading come from
//   ?charms             standalone charms + the same charm attached to a weapon
//   ?shoot              also snapshot each regression case
import { mountViewer, snapshotModel, INCOMPLETE, type ViewerKind } from "../../src/viewer3d";
import { resolveViewerModel, type CharmSpec } from "../../src/viewerModel";
import { liquidProbe } from "../../src/charmLiquid";

const out = document.getElementById("out")!;
const params = new URLSearchParams(location.search);

// ?lqprobe=N — the liquid's stage probes (see liquidProbe in charmLiquid.ts).
//
// Set HERE, at module scope, because the mode is read when the shader is
// PATCHED: anything that sets it after a mount has started is setting it for the
// next material, not this one. That timing is also why it is a URL parameter and
// not a console handle — BUTANE-BUDDY.md has told people to use these probes
// since they were written, and there was no way to reach them from the rig.
if (params.has("lqprobe")) liquidProbe.mode = Number(params.get("lqprobe"));
const line = (s: string, cls = "") => {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = s;
  out.appendChild(d);
};
const head = (t: string) => {
  const h = document.createElement("h2");
  h.textContent = t;
  out.appendChild(h);
};

interface Probe {
  model: string;
  kind: string;
  clip: string | null;
  clips: string[];
  bodyVariant: string;
  propStats: string;
  flatOn: boolean;
  stillTent: boolean;
  dual: boolean;
  weaponPaint: boolean;
  size: string[];
  camDir: string[];
  camPos: string[];
  /** Frustum half-height — see below; camPos alone no longer says how big. */
  halfH: string;
  target: string[];
}

/** Mount once and return what the viewer decided, plus an optional snapshot. */
async function probe(
  model: string,
  opts: {
    kind?: ViewerKind;
    charmSpec?: CharmSpec;
    paintMaterial?: string;
    wear?: number;
    seed?: number;
    shoot?: boolean;
    patches?: (string | null)[];
    pose?: "stand" | "open" | "ready" | null;
  },
): Promise<{ probe?: Probe; raw?: string; png?: string; error?: string }> {
  const host = document.createElement("div");
  host.style.cssText = "width:640px;height:480px;position:fixed;left:-9999px;top:0";
  document.body.appendChild(host);
  (globalThis as { __item3dDebug?: boolean }).__item3dDebug = true;
  (globalThis as { __item3d?: string }).__item3d = undefined;
  try {
    const handle = await mountViewer(host, model, {
      // `kind` is spread rather than always set: the regression case needs the
      // property genuinely ABSENT, not set to undefined, since the default it
      // is testing lives in `opts?.kind ?? "weapon"`.
      ...(opts.kind ? { kind: opts.kind } : {}),
      charmSpec: opts.charmSpec ?? null,
      paintMaterial: opts.paintMaterial ?? null,
      ...(opts.patches?.length ? { patches: opts.patches } : {}),
      wear: opts.wear ?? 0,
      seed: opts.seed ?? 0,
      interactive: false,
      still: true,
      frame: "fit",
    });
    if (opts.pose) handle.setAgentPose(opts.pose);
    // Textures and the composite land after the mount resolves; a snapshot
    // before they do is a picture of an untextured model.
    await new Promise((r) => setTimeout(r, opts.shoot ? 1800 : 400));
    let png: string | undefined;
    if (opts.shoot) {
      const blob = await handle.snapshot();
      if (blob)
        png = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(blob);
        });
    }
    handle.dispose();
    const raw = (globalThis as { __item3d?: string }).__item3d;
    if (!raw) return { error: "viewer set no __item3d — is the debug flag still gated the same way?" };
    return { probe: JSON.parse(raw) as Probe, raw, png };
  } catch (e) {
    return { error: String((e as Error)?.stack ?? e) };
  } finally {
    host.remove();
  }
}

// A spread of shapes rather than a long list: one plain rifle, the scoped rifle
// (its scope must stay unpainted), a knife (the only model whose framing is
// decided by a bounding-box rule), and the Dual Berettas (the only one with a
// holster cull, a dual layout and a `weapon_l` bone). If the kind refactor broke
// anything for weapons, it broke it for one of these.
const REGRESSION = [
  { model: "ak47", paintMaterial: null as string | null },
  { model: "aug", paintMaterial: null },
  { model: "knife_butterfly", paintMaterial: null },
  { model: "elite", paintMaterial: null },
];

async function regress() {
  head("kind refactor regression — `kind` unset must equal `kind:\"weapon\"`");
  line(
    "Every field the presentation table drives, measured inside the viewer. " +
      "Any difference here is a behaviour change to guns and knives.",
    "dim",
  );
  const shoot = params.has("shoot");
  let failures = 0;
  for (const c of REGRESSION) {
    const bare = await probe(c.model, { paintMaterial: c.paintMaterial ?? undefined, shoot });
    const typed = await probe(c.model, {
      kind: "weapon",
      paintMaterial: c.paintMaterial ?? undefined,
      shoot: false,
    });
    if (bare.error || typed.error) {
      failures++;
      line(`FAIL ${c.model}: ${bare.error ?? typed.error}`, "fail");
      continue;
    }
    // Compare everything EXCEPT `kind` itself, which is the one field that is
    // supposed to differ ("weapon" is the default it resolves to).
    const strip = (p: Probe) => JSON.stringify({ ...p, kind: null });
    const same = strip(bare.probe!) === strip(typed.probe!);
    if (!same) failures++;
    line(
      `${same ? "PASS" : "FAIL"} ${c.model.padEnd(18)} clip=${bare.probe!.clip ?? "-"} ` +
        `body=${bare.probe!.bodyVariant} flatOn=${bare.probe!.flatOn} tent=${bare.probe!.stillTent} ` +
        `dual=${bare.probe!.dual} ${bare.probe!.propStats}`,
      same ? "pass" : "fail",
    );
    if (!same) {
      line(`  unset: ${bare.raw}`, "dim");
      line(`  typed: ${typed.raw}`, "dim");
    }
    if (bare.png) {
      const img = document.createElement("img");
      img.src = bare.png;
      img.width = 260;
      out.appendChild(img);
    }
  }
  head(failures ? `${failures} FAILED` : "all passed");
  line(
    failures
      ? "The kind refactor changed weapon rendering. Diff the two lines above."
      : "Weapons render exactly as they did before kinds existed.",
    failures ? "fail" : "dim",
  );
}

async function one() {
  const model = params.get("model") ?? "";
  const kind = (params.get("kind") ?? "weapon") as ViewerKind;
  if (!model) {
    line("give ?model=<key> — e.g. ?kind=agent&model=agents/models/tm_leet/tm_leet_variantg", "warn");
    return;
  }
  head(`${kind}: ${model}`);
  const r = await probe(model, {
    kind,
    paintMaterial: params.get("pm") ?? undefined,
    wear: Number(params.get("wear") ?? 0),
    seed: Number(params.get("seed") ?? 0),
    shoot: true,
  });
  if (r.error) {
    line(r.error, "fail");
    return;
  }
  const p = r.probe!;
  // The clip is printed against the full list on purpose: "it picked one" and
  // "it picked the right one" look identical until you can see what it passed
  // over. A null clip is legitimate (the mesh ships posed) — a `bindpose` or
  // `ref` clip never is.
  const bad = p.clip != null && /^(bindpose|ref|a_)/i.test(p.clip);
  line(`clip:      ${p.clip ?? "(none — model ships posed)"}`, bad ? "fail" : "pass");
  if (bad) line("  ^ NEVER_POSE should have excluded this — the model will render mis-posed.", "fail");
  line(`clips:     ${p.clips.join(", ") || "(none)"}`, "dim");
  line(`size:      ${p.size.join(" x ")} m`);
  line(`camDir:    ${p.camDir.join(", ")}`);
  // The camera is ORTHOGRAPHIC, so camPos is a fixed standoff along camDir and
  // carries no framing information at all — halfH is the number that says how
  // large the item renders. Both are printed because a wrong camDir and a wrong
  // halfH look identical in a thumbnail.
  line(`camPos:    ${p.camPos.join(", ")}  (standoff only — parallel projection)`);
  line(`halfH:     ${p.halfH}  (frustum half-height = apparent size)`);
  line(`target:    ${p.target.join(", ")}  (orbit pivot)`);
  line(`flags:     flatOn=${p.flatOn} dual=${p.dual} weaponPaint=${p.weaponPaint} body=${p.bodyVariant}`);
  line(`props:     ${p.propStats}`);
  // A character mounted through the weapon paint path is the failure this whole
  // gate exists for, and it renders as a plausible-looking grey rather than an
  // error — so call it out rather than leaving it in the flags line.
  if (kind !== "weapon" && p.weaponPaint)
    line("!! weapon compositor ran for a non-weapon kind — this renders grey", "fail");
  if (r.png) {
    const img = document.createElement("img");
    img.src = r.png;
    img.width = 420;
    out.appendChild(img);
  }
}

/**
 * Resolve an ITEM the way the app does, then mount whatever comes back.
 *
 * The distinction from `one()` matters: `one()` is handed a model key, which
 * skips resolveViewerModel entirely. A charm's material and shading only exist
 * because that resolver fetched them, and dressing is what separates "23 charms
 * that look identical" from "23 charms". Nothing else here covers that path.
 */
async function byImage(image: string, seed: number, label?: string) {
  const target = await resolveViewerModel({ type: params.get("type") ?? "keychain", image });
  if (!target) {
    line(`${label ?? image}: resolveViewerModel returned null (no 3D form)`, "warn");
    return false;
  }
  const r = await probe(target.model, {
    kind: target.kind,
    charmSpec: target.charm,
    seed,
    shoot: true,
  });
  if (r.error) {
    line(`FAIL ${label ?? image} -> ${target.model}: ${r.error}`, "fail");
    return false;
  }
  const p = r.probe!;
  line(
    `PASS ${(label ?? image).padEnd(26)} model=${target.model} kind=${target.kind} ` +
      `material=${target.charm?.material ? "yes" : "none"} seed=${seed} ` +
      `size=${p.size.join("x")} weaponPaint=${p.weaponPaint}`,
    "pass",
  );
  if (r.png) {
    const img = document.createElement("img");
    img.src = r.png;
    img.width = 200;
    img.title = `${label ?? image} @ ${seed}`;
    out.appendChild(img);
  }
  return true;
}

// Two seeds per charm, not one. A charm's colour is DRIVEN by its pattern (see
// tuneCharmShading's dynamic expressions), so a single render cannot tell a
// correctly-graded charm from one whose grading never ran — both look like "a
// charm". Two patterns that render identically for a charm with a hue ramp is
// the actual failure signal.
const CHARM_SEEDS = [1, 61000];

/**
 * The charm ATTACHED to a weapon, which is the path dressCharm and
 * tuneCharmShading were lifted out of.
 *
 * Moving them to charmMaterial.ts is only safe if this still renders — and a
 * charm that fails to dress falls back to FLAT ART rather than throwing, so the
 * regression would be a subtly worse picture, not an error. Snapshot it and
 * look. (The blank-mesh charm is the one that proves it: undressed, it is a
 * featureless grey shape.)
 */
async function attached() {
  head("charm attached to a weapon — the path dressCharm was lifted out of");
  line("Community-blank charm on an AK. If dressing regressed this is a grey blob.", "dim");
  const host = document.createElement("div");
  host.style.cssText = "width:640px;height:480px;position:fixed;left:-9999px;top:0";
  document.body.appendChild(host);
  // `?on=<model>` to hang it on something else — `elite` in particular, the one
  // weapon with no keychain anchor, which resolves its pivot down a different
  // branch entirely and is the only way to see that branch rendered.
  const on = params.get("on") ?? "ak47";
  const raw = (params.get("at") ?? "").split(",").map(Number);
  const at = raw.length === 3 && raw.every(Number.isFinite)
    ? { x: raw[0], y: raw[1], z: raw[2] }
    : { x: null, y: null, z: null };
  try {
    // The model's own charm surfaces, exactly as the app fetches them — without
    // them the seat falls back to the nearest triangle anywhere on the weapon,
    // so a picture taken here would not be a picture of what ships. See
    // CharmSurface in viewer3d.ts.
    const charmSurfaces = await fetch(`/api/catalog/sticker-bounds/${encodeURIComponent(on)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.charmQuads ?? [])
      .catch(() => []);
    const handle = await mountViewer(host, on, {
      kind: "weapon",
      charmSurfaces,
      interactive: false,
      // `?live=1` drops `still`, which is what selects the dual-wield SIDE-BY-SIDE
      // layout over the tent — the tent is the card bake, and a charm hanging off
      // the back of it cannot be seen at all.
      still: !params.has("live"),
      frame: "fit",
      // `?at=x,y,z` to force a PLACED charm rather than the unplaced default —
      // the two take different branches of the pivot resolver.
      charm: { image: "/images/kc_missinglink_ancientcurse_5d7da72d.webp", ...at, seed: 61000 },
    });
    // AWAIT THE CHARM, then settle. mountViewer deliberately does not wait for
    // it — a weapon should not block on the trinket hanging off it — so the
    // handle comes back before the charm's own GLB has been fetched, and a fixed
    // sleep is a bet on how long that takes. The bet loses exactly where it
    // matters most: the side-by-side elite does extra work in bakePose to
    // synthesise its layout, the charm lands after the shutter, and the picture
    // shows a pair of pistols with no charm on them. That picture is where "the
    // charm does not render on the elite at all" came from.
    await (handle as { charmReady?: () => Promise<void> }).charmReady?.();
    // The pendulum still needs a moment after that to hang.
    await new Promise((r) => setTimeout(r, 2600));
    const blob = await handle.snapshot();
    // WHERE the charm is in THIS picture, not in some other rig's camera. A
    // charm can be in the scene, visible, the right size and seated on the gun
    // and still contribute no pixels; printing its normalised device coords next
    // to the image is what turns "I cannot see it" into a place to look.
    const seat = handle.probeCharmSeat();
    if (seat) {
      line(`charm: ndc=${seat.ndc ? `${seat.ndc.x.toFixed(2)},${seat.ndc.y.toFixed(2)}` : "-"} ` +
        `inFrame=${seat.inFrame} drawn=${seat.spriteMm.y.toFixed(0)}mm scene=${seat.inScene} visible=${seat.visible}`,
        seat.inFrame ? "dim" : "warn");
    } else {
      line("charm: no rig — nothing was mounted to measure", "warn");
    }
    handle.dispose();
    if (!blob) return line("FAIL attached charm: snapshot() returned null", "fail");
    const png = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(blob);
    });
    line(`PASS attached charm mounted on ${on} — check the picture, not just this line`, "pass");
    const img = document.createElement("img");
    img.src = png;
    img.width = 420;
    out.appendChild(img);
  } catch (e) {
    line(`FAIL attached charm: ${String((e as Error)?.stack ?? e)}`, "fail");
  } finally {
    host.remove();
  }
}

/**
 * ?card=<image>&seeds=1,61000 — the CARD BAKE path, not the viewer path.
 *
 * generateRenderNow does not mount a viewer, it calls snapshotModel with a
 * hand-built opts object, and that object is where a kind gets rendered wrong:
 * a charm baked through the weapon branch has no charmSpec, which does not
 * throw and does not read as broken — it just bakes a featureless grey shape
 * and caches it under a key that says it is finished. Exactly how every painted
 * glove card became a pair of blank white hands.
 *
 * So this builds the same opts the card bake does and shows what comes out,
 * once per seed. Two seeds because a charm's whole look is its PATTERN: one
 * render cannot tell a graded charm from an ungraded one, two identical renders
 * at different patterns can.
 */
async function cardBake(image: string) {
  head("card bake — snapshotModel through the grid-card opts");
  // A charm is addressed by its ART (it names no model of its own); a glove or a
  // weapon by its MODEL plus the paint chain to composite. `?model=` picks the
  // second form — without it a glove resolves to null and the whole point of the
  // check is missed silently.
  const target = await resolveViewerModel(
    params.get("model")
      ? { type: params.get("type") ?? "glove", model: params.get("model")!, image }
      : { type: params.get("type") ?? "keychain", image },
  );
  if (!target) return line(`${image}: resolveViewerModel returned null`, "warn");
  const seeds = (params.get("seeds") ?? "1,61000").split(",").map(Number).filter(Number.isFinite);
  const paint = params.get("paint");
  for (const seed of seeds) {
    const blob = await snapshotModel(target.model, {
      kind: target.kind,
      charmSpec: target.charm ?? null,
      // Unconditional, exactly as the card bake passes it — a glove reaching the
      // compositor without this is the blank-white-hands bug.
      paintMaterial: paint,
      legacyPaint: params.has("legacy"),
      wear: params.has("wear") ? Number(params.get("wear")) : null,
      seed,
      gloveArms: false,
      stattrak: null,
    } as any);
    if (!blob || blob === INCOMPLETE) {
      line(`FAIL seed ${seed}: ${blob === INCOMPLETE ? "INCOMPLETE" : "no blob"}`, "fail");
      continue;
    }
    // A data URL, not an object URL: shoot.mjs pulls `<img>` sources out of the
    // page and can only write the ones it can read, so a blob: src silently
    // produces no file at all.
    const url = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(blob as Blob);
    });
    const img = document.createElement("img");
    img.src = url;
    img.width = 150;
    img.title = `${image} @ ${seed}`;
    // The card is shown at natural size, so the cropped size IS how big the
    // picture can ever draw — a charm is a tall sliver of a 4:3 frame.
    await new Promise((r) => (img.onload = r));
    line(`PASS seed ${seed}: ${img.naturalWidth}x${img.naturalHeight} after crop`, "pass");
    out.appendChild(img);
  }
}

async function charms() {
  head("standalone charms — resolve, dress, grade");
  line("Each charm at two patterns. A charm with a hue ramp MUST differ between them.", "dim");
  const images = (params.get("images") ?? "").split(",").filter(Boolean);
  const list = images.length
    ? images
    : [
        "/images/kc_missinglink_ava_36bc006a.webp", // owns its own model
        "/images/kc_missinglink_banana_75d346ee.webp",
        "/images/kc_missinglink_cat_b0134893.webp",
      ];
  for (const image of list) for (const seed of CHARM_SEEDS) await byImage(image, seed, image.split("/").pop());
  await attached();
}



/**
 * Standalone decals: the generated quad, dressed with real art and the real
 * csgo_weapon_sticker material.
 *
 * A holo or glitter sticker MUST differ across viewAngles — that is the whole
 * point of porting a view-dependent shader, and a static render cannot tell a
 * working effect from a texture that happens to be colourful. Wear is swept on
 * the plain one because the scratch mask is the other half of the port.
 */
async function decals() {
  head("standalone stickers & patches");
  line("Effect finishes are rendered at 3 angles — they MUST differ. Plain ones sweep wear.", "dim");
  const cases = (params.get("images") ?? "").split(",").filter(Boolean);
  for (const image of cases) {
    const target = await resolveViewerModel({ type: params.get("type") ?? "sticker", image });
    if (!target) {
      line(`${image}: resolveViewerModel returned null`, "warn");
      continue;
    }
    for (const [label, opt] of [
      ["angle 0", { viewAngle: 0 }],
      ["angle 1.2", { viewAngle: 1.2 }],
      ["angle 2.4", { viewAngle: 2.4 }],
      ["wear 0.6", { wear: 0.6 }],
    ] as const) {
      const host = document.createElement("div");
      host.style.cssText = "width:420px;height:420px;position:fixed;left:-9999px;top:0";
      document.body.appendChild(host);
      try {
        const handle = await mountViewer(host, target.model, {
          kind: target.kind,
          decal: { image, wear: (opt as { wear?: number }).wear ?? 0 },
          viewAngle: (opt as { viewAngle?: number }).viewAngle,
          interactive: false,
          still: true,
          frame: "fit",
        });
        await new Promise((r) => setTimeout(r, 1400));
        const blob = await handle.snapshot();
        handle.dispose();
        if (!blob) {
          line(`FAIL ${image} ${label}: null snapshot`, "fail");
          continue;
        }
        const png = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(blob);
        });
        const img = document.createElement("img");
        img.src = png;
        img.width = 190;
        img.title = `${image} ${label}`;
        out.appendChild(img);
      } catch (e) {
        line(`FAIL ${image} ${label}: ${String((e as Error)?.stack ?? e)}`, "fail");
      } finally {
        host.remove();
      }
    }
    line(`PASS ${image} -> ${target.model} (${target.kind})`, "pass");
  }
}



/** Gloves: the csgo_customglove compositor against real finishes. */
async function gloves() {
  head("gloves — csgo_customglove multi-pass compositor");
  line("A white glove means the composite did not bind. Wear is swept on the last painted one.", "dim");
  const CASES = [
    { model: "sporty_gloves", pm: "/materials/sporty_blue_pink_d3d209c1.vcompmat.json", name: "Sport | Vice", wear: 0 },
    { model: "studded_brokenfang_gloves", pm: "/materials/operation10_metalic_green_4184fb95.vcompmat.json", name: "Broken Fang | Jade", wear: 0 },
    { model: "studded_bloodhound_gloves", pm: "/materials/bloodhound_snakeskin_brass_b37543b3.vcompmat.json", name: "Bloodhound | Snakebite", wear: 0 },
    { model: "studded_bloodhound_gloves", pm: "/materials/bloodhound_metallic_537f95f9.vcompmat.json", name: "Bloodhound | Bronzed @0.7", wear: 0.7 },
    // The substrate/surface generation — a different compositor behind the same
    // .vfx (gloveCompositeModern.ts). Keep at least one here: the two paths are
    // selected by which parameters a finish carries, so a regression in the
    // routing shows up as this row falling back to a black mesh while every
    // other row still passes.
    { model: "sporty_gloves", pm: "/materials/glove_sport_tech_gradient_bright_bfbaa94e.vcompmat.json", name: "Sport | Tech Gradient (gen 2)", wear: 0.5 },
    { model: "sporty_gloves", pm: null, name: "Sport (vanilla)", wear: 0 },
  ];
  for (const c of CASES) {
    const r = await probe(c.model, { kind: "glove", paintMaterial: c.pm ?? undefined, wear: c.wear, shoot: true });
    if (r.error) {
      line(`FAIL ${c.name}: ${r.error}`, "fail");
      continue;
    }
    line(`PASS ${c.name.padEnd(26)} clip=${r.probe!.clip ?? "-"} size=${r.probe!.size.join("x")}`, "pass");
    if (r.png) {
      const img = document.createElement("img");
      img.src = r.png;
      img.width = 220;
      img.title = c.name;
      out.appendChild(img);
    }
  }
}



/** Agents: no compositor, so this is purely "does the GLB render as itself". */
async function agents() {
  head("agents — GLB materials straight through");
  line("Black means a material is rendering as a dark mirror (metalness) or losing its base colour.", "dim");
  const list = (params.get("models") ?? [
    "agents/models/ctm_diver/ctm_diver_varianta",
    "agents/models/tm_leet/tm_leet_variantg",
    "agents/models/ctm_st6/ctm_st6_variantg",
    "agents/models/tm_professional/tm_professional_var1",
    "agents/models/ctm_swat/ctm_swat_variante",
    "agents/models/tm_phoenix/tm_phoenix_variantf",
  ].join(",")).split(",").filter(Boolean);
  // `?patches=<img>,<img>` fills the model's slots in order. Patches are a UV
  // composite into the body's base colour, not a placed decal, so there is
  // nothing to drag and the only question a fixture can answer is whether they
  // land in the right place at the right size — which needs the 3D render.
  const patches = (params.get("patches") ?? "").split(",").filter(Boolean);
  // ?pose=stand|open|ready — the three the viewer offers. See AgentPose.
  const pose = params.get("pose") as "stand" | "open" | "ready" | null;
  for (const model of list) {
    const r = await probe(model, { kind: "agent", shoot: true, patches, pose });
    if (r.error) {
      line(`FAIL ${model}: ${r.error}`, "fail");
      continue;
    }
    line(`PASS ${model.split("/").pop()} size=${r.probe!.size.join("x")} clip=${r.probe!.clip ?? "-"}`, "pass");
    if (r.png) {
      const img = document.createElement("img");
      img.src = r.png;
      img.width = 170;
      img.title = model;
      out.appendChild(img);
    }
  }
}



/**
 * FLAT MAPS. Look at what the compositor actually produced, as 2D textures,
 * before looking at a lit 3D render.
 *
 * Every glove diagnosis this session went "squint at a 200px lit thumbnail and
 * guess whether albedo, normal or metalness is wrong" — which is exactly what
 * DEBUGGING-SKINS.md says not to do, and the three are indistinguishable that
 * way. Sources on the left, composite outputs on the right, both big.
 */
async function flat() {
  const pm = params.get("pm") ?? "/materials/operation10_metalic_green_4184fb95.vcompmat.json";
  head(`flat maps — ${pm.split("/").pop()}`);
  const [{ loadGlovePaintDef, compositeGlove }, modern, three, { paintTextureUrl }] = await Promise.all([
    import("../../src/gloveComposite"),
    import("../../src/gloveCompositeModern"),
    import("three"),
    import("../../src/paintComposite"),
  ]);
  const def = await loadGlovePaintDef(pm);
  // Two parameter generations behind one .vfx — if this finish is not the
  // legacy set, fall through to the substrate/surface one rather than reporting
  // "returned null", which reads as a failure when it is a routing decision.
  if (!def) {
    const mdef = await loadGloveModernDef_(pm);
    if (mdef) return flatModern(mdef, modern, three, paintTextureUrl, pm);
    line(`neither generation matched ${pm}`, "fail");
    return;
  }
  async function loadGloveModernDef_(p: string) {
    return modern.loadGloveModernDef(p);
  }
  line(`pattern=${def.pattern} mode=${def.patternMode} replaceIdx=${def.patternReplaceIndex} cloth=${def.cloth}`, "dim");
  line(`paletteIdx=${JSON.stringify(def.vec.g_vPatternPaletteIndices ?? null)}`, "dim");
  for (const k of ["g_fDetailMetalness", "g_fDamageMetalness", "g_fDetailRoughnessContrast",
                   "g_fDetailRoughnessBrightness", "g_fDetailBlackPoint",
                   "g_fDetailBlackPointCompensation", "g_fDetailScale", "g_vDamageLevels1"]) {
    const v = (def.layer as Record<string, number[]>)[k] ?? def.vec[k];
    line(`  ${k} = ${JSON.stringify(v ?? null)}`, "dim");
  }
  line(`  scalars = ${JSON.stringify(def.scalar)}`, "dim");
  line(`  textures present = ${Object.keys(def.tex).length}: ${Object.keys(def.tex).sort().join(" ")}`, "dim");
  for (let i = 1; i <= 8; i++) {
    const t = def.vec[`g_vColorTint${i}`];
    if (!t) continue;
    const sw = document.createElement("span");
    sw.style.cssText = `display:inline-block;width:44px;height:22px;margin:2px;border:1px solid #444;background:rgb(${Math.round((t[0] ?? 0) * 255)},${Math.round((t[1] ?? 0) * 255)},${Math.round((t[2] ?? 0) * 255)})`;
    sw.title = `g_vColorTint${i} = ${t.slice(0, 3).join(", ")}`;
    out.appendChild(sw);
  }

  const shot = (label: string) => {
    const d = document.createElement("div");
    d.className = "dim";
    d.textContent = label;
    d.style.marginTop = "8px";
    out.appendChild(d);
  };

  // SOURCES — plain images, no interpretation.
  shot("sources: layer mask (rgb = layer weights, ALPHA = palette index) · pattern · normal");
  for (const k of ["g_tLayerMask", "g_tPattern", "g_tNormal", "g_tSurface"]) {
    if (!def.tex[k]) continue;
    const img = document.createElement("img");
    img.src = paintTextureUrl(def.tex[k]);
    img.width = 240;
    img.title = `${k} — ${def.tex[k]}`;
    out.appendChild(img);
  }

  // OUTPUTS — read the render targets back through a blit.
  // Its own context, not the rig's shared one: this renders straight to a
  // canvas and reads it back, and borrowing the shared renderer would resize it
  // out from under whatever else is mounted.
  const gl = new three.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  gl.setSize(512, 512);
  const comp = await compositeGlove(three, gl, def, { wear: Number(params.get("wear") ?? 0), size: 1024 });
  if (!comp) {
    line("compositeGlove returned null", "fail");
    gl.dispose();
    return;
  }
  // The palette INDEX channel, banded. The mask's alpha is floor(a*8) -> one of
  // eight tint slots, and if the banding does not line up with the artwork's
  // colour regions then every colour downstream is wrong for a reason that has
  // nothing to do with the maths.
  shot("layer mask ALPHA as palette slots (each band = one g_vColorTint)");
  {
    const maskTex = await new three.TextureLoader().loadAsync(paintTextureUrl(def.tex.g_tLayerMask));
    maskTex.colorSpace = three.NoColorSpace;
    maskTex.flipY = false;
    const sc = new three.Scene();
    const cm = new three.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g2 = new three.BufferGeometry();
    g2.setAttribute("position", new three.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const tintArr = Array.from({ length: 8 }, (_, i) => {
      const t = def.vec[`g_vColorTint${i + 1}`] ?? [1, 0, 1];
      return new three.Vector3(t[0] ?? 1, t[1] ?? 0, t[2] ?? 1);
    });
    for (const [lbl, mode] of [["raw alpha", 0], ["slot -> tint", 1]] as const) {
      const mat = new three.RawShaderMaterial({
        glslVersion: three.GLSL3,
        depthTest: false,
        vertexShader: `precision highp float;
in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }`,
        fragmentShader: `precision highp float;
in vec2 vUv; out vec4 c; uniform sampler2D t; uniform int mode; uniform vec3 tint[8];
void main(){
  float a = texture(t, vUv).w;
  if (mode == 0) { c = vec4(vec3(a), 1.0); return; }
  int slot = int(floor(a * 8.0));
  vec3 col = vec3(1.0, 0.0, 1.0);   // magenta = slot out of range
  for (int i = 0; i < 8; i++) if (i == slot) col = tint[i];
  c = vec4(col, 1.0);
}`,
        uniforms: { t: { value: maskTex }, mode: { value: mode }, tint: { value: tintArr } },
      });
      const me = new three.Mesh(g2, mat);
      sc.add(me);
      gl.setRenderTarget(null);
      gl.render(sc, cm);
      sc.remove(me);
      mat.dispose();
      const im = document.createElement("img");
      im.src = gl.domElement.toDataURL();
      im.width = 240;
      im.title = lbl;
      out.appendChild(im);
    }
  }

  shot("composite outputs: albedo · rough/metal (r=ao g=rough b=metal) · normal");
  const scene = new three.Scene();
  const cam = new three.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new three.BufferGeometry();
  geo.setAttribute("position", new three.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  for (const [label, tex] of [
    ["albedo", comp.albedo], ["rough/metal", comp.rm], ["normal", comp.normal],
    ["resolved detail", comp.debug.detail], ["resolved grunge", comp.debug.grunge],
    ["resolved detailNormal", comp.debug.detailNormal],
  ] as const) {
    const mat = new three.RawShaderMaterial({
      glslVersion: three.GLSL3,
      depthTest: false,
      vertexShader: `precision highp float;
in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }`,
      fragmentShader: `precision highp float;
in vec2 vUv; out vec4 c; uniform sampler2D t;
void main(){ c = vec4(texture(t, vUv).rgb, 1.0); }`,
      uniforms: { t: { value: tex } },
    });
    const mesh = new three.Mesh(geo, mat);
    scene.add(mesh);
    gl.setRenderTarget(null);
    gl.render(scene, cam);
    scene.remove(mesh);
    mat.dispose();
    const url = gl.domElement.toDataURL();
    const img = document.createElement("img");
    img.src = url;
    img.width = 240;
    img.title = label;
    out.appendChild(img);
    // NUMBERS, not impressions. "it looks magenta" cost several rounds of
    // guessing which channel was wrong; a mean and a few samples says it.
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const c2 = document.createElement("canvas");
    c2.width = bmp.width;
    c2.height = bmp.height;
    const ctx = c2.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c2.width, c2.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 37) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    line(`  ${label}: mean rgb = ${(r / n).toFixed(0)}, ${(g / n).toFixed(0)}, ${(b / n).toFixed(0)}`, "dim");
  }
  comp.dispose();
  gl.dispose();
  line("done", "pass");
}

/**
 * Flat maps for the substrate/surface generation.
 *
 * Same discipline as flat(): sources, then the eight resolve targets, then the
 * three composite outputs, each with a printed mean. The palette view is the
 * one to read first — if the tint-id banding does not line up with the
 * artwork's colour regions, every colour downstream is wrong for a reason that
 * has nothing to do with the shading maths.
 */
async function flatModern(
  def: Awaited<ReturnType<typeof import("../../src/gloveCompositeModern").loadGloveModernDef>>,
  modern: typeof import("../../src/gloveCompositeModern"),
  three: typeof import("three"),
  paintTextureUrl: (p: string) => string,
  pm: string,
) {
  if (!def) return;
  line(`generation = substrate/surface (combo 5)`, "pass");
  // paintLayer picks between the shader's two pattern branches — tint vs decal —
  // which are different enough that knowing which one ran is the first question
  // to ask of a wrong-looking pattern. See GLOVES-GEN2.md.
  line(
    `pattern=${def.pattern} paintLayer=${def.patternPaintLayer} emboss=${def.patternEmboss} tintId=${def.tintId} respectsTintMask=${def.patternRespectsTintMask}`,
    "dim",
  );
  line(`  textures = ${Object.keys(def.tex).length}`, "dim");
  line(`  scalars = ${JSON.stringify(def.scalar)}`, "dim");
  line(`  uvScale = ${JSON.stringify(def.layer.uvScaleX)} / ${JSON.stringify(def.layer.uvScaleY)}`, "dim");
  for (let i = 0; i < 8; i++) {
    const t = def.idColor[i];
    const sw = document.createElement("span");
    sw.style.cssText = `display:inline-block;width:44px;height:22px;margin:2px;border:1px solid #444;background:rgb(${Math.round(t[0] * 255)},${Math.round(t[1] * 255)},${Math.round(t[2] * 255)})`;
    sw.title = `g_vId${i + 1}Color = ${t.join(", ")}${def.idPattern[i] ? " (pattern)" : ""}`;
    out.appendChild(sw);
  }

  const shot = (label: string) => {
    const d = document.createElement("div");
    d.className = "dim";
    d.textContent = label;
    d.style.marginTop = "8px";
    out.appendChild(d);
  };

  shot("sources: layerId (rgb = layer weights) · tintId (r = palette slot) · pattern · normal");
  for (const k of ["g_tLayerId", "g_tTintId", "g_tPattern", "g_tNormal"]) {
    if (!def.tex[k]) continue;
    const img = document.createElement("img");
    img.src = paintTextureUrl(def.tex[k]);
    img.width = 240;
    img.title = `${k} — ${def.tex[k]}`;
    out.appendChild(img);
  }

  const gl = new three.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  gl.setSize(512, 512);
  const comp = await modern.compositeGloveModern(three, gl, def, {
    wear: Number(params.get("wear") ?? 0),
    size: 1024,
  });
  if (!comp) {
    line("compositeGloveModern returned null", "fail");
    gl.dispose();
    return;
  }

  shot("composite outputs: albedo · rough/metal (r=ao g=rough b=metal) · normal, then the eight resolve targets");
  const scene = new three.Scene();
  const cam = new three.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new three.BufferGeometry();
  geo.setAttribute("position", new three.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const views: [string, import("three").Texture][] = [
    ["albedo", comp.albedo], ["rough/metal", comp.rm], ["normal", comp.normal],
    ...Object.entries(comp.debug).map(([k, v]) => [`resolved ${k.replace("g_t", "")}`, v] as [string, import("three").Texture]),
  ];
  for (const [label, tex] of views) {
    const mat = new three.RawShaderMaterial({
      glslVersion: three.GLSL3,
      depthTest: false,
      vertexShader: `precision highp float;
in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.0,1.0); }`,
      fragmentShader: `precision highp float;
in vec2 vUv; out vec4 c; uniform sampler2D t;
void main(){ c = vec4(texture(t, vUv).rgb, 1.0); }`,
      uniforms: { t: { value: tex } },
    });
    const mesh = new three.Mesh(geo, mat);
    scene.add(mesh);
    gl.setRenderTarget(null);
    gl.render(scene, cam);
    scene.remove(mesh);
    mat.dispose();
    const url = gl.domElement.toDataURL();
    const img = document.createElement("img");
    img.src = url;
    img.width = 240;
    img.title = label;
    out.appendChild(img);
    // NUMBERS, not impressions — see flat().
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const c2 = document.createElement("canvas");
    c2.width = bmp.width;
    c2.height = bmp.height;
    const ctx = c2.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c2.width, c2.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 37) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    line(`  ${label}: mean rgb = ${(r / n).toFixed(0)}, ${(g / n).toFixed(0)}, ${(b / n).toFixed(0)}`, "dim");
  }
  comp.dispose();
  gl.dispose();
  line(`done — ${pm.split("/").pop()}`, "pass");
}

const mode = params.has("flat")
  ? flat()
  : params.has("agents")
  ? agents()
  : params.has("gloves")
  ? gloves()
  : params.has("decals")
  ? decals()
  : params.has("card")
  ? cardBake(params.get("card")!)
  : params.has("charms")
  ? charms()
  : params.has("image")
    ? byImage(params.get("image")!, Number(params.get("seed") ?? 1)).then(() => undefined)
    : params.has("kind") || params.has("model")
      ? one()
      : regress();
mode.catch((e) => line(String(e?.stack ?? e), "fail"));
