import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  MemoryStorage,
  SAVE_KEY,
  SAVE_VERSION,
  SaveError,
  clearSave,
  emptyRecord,
  exportSave,
  importSave,
  loadSave,
  migrate,
  newSave,
  writeSave,
  type SaveData,
} from '../../src/game/save'

/**
 * A version 1 save, written by hand. This is the fixture PHASES.md Phase 7 asks for: "a save
 * written by an older schema version migrates without data loss".
 */
const V1_FIXTURE = {
  version: 1,
  opens: {
    'clear-practice-cutaway': 3,
    'brasswell-no1-luggage': 1,
    'ironhold-spool-trainer': 7,
  },
  settings: { sensitivity: 1.4, muted: true },
}

describe('a fresh save', () => {
  it('starts at the current version with nothing in it', () => {
    const s = newSave()
    expect(s.version).toBe(SAVE_VERSION)
    expect(s.playDays).toEqual({})
    expect(s.customLocks).toEqual([])
    expect(s.records).toEqual({})
    expect(s.achievements).toEqual([])
    expect(s.settings).toEqual(DEFAULT_SETTINGS)
  })
})

describe('migration — GAME_DESIGN.md §11', () => {
  it('brings a version 1 save forward without losing anything', () => {
    const migrated = migrate(V1_FIXTURE)
    expect(migrated.version).toBe(SAVE_VERSION)
    // Every open count survives, now as a record.
    expect(migrated.records['clear-practice-cutaway']?.opens).toBe(3)
    expect(migrated.records['brasswell-no1-luggage']?.opens).toBe(1)
    expect(migrated.records['ironhold-spool-trainer']?.opens).toBe(7)
    // Fields v1 never had are filled in rather than left undefined.
    expect(migrated.records['clear-practice-cutaway']?.bestTime).toBeNull()
    expect(migrated.records['clear-practice-cutaway']?.challenges).toEqual([])
    // Settings that existed are kept; the rest default.
    expect(migrated.settings.sensitivity).toBe(1.4)
    expect(migrated.settings.muted).toBe(true)
    expect(migrated.settings.assist).toBe(DEFAULT_SETTINGS.assist)
  })

  it('is idempotent — migrating an already-current save changes nothing', () => {
    const once = migrate(V1_FIXTURE)
    const twice = migrate(once)
    expect(twice).toEqual(once)
  })

  it('treats an unversioned blob as version 1', () => {
    const { version, ...unversioned } = V1_FIXTURE
    expect(version).toBe(1)
    const migrated = migrate(unversioned)
    expect(migrated.version).toBe(SAVE_VERSION)
    expect(migrated.records['ironhold-spool-trainer']?.opens).toBe(7)
  })

  it('refuses a save from a newer build rather than mangling it', () => {
    expect(() => migrate({ version: SAVE_VERSION + 5 })).toThrow(SaveError)
    expect(() => migrate({ version: SAVE_VERSION + 5 })).toThrow(/newer version of the game/)
  })

  it('rejects data that is not an object', () => {
    expect(() => migrate(null)).toThrow(/not an object/)
    expect(() => migrate([1, 2, 3])).toThrow(/not an object/)
    expect(() => migrate('nope')).toThrow(/not an object/)
  })

  it('repairs a partially corrupt save instead of discarding it', () => {
    const damaged = {
      version: 2,
      records: { 'a-lock': { opens: 4, bestTime: 'x', challenges: 'no' } },
      settings: 'gone',
      tools: null,
      loadout: 12,
    }
    const fixed = migrate(damaged)
    expect(fixed.records['a-lock']?.opens).toBe(4)
    expect(fixed.records['a-lock']?.bestTime).toBeNull()
    expect(fixed.records['a-lock']?.challenges).toEqual([])
    expect(fixed.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('v3 -> v4 drops the inventory and refunds every credit ever spent (D-088)', () => {
    const v3 = {
      version: 3,
      spent: 1200,
      tools: ['starter-hook', 'deep-hook'],
      loadout: { pick: 'deep-hook', wrench: 'starter-wrench' },
      starterOpens: ['clear-practice-cutaway'],
      records: {},
      achievements: ['first-blood', 'well-equipped', 'frugal', 'one-tool'],
      settings: {},
      tutorial: [],
      daily: {},
      lockSalt: 12345,
      customLocks: [],
    }
    const fixed = migrate(v3)
    expect(fixed.version).toBe(SAVE_VERSION)
    // Nobody loses money for a shop that no longer exists.
    expect(fixed.playDays).toEqual({})
    // Achievements the trophy case can no longer name are dropped rather than left as holes.
    expect(fixed.achievements).toEqual(['first-blood'])
    expect('tools' in fixed).toBe(false)
    expect('loadout' in fixed).toBe(false)
    expect('spent' in fixed).toBe(false)
    expect('starterOpens' in fixed).toBe(false)
    // Everything worth keeping survives.
    expect(fixed.lockSalt).toBe(12345)
  })
})

describe('persistence', () => {
  it('round-trips through storage', () => {
    const storage = new MemoryStorage()
    const data = newSave()
    data.records['x'] = { ...emptyRecord(), opens: 2, bestTime: 12.5 }
    writeSave(storage, data)

    const loaded = loadSave(storage)
    expect(loaded.existed).toBe(true)
    expect(loaded.problem).toBeUndefined()
    expect(loaded.data.records).toEqual(data.records)
    expect(loaded.data.records['x']?.bestTime).toBe(12.5)
  })

  it('starts fresh when there is nothing saved', () => {
    const loaded = loadSave(new MemoryStorage())
    expect(loaded.existed).toBe(false)
    expect(loaded.data.records).toEqual({})
  })

  it('starts fresh but reports the problem when the save is unreadable', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_KEY, '{ this is not json')
    const loaded = loadSave(storage)
    expect(loaded.existed).toBe(true)
    expect(loaded.problem).toBeTruthy()
    expect(loaded.data.records).toEqual({})
  })

  it('clears', () => {
    const storage = new MemoryStorage()
    writeSave(storage, newSave())
    clearSave(storage)
    expect(loadSave(storage).existed).toBe(false)
  })
})

describe('export and import', () => {
  function populated(): SaveData {
    const data = newSave()
    data.records['halberd-deadbolt'] = {
      opens: 5,
      bestTime: 61.25,
      bestOversets: 0,
      bestRank: 2,
      challenges: ['no-resets'],
    }
    data.achievements.push('first-blood', 'push-through')
    data.tutorial.push('tension-and-lift')
    data.playDays['2026-07-29'] = 3
    data.settings.assist = 'medium'
    data.settings.sensitivity = 1.15
    return data
  }

  it('round-trips to an identical state', () => {
    const original = populated()
    const text = exportSave(original)
    const back = importSave(text)
    expect(back).toEqual(original)
  })

  it('produces something a person can read', () => {
    const text = exportSave(populated())
    expect(text).toContain('\n')
    expect(text).toContain('"bestRank"')
  })

  it('imports a version 1 file and brings it forward', () => {
    const back = importSave(JSON.stringify(V1_FIXTURE))
    expect(back.version).toBe(SAVE_VERSION)
    expect(back.records['ironhold-spool-trainer']?.opens).toBe(7)
  })

  it('rejects a file that is not JSON, with a message a player could act on', () => {
    expect(() => importSave('<html>')).toThrow(/not valid JSON/)
  })
})
