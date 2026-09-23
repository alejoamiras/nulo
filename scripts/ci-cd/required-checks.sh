#!/usr/bin/env bash
# Owner runbook for repointing the required status checks — see required-checks.ts.
#   scripts/ci-cd/required-checks.sh print --branch dev --json > ~/dev-checks.json   # review it
#   scripts/ci-cd/required-checks.sh --apply --branch dev --expect ~/dev-checks.json
set -u
exec bun "$(dirname "$0")/required-checks.ts" "$@"
