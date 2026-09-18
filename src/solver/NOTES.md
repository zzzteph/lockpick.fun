# The 2.5D pin solver — design notes

A standalone prototype, in `solver/`, of a purpose-built contact solver for a pin-tumbler
cylinder. Nothing in `src/sim`, `src/game` or the renderer is touched; `solverbench.html` runs
the game's cutaway and HUD on top of it (`src/physlab/solverbench.ts`), and `tests/solver/`
holds the eight acceptance behaviours. Every test prints the numbers it saw, so a run of
`npx vitest run tests/solver` is also the report.

## What it is

Two perpendicular planes, one solver.

- **Chamber plane (y–z)**, one per chamber: the plug is a disc of radius 6.35 mm turning about
  its axis, with a radial bore slot; the housing is the fixed bore above the shear circle. The
  key pin and the driver are rigid polygons with three degrees of freedom each — sideways,
  up, and a cant angle. Bores are Ø3.05, pins Ø2.95, every bore mouth has a 0.15 mm chamfer.
- **Cutaway plane (x–y)**: the pick is a rigid polygon (x, y, angle) plus one bending degree
  of freedom for the blade beyond a flex point 12 mm behind the tip. The keyway is a floor, a
  roof between the bores, the bore side walls, and the mouth's two corners as fulcrums.
- **The coupling** is that a key pin's Y is the same number in both planes. The pick pushes on
  the key pin's cone in the cutaway; the same body is pinched, wedged and rubbed in its
  chamber plane; one Gauss–Seidel sweep over all contacts settles both at once.

Units are mm, N, s, rad. Fixed 1/120 s frame in 8 substeps. No allocation in `step`, no DOM,
no clock: `createLock` builds every typed array; `step(state, input, dt)` fills them.

## How the solve works

Sequential impulses with warm starting (`solve.ts`), the same family as Box2D, but with an
analytic contact set instead of a broadphase (`contacts.ts`):

- pin vertices against the plug's bore walls, chamfers and floor and against the housing's
  walls and chamfers; pin vertices against the plug's outer circle (the ledge) and the
  housing's underside; the plug's rim corners and slot lips against pin edges; the housing's
  rim corners against pin edges; driver bottom against key top; pick vertices against the
  keyway and the key pins' undersides; keyway corners and key-pin corners against pick edges.
- Every candidate pair gets a fixed slot number in a fixed visiting order, so its accumulated
  impulses and its stick/slip flag persist between substeps without a hash lookup.
- Contacts are speculative: a pair within `margin` (0.3 mm) becomes a constraint that may close
  its gap this substep and no further. Speed caps keep every body under one margin per
  substep, so nothing tunnels; `contacts.deep` counts anything that did.
- **Friction is a real stick/slip model.** A stuck contact is held at zero tangential velocity
  by whatever impulse that takes, up to μ_s·N; once it saturates and moves it is flagged
  sliding and the cap drops to μ_k·N until it stops again. Brass on brass is 0.35 / 0.25,
  steel pick on brass 0.30 / 0.20.
- A position pass (non-linear Gauss–Seidel) removes what penetration the velocity pass left.

Springs and damping are explicit forces. That is deliberate: an implicitly damped velocity
absorbs part of an applied force before the contact solve sees it, and a blocked blade then
pushes on a pin with a fraction of what its bend says. Masses in `params.ts` are chosen so
every spring has ω·h < 1 — they are numerical, and they set only how fast a transient settles,
never where it ends. The hand, the blade and the pins are critically damped (ζ ≈ 1): an
under-damped pick rings at 40–100 Hz after every stick–slip and reads as trembling on screen.
The hand also has a force limit (`handMaxForce`, 12 N by default, 6 N in the bench).

## The eight behaviours, with numbers (defaults, 8 substeps, 10 iterations)

1. **Bind.** Torque, no lift: the chamber with the smallest δ binds, the plug stops at 1.01°
   against a rigid-centred-pin estimate of 0.90° — the extra is the pin canting into the
   offset — and creeps 2.7 arcseconds in two seconds. At 18 N·mm the pinch is 2.7 N per side,
   so lifting the binding pin costs about 2.5 N of pick force.
2. **Set.** Lifting the binding pin clears the driver; the plug advances from 1.01° to 1.39°
   (the next chamber's δ predicts 1.26°); the driver stays on the ledge when the pick leaves,
   0.63 mm up, held by the spring on a curved ledge plus stiction.
3. **Spool false set.** A spool whose waist straddles the shear line (key pin 2.0 mm) lets
   the plug through to 2.70° instead of 1.00°; the driver cants 4.0°, the key pin 2.6°, and it
   is jammed ring-against-plug-bore and head-against-housing with 7.6 N and 2.0 N. Leaning on
   it with the pick deflects the tip 1.0 mm at 2.1 N and moves the pin 0.03 mm. (The slimmer
   `spool-deep` profile gives 8.7° and 13° — the cant is a property of the ring height.)
4. **Counter-rotation and push-through.** From the false set, lifting drives the plug back
   (spool: 1.7°; mushroom: 6.0°; serrated: a 0.09° click per groove). Thresholds, as the
   wrench torque above which the pin cannot be pushed through to a true set: spool, mushroom
   and serrated all between 6 and 12 N·mm, T-pin unpushable at 6 N·mm. (With the earlier
   under-damped blade the spool's threshold read 12–18 N·mm: the snap of the blade was helping
   the pin through. The critically damped blade is the honest number.) Below the threshold the
   driver straightens, rises and drops into a true set.
5. **Overset.** Shoving past the shear line at 15 N·mm: the key pin's chamfer cams the plug
   back from 1.38° to 1.02°, the key pin enters the housing bore 0.8 mm and carries 2.5 N per
   side; the driver is unloaded, the next chamber releases, and it holds when the pick leaves.
   At 6 N·mm it also enters, but the pinch is too light to hold it against the spring.
6. **Feather.** With two chambers set at 1.28° and 1.41°, easing the wrench lets the plug
   roll back on the ledge chamfers; the last-set chamber (least ledge under it) drops at
   T=0.12, the first at T=0.04.
7. **The pick fouls neighbours.** A hook aimed 0.6 mm above the pin tips runs at 0.6 in the
   clear, is bent down to about 0.35 by the first pin's spring, and lifts every pin it passes
   by roughly that plus the cone's wedge; each pin falls back after. Carried above the keyway
   roof, the roof holds the tip down and the hand target stops mattering. The pins follow the
   tip they actually meet, never the hand.
8. **Rake.** A triple-peak rake scrubbed at 12 N·mm ratchets the binding pin up a little on
   every pass (the pinch friction holds what each pass gained) and sets it on pass 8; two of
   the three standard pins are set after forty passes; the spool is never set.

Six chambers cost 5.2 ms per frame in vitest on this machine (0.63× real time).

**Bench findings (`solverbench.html`).** With the mouse, a set is a 0.15–0.3 mm window of pin
travel, and at 15 N·mm of wrench torque the stick–slip jump when a pinched pin breaks free is
larger than that window: everything oversets. At 6–11 N·mm the jump is 0.1–0.2 mm and sets land.
This is the solver saying what real picking is like; the game will need its own assistance
layer on top. The bench carries the first helpers, all outside the solver: the hand target is
smoothed over 60 ms, vertical mouse sensitivity falls as the pick feels load, the hand pushes
with at most 6 N, Shift + arrows step the lift by 0.02 mm, and the drawn plug angle is eased
over 80 ms (readouts show the true one). Measured with a deliberately shaky mouse (±1.5 px at
60 Hz) the tip moves 0.5 px in the clear and not at all once it is loaded; with a still input
nothing in the solver moves. The bench draws the lock from the solver alone — the same polygons
in the cutaway and the chamber panel — at 36 px/mm on both axes. The mapping from the roster's
bitting and tolerance numbers to key lengths and housing offsets is data in `solverbench.ts` and
will need tuning per lock: with two chambers binding within 0.02 mm of each other, the first set
has no ledge and drops when the pick leaves.

## Parameters that are physical, and the ones that are not

Physical (`params.ts`, first two blocks; `profiles.ts`): plug radius, bore and pin radii, the
chamfer, the floor and slot, spring preload and rate, the four friction coefficients, the
maximum wrench torque, and every pin and pick outline. Change these and behaviour changes for
a reason you can point at.

Numerical: masses and inertias, damping, speed caps, substeps, iterations, margin, slop,
`stickSpeed`, and `pinGravity` (real is 2.6 mN; boosted to 30 mN so a freed key pin falls in a
few frames rather than a second). These decide how fast things settle, not where.

Two choices worth knowing about:

- **Key pin geometry.** The key pin is a cylinder with a 2.4 mm cone below its shoulder; the
  cone rests on the keyway slot's lips, so 1.5 mm of tip hangs into the keyway and the key
  top at rest sits at `K − 4.08`. Set lift is therefore `3.86 − K`. The bench maps the game's
  bitting so the player's learned lifts are unchanged.
- **The hand.** `aimTip` turns a tip target into a hand pose: level whenever the shank fits
  through the mouth that way, otherwise pivoting on the mouth's roof or floor. Effective tip
  stiffness is about 1.4 N/mm — 2 N/mm from the blade's bend plus the hand's rotational and
  translational give — and the hand can transmit at most ~12 N (the pick speed cap).

## What becomes redundant in `src/sim/constants.ts`

Everything that is a *rate toward a target* or a *tuned gain* is replaced by geometry, a
force, or friction:

- `PLUG_TAKEUP_RATE`, `PLUG_MAX_RATE` → plug inertia, damping and the wrench torque.
- `PICK_BASE_RATE`, `FREE_LIFT_MULTIPLIER`, `SPRING_RETURN_RATE`, `PICK_TRAVEL_RATE`,
  `TENSION_TRAVEL_DRAG` → the hand springs, the blade's bend, the driver spring, pin damping.
- `COUNTER_ROTATION_FORCE`, `PIN_COUNTER_FORCE`, `TAPER_FORCE_CAP`, `ENGAGE_RAMP`,
  `SERRATION_GRIP`, `PLUG_PUSHBACK`, `SPOOL_CAM_BITE` → the driver's shoulder geometry
  against the plug rim, with friction. The push-through threshold is an outcome.
- `FALSE_SET_GAIN`, `PIN_FALSE_SET_GAIN`, `OVERSET_THETA_FACTOR` → waist depth, ring height
  and bore clearance; the false-set angle is where the canted pin jams.
- `TOLERANCE_SPREAD`, `MIN_DELTA_GAP` → per-chamber housing offsets δ in millimetres, with
  the bore clearance setting the take-up.
- `T_MIN_HOLD`, `T_SET_HOLD`, `HOLD_ENGAGE_RELIEF`, `SET_SLIP_GRACE`, `DISTURB_SLIP_GRACE`,
  `DISTURB_FACTOR`, `LEDGE_FULL_ENGAGE`, `LEDGE_RELEASE_MARGIN`, `LEDGE_CLEAR_MM`,
  `FEATHER_WINDOW` → the ledge (a chamfered circle) plus stiction. Feathering order emerges.
- `MAX_OVERLIFT`, `DIMPLE_MAX_OVERLIFT`, `CAPTURE_WINDOW`, `CAPTURE_TIME` → the chamfer
  window at the shear line (about 0.3 mm with two 0.15 mm chamfers) and the housing rim.
- `RESIST_*`, `FORCE_FULL_MM`, `RESIST_PRESSURE_MM`, `DRAG_RATE_SPREAD`, `RESIST_PER_MM_LIFT`,
  `SPRING_SPREAD`, `RESIST_PER_SPRING`, `CONDITION_SPREAD`, `RESIST_FLOOR` → the pick's
  contact force and tip deflection, read from the solver.
- `SHANK_REACH`, `HOOK_RISE`, `SHAFT_HALF` → the pick outline in `profiles.ts`.
- `STRAIN_*`, `BENT_*` → not modelled yet; the bend angle is there to hang plastic strain on.

Still needed as they are: `DT`, `THETA_OPEN`, `OPEN_THETA_FRACTION`, `TENSION_SLEW` (an
input-shaping choice), the disc/wafer/sidebar/combination constants (other families), the
events and stats machinery.

## Known limits

- Pins are rigid; walls are rigid; the only compliance is the pick. A real lock has a little
  in its brass, which would soften the pinch forces at high torque.
- The pick's contact with the pin is in the cutaway plane only; a pick pushing off-centre does
  not tilt the pin about the keyway axis (the spec's simplification).
- The key pin's cutaway silhouette ignores its cant.
- No plastic strain or breakage on the pick yet.
- `contacts.deep` should stay at 0; if it does not, something moved more than a margin in a
  substep and the speed caps or margin need revisiting.

## Added for the sandbox bench, 2026-09-13 (all default-neutral; `tests/solver` unchanged, 12 green)

- `Params.shearGap` (default 0): the housing's underside is a circle `plugRadius + shearGap`
  about the plug's axis (`housingY` in geometry.ts; the housing bore walls end on it, the
  underside contact uses it). The bench opens it to 0.35 mm so a key pin's top can stand above
  the plug's rim where the turned plug's bore no longer lines up with the housing's - with a
  12.7 mm plug every degree shifts the bores 0.11 mm against each other, more than a key pin's
  0.07 mm of play by the second pin.
- `contacts.deepPts`: (body, x, y) triples for the first deep (beyond-margin) penetrations of a
  substep, so a bench can say what tunnelled. `deep` itself is unchanged in meaning.
- A vertex outside the plug's disc (a set driver's corner over the rim, above the curved top) no
  longer counts as "behind" a plug wall segment: `inDisc` is passed as the wall's `closed` flag.
  Before, such a corner at 4-5 deg of turn read as tunnelling 0.5 mm into the plug that was not
  there.
- `Params.keyTopChamfer` (default 0.15, the value `C` always had): the 45-degree chamfer on a
  key pin's top corners, so a lock can choose it. `keyPin(length, topChamfer)` takes it.
