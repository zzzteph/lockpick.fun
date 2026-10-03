class_name Repo
extends RefCounted
## Where the source lives, and how a player reports a problem with it.
##
## Nothing here is fetched: these are strings that get drawn, and handed to the system browser
## when clicked. One file, so that moving the repository is one line and not a search.

const URL := "https://github.com/zzzteph/lockpick.fun"
const ISSUES_URL := URL + "/issues"

## Long query strings get truncated on the way, and a report that arrives with its body cut
## in half is worse than a short one.
const MAX_URL := 1800


## A "new issue" link with the boring half already filled in.
##
## The difference between a bug report that can be acted on and one that cannot is almost all
## context the reporter did not think to include — which screen, which lock, which build. The
## game knows all of it, so it writes that in and leaves the player the one part only they
## have: what went wrong. `lock_name` empty leaves the lock line out.
static func new_issue_url(screen: String, lock_name: String, version: String) -> String:
	var lines := PackedStringArray([
		"<!-- What happened? What did you expect instead? -->",
		"",
		"",
		"---",
		"- screen: " + screen,
	])
	if lock_name != "":
		lines.append("- lock: " + lock_name)
	lines.append("- build: " + version)
	return ("%s/new?title=&body=%s" % [ISSUES_URL, _encode("\n".join(lines))]).substr(0, MAX_URL)


## Percent-encoded as a browser encodes a query component: everything but letters, digits
## and  - _ . ! ~ * ' ( )
static func _encode(text: String) -> String:
	var out := text.uri_encode()
	for plain: String in ["!", "*", "'", "(", ")"]:
		out = out.replace("%%%02X" % plain.unicode_at(0), plain)
	return out
