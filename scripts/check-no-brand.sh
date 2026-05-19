#!/usr/bin/env bash

set -euo pipefail

pattern='azguard|vibeguard|bb strategy|jp4g-azguard|/Users/[A-Za-z]|/home/[A-Za-z]'

mapfile -t hits < <(
	git grep -i -l -E "$pattern" -- \
		. \
		':!scripts/check-no-brand.sh' \
		':!ACKNOWLEDGEMENTS.md' \
		':!implementations-plan' \
		':!implementations-plan/**' || true
)

if ((${#hits[@]} > 0)); then
	printf '%s\n' 'legacy brand/path residue detected:' >&2
	printf ' - %s\n' "${hits[@]}" >&2
	printf '%s\n' 'Remove the legacy brand strings or absolute filesystem paths, or extend the allowlist in scripts/check-no-brand.sh if a historical public reference is intentional.' >&2
	exit 1
fi

printf '%s\n' 'ok: no legacy brand/path strings found'
