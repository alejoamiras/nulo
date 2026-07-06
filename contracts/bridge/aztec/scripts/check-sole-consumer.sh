#!/usr/bin/env bash
# Sole-consumer invariant (A2) for the recipient-commitment property: the token_bridge must have
# EXACTLY two `consume_l1_to_l2_message` call sites (one in claim_public, one in claim_private), and
# the private path must derive its secret via `derive_claim_secret` — never accept a raw secret.
# A stray/added consume site, or a private-mint path that bypasses the derivation, silently
# reintroduces the F-007 bearer property. This is a static tripwire, machine-checked in the Phase 2
# gate + re-checked in the Phase 9 audit (the circuit can't be TXE-tested for this here).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
main="$here/token_bridge/src/main.nr"

consumers=$(grep -c "consume_l1_to_l2_message" "$main" || true)
if [ "$consumers" -ne 2 ]; then
	echo "SOLE-CONSUMER VIOLATION: expected 2 consume_l1_to_l2_message sites in token_bridge, found $consumers" >&2
	echo "  A new consumption path can reintroduce the bearer property (F-007). Review $main." >&2
	exit 1
fi

# The private claim must derive the secret (recipient-committed), not take a raw secret argument.
if ! grep -q "derive_claim_secret" "$main"; then
	echo "SOLE-CONSUMER VIOLATION: claim_private no longer derives its secret via derive_claim_secret" >&2
	exit 1
fi
if grep -qE "secret_for_L1_to_L2_message_consumption|fn claim_private\([^)]*secret[^)]*:[[:space:]]*Field" "$main"; then
	echo "SOLE-CONSUMER VIOLATION: claim_private appears to accept a raw secret (bearer regression)" >&2
	exit 1
fi

echo "✅ sole-consumer invariant holds: 2 consume sites, claim_private derives (no raw-secret path)"
