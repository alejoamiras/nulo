#!/usr/bin/env bash
# Print each of a PR's checks as it reaches a terminal state, then exit once
# none are pending. Useful when a suite takes 25-45 minutes and you want the
# individual results as they land rather than one verdict at the end.
#
# Usage: scripts/e2e/watch-pr-checks.sh <pr-number> [poll-seconds]
#
# Exits 0 if every check succeeded or was skipped, 1 if any failed.
set -uo pipefail

PR=${1:-}
POLL=${2:-60}
[ -n "$PR" ] || { echo "usage: watch-pr-checks.sh <pr-number> [poll-seconds]" >&2; exit 2; }

prev=""
while true; do
	snapshot=$(gh pr checks "$PR" --json name,bucket 2>/dev/null) || { sleep "$POLL"; continue; }
	current=$(jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' <<<"$snapshot" | sort)
	# Only the newly-terminal ones, so a long wait does not reprint the list.
	comm -13 <(echo "$prev") <(echo "$current")
	prev=$current

	total=$(jq 'length' <<<"$snapshot")
	if [ "$total" -gt 0 ] && jq -e 'all(.bucket!="pending")' <<<"$snapshot" >/dev/null; then
		if jq -e 'any(.bucket=="fail")' <<<"$snapshot" >/dev/null; then
			echo "PR #$PR: some checks FAILED"
			exit 1
		fi
		echo "PR #$PR: all checks terminal, none failed"
		exit 0
	fi
	sleep "$POLL"
done
