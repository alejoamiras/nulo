#!/usr/bin/env bash
# Prune remote branches that are safely merged into main/dev. Local-only branches
# are archived under refs/archive/local-stale/<name> before deletion so nothing
# is lost.
#
# Safety rules (per the audit in implementations-plan/ci-cd/audit-smoke-gating.md
# and the practical observation that this repo squash-merges):
#   - AUTO-DELETE when either:
#       (a) the current tip SHA is reachable from origin/main OR origin/dev
#           (standard merge-commit case), OR
#       (b) a merged PR exists for this branch AND that PR's headRefOid SHA at
#           merge time matches the current tip SHA (squash-merge case — equality
#           guarantees no post-merge force-push).
#   - SKIP-OPEN-PR if the branch is the head ref of any currently-open PR.
#   - SKIP-UNREACHABLE for everything else; never auto-deleted. Use
#     `--force <branch>` for one-off manual overrides after eyeballing.
#
# Usage:
#   prune-stale-branches.sh                       # dry-run (default)
#   prune-stale-branches.sh --execute             # delete the AUTO-DELETE set
#   prune-stale-branches.sh --force <branch>      # one-off override

set -euo pipefail

KEEP=(main dev feat/ci-bringup)
MODE="dry-run"
FORCE_BRANCH=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--execute) MODE="execute"; shift ;;
		--force)   MODE="force"; FORCE_BRANCH="${2:-}"; shift 2 ;;
		-h|--help)
			grep -E '^# ' "$0" | sed 's/^# \?//'
			exit 0
			;;
		*) echo "::error::unknown arg: $1" >&2; exit 2 ;;
	esac
done

contains() {
	local needle=$1; shift
	local item
	for item in "$@"; do [[ "$item" == "$needle" ]] && return 0; done
	return 1
}

echo "Fetching origin (with prune)..."
git fetch --all --prune --quiet

# Open PR heads from GitHub
mapfile -t OPEN_PR_HEADS < <(gh pr list --state open --json headRefName -q '.[].headRefName' 2>/dev/null || true)

# Remote branches. Filter out:
#   - HEAD (symbolic ref)
#   - bare 'origin' (a stray ref that sometimes exists from old fetch state)
mapfile -t REMOTE_BRANCHES < <(
	git for-each-ref --format='%(refname:short)' refs/remotes/origin \
		| sed 's|^origin/||' \
		| grep -vE '^(HEAD|origin)$' \
		| sort
)

# Helper: does a merged PR exist for this branch whose merge-time headRefOid
# equals the current tip SHA? Equality proves no post-merge commits.
squash_merge_safe() {
	local branch=$1
	local current_tip=$2
	local merged_oid
	merged_oid=$(gh pr list --state merged --head "$branch" --json headRefOid -q '.[0].headRefOid' 2>/dev/null || true)
	[[ -n "$merged_oid" && "$merged_oid" == "$current_tip" ]]
}

echo
echo "## Remote branch audit"
echo
printf "%-55s %-18s %s\n" "BRANCH" "CATEGORY" "DETAIL"
printf "%-55s %-18s %s\n" "------" "--------" "------"

AUTO_DELETE=()
SKIP_UNREACHABLE=()
SKIP_OPEN_PR=()

for b in "${REMOTE_BRANCHES[@]}"; do
	if contains "$b" "${KEEP[@]}"; then
		printf "%-55s %-18s %s\n" "$b" "KEEP" "long-lived / current PR"
		continue
	fi
	sha=$(git rev-parse "origin/$b")

	if contains "$b" "${OPEN_PR_HEADS[@]}"; then
		SKIP_OPEN_PR+=("$b")
		printf "%-55s %-18s %s\n" "$b" "SKIP-OPEN-PR" "head of open PR"
		continue
	fi

	if git merge-base --is-ancestor "$sha" origin/main 2>/dev/null \
		|| git merge-base --is-ancestor "$sha" origin/dev 2>/dev/null; then
		AUTO_DELETE+=("$b")
		printf "%-55s %-18s %s\n" "$b" "AUTO-DELETE" "tip reachable from main/dev"
	elif squash_merge_safe "$b" "$sha"; then
		AUTO_DELETE+=("$b")
		printf "%-55s %-18s %s\n" "$b" "AUTO-DELETE" "squash-merged; tip == PR headRefOid at merge"
	else
		SKIP_UNREACHABLE+=("$b")
		printf "%-55s %-18s %s\n" "$b" "SKIP-UNREACHABLE" "tip NOT in main/dev — needs review"
	fi
done

echo
echo "## Summary"
echo "  auto-delete:           ${#AUTO_DELETE[@]}"
echo "  skip (open PR):        ${#SKIP_OPEN_PR[@]}"
echo "  skip (unreachable):    ${#SKIP_UNREACHABLE[@]}"
echo

if [[ "$MODE" == "dry-run" ]]; then
	echo "Dry-run only. To proceed:"
	echo "  $0 --execute               # delete the AUTO-DELETE set"
	echo "  $0 --force <branch>        # one-off manual override"
	exit 0
fi

if [[ "$MODE" == "force" ]]; then
	if [[ -z "$FORCE_BRANCH" ]]; then
		echo "::error::--force requires a branch name" >&2
		exit 2
	fi
	if contains "$FORCE_BRANCH" "${KEEP[@]}"; then
		echo "::error::refusing to delete keeper branch '$FORCE_BRANCH'" >&2
		exit 2
	fi
	if ! contains "$FORCE_BRANCH" "${REMOTE_BRANCHES[@]}"; then
		echo "::warning::'$FORCE_BRANCH' not found on origin (already deleted?)"
	else
		echo "Force-deleting origin/$FORCE_BRANCH..."
		git push origin --delete "$FORCE_BRANCH"
	fi
	exit 0
fi

# MODE == execute
echo "Deleting ${#AUTO_DELETE[@]} remote branches..."
for b in "${AUTO_DELETE[@]}"; do
	echo "  origin/$b"
	if ! git push origin --delete "$b"; then
		echo "    ::warning::failed to delete origin/$b; continuing"
	fi
done
echo "Remote prune complete."

echo
echo "## Local branches (archive-before-delete)"
mapfile -t LOCAL_BRANCHES < <(git for-each-ref --format='%(refname:short)' refs/heads | sort)
LOCAL_ARCHIVED=0
for b in "${LOCAL_BRANCHES[@]}"; do
	if contains "$b" "${KEEP[@]}"; then
		echo "  keep:    $b"
		continue
	fi
	sha=$(git rev-parse "$b")
	archive_ref="refs/archive/local-stale/$b"
	echo "  archive: $b @ ${sha:0:10} → $archive_ref"
	git update-ref "$archive_ref" "$sha"
	if git branch -D "$b" >/dev/null 2>&1; then
		LOCAL_ARCHIVED=$((LOCAL_ARCHIVED + 1))
	else
		echo "    ::warning::could not delete local branch '$b'; archive ref left in place"
	fi
done
echo "Local pruning: ${LOCAL_ARCHIVED} branches archived + deleted."
echo
echo "Recover an archived local branch with:"
echo "  git checkout -b <name> refs/archive/local-stale/<name>"
echo "Garbage-collect the archive once you're confident:"
echo "  git update-ref -d refs/archive/local-stale/<name>"
