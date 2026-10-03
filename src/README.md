# SHEAR LINE

The game, on Godot 4.7 (GDScript, 2D, GL Compatibility): a rebuild of the original browser
version, which is kept in `../old`. ("The web game" and "the TypeScript" below mean that one.)
Everything except the Lock Dungeon is here: the bench and its locks, the tutorial, Lock Blitz,
the snap gun, combination wheels, trophies, the lock editor, both themes. (The web's Share Codes
page is not: a lock's code is two buttons in the editor now.) One family is here that the web
game does not have: disc detainers — three on a shelf of the bench, and two lessons.

## Run it

```
Godot_v4.7.2-stable_win64.exe --path src            # play
Godot_v4.7.2-stable_win64.exe --path src --editor   # open in the editor
```

The first run after a checkout needs the class cache: `--headless --path src --import`.

The save is `user://save.json` (`%APPDATA%\Godot\app_userdata\SHEAR LINE\`). It uses the web
game's save format, so a web export pastes straight into Settings → Import.

## Controls

| | Keyboard | Mouse | Controller | Touch |
|---|---|---|---|---|
| Tension wrench | hold `Q` | hold any button over the lock | right trigger | the slider on the left edge: off at the bottom, and it stays where it is left |
| Wrench pressure | `1`–`0`, `W` / `E` | | bumpers | drag the slider, or tap a band |
| Move the pick | `←` `→` | move the pointer | d-pad / left stick | tap a pin |
| Lift | `Space` (`↑` `↓` trim in Training) | `Space` | `A` | drag up, from the pin or from anywhere off the lock |
| Turn a disc | `Space` on, `↓` back | left button on, right button back; or the wheel | `A` on, `B` back | drag up to turn it on, down to turn it back |
| Ease the plug back | hold `C` | hold the right button too | left trigger or `X` | hold the counter-rotate pad |
| Snap gun | hold `Space` (or `G`, `Shift`) to draw the needle back, let go to strike | | hold and release `A` or `X` | hold and release the strike pad |
| Restart / pause | `R` / `Esc` | | Back / Start | the pause pad |

`F11` or `Alt+Enter` toggles fullscreen. Menus take the arrows, Tab and Enter, or a controller.

On a disc detainer the mouse's two buttons are the pick's two ways — the left turns the disc to
the left (on, anticlockwise, as the front view draws it), the right turns it back — so there the
wrench is `Q` and easing it is `C`, and the buttons are neither.

On screen the keys are listed during the tutorial's lessons only; after that they are in Help
(reachable from the pause panel). With the mouse, the tip rests under a pin's centre while the
pointer is near it and slides on between pins; Space never moves the pick.

The touch controls come up when a finger first lands and go again at the first key, controller
button or real mouse click (`screens/pick/pick_touch.gd` is the scheme, `touch_pads.gd` draws
it). A tap only ever chooses a pin; lifting is a separate, geared-down drag (460 px for the whole
lift), and dragging across with the hand raised carries the hook to the next pin. The wrench
slider is relative — a thumb put down on it changes nothing until it moves — except its bottom
band, which is off however the thumb got there. A lesson's lines say what the fingers do instead
of naming keys. A phone held upright is asked to turn, and in a browser it is turned (and made
fullscreen) on the first touch where the browser allows that.

## Accessibility

The rules every menu screen is held to (`tests/audit_ui.gd` checks the mechanical ones):

- Every control is a real engine Control, at least 40×40 stage px, with a spoken name
  (`accessibility_name`) — cards and picture buttons included. Sliders and toggles are real
  sliders and toggle buttons underneath their drawing, so a screen reader hears what they are.
- Everything works from the keyboard or a controller alone. Focus is four ink corner ticks,
  shown once somebody steers by key or pad.
- Nothing is said by colour alone: a toggle is ticked as well as filled, a selection is inverted,
  locked and done are words.
- Type clears 4.5:1 on its ground in both themes; borders are a whole number of device pixels
  at any window size.
- What just happened (`app.status`) is shown as a strip for a few seconds and announced.
- Settings: hold or toggle for the wrench, reduce motion, audio subtitles, controller rumble,
  two themes.

Not there yet: remappable keys, and a larger-type option.

## Feedback

The Feedback button — bottom right of the menu and of Help, and a row of the pause panel — opens
a form in the game: a rating, a kind (Bug, Suggestion, General), a few words and an optional
name. Send posts it to a Google Form (`game/feedback.gd` has the form's address and the ids of
its questions; `game/feedback_post.gd` sends), and the build and where the player was go with
it. Nothing opens in a browser.

On a desktop a send that fails is kept in `user://feedback_queue.json` and tried once at the
next launch. In a browser the post goes but the reply is hidden from the game, so the form says
"submitted" rather than "sent" and nothing is retried. An app started by a test, or with no
display, never posts at all. `tests/send_feedback.gd` posts one real entry from the command
line, for checking the form after it has been edited.

## How the lock works here

The web game carries its own 2.5D contact solver. This build has none: a pin lock is a handful
of Godot physics bodies, and binding, setting, false sets and oversets are what those bodies do.

The lock is drawn unrolled — the plug's turn at its rim becomes a slide along x — so one 2D
physics world holds everything:

- `physics/lock_rig.gd` builds it: the shell (a `StaticBody2D` with a bore per chamber), the plug
  (a `RigidBody2D` on a `GrooveJoint2D` track, pushed by the wrench), and a key pin and a driver
  per chamber (`RigidBody2D`s with collision polygons cut from the game's pin profiles).
- **Binding order** is geometry: each plug bore's rim is cut back a little further than the last,
  so under the wrench the plug pinches one driver at a time.
- **Set**: lift a driver clear of the plug's top and the plug slides on to the next pinch; the
  ledge it leaves holds the driver up.
- **False set**: a spool's waist lets the plug slide in around it; the driver's foot is then
  trapped under the rim until the plug is eased back (counter-rotation).
- **Overset**: a push held past the click cams the plug back along the key pin's chamfer and the
  key pin wedges in the shell bore until the wrench is dropped.
- **Snap gun**: the strike is as hard as the needle was drawn back — up to 150% of a full strike
  — and it is one whole motion. *Up*: one blade throws every pin it reaches to the same height,
  higher the harder the strike, over the line and on up the chamber; the key pins are what it
  hits, and they jump under their drivers. *Down*: the drivers that will not be caught come
  straight back under their lines (pushed, so one the plug is pinching is never left hanging
  where it was thrown), while the plug is held a hair short of moving. *Catch*: the plug is let
  go and slides under whatever is still up, and anything still up that it did not get under is
  sent home as well. Which drivers hang is the gun's luck: none whose
  throw fell short of its line, most (70%) of those it just cleared, a few fewer of those it
  sailed past. A full strike (100%) reaches the deepest pin there is; past that the height buys
  nothing, but the shove grows with the draw, and it is the shove that lifts a driver out from
  under a heavy wrench — any strike will do up to the wrench's middle pressures, only a full
  one at 8, only an overdrawn one at 10. The strike is heard and the drawing kicks, both in
  proportion; a trigger pulled while a strike is still in the air goes off when it lands.
- `physics/pin_session.gd` is the hand: where the tip is, how fast it lifts, the wrench dial,
  the snap gun's strike. The pick itself is not a body — each pin near the tip is held up to the
  steel under it by a one-sided spring.
- Physics runs at 480 Hz while a lock is on the bench and 60 Hz in the menus.

The front view (`screens/pick/front_art.gd`) draws the chamber the way a lock is made — both
bores the same size and in line, the pins with play in them, the first to bind the fattest — and
*poses* the pins in it from the rig's state, because the rig gets its binding order another way
(it cuts each bore's edge back, and its pins cannot tilt). The plug is at its true angle in every
chamber's view; the one liberty is that the bore's play is drawn larger than life.

Combination wheels (`wheels/`) are a rules engine, not a physics one, ported exactly: it matches
the web engine bit for bit on every reference trace.

### Disc detainers

A disc detainer is bodies too (`physics/disc_rig.gd`), and it has no pins and no springs. The
parts are the lock's own: a body, a sleeve inside it that the wrench turns, a row of discs inside
that with a gate cut in each rim, and one bar — the sidebar — lying in a slot of the sleeve with
its back in a groove of the body. While the bar is in the groove the sleeve cannot turn; the bar
can only leave it by dropping into the discs; and it can only drop when every gate is under it.

The world is the lock unrolled at the discs' rim, and built from the sleeve's point of view: the
sleeve stands still and the body slides. Every disc's rim lies along the same strip, each on a
collision layer of its own, so the discs pass through each other and the one bar meets them all.

- **Pressing**: the groove's wall is a ramp. The sleeve, turning, carries the bar against it and
  the ramp drives the bar down onto the discs — harder the harder the wrench.
- **Binding order**: each disc's rim stands a step lower than the last, so the bar rests on one
  disc at a time. That disc is stiff under it; the others turn free.
- **Set**: turn that disc until its gate is under the bar and the bar drops in, one step, onto
  the next disc. The disc is loose again, and slides a little with the bar in its gate.
- **Overset**: a gate's mouth is eased, not square, and a bar only one step down is still on
  that slope. The hand stops at the click, as it does on a pin; a turn still held after that
  leans on the disc, rides the bar back up the slope and carries the disc on past its gate. It
  is stiff again with its gate behind it, and has to be turned back. A light wrench lets it
  happen easily; from about pressure 6 up the gate holds, and a disc leant on and let go slides
  back into it. Once more discs have set, the bar is down past the slope and the walls hold.
- **False gate**: a shallow notch takes the bar the same way, but its floor stops the bar short
  of leaving the groove — and on that floor the bar is down past the slope, so the disc is held.
  Easing the sleeve back (`C`) lets the bar's own light spring lift it out, and the disc can be
  turned on.
- **Nothing falls back**: let the wrench go and the bar lifts, and every disc stays where it was.
- `physics/disc_session.gd` is the hand: which disc the pick is in, which way it is being turned,
  the wrench. A lock's `bitting` is its key's code — how many 18° steps each disc is turned to
  bring its gate under the bar — and `discs.falseGates` the steps at which it carries a lie.

Both views are drawn by `screens/pick/disc_art.gd` from the bodies' own positions: the front is a
slice through the disc the pick is in (the gate comes up the right-hand side to the bar), the
side is the pack with the body and sleeve cut away (each gate a mark that climbs its disc's face;
one that has gone over the top is dashed). The same drawings, posed, are Help's.

## Layout

| | |
|---|---|
| `main.gd`, `main.tscn` | The app: which screen is up, the lock on the bench, what an open is worth |
| `core/` | The roster, pin profiles, lessons, the seeded RNG |
| `physics/` | The pin lock and the disc detainer: rig, bodies, the hand, a scripted hand for tests |
| `wheels/` | Combination locks: engine, solver, view |
| `game/` | Rules and records: save, progress, ranks, achievements, blitz, share codes, editor model, feedback |
| `screens/` | One script per screen; `screens/pick/` is the pick screen |
| `ui/` | Palette and type (`Pal`), widgets (`Kit`), the screen base class (`GameScreen`) |
| `audio/` | The synthesised sound |
| `assets/brand/` | The game's own mark and loading picture: `icon.png` (window, browser tab, home screen), `icon.ico` (the Windows exe), `splash.png` (the loading screen) |
| `tests/`, `*/tests/` | Headless tests |
| `web/` | What the published site needs beside the export: the domain and the worker that retires the old one |

## Build

```
G --headless --path src --export-release "Windows Desktop" build/windows/ShearLine.exe
G --headless --path src --export-release "Linux" build/linux/ShearLine.x86_64
G --headless --path src --export-release "Web" build/web/index.html
```

Nothing a player sees is the engine's: the icon is the brand mark (one pin stack crossing the
shear line), the loading screen is the game's title picture on the page's own paper colour, and
the Windows exe carries the mark and the game's name and version. All three come from
`assets/brand/`; replace the files there to change them. `splash.png` is 16:9 (2464×1386), so it
fills a screen edge to edge and is not enlarged on anything up to 1440p.

`export_presets.cfg` has the three presets; tests are left out of the pack. The Windows export
cannot replace `ShearLine.exe` while the game is running — close it first. The web build is the
single-threaded one (no special server headers needed) but must be served over HTTP, not opened
as a file: `npx serve src/build/web`, or upload the folder to any static host. There is no
Quit entry in a browser.

The site is this build: `.github/workflows/deploy.yml` exports the Web preset on every push to
`main` and publishes it at the root of lockpick.fun, with the old browser version beside it at
`/classic/`. `web/` holds the two files the site needs that the engine does not write — the
domain (`CNAME`) and `sw.js`, which retires the service worker the old version left in returning
players' browsers (the reason is at the top of that file).

## Tests

All headless, all exit non-zero on failure (`G` = the Godot console executable):

```
G --headless --path src --fixed-fps 60 -s res://tests/walk_roster.gd -- 3 all   # scripted hand opens every pin lock, 3 seeds
G --headless --path src --fixed-fps 60 -s res://tests/flow_app.gd               # bench lock, lesson, gun, blitz, wheels, pause through the real app
G --headless --path src --fixed-fps 60 -s res://tests/audit_ui.gd               # every menu screen against the accessibility rules
G --headless --path src --fixed-fps 60 -s res://tests/keys_pick.gd              # locks opened with real key events
G --headless --path src --fixed-fps 60 -s res://tests/mouse_pick.gd             # locks opened with real pointer events
G --headless --path src --fixed-fps 60 -s res://tests/touch_pick.gd             # locks opened with real touch events, and every pad
G --headless --path src --fixed-fps 60 -s res://tests/gun_strike.gd             # the snap gun: harder throws higher, nothing left hanging, no walking a pin up by tapping
G --headless --path src --fixed-fps 60 -s res://tests/walk_discs.gd -- 4 all    # scripted hand opens every disc detainer: one disc binds at a time, in order; every lie in the way catches
G --headless --path src --fixed-fps 60 -s res://tests/discs_play.gd             # disc detainers by real keys, fingers and mouse; both lessons run every step
G --headless --path src --fixed-fps 60 -s res://tests/feedback_form.gd          # the feedback form through the app: what is filled in is what would be posted (nothing is)
G --headless --path src -s res://game/tests/run.gd                              # rules and records against vectors from the TypeScript
G --headless --path src -s res://wheels/tests/golden.gd                         # wheel engine against the web engine's traces
G --headless --path src --fixed-fps 60 -s res://wheels/tests/view_smoke.gd      # wheel view through real input events
G --headless --path src --fixed-fps 60 -s res://audio/tests/test_audio.gd -- quick  # every sound against the web's rendered audio
```

A test that boots `main.tscn` must hand the app a throwaway save *before* adding it to the tree
(`app.progress = Progress.new(SaveStore.memory())`), or it plays on the real one.
