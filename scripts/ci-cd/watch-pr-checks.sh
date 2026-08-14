#!/usr/bin/env bash
# Print each of a PR's checks as it reaches a terminal state, then exit once
# none are pending. Useful when a suite takes 25-45 minutes and you want the
# individual results as they land rather than one verdict at the end.
#
# Usage: scripts/ci-cd/watch-pr-checks.sh <pr-number> [poll-seconds]
#
# Exits 0 if every check succeeded or was skipped, 1 if any failed or was cancelled.
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
		# `cancel` is not a pass: a cancelled required check leaves the PR
		# ungated just as a failure does.
		if jq -e 'any(.bucket=="fail" or .bucket=="cancel")' <<<"$snapshot" >/dev/null; then
			echo "PR #$PR: checks FAILED or were CANCELLED"
			exit 1
		fi
		echo "PR #$PR: all checks terminal, none failed or cancelled"
		exit 0
	fi
	sleep "$POLL"
done
