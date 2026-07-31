# SHEAR LINE

**A lockpicking simulator that doesn't roll dice.**

**Play it now at [lockpick.fun](https://lockpick.fun)**

![The Ironhold Spool Trainer, mid-false-set: two pins captured, a spool lying about the third, and the plug swung 18 degrees round to nothing.](.github/screenshot.png)

Most games turn lockpicking into a puzzle: connect the pipes, stop the bar in the green zone, or
wiggle a stick until a hidden dice roll decides you deserve it.

This one doesn't. Every lock here is a real mechanism, simulated. There's no secret success chance
and no progress bar. A pin sets because you held the pick still inside a window a fraction of a
millimetre wide, long enough for the plug's ledge to catch under the driver. When a spool shoves
your pick back out, that's a wedge on a bevel — worked out, not faked.

Twenty-two locks across four tiers, and a pick that bends when the lock pushes back.

---

## Playing

It runs in your browser. Nothing to install, no account, and no network traffic once the page has
loaded.

Want it offline? Every build is attached to the [latest release](../../releases/latest) as a zip.
Unpack it, open `index.html`, and it runs straight off your disk — there's nothing in it to fetch.

### Controls

You pick with the keyboard. The mouse is only for menus.

| key | what it does |
|---|---|
| **Q**, held | The tension wrench. **Nothing works without it.** |
| **Left / Right** | Move the pick to the next chamber. |
| **Space**, held | Push the pick up. Let go and the pin drops back down. |
| **1 … 9, 0** | Wrench pressure, ten steps from light to heavy. |
| **Up / Down** | Trim the lift a hair. Training level only. |
| **R** | Restart the lock. |
| **Esc** | Pause. |

**Learn the wrench first.** With no tension, nothing binds and nothing can be captured — you can
lift every pin in the lock and achieve absolutely nothing. The game tells you so, in amber, until
you've used it once.

**On a phone:** turn it sideways. Tap a pin to select it, drag up to lift, and the slider down the
left edge *is* your wrench — off at the bottom, ten pressure steps above.

### Where to start

Three short lessons sit at the top of the bench. Together they take about five minutes, and they're
the whole game in miniature:

1. Find the pin that's binding.
2. Jam one on purpose, and learn what a reset costs.
3. Meet a spool, and learn that a lock can lie to you.

There's no wall of text to click past — one line at a time, and it changes when you do something.

### If it feels impossible

It might be the lock. It might also be the wrench.

Four levels live in Settings and you can switch between them at any time. Each one takes away
exactly one thing:

| level | what you get |
|---|---|
| **Training** | Everything. The binding pin is bracketed, the capture window is marked, the overset zone is shaded red before you reach it, and the arrow keys trim your lift for you. |
| **Easy** | The readouts, plus a progress dot on each pin. The default. |
| **Medium** | No pin dots. The meters and the pick's flex. |
| **Hard** | No cutaway at all. The lock's face, your hands, and what you can hear. |

**The level buys time, not points.** There's no currency in this game. Your only score is the rank
on the clock, and the level scales the time you're measured against — 0.6x on Training, up to 2.5x
on Hard. The same run is a C on Easy and an S on Hard, so picking blind pays off rather than just
earning respect. Nothing is locked behind difficulty.

If you'd rather read the lock than listen to it, turn on audio subtitles in Settings.

---

## Found a bug? Stuck on something?

Both are worth telling me about.

- **Bugs and ideas** — [open an issue](https://github.com/zzzteph/lockpick.fun/issues/new). There's
  also a **report an issue** button inside the game, which fills in which screen and which lock you
  were on, so all you have to write is what went wrong.
- **Everything else** — [join the Discord](https://discord.gg/V9ce457mup). Questions, feedback,
  showing off a lock you built, or working out why that middle spool won't budge.



