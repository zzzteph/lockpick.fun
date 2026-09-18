# The sandbox bench — the game's screen on the 2.5D contact solver

A dev-only prototype. `sandbox.html` -> `src/sandbox/bench.ts`. It wears the game's screen (the
HUD, the drafting palette, the shell's widgets) but everything under it is the 2.5D contact
solver in `solver/` (see `solver/NOTES.md` for what it is and the numbers it produces). Nothing
here is in the shipped bundle (the build's single input is still `index.html`). Nothing in
`src/sim`, `src/game` or `solver/` is changed by it; `src/render/cutaway.ts` carries two optional,
unused-by-the-game fields from earlier experiments (`chamberTilt`, `rotationGauge`).

Open with `npm run dev`, then `/sandbox.html`.

## The three experiments of 2026-09-13, in order

**1. Controls.** The pick moves **freely** along the keyway under the mouse (a continuous
position; the solver is aimed at the nearest pin's x). Any mouse button held over the lock is the
wrench. The RIGHT button pressed on top of it is counter-rotation (since 2026-09-14, the owner's
control): the plug walks back at `COUNTER_RATE` (0.3°/s) for as long as it is held, the wrench
still on, and returns to normal when it is released — the way a hand eases a wrench to let a
false-set spool or a serrated pin through. ← / → snap the tip to the next pin in that direction; the mouse takes the pick back once
it moves (8px dead zone). Space is the only push: a held ramp (`KEY_LIFT_RATE`, ceiling 3.5 mm),
released = the pin comes back on its spring. Arriving under a new pin drops the lift unless Space
is held. Wheel or 1-5 = pressure; W latches the wrench; [ ] change lock; N reseed; R reset.

**2. The front view** (`frontview.ts`) — the pin under the tip seen from the FACE, in the left
gutter. A cropped window: driver, key pin, the top of the plug; no pick, no whole lock (owner's
cuts). The plug is a circle that really turns; the shell's bore stays put. Everything the owner
called out along the way is in the drawing: one continuous bore (the shell's walls end at the
hole's arc, the rim is stroked only where there is rim, the shear line is a dashed guide), the
same spring construction and key-pin chamfer as the side view, headroom above a lifted driver,
the window narrower than the gutter so the rim reads as the top of a big plug.

**3. The engine** (`engine.ts`, `sideview.ts`) — the game's 1-D rate sim is **gone from under the
bench**; the 2.5D solver runs instead. Why: the front view exposed what a 1-D model cannot say —
in a false set the plug has turned, so the other straddling pins are pinched by the offset bores
and cannot be set, yet the 1-D sim still named one "binding" and let it set. The solver has that
geometry for real: the plug is a disc, bores are offset per chamber (δ from the lock's tolerance
and a seeded order), pins are rigid polygons with a cant bounded by the bore walls (nothing enters
the shell), and the pick is a rigid polygon that presses a pin wherever it meets it — the pick's
shank fouls the pins it passes under, and a pin you push that the lock will not let through stops
the pick instead.

- `engine.ts` builds the solver lock from the roster lock (the mapping `solverbench.ts` arrived
  at: key length `3.86 − setLift`, housing offsets 0.06 mm × tolerance apart), aims the hand from
  a tip target (`aimTip`), steps the solver in fixed 1/120 s ticks, and pours each tick into a
  game `SimState` so the game's HUD reads it. The five state words are a read of forces and
  positions (`chamberStateOf`): overset = key pin's top above the rim; false set = cant > 2° under
  plug force; set = driver clear of the mouth (within 0.12 mm), lifted, carrying little plug force;
  binding = plug force > 0.3 N; else free.
- `sideview.ts` draws the cutaway from the solver alone, in the bench's drafting language: the
  keyway and bores at the solver's dimensions, pins as upright silhouettes at the solver's heights,
  the pick as the very polygon the solver pushes with, amber dots where it touches a pin. One
  scale on both axes (30 px/mm). It does **not** slide the plug's bores under tension (a section
  along the axis cannot show a turn) and does **not** cant pins (that is the front view's plane).
- `frontview.ts` now draws the solver's chamber plane directly: its plug angle, its pin polygons
  (cant included), its bore walls, and its contacts as dots sized by force (amber stuck, crimson
  sliding). No exaggeration anywhere — a false set turns the plug a couple of degrees and that is
  what is drawn.

**Fun over exactness (owner, after the first feel: "physics must also be fun to play … more
physically representable, not 101% physical"; later: "make the physics more relaxed — right now
I can not set anything").** The bench's lock uses GAME numbers, set in `engine.ts` and applied
only there (the solver's own defaults and tests are untouched). Found by two headless scripts on
the bench's own engine (`scratchpad/sweep.ts`: does one set hold; `scratchpad/play.ts`: walk the
whole lock in binding order the way Space does), not by feel alone:
- **Binding order is DRIVER DIAMETER, bores aligned** (`solverLock`, `gameDriver`). The
  `solverbench` mapping offset each housing bore sideways by a step of δ; at any spread wide
  enough to give a set a visible ledge the pins jammed the plug with no wrench (every driver
  straddles the line at rest — at 0.3 mm the plug rested at 3.6° reporting sets before anything
  was touched), and at a narrower spread neighbouring pins bound within hundredths of a degree
  and a set had no ledge ("another pin starts binding when the first one is not set"). Real
  cylinders are drilled aligned; the pins vary. So each driver is `GAME_TOLERANCE_GAP = 0.03` mm
  slimmer in radius than the one binding before it: the fattest pinches first, each set moves the
  plug ~0.55°, and the 0.06 mm ledge is the same for every pin. Near-real, so pins look one size
  (owner: "the pins always have different width — I do not believe this is correct") and a
  spool's waist is deeper than the accumulated turn, so a lifted spool false-sets with its waist
  at the line (at 0.1 mm steps the third pin's waist was shallower than the offset and spools
  behaved like standard pins — "their narrow part not at the shear line").
- **The LEDGE is magnified in the DRAWING, not the physics** (`VIEW_LEDGE_GAIN = 4` in
  `frontview.ts`, adding at most 6°). Only when the shown pin is SET — its driver above the rim,
  nothing of it in the plug's bore — the plug frame (plug, plug bore, the key pin in it, plug-side
  contacts) is drawn turned ×4 for the plug's turn BEYOND that pin's own bind angle; the shell
  frame (shell bore, driver) stays. A binding or free driver straddles the line with its lower
  half inside the plug's bore, so it is drawn against the TRUE angle — magnifying the whole angle
  drew the bore's wall through the pin (owner: "the plug turning too much, and its part is inside
  of the driver pins"). The same idea as the game's cutaway ledge (D-017); the caption prints the
  honest angle and says "ledge drawn ×4" when it is.
- `passed` has hysteresis (a margin to enter, a quarter of it to leave): a set pin sitting at the
  margin flickered SET/FREE and, with the magnification keyed on SET, the plug flipped with it —
  the "trembling". Pin damping is ×4 the solver's (numerical), which trims the one or two
  stick–slip jumps of a lift from ~0.11 to ~0.07 mm a tick at no cost to set times. Measured under
  a steady wrench, still mouse or ±2 px tremor: nothing moves at all.
- `GAME_BORE_RADIUS = 1.545` (0.07 mm clearance on the fattest pin, 1.4× real).
- **Deburred edges**: `GAME_RIM_CHAMFER = 0.02`, `PIN_BEVEL = 0.015` (the solver's 0.15/0.15). A
  set driver's corner must land on the plug's FLAT top; on a chamfer's slope its spring cams the
  plug back and two such sets held a pressure-2 wrench to a standstill. The set latch (below)
  makes the window's width irrelevant to the player, so small chamfers cost nothing.
- **The side view's shear line** is drawn at the plug's top at the BORE'S EDGE (`sideShearMm`),
  where a set driver's corner actually rests, not at the axis — with the line at the axis a set
  driver sat a few pixels below it (owner: "we see that parts of the driver pin below shear line").
- Open = the plug past 22° (`0.75 × THETA_OPEN`): four set drivers camming on the rim settle the
  plug short of the game's 30°. **The bench then freezes the solver** (`opened` in `bench.ts`)
  and shows the open banner: with every driver set and sliding on the rim at 25°+, the plug's
  friction against their corners makes it swing between two angles for as long as the wrench is
  held (measured: 25°–27°, 55 reversals in 3 s — "when you lift all the pins the plug turns and
  starts to tremble"). Heavy plug damping stops it but turns the opening into slow motion; an
  open lock has nothing left to simulate. R or N resets.
- **Lighter springs, slipperier brass** (`GAME_TUNE.params`: 0.3 N + 0.1 N/mm, μ 0.2/0.15; the
  solver's 0.5 + 0.15, 0.35/0.25). Even on the flat a set driver rests off-centre and its spring
  cams the plug back a little; with rim friction the solver's numbers still stalled the plug
  after two sets (reaction 10.8 of 10.8 N·mm, nothing binding). At these the walk sets all four
  pins of the spool trainer and opens it at pressure 2. Pinches are lighter and stick–slip jumps
  smaller — the "more relaxed".
- `HAND_MAX_FORCE = 12` (the solver's default; `solverbench`'s 6 N could not lift a pin bound at
  pressure 3).
- `PASS_CLEARANCE = 0.4`: the hook rides 0.4 mm under the pins while not pushing (at pin height
  the crest rammed the next cone walking the keyway and jammed at full hand force); the tip's x
  target slides at `TIP_SLEW` 60 mm/s instead of jumping a pitch; and pressing Space snaps the
  tip to the nearest pin within 1.5 mm, because a hook on a cone's slope lifts nothing useful.
- **Lighter wrench, less strength** (owner: "right now I need to push-push-push — before that I
  need less strength"): `TENSIONS` in `bench.ts` run 6–20 N·mm (was 6–30) with step 2 = 8 N·mm the
  default, and Space's ramp slows less under load (`1 + 0.6·force`, was 1.5). The pinch a push
  must lift scales with the wrench, so a lighter wrench is a lighter push. Step 1 is the lightest
  that still carries the plug past two set pins to the next bind (4.8 N·mm stalled there).
- The green band (`setWindow`) is drawn 0.6 mm tall in both views — a guide, not a rule; the
  latch does the timing (owner: "make green space bigger").
- Measured with `play.ts` at the default (8 N·mm): 4 → 1 → 2 (spool) → 3 (spool) in ONE push each
  (0.4, 0.4, 0.6, 0.9 s) → open at 29.8°. Same at step 3. At step 5 the last spool needs the wrench
  eased — the technique, not a bug.

**The plug turns back when the wrench is off** (`RETURN_GAIN`, `RETURN_MAX` in `engine.ts`): a
torque toward zero, proportional to the angle and fading at zero, applied only while no tension
is held. A real plug is pushed back by the set drivers' springs on the rim's chamfers; the flat
game ledges took that away, so it is put back explicitly, and the sets drop as the bores realign
(owner: "when tension is released completely the plug should turn back"). Measured: two sets at
5.0° → 0.02° and all pins free within half a second; the wrench then binds the first pin again.
The HUD never sees the return as tension.

**The click.** A held key has no way to stop at the set: after the driver clears, the key pin
carries on into the shell's chamfer and cams the plug back, undoing the set it just made. So the
moment the pin under the tip reads SET, Space stops adding lift until it is released and pressed
again (`liftLatched`). Overset is still there — let go and push again — but it is a second
decision, not a timing test. (A hand-lead clamp was tried first and rejected: lifting a bound
pin and camming a key pin both take ~2 N, so a force limit cannot tell them apart.)

**Reading SET from the plug's angle.** The engine records the plug angle each chamber was last
seen binding at (`bindAt`); a chamber the plug has turned a third of a step (0.3°) past that is
behind the wrench, and a lifted driver there is SET — the instant the plug moves on, while the
pick is still pushing. It used to demand the driver clear of the mouth, and a driver held on the
chamfer's slope read FREE while the next pin went amber ("I lift it, and it's not set and in a
second another pin starts binding"). FALSE SET is for shaped drivers only (a standard pin has no
waist): a canted driver carrying the wrench's force (> 1 N; a set driver leaning on its ledge
carries only its spring), or a passed pin whose foot's centre line is still 0.5 mm inside the
plug's bore (the plug turned into the waist). A set spool leaning on its ledge dips a corner into
the bore; that is why the foot is measured at the centre line.
- The set window is DRAWN, in both views: a teal band across the bore from where the driver's
  bottom clears the plug's mouth to where the key pin's top would meet the shell's (`setWindow`),
  with a faint crimson zone above — "the space where we need to align". A guide, not a rule.
- Space's ramp slows as the pick feels load (`rate = KEY_LIFT_RATE / (1 + 1.5·force)`): the last
  tenths before a set are a creep you can stop.

**What the numbers say on this bench now (spool trainer, seed 1, pressure 2):** the plug rests at
~1.2° with no wrench (the straddling pins settle it between their offset bores) and binds at
~5°; a non-binding pin pushed 2 mm does NOT go through (the turned plug blocks it); the binding
pin sets after ~150 ms of held Space and stays set on release — the driver drops onto the rim and
the key pin falls away; the spool behind it then false-sets on its own.

## 2026-09-17 — the pick gun works: a real FORCE, in two phases

The owner chose "keep working the physics" over a scripted capture. It works now, and cleanly.

THE FIX was to stop fighting the solver. The rigid frozen-key blade (invM 0) tunnelled because the
turning plug rammed an immovable driver. Instead the strike is a real upward FORCE on the key pins
(`SolverState.strikeForce`, one per chamber, added to the key pin in `applyForces`): the drivers
stay MOVABLE, so the plug turns and settles them onto the ledge instead of ramming them. Two phases,
recomputed per step in the drive loop:
- LAUNCH (1.6 N) until the driver clears its own shear (`setLift + 0.4`) — a hard shove, enough to
  lift even a pinched binder at a workable tension.
- HOLD (0.5 N) once cleared — balances the driver's spring so it HANGS just above the line for the
  ~130 ms window while the wrench turns the plug and catches it, instead of over-driving to 5 mm and
  crashing back (which tunnelled). At the window's end the force goes off and the uncaught fall.
Only unset pins are struck, so a strike never knocks a caught driver off its ledge.

MEASURED: Brasswell opens in 1–4 strikes at every tension, Kestrel and Northgate 5-pin in 2–4 at
T ≥ 0.10–0.13, all `deep` 0 (no tunnelling). Too light (0.08) leaves a pinched binder it cannot
lift — stuck, as it should be. The spool trainer mostly resists (a snap gun cannot counter-rotate a
false-set spool) and opens only at heavy tension — realistic. In the browser one strike opens
Brasswell (`47-gun-open.png`). The strike is opt-in (bench `g`); the game never strikes, and the
new `strikeForce` is 0 in all normal play, so nothing else changed — 994 suite green, lint clean.

LUCK (owner: "make it lucky, fewer catches per strike"): the HOLD phase alone did nothing — pins
caught whether held or not, because the capture is during the launch. So the lever is whether a pin
CLEARS the shear: a lucky pin (rolled per strike at `CATCH_CHANCE` 0.55, off a gun RNG seeded from
the lock) is launched CLEAR and caught; an unlucky one is launched only to JIGGLE height — up,
visibly, but short of the line, so the plug passes nothing. Result across 20 seeds: Brasswell 1–12
strikes (avg 3.8), the 5-pins 2–11 (avg ~4.8), all open, all `deep` 0. Browser: a 5-pin took three
bumps, catching a random few each. Version rolled to 5.0.0 (`npm run bump -- --major`) with a
CHANGELOG entry for the whole engine swap.

## 2026-09-17 — the pick gun (snap gun) on the bench, a first pass

Owner: "build the pick gun on the bench." The bench has a STRIKE key now (`g`): `Engine.strike()`
flicks every unset key pin up so the drivers jump over the shear (the pins visibly JUMP — the
thing the owner asked for). Held light on the wrench, a few bumps are meant to pop it.

HOW IT ENDED UP (the physics fought every approach; recorded so nobody re-treads it):
- A velocity impulse dies in ~1 ms — the pins are `pinMass` 2.6e-5 with `pinDamping` giving a 6 ms
  time constant, so even `pinMaxSpeed` launches them under 1 mm. Cutting damping + gravity for the
  window barely moved them either.
- Teleporting the key pins up tunnels (a jump > the 0.3 mm contact margin). 
- What is in now: the blade FREEZES each unset key pin's vertical DOF (`invM` → 0) and ramps it up
  under the margin (0.12 mm/step) to just clear its own `setLift`, holds ~200 ms, then releases;
  the wrench is held off during the window so the plug does not turn into the rigidly-held drivers
  and jam, and catches on release.

WHAT WORKS: the pins jump (verified in the browser, `46-gun-jump.png`); a single clean strike on a
fresh lock sets the binder stably (`deep` 0). WHAT DOES NOT, yet: the CAPTURE is unreliable — the
drivers tend to over-drive to OVERSET rather than being caught, repeated strikes tunnel (`deep`
15–45) once pins are in mixed states, and it does not reliably open. The blocker is the solver:
it was tuned for slow quasi-static picking, and the plug catching a driver that is momentarily up
is a stiff transient it resolves by tunnelling. Making it robust needs solver work (more
iterations / a dedicated capture path) or a semi-scripted capture (place the caught driver on the
ledge with the stable `clickSet` machinery instead of relying on the plug snap) — an owner call.
The strike is opt-in (only the bench's `g`), so nothing else is affected; the game never strikes.

## 2026-09-17 — the engine ships, and a set pin can be overset

The engine moved to `src/physics/engine.ts` and the two views to `src/render/sideview.ts` and
`src/render/frontview.ts` (the bench imports all three from there; `SIDE_SHEAR_Y` is 536 now, for
the game's rank band) because the game now runs and draws them: `Session` with `physics: 'solver'`, behind
`index.html?physics=solver` — see docs/SOLVER_PORT.md. Two bench changes the same morning:

- **Overset on a set pin** (owner: "I cannot overset the pins — only the free ones, a bit").
  Measured: a set pin's key pin can be pushed 0.2 mm into the housing's mouth on its top chamfer,
  where it blocks the plug — but the read kept saying SET for a passed pin, and the latch stopped
  the push at the click anyway. Now a passed pin held over the corner for more than `OVER_HOLD`
  (0.2 s) reads OVERSET, and the bench's latch is a pause (`CLICK_PAUSE` 0.35 s): Space still
  down after the click pushes on. Headless and in the browser: hold through the click → OVER after
  the pause, let go → SET again, the plug held meanwhile.
- **The legend says right-click = counter-rotate**; the front view moved down a row for it.

## 2026-09-16 — the plug's caps are the solver's own stops

The owner, on the Kestrel Serrated Trainer: "I set 4, first, and when I set the second with
counter-rotation, the third pin (driver) falls out of the shaft into the keyhole … always, when
you counter-rotate to set up the pin, if next is serrated — it falls out." Seed 1 never showed
it; seeds 2, 3 and 4 did, headless (`scratchpad/serrated.ts`), and seed 4 was traced to the
sub-substep (`serrinner.ts` replays one 1/120 s solver step by hand):

- Counter-rotating on pin 3 with the pick lifting it, the moment the driver's first serration
  groove reached the plug's rim corner the pinch let go. Inside ONE solver step the wrench had the
  free plug to itself: 0.34° → 0.77° at 60°/s (the soft cap only limited the velocity at the
  step's start; the eight inner substeps re-accelerated it). At 0.63° the serration's lip landed
  on the rising ledge and the position pass, asked to resolve lip-on-ledge, plug wall, housing
  wall and key pin at once, threw the driver (+1.3° then +3.4° of cant in two sub-substeps).
- The hard cap then teleported the plug back 0.44° to the counter-rotation stop, leaving the
  driver canted 3.9° with a corner 0.2 mm inside the plug's wall. Next step: `contacts.deep` 5,
  the driver flipped 96° into the plug and lay across the keyway — the owner's picture.

The fix (`engine.ts` `setStops`): every cap the engine computes — the run limit, a false set's
give, the counter-rotation stop, the pushed-pin hold — is now written into the solver as its own
rotation stop (`Params.thetaOpen`; the hold as `thetaMin` too) before each step. The stop is a
contact solved together with the pins' contacts, so the plug never leaves the cap inside a step
and nothing is teleported; `hardCap` only takes back the stop's residual (at most the solver's
slop) and the counter-rotation's own 0.0025° increment. A second guard: a cap that lands further
below a counter-rotating plug (a false set's give computed late) is held to `rate·DT` as well —
only counter-rotation moves the plug back, and only at its rate.

Measured after: the serrated trainer on seeds 1–6 and on the bench's own new-seed sequence,
`deep` 0 throughout, every driver in its chamber; the browser replay of the owner's steps
(`serratedbrowser.mjs`) `[SET SET BIND SET]` at 1.04°, no errors; Brasswell, Kestrel, Northgate,
the spool trainer and the laminated pad still open at 1.37° / 1.65° / 1.74° / 1.43° / 1.44°, all
`deep` 0; `tests/sandbox` 14 green (a seed-4 regression test added). Still open from 2026-09-15:
the serrated notches read binding rather than false set in the automated walk, and Northgate
Commercial's first spool reads false set at rest.

### Later the same day — three reports, one place

The owner: (1) "when the pin is binding the lockpick under it moves very slowly"; (2) the state
says FALSE SET while the plug's line only touches the spool's two shoulder corners — "the plug
barely rotated"; (3) Northgate Commercial: "the first pin false-sets, the second starts to bind,
and even lifted to the correct place it is still marked as binding". Measured (`scratchpad/
spoolread.ts`, `liftbrowser.mjs`): a standard binder rises under Space at 2–3.6 mm/s at every
tension (not slow); the slow one was the FALSE-SET spool — the 0.3 N hand cap of 09-15 cannot
lift a driver against its own 0.3 N spring, so the pick sat under it. Northgate Commercial's first
spool had its waist top 0.05 mm OVER the line at rest (the bench cut `0.6 + 1.25·lift` ignored
the game's `minimumSetLift`), the wrench dropped the plug into it at 0°, and the second pin — 0.05 N
from the corner while the spool carried 1.6 N — read as the binder. Three changes in `engine.ts`:

- The cut respects the game's own rule: `setLift ≥ minimumSetLift(profile)` (groove top + 0.15).
  Northgate Commercial now rests at `[BIND FREE FREE FREE FREE]` 0.48°, spool first.
- A driver binds only when it HOLDS the plug: `BIND_MIN_FORCE` 0.3 N (the `holdAt` threshold
  already). A brushed pin reads FREE; a binder let go of by counter-rotation reads FREE until the
  wrench takes over (test adjusted).
- THE WAIST FLOOR replaces the 0.3 N hand cap: while the pick pushes the pin under the tip and the
  plug's corner is in that driver's groove, `Params.thetaMin` is set to where the plug is (or to
  the receding counter-rotation cap), so the spool's lever cannot turn the plug back and the hand
  pushes with all 6 N. Measured: the trainer's spool 2 false-sets at 1.04°, rises through its
  waist at 2.4–2.9 mm/s to 1.19 mm and jams on the foot's shoulder with the pick at 2.7 N, the
  plug at 1.04° throughout; the right button walks the plug back and it sets. Northgate
  Commercial's spool: the same at 0.68°, 2.7 N, no back-off. All six locks open, serrated seeds
  1–6 clean, 14 tests green.

WHAT IS NOT FIXED, and why — the false set's depth. At real tolerances the plug enters a spool's
waist by 0.015–0.03 mm (0.2–0.3°) and stops: the driver's head is 3.1 mm of full width in the
housing bore (the game's `spool` bands are `full 0.45, groove 0.95, full 3.1`), so it cannot
lean more than ~0.9°, and the foot's upper corner meets the tilted plug wall as soon as the
pin's sideways play is used up. More play does not help — measured at bore 1.50 / 1.525 / 1.55:
drop 0.015 / 0.018 / 0.015 mm. A real spool leans 5–10° in a false set because its ends are ~1 mm
and its waist 2.5–4 mm long. So with the game's proportions the picture the owner objects to —
the plug's line touching the two shoulder corners — IS the false set, the deepest one this shape
allows. Options (his call): give the solver's spool a real spool's proportions above the game's
bands (his rule says use the game's shapes), or accept a 0.2° false set and draw the plug's turn
magnified in the front view, or leave the word and the picture as they are.

### Later still — real spool ends, built and REVERTED the same hour

Asked which option, I said real spool proportions and read the owner's "it's no more 1-D sim,
but 2.5D" as a go. It was not: "DO NOT change the spools — we have dedicated shapes for them —
use only them." The shape is back to the game's bands, band for band, full width to the top;
what follows is the record of what the real ends did, so it need not be measured again. For an
hour `fromBands` gave the spool family (spool, spool-slim, spool-deep, spool-double) a real
spool's top: the game's foot and waist(s) band for
band, then `SPOOL_END` 1.0 mm of full width, then a stem relieved by `SPOOL_STEM_RELIEF` 0.2 mm
to the spring. Grooves for the reads come from the game's bands now, not from the polygon (the
stem is not a groove). Two things fell out and are handled:

- A relieved stem the plug's corner meets at rest is a chamber that never binds. Northgate
  Commercial's spool-slim (foot+waist+end = 2.0 mm) was cut 1.98 mm deep: it read FREE to the
  end and the lock did not open; cut 1.9 deep its end's top edge hooked under the housing's
  mouth corner by 1.6° and 3.8 N could not lift it. `spoolMaxLift`: a spool chamber's cut stops
  0.2 mm under the end's top (the leading corner rises ~0.05 mm over the picking turn).
- A leaning false-set spool wedges the plug (foot corner on the plug wall, end corner on the
  housing wall, 2–5 N), and the pin binding behind it cannot set until the spool is set: pushed
  to the line it reads FREE, past it OVERSET. The 09-15 accommodation ("the pin behind a false
  set sets") was an artefact of a spool that could not lean; the walk's spool-first order with
  counter-rotation opens everything.

Measured, headless and in the browser (`spoolread.ts`, `liftbrowser.mjs`, `23-spool-real-
end.png`): a spool's false set is a JUMP of the plug when the waist's top passes the corner —
0.18° in the trainer's spool 2 (the next pin binds there; that is the tolerance step), 0.30° in
spool 3 worked last (1.04° → 1.34°, 0.05 mm into the waist), 0.30° in Northgate Commercial's
first spool. Pushed, the spool leans 1.5–1.8° and rides down its waist to the foot's shoulder;
released, it hangs there at 0.1°. So the picture the owner objects to changes by a pixel or two:
at 0.01 mm tolerance steps a false set can be at most one step deep while another pin is still
to bind, whatever the spool's shape. The shape matters only for the last spool, and there it is
0.3° rather than 0.2°. All six locks open, serrated seeds 1–6 clean, 14 tests green.

## 2026-09-15 — real tolerances (read this first, it supersedes the numbers below)

The owner asked what is more realistic and said "do that". The bench now runs at real bore
play and real per-pin offsets, and the family of problems the 1°-a-pin scale had made — the
shear gap, the spool lever, the false-set strut that locked the plug, the tip-over of the last
driver — has gone with it. The numbers (`engine.ts`):

| knob | was | now | why |
|---|---|---|---|
| bore radius | 1.545 | 1.50 | 0.025 mm of play a side, a real cylinder |
| tolerance step (radius) | 0.05 | 0.01 | pins bind 0.18° apart; five pins in 1.2° |
| rim chamfer / pin bevel | 0.02 / 0.03 | 0.01 / 0.01 | a set's ledge is 0.02–0.03 mm and must be a flat |
| shear gap | 0.2 | 0.05 | the leading corner rises only 0.03 mm at these angles |
| click window / landing | 0.06 / 0.06 | 0.03 / 0.015 | scaled with the ledge |
| false set's give | 0.25 | 0.08 | still several pins' worth of offset |
| run past the last hold / open past | 1° / 1° | 0.4° / 0.3° | the largest binder step is 0.2° |
| overset above the corner | 0.35 | 0.12 | and never for a pin the plug has already passed |
| counter-rotation | 1.5°/s | 0.3°/s | a set survives ~0.2° of back-turn now |

Measured, headless and in the browser: Brasswell 4-pin opens at 1.58°, Kestrel and Northgate
5-pin at 1.66° and 1.74°, all `deep` 0; the spool trainer opens by counter-rotation at 1.45°
(spool 2 false-sets at 1.03°, spool 3 at 1.44°); Ironhold Laminated Pad (a serrated pin) opens
at 1.44°. THE OWNER'S CASE — spool 2 false-set, pin 3 binding behind it — now works: pin 3
lifts, the plug gives 0.03° into spool 2's waist, pin 3 sets (browser: `[SET FALS SET SET]` at
1.09°). A false-set spool pushed with Space alone moves the plug 0.000°. Two set pins under a
steady wrench: 0.000° peak to peak. The plug's whole picking turn is now under 2°, so in the
front view a set moves the plug about a pixel: the colours and the click carry it, as agreed.

Not right yet at this scale: the Kestrel Serrated Trainer — a serrated pin's four notches each
catch the plug's corner and the walk reads binding, not false set, and never sets it (needs
its own study); Northgate Commercial's first spool reads false set at REST, because the bench's
cut mapping (`0.6 + 1.25 × lift`) ignores the game's `minimumSetLift` and puts a waist on the
line before any lift. Counter-rotating past ~0.2° drops earlier sets — real, and the right
button is the owner's own control.

## State at the end of 2026-09-13 — the 1°-a-pin scale (superseded above)

**Solid, measured headless (`tests/sandbox/engine.test.ts` — 10 green, 1 todo — and
`scratchpad/play.ts`) and in the browser (`openbrowser.mjs`, `frontshots.mjs`):**
- Standard locks OPEN: Brasswell Bike Padlock (4 pins), Northgate 5-Pin Cabinet and Kestrel Door
  Cylinder (5 pins) walk with one binder at a time, every push a set that holds, `contacts.deep`
  0 throughout, the plug free at 7.3–8° and the engine frozen there with the banner. Cuts are
  `0.6 + 1.25 × the game's lift`, min 0.8 mm. Wrench 6–20 N·mm, default 8.
- **The click.** A binder whose foot (its LOWEST corner) comes within `CLICK_MM` (0.06) of the
  plug's rim corner while the pick lifts it is moved the rest of the way, once (`clickSet`,
  `CLICK_LAND` 0.06 above the corner — clear of the corner's chamfer and the driver's bevel, so
  the rim passes under the driver's flat; never on a driver the plug's corner is in the groove
  of, that is a spool's false set). Before it the pin sat AT the line reading binding until the
  hand had wound the pick up another 0.2–0.4 mm of asked lift (owner: "you need to lift it a
  nano-meter", "extra precise", "edges of plug and pin meet — they must flip"). Measured now:
  SET 33–50 ms and 0.04–0.09 mm after the foot reaches the line, all five pins of the cabinet.
- **The rim corner is not `rimY`.** The plug is 12.7 mm across: turning it lifts the leading rim
  corner by (bore + chamfer) × sin θ — 0.08 mm at 3°, 0.15 mm at 5.6°. Every "above the rim"
  read (`Engine.footAboveRim`, the click, SET vs FALSE_SET) is against that corner
  (`rimCornerY`), not the rest rim; landing 0.02 above `rimY` left the driver pinched at 0.7 N.
- **The shear gap** (`SHEAR_GAP` 0.2 → `Params.shearGap`, a solver parameter that is 0 by
  default): the shell's underside is a circle that much above the plug's top, drawn in both views.
  Why: each degree of turn shifts the plug's bore 0.11 mm against the shell's, so by the third
  pin the shell's edge overhangs the plug's bore by 0.4–0.6 mm while a key pin has 0.07 mm of
  play — a key pin's top could not stand a hair above the rim without meeting the shell's flat,
  the third and later pins set only inside a 0.05 mm window or by penetration, and "the last
  spool never sets" was never about spools. The gap is the owner's own idea ("a small space
  between plug and hull, as an additional lax thing"). He then asked for it "10 times smaller":
  measured, 0.2 is the smallest that opens the three standard locks; 0.15 and 0.12 leave the
  last pin binding, 0.035 cannot work while the plug turns ~1° a pin (the shear circle falls
  away under the shell's TRAILING overhang, so the key pin's top-left corner meets the shell
  0.08 mm below `rimY` while the driver's foot must reach the leading corner 0.13 above it), and
  smaller tolerance steps (the plug turning less) made 0.03–0.05 mm ledges every set slid off.
  The way to a hairline gap was tried on his "fix those two things": a 0.7 mm chamfer on the
  key pin's top moves its trailing corner in to where the shear circle is higher, and the three
  standard locks then open at a 0.07 gap (not 0.05) — but the key pins look like diamonds
  (owner: "why did the key pins become diamonds?") and the second spool's false set can no
  longer be pushed through, so it went back: 0.2 and flat-topped key pins. A hand that relaxed
  0.15 mm at the click (`CLICK_RELAX`, now 0) was tried so the key
  pin would not follow the driver up: it dropped the just-set driver onto the moving rim and
  every standard lock stalled 0.4° short of open; the overset rule below makes the room instead.
- **Counter-rotation** (owner's design): the right mouse button pressed on top of the wrench
  walks the plug back at `COUNTER_RATE` (1.5°/s) against a receding stop, the wrench staying on;
  let go and the wrench takes the plug forward again to whatever holds it. Torque OFF instead let
  the set drivers' springs cam the free plug home in a quarter second. A set survives as long as
  the plug is not backed past its own bind angle (~0.9°); a false-set spool's foot gets its room.
  Browser: 3.17° → 1.57° in a second held, back to 3.18° on release, no errors.
- Wrench off: the plug is walked back to zero (`RETURN_RATE`, kinematic) and every set drops.
  Verified 0.00° headless and in the browser.
- Open: the moment every pin is set and the plug runs `OPEN_PAST` (1°) beyond the last hold the
  engine stops stepping and `sim.opened` is true. Not at 22°: the keyway and the pick do not turn
  with the solver's plug, so a long open swing dragged key pins through the plug's floor
  (`contacts.deep` 8–11). Not while the pick is still pushing a pin either: the open is called
  only once the pick's force is gone — browser: 5.4° steady with Space held on the last pin,
  then 7 → 13 → 18 → 22° over 0.4 s once it is let go. The bench DRAWS that open turn from the
  frozen angle to 22.5° at `OPEN_TURN_RATE` (45°/s) — the animation the owner missed — with the
  key pins turning with the plug in the front view (they are in its bore; drawn fixed they
  "became part of the plug body") and the stale contact dots hidden. `plugMaxRate` 3 rad/s (was
  10: 9° a frame, past the contact margin).
- **The plug never runs more than `RUN_PAST` (1°) past the angle a pin last held it at**, under
  the wrench, always (`plugCap`). Past the next binder (steps 0.9–1.15°: after a 1.15° step the
  next pin binds once the pick lets go), never into the open swing. 1.5° tipped the Brasswell
  padlock's last, slimmest driver into the turned plug's bore mouth (0.22 mm of play in the
  housing bore, its foot on 0.25 mm of rim; cant 36°, `deep` 4). Gating the limit on the SET
  read let a set that read a frame late run the plug to 23° with the pick up; gating it on
  "every driver above the rim corner" failed because set drivers rest where the corner WAS.
  Every stop on the plug — this limit, a false set's give (`WAIST_DROP_MAX`), the
  counter-rotation stop, the pushed-pin hold — is one cap applied SOFTLY: the plug's speed is
  limited so it reaches the cap within the substep (`softCap`), and only the remainder is taken
  back after (`hardCap`). A hard reset of up to 0.7° a substep yanked the rim under the set
  drivers and knocked them off.
- **A pushed pin blocks the wrench** (owner: "it should not be possible to turn the tension
  wrench with the lockpick pushing the pin" — "I see that I can do so"): a key pin the pick is
  carrying more than `OVER_PUSH` (0.25 mm) above the plug's leading rim corner reads OVERSET,
  the wrench's torque is taken off and the plug is held where it is, both ways, until the pin is
  lowered. Browser: pin 2 pushed 1 mm up with no wrench, wrench on for 0.75 s → 0.00° and
  OVERSET; Space let go → 1.33°, pin 4 binds. 0.25 because a natural pop (the click's 0.06
  window missed by a hair) throws a set pin's key pin 0.2 above the corner while Space is held.
  Holding the plug with the torque still ON ratcheted the binding driver 0.3 mm into the
  housing's mouth corner (`deep` 1); the HUD keeps showing the hand's wrench while blocked.
- **A false-set spool cannot lever the plug back** (owner: "while pressing the tension wrench
  (5.26°) I push, and it suddenly changes to 4.4°, which allows me to push the spool"). Traced
  (`scratchpad/backwalk.ts`): the spool in its false set is a diagonal strut — foot on the
  plug's bore wall, head on the housing's mouth corner, ~20° from horizontal — so every newton
  the pick puts on it is 2.7 N sideways on the plug wall 5.4 mm above the plug's axis, 15 N·mm
  of backward torque, twice the default wrench: with the bench's 1° a pin the bores are offset
  many times a pin's play, and lifting a pin that bridges them means pulling the bores back
  into line. Tried and rejected: a near-square shoulder on the spool (it was not the shoulder
  camming), a 6 N hand (the lever still won, and 6 is now the cap anyway), a ratchet on the
  plug — the immovable plug against a wedged pin made the solver tunnel (`deep` 6–18), and a
  looser ratchet just crept 0.3° a second. What holds: `FALSE_SET_HAND` — the hand puts at
  most 0.3 N through a pin that reads FALSE_SET (4 N·mm of lever, under the lightest wrench's
  6), so the spool goes nowhere until the right button turns the plug back. Browser: 4.07°
  before, during and after a 1.3 s Space push on the false-set spool. The headless walk and
  the "spool technique" test now counter-rotate (right button) instead of easing the wrench.
- **The bench's own hook** (`BENCH_HOOK`, tip 3.3 mm over the shank's underside, 1 mm taller than
  the solver's): with the short hook any lift past 2.2 mm brought the shank up under the
  neighbouring key pin — behind a false-set spool that lifted the spool's own key pin into the
  lever, and the pin binding behind it could never be lifted far enough (owner: "your handle
  stuck on the key pins"; "the one that binds is no longer able to set"). Cuts run to 2.6.
- **False set = the narrow part only** (owner): the read needs a plug contact inside a groove;
  the plug pinching a head at rest or a foot's side is binding. The foot-deep fallback applies
  only to a lifted, unpinched driver whose groove contact dropped out for a substep.
- **OPEN — a pin binding behind a false-set spool cannot be set** (owner: "when one pin false-sets,
  another starts to bind, but the one that binds is no longer able to set — which is unreal").
  With the taller hook it lifts clear of the plug's corner (foot +0.08, 2.19 mm), but the plug
  will not advance the 1° that makes the set: the false-set spool is a three-point lock —
  its shoulder resting on the plug's corner, its foot's side on the plug's wall, its head's
  flank on the housing's mouth corner — and moving the wall left would swing the foot down
  through the corner. Measured: 20 N·mm of wrench (2.6× the default) moves the plug 0.14° and
  stops, `scratchpad/thirdpin.ts`. Working the spool first (right button, then push) frees
  everything. Real locks let you set other pins during a false set; here the bores are offset
  far beyond a pin's play (1° a pin), which is what makes the spool a strut. Next: give the
  false-set spool room to cant as the plug advances — the housing corner in the gap band is
  what pins its head.
- The game's `taper` is read as the shoulder's run per unit of groove depth, halved (a spool's
  0.15 → a 0.03 mm run over a 0.41 mm depth, near square, as the game means it; a mushroom's
  0.85 → a real bevel). The first reading (a fraction of the band's length) made a 10° ramp.
- **The state read is contact-based** (`plugTouch`): FALSE_SET = the plug's corner touching the
  driver inside one of its grooves (ramps included, `grooves[]` from the profile); SET = passed
  and lifted with no sideways plug contact; the plug touching a driver under its foot, or its
  head at rest, is never a false set (owner: "when the spool is already behind the shear line
  and the plug touches the middle of its bottom, it's marked as false set — once part of the plug
  touches the bottom it should flip and set"). Heights and cants misread a canted resting spool.
- Front view: ONE plug angle at every pin — the true one. The ×4 ledge magnification is gone
  (owner: "somewhere it's turned more than on another", "none of the lines from the plug should
  intersect the pin lines"). Pins draw one size; the ledge under a set pin is the real 0.1 mm
  (3–4 px); the shear line is the same height in both views; contact dots by kind.
- No trembling under a steady wrench on a standard lock (test: plug p-p < 0.02° over a second,
  pins < 0.01 mm). `contacts.deep` counts only real tunnelling now: a set driver's corner over
  the rim, above the curved plug top, is no longer "behind the wall" (`inDisc` in contacts.ts);
  `contacts.deepPts` names the body and place of anything that does tunnel.

**Open — the spools, honestly.** The owner's last word: "check what kind of spool pins and their
design is available — do not generate them, use defined". So the bench no longer generates any
pin shape. Every driver is the game's own profile from `src/sim/profiles.ts`, converted band for
band by `fromBands` in `engine.ts` (end bevels 0.03, a groove band = radius × (1 − depth), its
shoulders ramped by the band's taper), then slimmed by the chamber's tolerance step. The game's
catalogue: standard (one 4.5 mm band); spool = foot 0.45 / waist 0.95 at depth 0.30 / head 3.1;
spool-slim 0.62 / 0.38 at 0.24 / 3.5; spool-deep 0.5 / 1.1 at 0.44 / 2.9; spool-double, two
0.55 waists at 0.27; serrated, four 0.18 grooves at 0.12; mushroom 0.12 / 1.38 (taper 0.85) at
0.28 / 3.0; t-pin 0.1 / 1.5 (square) at 0.44 / 2.9; wafer 0.35 / 0.22 at 0.5 / 3.93. The waist
is where the game put it: in the trainer the spools rest with the foot 1.62 and 2.00 mm under
the rim (`scratchpad/catalogue.ts`).

**The trainer OPENS** (standard/spool/spool/standard), headless and in the browser. Headless
(`play.ts`, a false-set pin worked first with the wrench eased to 0.1; also the test "the spool
technique"): 4 sets, 1 sets, spool 2 false-sets at 4.02°, eased push → set at 4.09°, spool 3
false-sets at 5.34°, eased push → set, open at 5.53°, `deep` 0 throughout. Browser
(`counter.mjs`, the owner's control): spool 2 sets at the default wrench, spool 3 false-sets at
6.37°, pushed with the right button held → set → open, no errors. What made it, after the gap
and the corner read: the contact-based false-set read (the earlier height read latched the push
early or called a resting spool a false set) and the hand relaxing at the click. Still true and
worth knowing: the game's spool taper (0.15 of the 0.95 band) makes a 10° shoulder, self-locking
at μ 0.2 (tan 10° < μ), so a spool's foot cannot push the plug back by itself — the plug must be
eased or counter-rotated back; and at 0.01 of wrench the plug walks home and the standard sets
drop. Two false-set spools at once used to jitter the plug ~0.4° on the waist ramps; since the
plug never runs more than 1° past the last hold the second drop cannot happen, and a steady
wrench over a false set measures 0.000° peak to peak, headless and in the browser. At the
default wrench the first spool (a 0.9° drop, pin 3 binding right behind it) can be pushed
straight through; the second (1.3°) stays a false set until eased. Earlier today,
with generated spool shapes and before the gap and the corner read, the plug wedged three
bodies and penetrated (`deep` 2–7); that failure is gone. `limitFalseSet` is now a give bound:
the plug's corner may enter a lifted security driver's groove by at most `WAIST_DROP_MAX`
(0.25 mm, ~2.3°) past the head's side — physically the head then meets the housing wall, and
asked to resolve the corner on the groove's floor the solver tunnelled (`deep` 6 at 7.8°, six
housing corners inside the spool). The old rule (3° past the last hold) followed the binder as
it crept down the shallow shoulder and bounded nothing; the test "the spool technique" caught it.

## Knobs

- `TENSIONS` in `bench.ts` — the five pressure steps as fractions of the solver's 60 N·mm. Sets
  need a 0.15–0.3 mm window and above step 2 the stick–slip jump exceeds it; 2 is home.
- `LIFT_CEILING`, `KEY_LIFT_RATE` — how far and how fast Space asks the tip to rise.
- `HAND_MAX_FORCE`, `FALSE_SET_HAND` in `engine.ts` — 6 N, the most the hand puts through the
  pick; 0.3 N on a pin that reads FALSE_SET (the lever, above). `tune.params.ratchet` — a plug
  ratchet under the wrench, degrees per substep, off (0); it tunnels.
- `SHEAR_GAP` in `engine.ts` — 0.2 mm between the plug's top and the shell's underside
  (`Params.shearGap`); the room a key pin's top has above the rim. The smallest that opens the
  three standard test locks with the plug turning ~1° a pin.
- `CLICK_MM`, `CLICK_LAND` in `engine.ts` — how close to the rim corner a lifted binder is
  carried over it, and where it lands. `OPEN_PAST` — how far past the last hold is "open".
  `WAIST_DROP_MAX` — how far the plug's corner may enter a groove (a false set's give).
- `CLICK_RELAX`, `COUNTER_RATE`, `OPEN_TURN_RATE` in `bench.ts` — how much the hand eases at the
  click (0, see above), how fast the right button walks the plug back (1.5°/s), how fast the
  drawn open turn runs (45°/s).
- `OVER_PUSH`, `RUN_PAST`, `KEY_TOP_CHAMFER` in `engine.ts` — how far a key pin may stand above
  the rim corner before it blocks the wrench (0.25), how far the plug may run past the last hold
  (1°), the key pins' top chamfer (0.15, `Params.keyTopChamfer`; 0.03 was tried against a
  key-corner-on-driver-bevel wedge and made the pop overshoot worse).
- `GAME_TUNE.params` in `engine.ts` — springs 0.3 + 0.1, μ 0.2/0.15, pin damping 0.009, gravity
  0.06, `plugMaxRate` 3 rad/s.
- `solver/params.ts` — every physical and numerical number the solver uses.
- `VIEW_TOP_MM`, `VIEW_BOTTOM_BELOW_FLOOR_MM`, `VIEW_WIDTH_MM` in `frontview.ts` — the window's crop.
- `SIDE_PX`, `SIDE_SHEAR_Y` in `sideview.ts` — the side view's scale and where its shear line sits.

## Known, not yet done

- The per-lock mapping (bitting → cut `0.6 + 1.25 × game lift`, min 0.8; tolerance quality →
  the driver-diameter step) is a first cut, checked on the spool trainer only. Tune per lock.
- The plug's take-up is a few milliseconds of physics; `solverbench` eased the *drawn* angle over
  80 ms after "plug harsh". This bench draws the true angle so the pins and the plug agree.
- The state words are a heuristic read of the solver; the solver itself has no states. Two reads
  that bit on 2026-09-13: OVERSET must mean the key pin is *inside* the shell's bore (past the
  chamfer, `rimY + rimChamfer + 0.2`) — a pin the turned plug will not let through stops against
  the chamfer's edge and read as overset with a flat 0.25, which is what "always oversetting" was;
  and SET requires the plug to *carry* the driver (plug force > 0.1 N), so a pin merely held up
  by the pick does not read as set until the pick lowers and the key pin falls away.
- Contact marks in the front view say two things only: amber (crimson while slipping) where a
  WALL pinches the pin; a small teal mark where the RIM or LEDGE carries it (a set driver resting
  on the plug's rim is not a block — the owner read the amber dot there as "still touching and
  preventing the plug from rotation"). Pin-on-pin, the slot lips and the pick are not marked.
- Only the BINDING pin (amber) can set. A non-binding pin pushed against the turned plug just
  stops at the shell's edge and comes back; that is the real lock, not a bug — but it is easy to
  push the wrong pin and conclude nothing sets.

## Files

- `sandbox.html` — the page (dev only).
- `src/sandbox/bench.ts` — the screen, the controls, the frame loop.
- `src/sandbox/engine.ts` — the seam between the solver and the game's read model.
- `src/sandbox/sideview.ts` — the cutaway, from the solver.
- `src/sandbox/frontview.ts` — the face-on window, from the solver.
- `tests/sandbox/engine.test.ts` — the engine played the way a hand plays the bench: one binder,
  set-hold-next, the click, a non-binder sets nothing, wrench off, no tremble, the hand's cap,
  the game's profiles band for band, the set window, a spool's false set, counter-rotation, and
  the spool technique through to the open. `npx vitest run tests/sandbox`; every test prints
  what it saw.
- `solver/` — the 2.5D contact solver. Touched for the bench on 2026-09-13, all default-neutral:
  `Params.shearGap` (0), `housingY`, `contacts.deepPts`, and the disc check that keeps a corner
  above the plug's curved top from counting as tunnelling (`inDisc`). Its notes are its own.
