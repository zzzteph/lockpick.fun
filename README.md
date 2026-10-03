# SHEAR LINE

**A lockpicking simulator that doesn't roll dice.**

**Play it now at [lockpick.fun](https://lockpick.fun)**

Every lock here is a real mechanism, simulated. Picking has no hidden success chance and no progress
bar: a pin sets because you lifted it to the shear line while the plug was pinching it, and a spool
that drops the plug into a false set is a waist and a rim doing what they do.

## What is in here

| | |
|---|---|
| [`src/`](src/README.md) | **The game.** A Godot 4.7 project (GDScript, 2D): the pin lock is engine physics bodies, and binding, setting, false sets and oversets are what those bodies do. Exports for the browser, Windows and Linux. |
| [`old/`](old/README.md) | The original browser version (TypeScript and a canvas), with its own contact solver, its tests and its tools. No longer developed; still playable at [lockpick.fun/classic](https://lockpick.fun/classic/). |
| `.github/workflows/deploy.yml` | Tests both, exports the game for the web and publishes the site on every push to `main`. |

## Running the game

With Godot 4.7.2 (`G` is its executable):

```
G --headless --path src --import    # once after a checkout
G --path src                        # play
G --path src --editor               # open in the editor
```

Controls, how the lock works, the builds and the tests are in [`src/README.md`](src/README.md).

## Licence

MIT — see [`LICENSE`](LICENSE).
