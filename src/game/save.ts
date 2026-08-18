/**
 * Save data — GAME_DESIGN.md §11.
 *
 * Versioned, migrated forward, and export/importable as JSON. The schema *will* change again
 * in Phase 13, and losing the player's progress at that point is unacceptable, so the
 * migration chain is built and tested now rather than bolted on when it is needed.
 *
 * Nothing here touches `localStorage` directly: it takes a `StorageLike`, which keeps the
 * whole module unit-testable and makes the export/import round trip trivial to assert.
 */

export const SAVE_VERSION = 5
export const SAVE_KEY = 'shearline.save.v1'

// One definition, in the simulation, because the simulation reads it too. It used to be
// declared here *as well*, which is how the two could have drifted apart silently.
import type { AssistMode, LockDef } from '../sim'
import { lockBySlug } from './locks'
import { rankIndexFor } from './ranks'
import type { StreakScore } from './streak'

export type { AssistMode }

/**
 * A lock's par by slug, for the v4 migration. Zero when the slug is not in the roster any more —
 * a save may name locks that D-088 cut, and those simply get no derived rank rather than a wrong one.
 */
function parFor(slug: string): number {
  return lockBySlug(slug)?.par ?? 0
}
export type ThemeName = 'drafting' | 'blueprint'
/** Kept literally in step with `render/viewport.ts` — the assignment in `app.ts` holds them together. */
export type InterfaceMode = 'auto' | 'full' | 'compact'

export interface SettingsData {
  /** Mouse-to-lift sensitivity multiplier. */
  sensitivity: number
  /** Accessibility: tension as a toggle rather than a held button. */
  tensionToggle: boolean
  masterVolume: number
  mechanicalVolume: number
  ambientVolume: number
  uiVolume: number
  muted: boolean
  reducedMotion: boolean
  /**
   * Whether the **continuous** voices play at all — the binding hum, the free-pin tone, the spring,
   * the scrape, the plug friction and the room bed.
   *
   * Off by default, which is not where `AUDIO.md §4` put it. Twice now the same note has come back
   * from play — first the engine-like bed, then *"remove sound of pressure, let's leave only
   * clicking sound"* — and the second time is the answer. The discrete voices are the ones carrying
   * information a player acts on: the click of a pin setting, the cascade of a reset, the false-set
   * thunk. The continuous layer is atmosphere, and this one is nicer without it. The setting stays
   * so it can be put back. See DECISIONS D-085.
   */
  continuousTones: boolean
  subtitles: boolean
  assist: AssistMode
  /**
   * Which side of the screen the keyway opens at.
   *
   * `left` puts the mouth on the left and the pick comes in from the left — comfortable if you
   * hold the pick in your left hand. `right` mirrors the whole cutaway. Nothing about the lock
   * changes: pin 1 is still the front pin, reach still runs from the mouth inward, and the
   * simulation never learns which way round it is being drawn. See DECISIONS D-047.
   */
  handedness: 'left' | 'right'
  /**
   * Vibrate on the events a hand would feel — pins setting, oversets, a cascade.
   *
   * On by default: this is a game about touch, and the one device with a motor in it is the one
   * where the pick and the wrench are both blunt instruments. Does nothing where
   * `navigator.vibrate` is missing, which is every iPhone (D-131), and the settings screen says so
   * rather than showing a switch that cannot do anything.
   */
  haptics: boolean
  theme: ThemeName
  /**
   * Full page, compact page, or let the screen size decide — DECISIONS D-160.
   *
   * `auto` is the compact heuristic (`COMPACT_SCALE`, plus the fold-class exception). The other
   * two exist because players found the override themselves: Chrome's Desktop-site checkbox
   * inflates the CSS viewport until the full page appears, and *"to have the PROPER UI I need to
   * check in chrome - PC version, then it works perfectly"* is a player doing the browser's-menu
   * version of this setting. The choice belongs in the game, remembered, one tap away.
   */
  interfaceMode: InterfaceMode
}

export const DEFAULT_SETTINGS: SettingsData = {
  sensitivity: 1,
  tensionToggle: false,
  masterVolume: 0.8,
  mechanicalVolume: 1,
  ambientVolume: 0.2,
  uiVolume: 0.7,
  muted: false,
  reducedMotion: false,
  continuousTones: false,
  subtitles: false,
  /**
   * **Training**, not Easy — a new save starts on the rung that explains itself (D-120).
   *
   * Easy draws one pin, the one under the tip. Training draws the whole cutaway, brackets the
   * binding chamber, marks the capture window, shades the overset zone before you reach it, and
   * gives the arrow keys a lift trim (D-111). Somebody opening this for the first time has never
   * seen a pin stack, and the level that shows them one is the level to open on. Every rung is one
   * click away in Settings and nothing is gated behind difficulty.
   *
   * Note what this also does to the clock: `ASSIST_PAR_SCALE.training` is 0.6, so a Training
   * attempt is ranked against 60% of the lock's par. See D-120 for why that is left alone.
   */
  assist: 'training',
  // Left by default because that is what the lock has always been drawn as; right-handed is
  // one click away in Settings. Flipping the *default* is a bigger change than it looks —
  // every geometry assertion in the suite is written against one orientation.
  handedness: 'left',
  // On where there is a motor, absent where there is not. No save migration needed: `loadSave`
  // spreads `DEFAULT_SETTINGS` under whatever it read, so an old save picks this up as true.
  haptics: true,
  theme: 'drafting',
  // No migration needed: `migrate` spreads DEFAULT_SETTINGS under whatever it read, exactly as
  // haptics arrived. An old save wakes up on auto, which is where every save has always been.
  interfaceMode: 'auto',
}

export interface LockRecord {
  /** How many times this lock has been opened. */
  opens: number
  /** Best time in seconds, or null if never opened. */
  bestTime: number | null
  /** Fewest oversets in a winning attempt. */
  bestOversets: number | null
  /**
   * Best rank ever earned on this lock, as an index into `RANKS` — 0 is S, 6 is F, null unopened.
   *
   * Stored as the index rather than the letter so it can be compared with `<`, and because the
   * letters are a presentation detail that a future ladder might rename. This is the number tiers
   * unlock on since D-091.
   */
  bestRank: number | null
  /** Challenge modifiers cleared at least once on this lock. */
  challenges: string[]
}

export function emptyRecord(): LockRecord {
  return { opens: 0, bestTime: null, bestOversets: null, bestRank: null, challenges: [] }
}

export interface SaveData {
  version: number
  /** Keyed by lock slug. */
  records: Record<string, LockRecord>
  achievements: string[]
  settings: SettingsData
  /** Tutorial lessons completed, by id. */
  tutorial: string[]
  /**
   * Days the player picked something: ISO date -> locks opened that day.
   *
   * Was `daily`, and was a history of a **daily lock feature that does not exist** — declared,
   * migrated, read by one achievement, and never once written to. This is the same field doing a
   * job that is actually done: it records the days you turned up. See DECISIONS D-090.
   */
  playDays: Record<string, number>
  /**
   * This player's bench, as one number.
   *
   * Every lock's tolerance seed is derived from this and the lock's slug, so *your* Brasswell No.1
   * is a specific physical copy — same binding order, same heavy chamber, same worn-in feel — every
   * time you sit down with it, while somebody else's is a different copy of the same catalogue
   * model. Rolled once when the save is created. See DECISIONS D-073.
   */
  lockSalt: number
  /**
   * Locks this player built (D-080). Stored as whole `LockDef`s rather than as drafts: the draft is
   * an editing convenience, the def is the thing the simulation actually reads, and keeping the
   * saved form identical to the authored form means a custom lock is a first-class lock everywhere.
   */
  customLocks: LockDef[]
  /**
   * The Gauntlet's personal bests, by the difficulty the run was played at — D-165.
   *
   * A score, deliberately not a currency (D-091 buried currencies): nothing is bought with it and
   * nothing unlocks behind it. It is a number to beat, which is the whole mode. Only *survived*
   * runs write here; a fallen run leaves no trace, which is also the whole mode. The run itself is
   * never persisted anywhere — that absence is what makes "no resume" true across a relaunch.
   */
  gauntletBest: Partial<Record<AssistMode, number>>
  /**
   * The Lock streak's best five-minute runs, by the difficulty they were played at — D-205,
   * replacing D-199's chains (which measured patience: they only ever ended on a mistake).
   * Sum of the opened locks' tiers, with the open count kept beside it for colour. Like
   * `gauntletBest` it is a score, never a currency — nothing unlocks behind it — and only
   * *finished* runs write here: the run itself is never persisted, so there is no resume.
   */
  streakBest: Partial<Record<AssistMode, StreakScore>>
}

export function newSave(): SaveData {
  return {
    version: SAVE_VERSION,
    records: {},
    achievements: [],
    settings: { ...DEFAULT_SETTINGS },
    tutorial: [],
    playDays: {},
    customLocks: [],
    gauntletBest: {},
    streakBest: {},
    // Any odd 32-bit value; the mixer below does the work of spreading it.
    lockSalt: (Math.floor(Math.random() * 0xffffffff) | 1) >>> 0,
  }
}

/**
 * The tolerance seed for one lock on one bench — stable for as long as the save exists.
 *
 * A string hash of the slug mixed with the player's salt. It has to be *stable*, which rules out
 * anything involving the clock, and *well spread*, because neighbouring slugs must not produce
 * neighbouring seeds or half the roster would bind in the same order.
 */
export function seedForLock(slug: string, salt: number): number {
  let h = salt >>> 0
  for (let i = 0; i < slug.length; i += 1) {
    h = Math.imul(h ^ slug.charCodeAt(i), 0x01000193) >>> 0
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h ^= h >>> 13
  return (h >>> 0) % 100000 || 1
}

// ── Migration ───────────────────────────────────────────────────────────────────────────

/**
 * Version 1 — the shape the save layer was first written to during Phase 7: credits, a flat
 * count of opens per lock, and settings. Version 2 replaced the flat counts with per-lock
 * records carrying best time and challenge history, and added tools, loadout, achievements,
 * tutorial progress and daily history.
 */
export interface SaveV1 {
  version: 1
  credits: number
  opens: Record<string, number>
  settings?: Partial<SettingsData>
}

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>

/** `MIGRATIONS[n]` upgrades a version-`n` save to version `n + 1`. */
export const MIGRATIONS: Record<number, Migration> = {
  /**
   * Version 4 -> 5. Credits are gone and rank is the currency (D-091).
   *
   * `credits` is dropped: with the shop removed in D-088 it had become a number that went up and
   * did nothing, and keeping it would have meant keeping the whole payout machine behind it.
   * `daily` becomes `playDays`, which is the same shape doing a job that is actually done — the
   * old field recorded a daily-lock feature that never existed and was never written to (D-090).
   *
   * **Existing records keep their best time and gain a best rank derived from it.** That is the one
   * thing this migration must get right: a player who has beaten par on nine locks should not open
   * the game to find nine blank ranks and a locked Tier 2. The derivation cannot know which assist
   * level those times were set on, so it assumes Easy — the middle of the ladder and the default —
   * and rounds in the player's favour by never assigning worse than the time deserves.
   */
  4: (old) => {
    const records = isRecord(old['records']) ? old['records'] : {}
    const migrated: Record<string, unknown> = {}
    for (const [slug, raw] of Object.entries(records)) {
      const r = isRecord(raw) ? raw : {}
      const best = typeof r['bestTime'] === 'number' ? r['bestTime'] : null
      const par = parFor(slug)
      migrated[slug] = {
        ...r,
        bestRank: best !== null && par > 0 ? rankIndexFor(best, par) : null,
      }
    }
    const { credits: _c, daily, ...rest } = old
    return {
      ...rest,
      version: 5,
      records: migrated,
      playDays: isRecord(daily) ? daily : {},
    }
  },
  /**
   * Version 3 -> 4. The tool inventory is gone (D-088): no shop, no loadout, one fixed kit.
   *
   * `tools`, `loadout`, `spent` and `starterOpens` are dropped outright. **Credits are kept**, and
   * every credit ever spent is handed back — a player who bought a deep hook paid for a thing that
   * no longer exists, and quietly keeping their money would be the wrong way round. It is only a
   * score now, but it is *their* score.
   *
   * Achievements that referenced the shop are dropped from the earned list too, because an
   * achievement the trophy room can no longer name is a hole in the case.
   */
  3: (old) => {
    const spent = Number(old['spent']) || 0
    const credits = (Number(old['credits']) || 0) + spent
    const GONE = new Set(['well-equipped', 'frugal', 'one-tool', 'tooled-up'])
    const achievements = Array.isArray(old['achievements'])
      ? old['achievements'].map(String).filter((id) => !GONE.has(id))
      : []
    const { tools: _t, loadout: _l, spent: _s, starterOpens: _o, ...rest } = old
    return { ...rest, version: 4, credits, achievements }
  },
  /**
   * Version 2 -> 3. The four levels were renamed when they were re-scoped from
   * `guided|standard|expert|blind` to `training|easy|medium|hard` (D-046), and handedness was
   * added. A saved setting naming a level that no longer exists would otherwise fall through to
   * the default and silently move the player up or down the ladder.
   */
  2: (old) => {
    const RENAMED: Record<string, string> = {
      guided: 'training',
      standard: 'easy',
      expert: 'medium',
      blind: 'hard',
    }
    const settings = isRecord(old['settings']) ? { ...old['settings'] } : {}
    const was = settings['assist']
    if (typeof was === 'string' && was in RENAMED) settings['assist'] = RENAMED[was]
    return { ...old, version: 3, settings }
  },
  1: (old) => {
    const opens = (old['opens'] ?? {}) as Record<string, number>
    const records: Record<string, LockRecord> = {}
    for (const [slug, count] of Object.entries(opens)) {
      records[slug] = { ...emptyRecord(), opens: Number(count) || 0 }
    }
    return {
      ...newSave(),
      version: 2,
      credits: Number(old['credits']) || 0,
      records,
      settings: { ...DEFAULT_SETTINGS, ...((old['settings'] ?? {}) as Partial<SettingsData>) },
    }
  },
}

export class SaveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaveError'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A best run is a non-negative score and open count, or it is nothing. */
function coerceStreakScore(raw: unknown): StreakScore | null {
  if (!isRecord(raw)) return null
  const score = raw['score']
  const opens = raw['opens']
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) return null
  if (typeof opens !== 'number' || !Number.isFinite(opens) || opens < 0) return null
  return { score: Math.trunc(score), opens: Math.trunc(opens) }
}

function coerceRecord(raw: unknown): LockRecord {
  if (!isRecord(raw)) return emptyRecord()
  const bestTime = raw['bestTime']
  const bestOversets = raw['bestOversets']
  const bestRank = raw['bestRank']
  return {
    opens: Number(raw['opens']) || 0,
    bestTime: typeof bestTime === 'number' && Number.isFinite(bestTime) ? bestTime : null,
    bestOversets:
      typeof bestOversets === 'number' && Number.isFinite(bestOversets) ? bestOversets : null,
    bestRank:
      typeof bestRank === 'number' && Number.isFinite(bestRank) ? Math.max(0, bestRank | 0) : null,
    challenges: Array.isArray(raw['challenges']) ? raw['challenges'].map(String) : [],
  }
}

/**
 * Bring any save forward to the current version, filling in anything missing with defaults.
 * Throws only when the data is from a *newer* version than this build understands — silently
 * discarding a future save would be the one genuinely unrecoverable outcome.
 */
export function migrate(raw: unknown): SaveData {
  if (!isRecord(raw)) throw new SaveError('save data is not an object')
  let data = { ...raw }
  let version = Number(data['version'])
  if (!Number.isFinite(version) || version < 1) {
    // Unversioned blob from before the schema was numbered: treat it as version 1.
    version = 1
    data['version'] = 1
  }
  if (version > SAVE_VERSION) {
    throw new SaveError(
      `save is version ${version} but this build understands up to ${SAVE_VERSION} — ` +
        'it was written by a newer version of the game',
    )
  }
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new SaveError(`no migration from save version ${version}`)
    data = step(data)
    version = Number(data['version'])
  }

  const records: Record<string, LockRecord> = {}
  const rawRecords = isRecord(data['records']) ? data['records'] : {}
  for (const [slug, r] of Object.entries(rawRecords)) records[slug] = coerceRecord(r)

  return {
    version: SAVE_VERSION,
    records,
    achievements: Array.isArray(data['achievements']) ? data['achievements'].map(String) : [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...(isRecord(data['settings']) ? (data['settings'] as Partial<SettingsData>) : {}),
    },
    tutorial: Array.isArray(data['tutorial']) ? data['tutorial'].map(String) : [],
    playDays: isRecord(data['playDays'])
      ? Object.fromEntries(Object.entries(data['playDays']).map(([k, v]) => [k, Number(v) || 0]))
      : {},
    // Anything unreadable is dropped rather than crashing the save: a malformed custom lock is one
    // lost creation, and refusing to load is the whole player's progress.
    customLocks: Array.isArray(data['customLocks'])
      ? (data['customLocks'].filter(isRecord) as unknown as LockDef[])
      : [],
    // Same road haptics and interfaceMode arrived by: absent on an old save, defaults to empty.
    // Non-numeric entries are dropped rather than trusted — a best is a number or it is nothing.
    gauntletBest: isRecord(data['gauntletBest'])
      ? Object.fromEntries(
          Object.entries(data['gauntletBest']).filter(
            ([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
          ),
        )
      : {},
    // The blitz bests arrive by the same road every new field has (D-205): absent — including
    // on a save carrying D-199's old `streak` chains, which are dropped without ceremony; the
    // mode was days old and unreleased — the table starts empty.
    streakBest: isRecord(data['streakBest'])
      ? Object.fromEntries(
          Object.entries(data['streakBest'])
            .map(([k, v]) => [k, coerceStreakScore(v)] as const)
            .filter((e): e is readonly [string, StreakScore] => e[1] !== null),
        )
      : {},
    // A save from before D-073 has no salt; give it one rather than defaulting everybody to the
    // same bench, which would make every player's locks identical.
    lockSalt:
      typeof data['lockSalt'] === 'number' && data['lockSalt'] > 0
        ? (data['lockSalt'] >>> 0)
        : (Math.floor(Math.random() * 0xffffffff) | 1) >>> 0,
  }
}

// ── Persistence ─────────────────────────────────────────────────────────────────────────

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** An in-memory stand-in, for tests and for browsers with storage disabled. */
export class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

export interface LoadResult {
  data: SaveData
  /** True when a save was found and read. */
  existed: boolean
  /** Set when a save was found but could not be used; the game starts fresh instead. */
  problem?: string
}

export function loadSave(storage: StorageLike, key = SAVE_KEY): LoadResult {
  const raw = storage.getItem(key)
  if (raw === null) return { data: newSave(), existed: false }
  try {
    return { data: migrate(JSON.parse(raw)), existed: true }
  } catch (err) {
    return {
      data: newSave(),
      existed: true,
      problem: err instanceof Error ? err.message : String(err),
    }
  }
}

export function writeSave(storage: StorageLike, data: SaveData, key = SAVE_KEY): void {
  storage.setItem(key, JSON.stringify(data))
}

export function clearSave(storage: StorageLike, key = SAVE_KEY): void {
  storage.removeItem(key)
}

/** Pretty-printed, so a player who opens the file can read it. */
export function exportSave(data: SaveData): string {
  return JSON.stringify(data, null, 2)
}

export function importSave(text: string): SaveData {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new SaveError('that file is not valid JSON')
  }
  return migrate(parsed)
}
