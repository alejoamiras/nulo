#!/usr/bin/env bash
# Re-point a branch's required status checks to the renamed aggregators, SAFELY.
#
# Read-modify-write: GET the live required_status_checks, PRESERVE `strict`
# (main is strict:true — a blind overwrite would clobber it), and PATCH only the
# `checks` set. Two steps keep the gate never-weaker-than-today:
#
#   add-union  checks := live ∪ {new pinned names}   (phantoms stay → gate stays blocked)
#   finalize   checks := {new pinned names only}      (drops the phantoms → satisfiable)
#
# Dry-run by default. Pass --apply to actually PATCH.
#
# Usage:
#   repoint.sh <dev|main> <show|add-union|finalize> [--apply]
set -euo pipefail

REPO="alejoamiras/nulo"
BRANCH="${1:?branch (dev|main) required}"
STEP="${2:?step (show|add-union|finalize) required}"
APPLY="${3:-}"

# The renamed aggregators + the live-observed GitHub Actions app_id (slug github-actions).
# app_id pin = defense-in-depth: only this app can satisfy the gate (blocks a same-named spoof).
APP_ID=15368
NEW_CONTEXTS=(quality-status network-e2e-status smoke-e2e-status)

api="repos/$REPO/branches/$BRANCH/protection/required_status_checks"

live_json="$(gh api "$api")"
live_strict="$(jq -r '.strict' <<<"$live_json")"
echo "── live $BRANCH: strict=$live_strict"
echo "── live checks:"; jq -c '.checks[]' <<<"$live_json" | sed 's/^/     /'

# Build the new pinned checks array as JSON.
new_pinned="$(printf '%s\n' "${NEW_CONTEXTS[@]}" | jq -R --argjson a "$APP_ID" '{context:., app_id:$a}' | jq -s '.')"

case "$STEP" in
  show)
    exit 0 ;;
  add-union)
    # union(live.checks, new_pinned) deduped by context — preserves any non-target checks.
    next_checks="$(jq -n --argjson live "$(jq '.checks' <<<"$live_json")" --argjson new "$new_pinned" \
      '($live + $new) | unique_by(.context)')" ;;
  finalize)
    # exactly the new pinned names; drops the phantoms (and the actionlint Status was never here).
    next_checks="$new_pinned" ;;
  *)
    echo "unknown step: $STEP" >&2; exit 2 ;;
esac

body="$(jq -n --argjson strict "$([ "$live_strict" = true ] && echo true || echo false)" \
              --argjson checks "$next_checks" '{strict:$strict, checks:$checks}')"

echo "── computed PATCH body for $BRANCH ($STEP):"
jq . <<<"$body"

if [ "$APPLY" = "--apply" ]; then
  echo "── APPLYING (strict preserved=$live_strict)…"
  gh api -X PATCH "$api" --input - <<<"$body" >/dev/null
  echo "── done. re-reading:"
  gh api "$api" --jq '{strict, checks:[.checks[].context]}'
else
  echo "── DRY-RUN (no change). re-run with --apply to PATCH."
fi
