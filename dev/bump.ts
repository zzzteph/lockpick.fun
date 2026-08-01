/**
 * Bump the version — `npm run bump`.
 *
 * The scheme is the one that was asked for: `1.0.0 -> 1.0.1 -> … -> 1.0.9 -> 1.1.0`, and by the
 * same rule `1.9.9 -> 2.0.0`. Each field is a **single digit** that carries into the one above it,
 * so the version is a count of changes rather than a claim about them.
 *
 * That is deliberately not semver, and it is worth being clear about which one this is. Semver
 * says what a change *means* — patch for a fix, minor for a feature, major for a break — and it is
 * the right scheme for something other people build against. This game is a page you open: nothing
 * links against it, nothing pins a range, and there is no API to break. What a version is for here
 * is telling one build from another, in a release list and in a bug report, which a rolling count
 * does perfectly well and without a judgement call every time.
 *
 * `npm run bump -- --minor` and `-- --major` force a carry when a change deserves one.
 *
 * Run with `node dev/bump.ts` — Node 24 strips the types natively, so a four-line odometer does
 * not need a build step to be type-checked and linted like the rest of the code.
 *
 * Writes `package.json` with `node`, never PowerShell: this machine's ANSI codepage is 1251 and
 * `Get-Content | Set-Content` double-encodes UTF-8 into Cyrillic. It has eaten three source files
 * on this project already.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(ROOT, 'package.json')

/** `1.0.9` -> `1.1.0`. Each field carries at 9, the way an odometer does. */
export type BumpLevel = 'patch' | 'minor' | 'major'

/** `1.0.9` -> `1.1.0`. Each field carries at nine. Throws on anything not `n.n.n`. */
export function nextVersion(current: string, level: BumpLevel = 'patch'): string {
  const parts = String(current).split('.').map((n) => Number.parseInt(n, 10))
  const [rawMajor, rawMinor, rawPatch] = parts
  if (
    parts.length !== 3 ||
    rawMajor === undefined ||
    rawMinor === undefined ||
    rawPatch === undefined ||
    parts.some((n) => !Number.isInteger(n) || n < 0)
  ) {
    throw new Error(`"${current}" is not a three-part version`)
  }
  let major = rawMajor
  let minor = rawMinor
  let patch = rawPatch

  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return minor >= 9 ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`

  patch += 1
  if (patch > 9) {
    patch = 0
    minor += 1
  }
  if (minor > 9) {
    minor = 0
    major += 1
  }
  return `${major}.${minor}.${patch}`
}

function main(): void {
  const level: BumpLevel = process.argv.includes('--major')
    ? 'major'
    : process.argv.includes('--minor')
      ? 'minor'
      : 'patch'

  const raw = readFileSync(PKG, 'utf8')
  const pkg = JSON.parse(raw) as { version: string }
  const from = pkg.version
  const to = nextVersion(from, level)

  // Rewritten by string replacement rather than `JSON.stringify`, so npm's formatting, key order
  // and trailing newline survive a bump untouched — a version change should be a one-line diff.
  const updated = raw.replace(`"version": "${from}"`, `"version": "${to}"`)
  if (updated === raw) throw new Error(`could not find "version": "${from}" in package.json`)
  writeFileSync(PKG, updated, 'utf8')
  process.stdout.write(`${from} -> ${to}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
