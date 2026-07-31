/**
 * Where the source lives, and how a player reports a problem with it.
 *
 * A `site.ts` was deleted in D-101 for naming a domain nobody had registered. This is the opposite
 * case: a real repository, given by the person who owns it, so the game can point at something that
 * exists. Kept in one file for the same reason — moving it should be one line, not a grep.
 *
 * Nothing here is fetched. The build still ships no network asset (BUILD.md); these are strings
 * that get drawn, and opened in a new tab when clicked. See DECISIONS D-102.
 */

export const REPO_URL = 'https://github.com/zzzteph/lockpick.fun'

/**
 * A GitHub "new issue" URL with the boring half already filled in.
 *
 * The difference between a bug report you can act on and one you cannot is almost entirely context
 * the reporter did not think to include — which screen, which lock, which build. The player is the
 * one person who cannot be expected to know that, and the game knows all of it, so it fills the
 * body in and leaves them the one part only they have: what went wrong.
 *
 * Everything is `encodeURIComponent`-ed, and the whole thing is capped: GitHub truncates very long
 * query strings and a report that arrives with its body cut in half is worse than a short one.
 */
export function newIssueUrl(context: {
  readonly screen: string
  readonly lock?: string | undefined
  readonly version: string
}): string {
  const body = [
    '<!-- What happened? What did you expect instead? -->',
    '',
    '',
    '---',
    `- screen: ${context.screen}`,
    ...(context.lock !== undefined ? [`- lock: ${context.lock}`] : []),
    `- build: ${context.version}`,
  ].join('\n')
  const query = `title=${encodeURIComponent('')}&body=${encodeURIComponent(body)}`
  return `${REPO_URL}/issues/new?${query}`.slice(0, 1800)
}
