#!/usr/bin/env bash
# Verify one certification trigger against the Phase-6 qualifying criteria.
#
# A run QUALIFIES when, for the given head SHA:
#   - ALL THREE required workflows ran (Quality, Smoke e2e, Network e2e);
#   - each completed successfully, at attempt 1 (a re-run means the first
#     attempt was not green);
#   - no job in them failed or was cancelled;
#   - no successful job's runtime log contains a vitest retry marker or an
#     exit-86 / infra-reboot warning (a pass that consumed a retry is not a
#     green);
#   - the network run executed its full agent set, BY NAME, so a wrongly-skipped
#     matrix entry cannot masquerade as a pass.
#
# It fails CLOSED: any API call that does not return usable data is a violation,
# never a skipped check. `set -e` is deliberately not used — the script
# accumulates violations so one invocation reports all of them — so every
# command's failure is handled explicitly.
#
# Usage:
#   scripts/ci-cd/verify-cert-run.sh <head-sha>
#   scripts/ci-cd/verify-cert-run.sh --pr <number>
#
# Exits 0 only when the run qualifies, 1 when it does not, 2 on a usage or
# environment error.
set -uo pipefail

REQUIRED_WORKFLOWS=("Quality" "Smoke e2e" "Network e2e")

# The exact network agent set: 5 sharded jobs + 2 heavies + the prover-ON
# canary. Checking names rather than a count means a missing shard cannot be
# offset by an extra job elsewhere.
EXPECTED_AGENTS=(
	"Run / shard 1/5 / Aztec agent (shard 1/5)"
	"Run / shard 2/5 / Aztec agent (shard 2/5)"
	"Run / shard 3/5 / Aztec agent (shard 3/5)"
	"Run / shard 4/5 / Aztec agent (shard 4/5)"
	"Run / shard 5/5 / Aztec agent (shard 5/5)"
	"Run / heavy / fee-methods / Aztec agent"
	"Run / heavy / concurrent-confirm / Aztec agent"
	"Run / canary / real-proving / Aztec agent"
)

die() {
	echo "verify-cert-run: $1" >&2
	exit 2
}

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner) || die "could not resolve the repository (is gh authenticated?)"

if [ "${1:-}" = "--pr" ]; then
	[ -n "${2:-}" ] || die "--pr needs a number"
	SHA=$(gh pr view "$2" --json headRefOid -q .headRefOid) || die "could not resolve PR #$2"
else
	SHA=${1:-}
fi
[ -n "$SHA" ] || die "usage: verify-cert-run.sh <head-sha> | --pr <number>"

FAILED=0
TMP=$(mktemp -d) || die "could not create a temp dir"
trap 'rm -rf "$TMP"' EXIT

violation() {
	echo "VIOLATION: $1"
	FAILED=1
}

# --slurp wraps the paginated pages in an array, so one jq pass sees them all.
RUNS="$TMP/runs.json"
gh api "repos/$REPO/actions/runs?head_sha=$SHA&per_page=100" --paginate --slurp >"$RUNS" ||
	die "could not list workflow runs for ${SHA:0:10}"

for WF in "${REQUIRED_WORKFLOWS[@]}"; do
	ROWS=$(jq -r --arg wf "$WF" \
		'[.[].workflow_runs[]?] | map(select(.name==$wf)) | .[] | [(.id|tostring), .status, (.conclusion // "none"), (.run_attempt|tostring)] | @tsv' \
		"$RUNS")

	if [ -z "$ROWS" ]; then
		violation "no '$WF' run found for ${SHA:0:10} — a missing required workflow is not a pass"
		continue
	fi

	while IFS=$'\t' read -r ID STATUS CONCLUSION ATTEMPT; do
		[ -z "${ID:-}" ] && continue
		echo "  $WF run $ID: $STATUS/$CONCLUSION attempt=$ATTEMPT"
		[ "$STATUS" = "completed" ] && [ "$CONCLUSION" = "success" ] ||
			violation "run $ID ($WF) is $STATUS/$CONCLUSION"
		[ "$ATTEMPT" = "1" ] ||
			violation "run $ID ($WF) is attempt $ATTEMPT — a re-run is not a first-attempt green"

		JOBS="$TMP/jobs-$ID.json"
		if ! gh api "repos/$REPO/actions/runs/$ID/jobs?per_page=100" --paginate --slurp >"$JOBS"; then
			violation "could not list jobs for run $ID ($WF) — evidence missing, treating as non-qualifying"
			continue
		fi

		while IFS=$'\t' read -r JOB_ID JOB_CONCLUSION JOB_NAME; do
			[ -z "${JOB_ID:-}" ] && continue
			case "$JOB_CONCLUSION" in
				failure | cancelled)
					violation "run $ID has a $JOB_CONCLUSION job: $JOB_NAME ($JOB_ID)"
					continue
					;;
				success) ;;
				*) continue ;;
			esac
			L="$TMP/job-$JOB_ID.txt"
			if ! gh api "repos/$REPO/actions/jobs/$JOB_ID/logs" >"$L" 2>/dev/null; then
				violation "could not fetch logs for job $JOB_ID ($JOB_NAME) — cannot prove it consumed no retries"
				continue
			fi
			RETRIES=$(grep -cE "\(retry x[0-9]" "$L")
			REBOOTS=$(grep -cE "##\[warning\].*(exit 86|Infra boot)" "$L")
			[ "$RETRIES" = "0" ] || violation "job $JOB_ID ($JOB_NAME) consumed $RETRIES vitest retries"
			[ "$REBOOTS" = "0" ] || violation "job $JOB_ID ($JOB_NAME) has $REBOOTS exit-86/infra-reboot warnings"
		done < <(jq -r '[.[].jobs[]?] | .[] | [(.id|tostring), (.conclusion // "none"), .name] | @tsv' "$JOBS")

		if [ "$WF" = "Network e2e" ]; then
			for AGENT in "${EXPECTED_AGENTS[@]}"; do
				OK=$(jq -r --arg n "$AGENT" '[.[].jobs[]? | select(.name==$n and .conclusion=="success")] | length' "$JOBS")
				[ "${OK:-0}" -gt 0 ] || violation "network agent job did not run green: $AGENT"
			done
		fi
	done <<<"$ROWS"
done

if [ "$FAILED" = "0" ]; then
	echo "QUALIFYING GREEN: $SHA"
else
	echo "RUN DOES NOT QUALIFY: $SHA"
fi
exit "$FAILED"
