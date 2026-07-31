/**
 * Simulation constants — SIMULATION.md.
 *
 * Units: millimetres, seconds, radians. Roughly life-sized so the numbers stay intuitive.
 * Every value here is either quoted directly from the spec or derived from a behaviour the
 * spec requires; where a value differs from the literal text, the reason is on the line and
 * the reasoning is in `DECISIONS.md`.
 */

/** §9 — fixed timestep. Never step with a variable frame time. */
export const DT = 1 / 120

// ── §1 Coordinates ──────────────────────────────────────────────────────────────────────

/** Where the bottom of a key pin rests with nothing in the lock. */
export const KEYWAY_FLOOR = -5.0
/** Uniform driver pin length. Every band profile sums to this. */
export const DRIVER_LENGTH = 4.5
/** A key pin must sit below the shear line at rest. */
export const MAX_KEY_PIN = 5.0
/** …and the stack must straddle it: `K + D > 5.0`. */
export const MIN_STACK_HEIGHT = 5.0

// ── §2 Tolerance ────────────────────────────────────────────────────────────────────────

/** Radians of plug rotation before the loosest chamber binds. */
export const TOLERANCE_SPREAD = 0.02
/** Two chambers binding at once is real but unpickable; keep them apart. */
export const MIN_DELTA_GAP = 0.0008

// ── §4 Plug rotation ────────────────────────────────────────────────────────────────────

/** ~30° — enough that the payoff reads clearly on screen. */
export const THETA_OPEN = 0.52
/** Open at 98% of full rotation, with every chamber SET. */
export const OPEN_THETA_FRACTION = 0.98
/** An overset jams harder than a bind. */
export const OVERSET_THETA_FACTOR = 0.5
/**
 * Radians of extra plug rotation per unit of groove depth (depth is a 0..1 fraction of the
 * pin radius). Tuned so a fully spool-false-set lock sits at ~61% of `THETA_OPEN`, inside
 * the 55-70% band the spec asks for. See DECISIONS D-009.
 */
export const FALSE_SET_GAIN = 1.05
/** Stiff spring: θ chases its target. */
export const PLUG_TAKEUP_RATE = 24.0
/**
 * Cap on plug angular speed, so the false-set swing takes ~350ms with an ease-out
 * (ART_DIRECTION.md §5) instead of snapping in 40ms. Small per-set take-ups are well under
 * this and unaffected. See DECISIONS D-011.
 */
export const PLUG_MAX_RATE = 1.2

// ── §5 Counter-rotation ─────────────────────────────────────────────────────────────────

/**
 * Downward mm/s driven into a chamber whose groove has the plug's ledge in it.
 *
 * Spec said 14.0. At that value a spool is still comfortably settable at T=0.9, which
 * contradicts the spec's own §11 test and its §5 claim that heavy tension makes a spool
 * unsettable. The wall is placed by solving `F_counter(T) = liftRate(T)` for the stated
 * `T_SPOOL_MAX = 0.55`. See DECISIONS D-010.
 *
 * Re-solved from 60.0 to 42.8 when the bogus `θ / θ_open` factor came out of the force (D-053).
 * The old 60 was solved *with* that factor sitting at about 0.71, so it only ever described the
 * endgame; 42.8 puts the same wall in the same place with the term gone:
 * `42.8 × 0.55 × (0.25 + 0.15) = 9.42 = 26 / (1 + 3.2 × 0.55)`. Measured walls after the change
 * are spool T≈0.55, mushroom T≈0.29 (correctly worse), t-pin T≈0.65, serrated T≈0.60 — and the
 * shallow serrated grooves still lie rather than fight, because `grooveFloorLift` bounds how far
 * a 0.12-deep notch can push anything.
 */
export const COUNTER_ROTATION_FORCE = 42.8
/** Radians of plug rotation past δ over which the ledge fully enters the groove. */
export const ENGAGE_RAMP = 0.003

/**
 * How hard pushing a trapped driver rotates the plug **backwards**, in radians per second per
 * millimetre of over-push, before tension is accounted for.
 *
 * This is the missing half of a false set. A spool caught at its waist is trapped between its own
 * two shoulders and cannot simply be shoved up — the way through is that the driver bears on the
 * plug's ledge, and because the waist's edge is *bevelled* that contact drives the plug back
 * against your wrench. The ledge withdraws, the shoulder clears, the pin climbs.
 *
 * So the thing a player feels when pushing through a spool is **the wrench giving back**, and the
 * thing that stops them is holding it too hard to give.
 *
 * Radians of backward rotation per mm/s by which the pick is out-pushing the counter-force — which
 * ties the release to the force race whose balance point D-010 and D-053 already solved for and
 * measured per profile. A constant of its own would have re-opened that tuning. See DECISIONS D-075.
 */
export const PLUG_PUSHBACK = 0.15
/**
 * How much of the camming a *fully engaged* ledge takes away, 0..1.
 *
 * At 0.85 a spool the plug has swung right into keeps 15% of its cammability — a very slow shove
 * rather than an impossible one, so no wrench in the catalogue is locked out of a spool lock. Ease
 * the tension and the plug rotates back, the bevel comes into contact, and it climbs in about a
 * second. Hold it hard and it is a wall. See DECISIONS D-077.
 */
export const SPOOL_CAM_BITE = 0.6

// ── §6 Tension ──────────────────────────────────────────────────────────────────────────

/**
 * The tension a **barely** caught pin needs to stay caught — the worst case, not the rule.
 *
 * A driver held on a sliver of ledge lets go long before one the plug has swung well past, so the
 * real threshold is per pin and this is its ceiling. See `HOLD_ENGAGE_RELIEF`.
 */
export const T_MIN_HOLD = 0.08
/**
 * How much of that threshold a fully engaged pin does *not* need.
 *
 * At 0.75, a driver with the ledge properly under it holds down to a quarter of `T_MIN_HOLD`,
 * while one caught a moment ago needs the full amount. That spread is what turns easing the wrench
 * from a cliff into an instrument: back off a little and your newest, least-committed pin drops
 * while the rest stand. It is the single most-used technique in real picking and the game had no
 * way to express it — above the line everything held, below it everything died.
 *
 * Engagement is `θ - δᵢ`: how far the plug has swung *since this chamber's ledge started closing*.
 * So the pins you set first are the ones that survive, which is both correct and a rather good
 * incentive. See DECISIONS D-074.
 */
export const HOLD_ENGAGE_RELIEF = 0.75

/**
 * The tension a **captured driver** needs to stay on its ledge, before engagement relief.
 *
 * Separated from `T_MIN_HOLD` because that constant was doing two jobs and could only do one of
 * them. `T_MIN_HOLD` answers *"is the wrench doing anything at all"* — it gates binding, capture and
 * the feather — and at 0.08 it is correctly far below the lightest thing a player can select. But it
 * was also answering *"how much tension does a set pin need"*, and there the same number is a
 * disaster: the lightest pressure step is **0.12**, so at every selectable step, every set pin held,
 * always. The engagement relief below it was arithmetic nobody could reach.
 *
 * **0.18, and the number was measured rather than chosen.** Engagement mid-pick is not "low", it is
 * *0.01 to 0.14* — θ sits at the next chamber's δ, a hundredth of a radian, until the last pin sets
 * and θ runs up to 0.50. So the curve is effectively binary, and `T_SET_HOLD` simply **is** the
 * mid-pick threshold:
 *
 * | | engagement | threshold | in pressure steps |
 * |---|---|---|---|
 * | mid-pick, pins still to do | ~0.1 | 0.17 | between step 1 and step 2 |
 * | plug swung — spool false set, or all set | 1.0 | 0.045 | below step 1 |
 *
 * So exactly one setting is dangerous, the lightest one, and it is dangerous only while you still
 * have work to do. Ease to step 1 with three pins down and you start shedding them, newest first.
 * Ease to step 1 *after* a spool has let the plug swing and nothing moves — which is the whole
 * spool technique, and it has to stay free or spools become unpickable.
 *
 * The first attempt was 0.30, which put the mid-pick threshold above step 3 and broke sixteen
 * tests: it did not make light tension risky, it made light picking impossible. The right lesson
 * is "get the plug turned, then you may play with the wrench" — not "never use a light hand".
 *
 * Asked for in play as *"if tension is too easy, the other pins can fall down"*. See DECISIONS D-095.
 */
export const T_SET_HOLD = 0.18

/**
 * How long a captured driver may sit under-tensioned before it lets go, in seconds.
 *
 * Only applies while the wrench is still *on* — drop it entirely and the old rules apply, which is
 * where the feather lives. See DECISIONS D-095.
 */
export const SET_SLIP_GRACE = 0.25

/**
 * How much more tension a captured driver needs while you are **leaning on another chamber**.
 *
 * The other half of D-095, and the half that makes tension a *choice* rather than a slider you set
 * to 1 and forget. With only `T_SET_HOLD`, step 2 was safe for the whole attempt — so the answer to
 * "how hard should I turn" was still "as little as the game allows", which is the thing that was
 * reported: *"I do not see the reason not to only use the lowest tension — it allows to bypass
 * everything."*
 *
 * Working a pin loads the plug through that pin and shakes the ones already on their ledges. It is
 * why a real picker's hand is *steady* rather than merely light, and why you feel a set pin go the
 * moment you lean on its neighbour.
 *
 * 1.4 places it deliberately: with `T_SET_HOLD` at 0.18 a disturbed fresh pin needs 0.252, so
 * **step 2 (0.212) is no longer free while you are working and step 3 (0.304) is**. Below 1.18 it
 * would change nothing; above 1.69 it would make step 3 unusable too, which is the mistake the
 * first pass at D-095 made.
 *
 * Applied in proportion to how hard the tip is actually pushing, and never for a chamber that is
 * false set — a false-set pin's shove at the plug is already carried by `COUNTER_ROTATION_FORCE`
 * and `PLUG_PUSHBACK`, and charging for it twice makes the spool technique impossible. See
 * DECISIONS D-098.
 */
export const DISTURB_FACTOR = 1.4
/** Above this, grooves bite too hard to push a spool through comfortably. */
export const T_SPOOL_MAX = 0.55
/**
 * Tension at which the player is demanding *full* rotation. Above it θ_demand saturates.
 * Spec had `θ_demand = T × θ_open`, which makes every lock unopenable below T=0.98 and
 * therefore unopenable with several of the wrenches in `CONTENT.md`. See DECISIONS D-008.
 */
export const T_FULL_TURN = 0.25
export const BIND_HARDNESS = 3.2
export const PICK_BASE_RATE = 26.0
/** Non-pinched chambers are just riding springs. */
export const FREE_LIFT_MULTIPLIER = 2.2
/** How fast a chamber the pick has left returns to rest. Spec silent; see DECISIONS D-012. */
export const SPRING_RETURN_RATE = 34.0
/** The spring bottoms out this far above `setLift`; bounds the overset region. */
export const MAX_OVERLIFT = 2.0
/**
 * The same, for a dimple lock.
 *
 * A dimple's pins are addressed from the *face* of the key rather than its edge, and the whole
 * stack is shorter: less travel above the shear line, so the ground between "set" and "jammed" is
 * narrower. This is what actually makes a dimple lock a different job rather than a pin-tumbler
 * with a funny keyway — the family was gated behind its own pick and then played identically.
 * See DECISIONS D-067.
 */
export const DIMPLE_MAX_OVERLIFT = 1.1
/** §9 step 1 — tension is rate-limited, not instantaneous. */
export const TENSION_SLEW = 4.0

// ── Pick strain — the tool bends ────────────────────────────────────────────────────────

/**
 * Strain accumulates while the tip is loaded and the pin will not move, and recovers when it is
 * not. Spring steel takes a set if you lean on it long enough, and past that it snaps.
 *
 * The trigger is deliberately *not* "high resistance": a bound pin under a light touch is the
 * normal state of picking and must cost nothing. What bends a pick is **force meeting something
 * that will not give** — the gap between where you are asking the tip to be and where it actually
 * is, which is the same quantity the shaft's flex has always been drawn from. So the animation
 * stops being decoration and starts being the readout of a real accumulating cost.
 *
 * See DECISIONS D-068.
 */
export const STRAIN_PER_MM_SECOND = 0.42
/** How fast strain recovers with the tip unloaded, per second. */
export const STRAIN_RECOVERY = 0.55
/** Above this the pick has taken a permanent set for the rest of the attempt. */
export const STRAIN_BENT = 1
/** Above this it breaks and the attempt is over. */
export const STRAIN_BROKEN = 2.4
/** A bent pick's jitter multiplier — it no longer goes quite where you point it. */
export const BENT_JITTER_FACTOR = 3.5
/** …and a bent pick is slower, because a bowed shaft loses the leverage. */
export const BENT_RATE_FACTOR = 0.72

/**
 * How fast the pick tip travels **along** the keyway, in chambers per second, with no tension.
 *
 * The tip cannot teleport from chamber to chamber. It slides, and under tension it slides
 * *slowly*, because every pin it passes is being pressed down onto it by its spring and by the
 * plug — the hook has to shove each one out of the way to get past. That is what makes heavy
 * tension a genuine trade rather than a free choice: it holds your set pins beautifully and it
 * costs you the ability to move. See DECISIONS D-045.
 */
export const PICK_TRAVEL_RATE = 14.0
/** How much tension resists that travel. Higher means a heavy hand is a slow hand. */
export const TENSION_TRAVEL_DRAG = 3.5

// Raking's two constants lived here — tooth height range and retarget chance — and went with the
// rake itself (D-058). The finding they recorded is still worth keeping: modelling a rake as random
// *impulses* provably cannot work, because a kicked pin crosses its capture window faster than
// `CAPTURE_TIME` and so never dwells long enough to be caught (D-025).

// ── Disc detainers — SIMULATION.md §10 ──────────────────────────────────────────────────

/**
 * A disc's full travel, expressed in the same units as lift so the whole machine can be
 * reused unchanged. The renderer maps this onto a full turn; the simulation never needs to
 * know it is an angle.
 */
export const DISC_TRAVEL = 3.0
/** Discs have no springs — nothing returns them. They stay exactly where you left them. */
export const DISC_SPRING_RETURN = 0

/**
 * A magnetic chamber's return rate: a crawl, not zero.
 *
 * Not quite a disc. A magnet holds a steel pin firmly but it is still a spring-loaded stack, so the
 * pin creeps back rather than staying put forever — enough that a very patient player recovers, not
 * enough to be a plan: 0.12mm/s against a sprung pin's 34mm/s, so a magnetic pin loses a tenth of a
 * millimetre while you work the chamber next door and needs half a minute to give up entirely.
 * See DECISIONS D-066.
 */
export const MAGNETIC_RETURN = 0.12

/**
 * How deep a false gate is, as the same 0..1 fraction the pin profiles use for a groove.
 *
 * A false gate is a notch too shallow to let the sidebar all the way through: it drops
 * partway and stops. That partial drop is what lets the plug rotate a little further and
 * lie convincingly — the identical mechanism to a spool's waist, so it uses the identical
 * number. Without a depth here the constraint stays exactly at `δ`, the plug asymptotes just
 * *below* `δ` and never satisfies `θ ≥ δ`, so a false gate silently never fires at all.
 * See DECISIONS D-028.
 */
export const DISC_FALSE_GATE_DEPTH = 0.3
/** A false gate's bevel. Shallower than a spool's — a sidebar tip is a blunter wedge. */
export const DISC_FALSE_GATE_TAPER = 0.2

/**
 * How far the plug can turn while a sidebar is still up. Enough to feel like progress and to
 * make the stall unmistakable, nowhere near enough to open.
 */
export const SIDEBAR_HELD_FRACTION = 0.3
/** A dip below `T_MIN_HOLD` shorter than this drops only overset pins (Tier 3 technique). */
export const FEATHER_WINDOW = 0.12

// ── §7 Capture window ───────────────────────────────────────────────────────────────────

/** Multiplied by the lock's `toleranceQuality` to give chamber `Wᵢ`. */
export const CAPTURE_WINDOW = 0.62
/** Time inside the window before the ledge is under the driver. Rushing gets punished. */
export const CAPTURE_TIME = 0.045

// ── §8 Resistance ───────────────────────────────────────────────────────────────────────

/**
 * How hard you have to be pushing before a chamber tells you anything, in millimetres of lift.
 *
 * You do not feel a pin by resting a hook under it. You feel it by **pushing**, and what you feel
 * is how it pushes back: the free ones give and ride up, the bound one does not move. Resting the
 * tip under a pin and reading off a verdict is not a thing a hand can do.
 *
 * Without this, the entire game was solved by one gesture: hold tension, sweep the pick along the
 * keyway at zero lift, and the meter named the binding chamber before you had touched anything.
 * Every level did it, including the ones whose whole purpose is to make you work that out.
 * Roughly half a capture window, so a deliberate probe reads fully and a drag-past does not.
 * See DECISIONS D-056.
 */
export const RESIST_PRESSURE_MM = 0.45

/**
 * Overreach at which the force column reads full, in mm.
 *
 * The force meter used to share `RESIST_PRESSURE_MM`, which is a *gate* — half a millimetre of push
 * and the chamber starts talking. As a **reading** that is useless: a four-millimetre travel pegs it
 * within the first tenth of the lift and it never comes off the stop again. Reported from play as
 * "the force meter always maxed", which it was.
 *
 * 0.9mm is a little under a third of a second of held Space at `KEY_LIFT_RATE`, so pegging the meter
 * is a deliberate lean rather than the resting state of picking. See DECISIONS D-083.
 */
export const FORCE_FULL_MM = 0.9

export const RESIST_BINDING_BASE = 0.42
export const RESIST_BINDING_TENSION = 0.34
export const RESIST_FALSE_BASE = 0.36
export const RESIST_FALSE_TENSION = 0.26
export const RESIST_FALSE_WOBBLE = 0.08
export const RESIST_FALSE_HZ = 9
/**
 * A captured chamber, while the key pin is still climbing the empty bore beneath the driver.
 *
 * Almost nothing, and correctly so: the driver is held up by the plug's ledge rather than by the
 * key pin, so there is no spring load on the tip at all — just the key pin's own weight.
 */
export const RESIST_SET = 0.05
/**
 * The same chamber once the key pin has come up against the driver.
 *
 * Firm. From here you are pushing a captured driver back off its ledge, against its spring and
 * the shell bore, and if you keep going the key pin crosses the shear line and jams (D-051).
 * Lighter than a bind, because nothing is *pinching* the stack — but unmistakably there.
 *
 * A set pin used to read `RESIST_SET` however hard you leaned on it, which made the one action
 * that can destroy your progress the only action in the game with no warning attached. Asked for
 * directly: "even after a pin has been set, the player should still feel some resistance when
 * lifting it." See DECISIONS D-061.
 */
export const RESIST_SET_CONTACT = 0.52
/** How far below the driver the key pin starts to feel it coming. */
export const SET_CONTACT_MM = 0.5

/**
 * How much a chamber's spring may differ from the nominal rate, either way.
 *
 * Springs come off a coil and are cut to length; no two in a cylinder are quite the same. This is
 * the *physical* half of what makes each chamber feel individual — the other half is
 * `RESIST_PIN_BIAS`, which stands for bore finish and pin fit. Keeping them separate matters: a
 * stiff spring also makes that pin fall back **faster**, which is a thing you can watch, where a
 * tight bore only ever changes what you feel. See DECISIONS D-062.
 */
export const SPRING_SPREAD = 0.22
/** Resistance units per unit of spring strength above nominal. */
export const RESIST_PER_SPRING = 0.18
export const RESIST_OVERSET = 0.95
/**
 * A free pin is not weightless — it is a spring, and a spring you are pushing pushes back.
 *
 * Raised from 0.10 and the binding figures lowered to meet it, narrowing the gap from about 0.68
 * to about 0.39 at T = 0.5. The old spread made the meter self-evident: one glance at a full bar
 * against an empty one and there was nothing left to work out. Now the states still rank in the
 * right order but you have to *compare pins within this lock* to be sure — which is what the
 * per-pin bias is for, and is what a person actually does. See DECISIONS D-056.
 */
export const RESIST_FREE_BASE = 0.2
export const RESIST_FREE_WOBBLE = 0.07
export const RESIST_FREE_HZ = 3.5
/**
 * How much lighter a binding chamber feels while its sidebar gate is lined up.
 *
 * Without this a sidebar lock is a lottery: the gate is a 0.18mm band inside a 0.36mm capture
 * window, invisible, and missing it is only discovered after every pin is set and the plug
 * refuses to turn — at which point the only remedy is dropping tension and losing the lot.
 * It is also not how these locks are picked. The sidebar leg rides on the pin as you lift it
 * and *seats* when the gate passes under it; you feel that, and you stop there. Making the
 * tell readable on the one channel §8 already gives the player turns the sidebar from a coin
 * flip into a second, finer search. See DECISIONS D-029.
 */
export const RESIST_SIDEBAR_DETENT = 0.18

/**
 * How much one chamber's feel may differ from its neighbour's, either way (D-052).
 *
 * Wide enough that a heavy free pin and a light binding one are not separable by the number
 * alone — you have to compare pins *within this lock*, which is what a picker actually does —
 * and narrow enough that the ordering of the states survives. At ±0.09 against a binding/free
 * gap of 0.45 the states still rank correctly; what goes away is the exact threshold.
 */
export const RESIST_PIN_BIAS = 0.07

/**
 * How much a chamber's drag changes how fast its pin actually **moves**, either way.
 *
 * Friction that only changes a readout is not friction. `resistanceBias` stood for a tight bore and
 * a fat pin and did nothing but shift a number on a meter: a tight chamber read heavier and lifted
 * at precisely the same speed as a loose one, and fell back at the same speed too. A pin that drags
 * drags. Same roll drives both, so what you feel and what you watch agree. See DECISIONS D-069.
 */
export const DRAG_RATE_SPREAD = 0.15

/**
 * Resistance added per millimetre of lift — the spring getting stiffer as it compresses.
 *
 * Springs obey Hooke's law: the force rises linearly with compression, so a pin held at 3mm pushes
 * back appreciably harder than the same pin at 1mm. That rising gradient is how a picker judges
 * depth with no way of seeing it, and without it depth is free information-wise: every height felt
 * identical. See DECISIONS D-070.
 */
export const RESIST_PER_MM_LIFT = 0.085
/** Return rate at zero compression, as a fraction of the nominal — the spring's preload. */
export const SPRING_PRELOAD = 0.55

/**
 * Plug rotation past a chamber's δ at which its driver is *fully* caught on the ledge.
 *
 * The overlap between the plug's bore and the shell's shrinks as the plug turns, so a driver set
 * early — with the plug barely moved — is held by a sliver and can be shoved straight back off
 * (D-051), while one still there at the end of the attempt has the ledge properly under it and
 * cannot be reached at all. Everything about how safe a set pin is comes from this one quantity.
 * See DECISIONS D-071.
 */
export const LEDGE_FULL_ENGAGE = 0.12

/**
 * How far back past its own δ the plug must come before a set driver loses its ledge entirely.
 *
 * The ledge under a captured driver *is* the plug's rotation past δ — so if something drives the
 * plug back to δ, there is nothing under the driver any more and it falls into the plug. Forcing a
 * false-set spool with a light wrench does exactly that (D-075), and until this existed the chamber
 * stayed nominally SET with an open ceiling above it: the driver could be shoved to the top of its
 * travel, never jammed, and never fell. Set pins were being lost in geometry and kept in bookkeeping.
 *
 * The margin exists only so that resting *at* δ — which is where every chamber sits for the tick it
 * captures on — is not mistaken for coming back past it. Half of `MIN_DELTA_GAP`, so it can never
 * span two chambers. See DECISIONS D-081.
 */
export const LEDGE_RELEASE_MARGIN = 0.0004

/**
 * How far the pick must have a captured driver up off the plug's shoulder before it stops ratcheting.
 *
 * A set driver blocks the plug from turning back because its own body is in the corner. Lift it
 * clear and the plug can swing back underneath — twenty microns is enough to be *lifted* rather
 * than resting, and small enough that it is the deliberate shove, not float noise, that does it.
 * See DECISIONS D-081.
 */
export const LEDGE_CLEAR_MM = 0.02

/**
 * How far a lock's condition may move its tolerances, either way.
 *
 * No two copies of the same lock pick alike. A well-used cylinder has worn its chambers a little
 * wider and its pins a little smoother; a stiff new one is tighter than the catalogue says. Rolled
 * per instance from the same seed as everything else, so a given lock in a given save is a specific
 * copy of that lock rather than the platonic one. See DECISIONS D-072.
 */
export const CONDITION_SPREAD = 0.1

/**
 * The lightest a chamber under the tip can ever read.
 *
 * Never zero: a spring sits on top of every pin, so there is always something pushing back at
 * the tool. Zero is reserved for `no chamber under the tip at all` — it is how the renderer
 * knows to draw the shaft dead straight — and letting a real pin reach it made the two
 * indistinguishable (D-052).
 */
export const RESIST_FLOOR = 0.02

// ── Event throttling ────────────────────────────────────────────────────────────────────

/** Continuous events (PLUG_MOVED, COUNTER_ROTATION) are emitted at 120/N Hz. */
export const CONTINUOUS_EVENT_STRIDE = 4
/** Plug movement below this per tick is not worth an event. */
export const PLUG_MOVED_EPSILON = 1e-5
