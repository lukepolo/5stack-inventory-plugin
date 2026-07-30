# How a CS2 charm moves

Ground truth for `src/charmPhysics.ts`. Same discipline as `DEBUGGING-SKINS.md`: **transcribe, do not
infer.** Everything below is copied from a source, and each section says which. If you change a
formula here, say where the new one came from.

## The short version

A charm is a **cloth softbody**, not a pendulum and not authored animation.

- Every `kc_*.vmdl_c` carries a `PHYS` block whose `m_pFeModel` is a `PhysFeModelDesc` — Valve's
  FEM/position-based cloth description. Extracted by step 3g of `scripts/extract-models.sh` into
  `<stem>.phys.json` (62 models, ~8KB each).
- It is simulated by `vphysics2`'s `CSoftbody` over a `CFeModel`. The charm GLB's 3-bone skin
  (`joint1/2/3`) is driven from the sim by `m_NodeBases`.
- The GLB's one `inspect` animation is a **single static keyframe** — a reference pose. There is no
  authored swing anywhere; all charm motion in game comes out of this solver.

## Sources and their standing

| Source | What it is | Trust |
|---|---|---|
| `<stem>.phys.json` | the shipped per-charm data, extracted from this build's VPK | authoritative |
| `DumpSource2/schemas/physicslib/*.h` (SteamDatabase/GameTracking-CS2) | schema dump generated **from the shipped CS2 binary** | authoritative for layout |
| `mathlib/{femodel,softbody}.{h,cpp,inl}` (leaked CS:GO tree) | Valve's own solver, CS:GO-era | authoritative for math, **but predates CS2** |
| `libvphysics2.so` (our own install, `game/bin/linuxsteamrt64/`) | the actual shipped solver, stripped | tie-breaker |

### The cross-check that matters

The leaked tree is CS:GO-era, so before trusting its math for a CS2-authored charm, every struct we
consume was diffed against the CS2 binary's own schema dump. **All five are identical, field for
field, in order**: `FeQuad_t`, `FeNodeBase_t`, `FeRodConstraint_t`, `FeAxialEdgeBend_t`,
`FeNodeIntegrator_t`. CS2 changed none of them; it only *added* constraint types (below). So the data
contract the CS:GO-era solver was written against is still the contract our charms are authored to.

That is a strong check but not a proof about the *code*. The end-to-end check is
**§"Rest pose is a fixed point"** below: a CS2-authored rest pose staying put under a CS:GO-era
transcription is hard to get by accident.

### What CS2 added and we therefore do NOT have

`FeHingeLimit_t`, `FeTwistConstraint_t`, `FeAntiTunnelProbe_t`, `FeDynKinLink_t`,
`FeSimdRodConstraintAnim_t`, `FeNodeStrayBox_t`, `FeSDFRigid_t`, `FeBoxRigid_t`. These exist in the
CS2 schema and in our extracted data but have **no counterpart in the leaked source** — they are
newer. Of these only hinge limits matter for charms (4-5 per charm, they stop a link folding through
itself under large deflection). Recovering them needs real disassembly of `libvphysics2.so`; until
then the solver skips them and the charm is slightly floppier than the game at extreme angles.

## Units and space — settled, do not re-derive

The charm GLB's root node carries `matrix` = 0.0254 scale + the Source→glTF axis swizzle. Everything
under it — bone translations, mesh positions — is **Source inches in Source axes**, and so is the
FeModel. Verified: `m_InitPose[3]` (ctrl `joint1`) of `kc_aus2025` is `[0, 0, -0.000616]`, and that
bone's GLB bind translation is `[9.64e-20, 0, -0.000616402]`. Same numbers.

So the sim runs natively in charm-local inches and `flGravity` is used verbatim. Only the gravity
*direction* has to be rotated in.

`m_InitPose` entries are 8 floats: `[x, y, z, 1.0, qx, qy, qz, qw]`.

Gravity in the engine is **local -Z** (`vGravityStepScaled = {0, 0, -scale, 0}`), i.e. the softbody
simulates in a frame where -Z is down. We run in charm-local space instead, so we rotate world-down
into that space per step. In the viewer, "world down" is deliberately **camera-frame down**, so that
orbiting the view is equivalent to rotating the weapon under fixed gravity — which is what CS2's
inspect actually does.

## Array indexing conventions (from the shipped data, verified across all 62)

- `m_NodeIntegrator` and `m_NodeInvMasses`: **one entry per node**, exactly `nodeCount`.
- `m_NodeCollisionRadii` and `m_DynNodeFriction`: **per dynamic node** — length `nodeCount -
  staticNodes`, so index them as `[node - staticNodes]`. `friction` is absent entirely when it is
  uniformly zero.
- Nodes `0 .. staticNodes-1` are pinned (`invMass == 0`). `m_FreeNodes` lists the simulated ones.
- Nodes `>= m_nFirstPositionDrivenNode` carry `flGravity == 0` — they are not integrated, they are
  written by the node bases. On `kc_aus2025` those are exactly ctrl 18/19 = `joint3`/`joint2`.
- `m_CtrlName` maps node → bone. Only `joint*` names are real bones; `$ha_*`, `$cc*`,
  `$cloth_node_*` are virtual.
- `m_nQuadCount1/2` are **boundaries, not counts**. The quad array is sorted by how many of its nodes
  are static: `[0, count2)` have two static nodes, `[count2, count1)` have one, `[count1, total)` have
  none. Each range gets a different solver (see below). Same convention for the SIMD arrays and tris.

## One step

`CSoftbody::RawSimulate` (leaked). Our charms do not set `FE_FLAG_UNINERTIAL_CONSTRAINTS`, so it is
the `else` branch:

```
Integrate(dt)                  // air drag / wind / velocity smoothing — ALL no-ops for charms
Predict(dt)                    // verlet + gravity  <- the only place motion is created
AddAnimationAttraction(dt)     // no-op for charms: every flAnimation*Attraction is 0
Collide()
ConstraintIterator.Iterate(n)  // n = environment iteration count
```

`Integrate` is entirely gated on drag/windage/smooth-rate fields that are **0 on every charm**, so it
does nothing for us. Do not port it.

### Predict — the integrator

```
timestepScale = (1 - velocityDamping) * (1 + overPredict) * dt / max(0.25*dt, lastDt)
gravityStep   = -gravityScale * dt * dt          // applied along local -Z
                 gravityScale = m_flDefaultGravityScale * (1 + overPredict)

for each static node:   pos0[n] = animated target (the anchor)
for each dynamic node:  pos0[n] = pos1[n] + (pos1[n] - pos0[n]) * timestepScale
                                 + integrator[n].flGravity * gravityStep
swap(pos0, pos1)
```

With node damping (only when `FE_FLAG_HAS_NODE_DAMPING`), the velocity term is additionally scaled by
`max(0, 1 - flPointDamping * dt * dampingMultiplier * g_flClothDampingMultiplier)`.

### What damps the motion — the answer is "nothing explicit"

This was the question most likely to sink the port, so it is worth stating plainly. For our charms:

- `flPointDamping` is **0 on every node of every charm** (checked across all 62).
- `m_flVelocityDamping` defaults to **0**, `m_flOverPredict` **0**, `m_flDampingMultiplier` **1**,
  `g_flClothDampingMultiplier` **1**, `m_flGravityScale` = `m_flDefaultGravityScale` = **1**.
- every air-drag / windage / velocity-smoothing field on the model is **0**.
- `g_flClothNodeVelocityLimit` is `1000000` and the clamp is gated on `< 1e5`, so it is off.

So `timestepScale` is exactly `1.0` at a fixed dt, and **no term removes energy**. All dissipation
comes from the constraint projections themselves — the quad solve discards the non-rigid part of the
configuration every iteration, which is strongly dissipative at 5-10 iterations — plus contacts.

**Do not add invented damping.** If the charm rings forever, the constraint solve is wrong; damping
would only hide it. (The viewer's sleep latch is a separate, presentation-level concern.)

`flGravity` defaults to `360.0` in `FeNodeIntegrator_t::Init()` — Valve's cloth default. Not 386.09
(real *g* in in/s²), not 800 (`sv_gravity`). Charms in this build use 360, 216, 180 or 0 per node.

### Iterate — the constraint loop

```
rodStiffness     = exp(-threadStretch  / nIterations)      // threadStretch  = 0 -> 1.0
surfaceStiffness = exp(-surfaceStretch / nIterations)      // surfaceStretch = 0 -> 1.0
constraintScale  = modelScale * clothScale                 // 1.0 for us

repeat nIterations:
    if rodStiffness > 0.01:  RelaxRods2   (last iteration: RelaxRods2Ftl)
    RelaxBend(rodStiffness)
    RelaxQuads(surfaceStiffness, constraintScale)
    RelaxTris(...)                                          // no charm has tris
```

Note both stiffness values come out as exactly 1.0 for charms, and `RelaxRods2`/`RelaxQuad*` ignore
the stiffness argument anyway (rods use their own `flRelaxationFactor`). `RelaxBend` does use it.

`nIterations` is the *environment's* iteration count, not the model's. `m_nExtraIterations` (5-10 on
charms) is a per-model addition on top; how the two combine is not settled — treat the model value as
the iteration count until something contradicts it.

## The constraints

### Rods — `RelaxRods2` (distance)

```
d      = b - a
dist   = |d|
req    = clamp(dist, scale*minDist, scale*maxDist)
delta  = d * (relaxationFactor * (req/dist - 1))
a -= delta * weight0
b += delta * (1 - weight0)
```

`flMaxDist == 16384` means "no upper bound" — a cord that may go slack but must not stretch.
`RelaxRods2Ftl` (follow-the-leader, last iteration only) instead moves **only** `b += delta`, leaving
`a` alone.

### Bend — `RelaxBend` (axial edges)

```
fe = p0*(1-te) + p1*te
fv = (p2+p3)*(0.5 - tv/2) + (p4+p5)*(tv/2)
axis = fv - fe;  axisLen = |axis|
crossEdges = cross(p1-p0, (p4+p5)-(p2+p3))
if axisLen > 0.001:
    adjDist    = dot(axis, crossEdges) > 0 ? -flDist : +flDist     // flip detection
    correction = 1 + adjDist/axisLen
else if |crossEdges| > eps:
    axis = crossEdges;  correction = flDist / |crossEdges|
else:
    axis = (0,0,1);     correction = flDist
delta = axis * (stiffness * correction)
p0 += delta*w[0];  p1 += delta*w[1]
p2 += delta*w[2];  p3 += delta*w[2]      // NOTE: same weight applied to both
p4 += delta*w[3];  p5 += delta*w[3]
```

Weights are `{node0, node1, nodes 2 and 3, nodes 4 and 5}`.

### Quads — shape matching via Wahba's problem

`vShape[i]` is the relaxed pose with the centre of mass at the origin; `.w` is that node's weight and
the four weights sum to 1. The local frame convention is X = edge 0→1, Y = edge 0→2 orthogonalized.

Three solvers by static-node count. Common helper:

```
CFeBasis(tentativeX, tentativeY):
    axisX = normalize(tentativeX)                              fallback (1,0,0)
    axisY = normalize(tentativeY - axisX*dot(tentativeY,axisX)) fallback (0,1,0)
    axisZ = cross(axisX, axisY)
```

**RelaxQuad0** (no static node) — the general case:

```
basis = CFeBasis(p2-p0, p3-p1)
m[i]  = vShape[i].w
CoM   = sum(p[i]*m[i])
x[i]  = p[i] - CoM
r[i]  = basis.LocalToWorld(scale * vShape[i].xyz)
rhs   = -sum(m[i] * cross(x[i], r[i]))
cov   = sum over i of Wahba(m[i], x[i]):
            diag += m*(y²+z², x²+z², x²+y²);  XY -= m*x*y;  XZ -= m*x*z;  YZ -= m*y*z
omega = Cholesky3x3(cov).Solve(rhs)
r[i]  = r[i] + cross(omega, r[i])          // CSinCosRotation: first-order rotation, NOT normalized
p[i]  = r[i] + CoM
```

**RelaxQuad1** (node 0 static) — identical but `CoM = p0`, basis `(p2-p0, p3-p1)`, and only nodes
1..3 participate in the covariance and get written.

**RelaxQuad2** (nodes 0,1 static) — reduces to a 1-DOF rotation about the edge:

```
CoM   = (p0+p1)*0.5
basis = CFeBasis(p1-p0, p2+p3-2*p0)
local2 = basis.WorldToLocalYZ(p2-CoM);  local3 = basis.WorldToLocalYZ(p3-CoM)
rot   = SinCos2D( (local2.x*S2.y + local2.y*S2.z)*S2.w + (local3.x*S3.y + local3.y*S3.z)*S3.w,
                  (local2.x*S2.z - local2.y*S2.y)*S2.w + (local3.x*S3.z - local3.y*S3.y)*S3.w )
r_i   = basis.LocalToWorld( S_i.x,
                            S_i.y*cos - S_i.z*sin,
                            S_i.z*cos + S_i.y*sin )
p_i   = CoM + r_i * scale        (i = 2,3)
```

`SinCos2D(wc, ws)` normalizes: `w = hypot(wc, ws)`; if `w > FLT_EPSILON` then `cos = wc/w, sin =
ws/w`, else `cos = 1, sin = 0`.

#### Where CS2 differs from the CS:GO-era source: the RelaxQuad2 sine

The leaked source computes the sine term as `cross2(local, shape)`:

```
( vLocalP2.x * vShape[2].z - vLocalP2.y * vShape[2].y ) * mass2  +  ...
```

**We use the opposite order, `cross2(shape, local)`.** Two independent reasons:

1. *Algebraically*, only that order is invariant to the roll of the YZ frame. The frame here is
   `CFeBasis(p1-p0, p2+p3-2*p0)`, and at the authored pose that tentative Y is very nearly parallel
   to the edge — so which way Y ends up pointing is decided by the last decimal of the node
   positions. A solve that depends on that roll is not a solve. Working it through: with
   `cross2(shape, local)` the reconstructed world position comes out at `R(angle(local) -
   angle(shape))·shape`, independent of the roll; with the other order the roll appears twice and
   does not cancel.
2. *Empirically*, on this build's data: with the source's order every one of the 62 charms flips its
   pose through 180° on the very first step (nodes 4 and 5 swap places) and the assembly then falls
   at exactly free-fall speed. With this order all 62 settle by at most 0.07in and stop.

The likely explanation is `Builder::AdjustQuads` — the comment in `RelaxQuad2` says the basis
"should be synced up" with it, so the two-static-node quads' `vShape` is stored in whatever
convention the builder used, and CS2's builder evidently differs from the CS:GO-era one. We did not
confirm that in the binary; the 62-model agreement is the evidence.

`Cholesky3x3(a00,a10,a11,a20,a21,a22)`:
```
m00 = sqrt(a00);              inv00 = 1/m00
m10 = a10 * inv00
m11 = sqrt(a11 - m10²);       inv11 = 1/m11
m20 = a20 * inv00
m21 = (a21 - m20*m10) * inv11
m22 = sqrt(a22 - m20² - m21²); inv22 = 1/m22
SolveLeft(b):  x = inv00*b.x;  y = inv11*(b.y - m10*x);  z = inv22*(b.z - m20*x - m21*y)
SolveRight(b): z = inv22*b.z;  y = inv11*(b.y - m21*z);  x = inv00*(b.x - m20*z - m10*y)
Solve(rhs) = SolveRight(SolveLeft(rhs))
```
`sqrt`/reciprocal are the "safe" variants — a non-positive-definite covariance yields 0, not NaN.

## Node bases → bone transforms

The part that had two plausible orderings. The engine uses the **second** one, and the header comment
on `FeNodeBase_t` ("y = nodeY1 - nodeY0, then orthogonalized") describes the *dead* branch. The live
code normalizes **Y first** and orthogonalizes **X** against it:

```
axisY = normalize(pos[nNodeY1] - pos[nNodeY0])        fallback (0,0,-1)
axisX = pos[nNodeX1] - pos[nNodeX0]
axisX = axisX - dot(axisY, axisX) * axisY
if |axisX| > 0.05: axisX /= |axisX|  else  axisX = anyPerpendicular(axisY)
tm = { X: axisX, Y: axisY, Z: cross(axisX, axisY), origin: pos[nNode] }
if qAdjust.w != 1.0:  tm = tm * matrix(qAdjust)       // concat in that order
```

Static nodes below `m_nRotLockStaticNodes` take their whole transform from the animation instead;
static nodes between that and `m_nStaticNodes` take the animated orientation with the simulated
position.

## Which nodes are simulated, and which only ride a bone

Not every free node is integrated. `m_FreeNodes` on `kc_aus2025` is 4..17, but only 4..9 appear in
any quad, rod or axial edge. Nodes 10..17 are the `$cloth_node_body*` proxies: no constraint touches
them, they carry the biggest collision radii (0.4) and friction 1.0, and `m_CtrlOffsets` attaches
each rigidly to `joint3`. They are the charm's rigid BODY, and they follow the bone.

Integrating them makes them fall away at exactly free-fall speed — which is how this was found, and
it is a useful signature: **a drift of ½·360·t² inches means a node nothing constrains is being
integrated.**

So the rule, which is data-driven rather than a list of names: a free node that appears in no
constraint is placed from its `m_CtrlOffsets` parent, not integrated. The full order per step is

```
predict (integrate the constrained free nodes)
collide
iterate constraints
node bases            -> a frame per bone ctrl
reverse offsets       -> refine each bone's ORIGIN so its target node lands at the authored offset,
                         and write that back into the node positions (the engine does this too)
ctrl offsets          -> place the driven body nodes from their parent bone
```

**Collision lives on the body, not the chain.** Worth knowing before touching contact code: on
`kc_aus2025` every nonzero entry in `m_NodeCollisionRadii` belongs to a `$cloth_node_body*` proxy —
the chain links are radius 0. So colliding only the simulated nodes collides *nothing*, and the charm
hangs straight through the weapon.

The proxies cannot be pushed directly (they are placed from a bone, so any write is overwritten on
the next solve), so `collideBody` resolves them the way the geometry works: the body is rigid on the
end of the chain, so pushing the body means displacing the chain. The deepest correction is applied
to every simulated node as a pure translation — position and previous together, injecting no
velocity — and the constraint pass that follows re-establishes the shape against the anchor, which
bends the chain instead of sliding the whole rig.

## Contact stability — why the charm used to jitter

Three separate faults, all in our integration rather than the transcription. Worth knowing because
each one is easy to reintroduce.

1. **Contacts must get the LAST word.** Running them once before the constraint loop means the final
   thing to touch a position is `relaxQuads`, which cheerfully pulls a node back into the weapon it
   was just pushed out of — so the next step it penetrates again. That push-pull across frames *is*
   the jitter. Contacts now run at the end of every constraint iteration.
2. **Only the inbound NORMAL velocity may be removed.** Zeroing the whole velocity (what the old
   pendulum did, and what this did first) means a charm resting on the gun cannot slide along it: it
   sticks, gets pulled by the constraints, un-sticks, and stutters. Keep the tangent.
   `m_DynNodeFriction` would belong here but its semantics are not recoverable — it is 1.0 on every
   body node and absent elsewhere — so no tangential damping is invented.
3. **Bound the per-step travel.** A node that moves further than its own collision radius in one step
   can land on the far side of the shell, and a nearest-surface query then pushes it out through the
   WRONG side. That is what "the charm suddenly went inside the gun and thrashed" was. `maxTravel` is
   half the smallest collision radius the model uses, and the step is 1/120 rather than 1/60 so the
   clamp rarely has to bind.

Also: push out by `depth * (1 + CONTACT_SKIN)` rather than exactly to the surface, or the next query
is a coin flip between touching and not; and push the BODY out in several relaxed passes
(`BODY_PUSH_RELAX`, `BODY_PASSES`) re-solving the chain between them, instead of one shove the
constraints immediately undo.

4. **Weight the body push down the chain; never apply it rigidly.** A rigid translation moves the
   nodes pinned to the anchor too, and the constraint pass snaps them straight back every step,
   forever — a freshly loaded charm bouncing in place near its mount until you shake it loose.
   `chainWeight` is 0 at the anchor and 1 at the far end, so the chain BENDS out of the way, which is
   the only thing it can physically do with one end nailed to the gun.
5. **Geometry at the clip point is the MOUNT, not an obstacle** (`charmAnchorSkip`, sized to the
   static nodes' spread). A charm is clipped ONTO the weapon; treating the surface it is clipped to
   as penetration means buzzing against its own mount forever. The old pendulum had the same guard.
6. **Give up on a contact that cannot resolve.** If the placement puts the anchor inside the weapon —
   the physics cannot argue with a saved offset — the pin holds the charm in, the contact pushes it
   out, and they trade places forever. `contactLoad` is a rolling duty cycle, and above
   `CONTACT_GIVEUP` the push fades to nothing, so the charm goes still (slightly embedded, but
   stationary) and the sleep latch takes over. **It must be a duty cycle, not a consecutive-step
   counter:** a jammed charm does not hold contact solidly, it oscillates in and out of it — that
   *is* the buzz — so a counter resets every other step and never fires. Measured on the jammed AK:
   43 contacts in 180 steps of unbroken buzzing. Only a real change (new anchor, drag, flick) resets
   it, via `resetCharmContact` — deliberately NOT `wakeCharmSim`, which the viewer calls on every
   camera nudge and which would clear the ramp before it ever engaged.

**Reproducing it:** bury the charm and watch it recover. In the live viewer,

```js
const s = window.__viewer.charm.sim;
for (const n of s.dynamic) { s.pos[n*3] += 1.2; s.prev[n*3] += 1.2; }  // 1.2in into the body
s.asleep = false;
```

A healthy solver escapes in one frame and then decays monotonically to a settle. Thrashing shows up
as alternating large per-frame steps, or a max step pinned at `maxTravel`.

## Cost

The collider is a uniform grid (CSR buckets) rebuilt with the bake, not a linear scan: contacts are
queried for every colliding node of every constraint iteration of every substep, which is a few
hundred queries a frame. Measured on an AK-47 with Lil' Squatch, before and after:

| | before | after |
|---|---|---|
| charm bucket | 2.80 ms | 0.09 ms |
| collider | 10,187 tri | 119 tri |
| triangle tests/frame | 11,822 | ~0 at rest |

Most of the collider win is the reach: it is CUBED into the triangle count, and it only has to cover
where a node can actually get to. The constraints are near-inextensible, so that is the furthest rest
node plus a margin — **not** twice it, which is what swallowed 39% of a high-poly weapon.

**Size grid cells from the collider's EXTENT, never from its largest triangle.** Sizing them to the
longest edge sounds tidy — no triangle then spans more than a couple of cells — but weapon meshes are
full of long slivers, so one of them makes the cell as big as the whole collider, every triangle
lands in a single bucket, and the query degenerates to the linear scan the grid exists to avoid. That
cost 9ms and 18 MILLION triangle tests a frame on a charm jammed in an AK's receiver. Cells are now
`span/24`, and the few triangles too big to bucket go in an overflow list every query checks.

Two things make that number worth recognising: `contacts/f` far exceeding the collider's triangle
count means the grid is not culling, and a `charm` bucket in the milliseconds with `fps 0` means the
average is being divided by a tiny frame count — read the raw `charm` figure, not the ratio.

**Picking:** `SkinnedMesh` keeps its OWN `boundingBox`/`boundingSphere`, and those — not the
geometry's — are what `raycast` tests. They are computed once and cached, so a deforming charm ends
up with a stale hull. This one cached a 0.03in sphere on a 1.7in charm and became completely
unpickable: 0 of 400 rays across the whole screen hit it, and the charm could no longer be dragged to
a new spot on the weapon. `invalidateCharmBounds` drops both after every step that moved the cloth.

## Still open

- **Hinge limits** (`FeHingeLimit_t`): 4-5 per charm, CS2-only, no source. `nNode[6]`,
  `flWeight4`/`flWeight5`, `flAngleCenter`, `flAngleExtents` (radians on our data — extents are
  0.785398 = π/4 and 1.178097 = 3π/8, which is decisive). Needs disassembly.
- **Twists** (2 charms), **anti-tunnel probes**, **dyn/kin links** (1 charm). Same situation, much
  lower stakes.
- How the environment's iteration count combines with `m_nExtraIterations`.
- `m_flAddWorldCollisionRadius = 2.0` inches on a ~1.6in charm would hold it 5cm off the gun, so its
  meaning is not what the name suggests. Shipped at 0 until it is understood.

## Checking a change

Run `tools/charmsim-check.ts` over the extracted sidecars — headless, no three, whole catalogue in
under a second:

```
npx esbuild tools/charmsim-check.ts --bundle --platform=node --format=esm --outfile=/tmp/check.mjs
node /tmp/check.mjs <dir-with-*.phys.json>
```

It asserts, for all 62 charms:

1. **The authored pose is an equilibrium.** Gravity along local -Z: settle by at most 0.25in, then
   stop. The worst in the catalogue is 0.066in on a ~1.6in charm. Note this is NOT "nothing moves" —
   the authored pose is the undeformed pose, not the gravity equilibrium, so a little sag is
   correct. A wrong quad projection, `qAdjust` order or Gram-Schmidt order each send it to tens of
   inches, so the test is still extremely sharp.
2. **It comes to rest.** Worst per-step motion at t=50s is ~1e-8in. Nothing in the data damps
   anything, so this is entirely the constraint projections dissipating — which makes it the check
   that they are not *injecting* energy.
3. **No NaN**, from a perturbed start as well as a clean one.

Beyond that: period and decay against a 60fps capture of a real CS2 inspect.
