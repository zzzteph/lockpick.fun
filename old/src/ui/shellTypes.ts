/**
 * Type re-exports for the shell.
 *
 * `src/ui/` draws the screens; it should not have to reach across the tree for the two types
 * it needs to describe what it is drawing. Keeping the imports in one place also means the
 * shell has exactly one line to change if either moves.
 */

export type { LockDef } from '../sim'
export type { SettingsData } from '../game/save'
