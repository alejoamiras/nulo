#!/usr/bin/env bash
# Verify one certification trigger against the Phase-6 qualifying criteria.
#
# A run QUALIFIES when, for the given head SHA:
#   - Quality, Smoke e2e and Network e2e all completed successfully;
#   - each ran at attempt 1 (a re-run means the first attempt was not green);
#   - no job in them failed or was cancelled;
#   - their runtime logs contain no vitest retry markers and no exit-86
#     infra-reboot warnings (a pass that consumed a retry is not a green);
#   - the network run actually executed its agent jobs, so a wrongly-skipped
#     matrix cannot masquerade as a pass.
#
# Usage:
#   scripts/e2e/verify-cert-run.sh <head-sha>
#   scripts/e2e/verify-cert-run.sh --pr <number>     # resolve the PR's head
#
# Exits 0 only when the run qualifies.
set -uo pipefail

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) || {
	echo "verify-cert-run: could not resolve the repository (is gh authenticated?)" >&2
	exit 2
}

MIN_NETWORK_AGENTS=${MIN_NETWORK_AGENTS:-8}

if [ "${1:-}" = "--pr" ]; then
	[ -n "${2:-}" ] || { echo "verify-cert-run: --pr needs a number" >&2; exit 2; }
	SHA=$(gh pr view "$2" --json headRefOid -q .headRefOid) || exit 2
else
	SHA=${1:-}
fi
[ -n "$SHA" ] || { echo "usage: verify-cert-run.sh <head-sha> | --pr <number>" >&2; exit 2; }

FAILED=0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

RUNS=$(gh api "repos/$REPO/actions/runs?head_sha=$SHA&per_page=50" \
	--jq '.workflow_runs[] | select(.name=="Quality" or .name=="Smoke e2e" or .name=="Network e2e") | "\(.id) \(.name|gsub(" ";"_")) \(.status) \(.conclusion) \(.run_attempt)"')

if [ -z "$RUNS" ]; then
	echo "verify-cert-run: no Quality/Smoke/Network runs found for ${SHA:0:10}" >&2
	exit 1
fi
echo "$RUNS"

while read -r ID NAME STATUS CONCLUSION ATTEMPT; do
	[ -z "$ID" ] && continue
	if [ "$STATUS" != "completed" ] || [ "$CONCLUSION" != "success" ]; then
		echo "VIOLATION: run $ID ($NAME) $STATUS/$CONCLUSION"
		FAILED=1
	fi
	if [ "$ATTEMPT" != "1" ]; then
		echo "VIOLATION: run $ID ($NAME) is attempt $ATTEMPT — a re-run is not a first-attempt green"
		FAILED=1
	fi

	JOBS=$(gh api "repos/$REPO/actions/runs/$ID/jobs?per_page=100" --paginate --jq '.jobs[] | "\(.id) \(.conclusion)"')
	while read -r JOB_ID JOB_CONCLUSION; do
		[ -z "$JOB_ID" ] && continue
		case "$JOB_CONCLUSION" in
			failure|cancelled)
				echo "VIOLATION: run $ID has a $JOB_CONCLUSION job ($JOB_ID)"
				FAILED=1
				continue
				;;
			success) ;;
			*) continue ;;
		esac
		L="$TMP/job-$JOB_ID.txt"
		gh api "repos/$REPO/actions/jobs/$JOB_ID/logs" >"$L" 2>/dev/null || continue
		RETRIES=$(grep -cE "\(retry x[0-9]" "$L")
		REBOOTS=$(grep -cE "##\[warning\].*(exit 86|Infra boot)" "$L")
		if [ "$RETRIES" != "0" ]; then
			echo "VIOLATION: job $JOB_ID consumed $RETRIES vitest retries"
			FAILED=1
		fi
		if [ "$REBOOTS" != "0" ]; then
			echo "VIOLATION: job $JOB_ID has $REBOOTS exit-86/infra-reboot warnings"
			FAILED=1
		fi
	done <<<"$JOBS"
done <<<"$RUNS"

NET_ID=$(awk '$2=="Network_e2e"{print $1}' <<<"$RUNS")
if [ -n "$NET_ID" ]; then
	AGENTS=$(gh api "repos/$REPO/actions/runs/$NET_ID/jobs?per_page=100" --paginate \
		--jq '[.jobs[] | select(.name | contains("Aztec agent")) | select(.conclusion=="success")] | length')
	if [ "${AGENTS:-0}" -lt "$MIN_NETWORK_AGENTS" ]; then
		echo "VIOLATION: only ${AGENTS:-0}/$MIN_NETWORK_AGENTS network agent jobs ran green"
		FAILED=1
	fi
fi

if [ "$FAILED" = "0" ]; then
	echo "QUALIFYING GREEN: $SHA"
else
	echo "RUN DOES NOT QUALIFY: $SHA"
fi
exit "$FAILED"
