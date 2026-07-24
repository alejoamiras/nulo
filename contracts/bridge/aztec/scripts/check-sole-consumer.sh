#!/usr/bin/env bash
# Sole-consumer invariant (A2) for the recipient-commitment property: the token_bridge must have
# EXACTLY two `consume_l1_to_l2_message` call sites (one in claim_public, one in claim_private), and
# claim_private must (a) NOT take a raw secret parameter and (b) DERIVE its consumption secret via a
# `derive_claim_secret(...)` CALL inside its own body. Any of: a stray consume site, a raw-secret
# param, or a private path that consumes without deriving, silently reintroduces the F-007 bearer
# property. Static tripwire, machine-checked in the Phase 2 gate + the Phase 9 audit (the circuit
# can't be TXE-tested for this here).
#
# Robustness note (Phase 9 M2 fix): the parameter list + function body are analysed on a NEWLINE-
# FLATTENED copy of the source, because the real `claim_private(` signature spans multiple lines and a
# line-oriented grep silently matched nothing (the original guard passed a crafted multi-line bearer
# regression — proven in the Phase 9 audit). Run `check-sole-consumer.sh --self-test` to verify the
# guard actually rejects such regressions.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Returns 0 if the file at $1 upholds the invariant, 1 (with a reason on stderr) otherwise.
check_file() {
	local main="$1"
	[ -f "$main" ] || { echo "SOLE-CONSUMER: no such file: $main" >&2; return 1; }

	local consumers
	consumers=$(grep -c "consume_l1_to_l2_message" "$main" || true)
	if [ "$consumers" -ne 2 ]; then
		echo "SOLE-CONSUMER VIOLATION: expected 2 consume_l1_to_l2_message sites, found $consumers in $main" >&2
		echo "  A new consumption path can reintroduce the bearer property (F-007)." >&2
		return 1
	fi

	# Flatten newlines → spaces so a multi-line signature/body is analysable with one regex.
	local flat after params body
	flat=$(tr '\n' ' ' < "$main" | tr -s ' ')
	if ! printf '%s' "$flat" | grep -q "fn claim_private"; then
		echo "SOLE-CONSUMER VIOLATION: no claim_private function found in $main" >&2
		return 1
	fi
	after=$(printf '%s' "$flat" | sed -E 's/.*fn claim_private//')      # everything after `fn claim_private`
	params=$(printf '%s' "$after" | sed -E 's/\).*//')                  # its parameter list (up to first `)`)
	body=$(printf '%s' "$after" | sed -E 's/ fn .*//')                  # its body (up to the next ` fn `)

	# (a) The signature must carry the recipient-committed salt and NO raw secret parameter. The legit
	#     params are {recipient, amount, claim_salt, message_leaf_index} — none contains "secret", so any
	#     "secret" substring here (secret, raw_secret, secretHash, …) is a bearer regression.
	if ! printf '%s' "$params" | grep -q "claim_salt"; then
		echo "SOLE-CONSUMER VIOLATION: claim_private no longer takes claim_salt (recipient-commitment lost)" >&2
		return 1
	fi
	if printf '%s' "$params" | grep -qi "secret"; then
		echo "SOLE-CONSUMER VIOLATION: claim_private accepts a raw secret parameter (bearer regression)" >&2
		return 1
	fi

	# (b) The consumption secret must be DERIVED via a real call (a `(` after the name — not the bare
	#     `use …::derive_claim_secret;` import), INSIDE claim_private's own body, alongside its consume.
	if ! printf '%s' "$body" | grep -qE "derive_claim_secret[[:space:]]*\("; then
		echo "SOLE-CONSUMER VIOLATION: claim_private body does not CALL derive_claim_secret(...) (import alone is not enough)" >&2
		return 1
	fi
	if ! printf '%s' "$body" | grep -q "consume_l1_to_l2_message"; then
		echo "SOLE-CONSUMER VIOLATION: claim_private body does not consume an L1→L2 message where it derives" >&2
		return 1
	fi

	# (c) Dataflow (codex ultra Low): the secret passed to consume must be the value DERIVED from
	#     derive_claim_secret, not a raw param. Catches "derive then ignore it" (`let _ = derive(...);
	#     consume(.., claim_salt, ..)`) and "consume with the raw salt". Extract the var bound to
	#     derive_claim_secret and require claim_private's consume use THAT var as its secret (2nd) arg.
	#     (aztec 5.0.1+: consume_l1_to_l2_message takes the secret as a one-element array `[secret]`, so
	#     accept EITHER `[secret]` or bare `secret` — but NOT a multi-element `[secret, X]` (the extra
	#     element would change the committed hash while a lax `\[?…\]?` regex still matched — codex Low).)
	local derived_var
	derived_var=$(printf '%s' "$body" | sed -nE 's/.*let[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*derive_claim_secret[[:space:]]*\(.*/\1/p' | head -1)
	if [ -z "$derived_var" ] || [ "$derived_var" = "_" ]; then
		echo "SOLE-CONSUMER VIOLATION: claim_private does not bind the derived secret to a real variable (let X = derive_claim_secret(...))" >&2
		return 1
	fi
	if ! printf '%s' "$body" | grep -qE "consume_l1_to_l2_message[[:space:]]*\([^,]*,[[:space:]]*(\[${derived_var}\]|${derived_var})[[:space:]]*,"; then
		echo "SOLE-CONSUMER VIOLATION: claim_private consume does not use the derived secret ($derived_var) as its secret arg — bearer/dataflow bypass" >&2
		return 1
	fi

	# (d) Ban lower-level messaging/nullifier primitives (codex ultra Low): they can consume or nullify a
	#     message WITHOUT going through consume_l1_to_l2_message, bypassing (a)-(c) entirely.
	if printf '%s' "$flat" | grep -qE "process_l1_to_l2_message|push_nullifier"; then
		echo "SOLE-CONSUMER VIOLATION: a lower-level messaging/nullifier primitive is present — it can bypass consume_l1_to_l2_message" >&2
		return 1
	fi

	return 0
}

# --self-test: prove the guard passes on the real source AND rejects crafted bearer regressions.
if [ "${1:-}" = "--self-test" ]; then
	real="$here/token_bridge/src/main.nr"
	tmp=$(mktemp -d)
	trap 'rm -rf "$tmp"' EXIT
	fails=0

	check_file "$real" >/dev/null 2>&1 || { echo "SELF-TEST FAIL: real source rejected" >&2; fails=1; }

	# Regression 1: multi-line raw-secret signature + consume-with-raw-secret, derivation import kept.
	cat >"$tmp/raw_secret.nr" <<'EOF'
use claim_secret_lib::derive_claim_secret;
fn claim_public(to: AztecAddress, amount: u128, secret: Field, message_leaf_index: Field) {
    self.context.consume_l1_to_l2_message(content_hash, secret, config.portal, message_leaf_index);
}
fn claim_private(
    recipient: AztecAddress,
    amount: u128,
    raw_secret: Field,
    message_leaf_index: Field,
) {
    self.context.consume_l1_to_l2_message(content_hash, raw_secret, config.portal, message_leaf_index);
}
EOF
	check_file "$tmp/raw_secret.nr" >/dev/null 2>&1 && { echo "SELF-TEST FAIL: multi-line raw-secret regression accepted" >&2; fails=1; }

	# Regression 2: import present but no derive CALL in the body (consume without deriving).
	cat >"$tmp/no_call.nr" <<'EOF'
use claim_secret_lib::derive_claim_secret;
fn claim_public(to: AztecAddress, amount: u128, secret: Field, message_leaf_index: Field) {
    self.context.consume_l1_to_l2_message(content_hash, secret, config.portal, message_leaf_index);
}
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    self.context.consume_l1_to_l2_message(content_hash, claim_salt, config.portal, message_leaf_index);
}
EOF
	check_file "$tmp/no_call.nr" >/dev/null 2>&1 && { echo "SELF-TEST FAIL: import-only (no derive call) regression accepted" >&2; fails=1; }

	# Regression 3: a third consume site added.
	cat >"$tmp/three.nr" <<'EOF'
use claim_secret_lib::derive_claim_secret;
fn a() { self.context.consume_l1_to_l2_message(x); }
fn b() { self.context.consume_l1_to_l2_message(y); }
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let secret = derive_claim_secret(claim_salt, recipient);
    self.context.consume_l1_to_l2_message(content_hash, secret, config.portal, message_leaf_index);
}
EOF
	check_file "$tmp/three.nr" >/dev/null 2>&1 && { echo "SELF-TEST FAIL: 3-consumer regression accepted" >&2; fails=1; }

	# Regression 4: derive is CALLED but its result is discarded; consume uses the raw claim_salt (dataflow bypass).
	cat >"$tmp/dataflow.nr" <<'EOF'
use claim_secret_lib::derive_claim_secret;
fn claim_public(to: AztecAddress, amount: u128, secret: Field, message_leaf_index: Field) {
    self.context.consume_l1_to_l2_message(content_hash, secret, config.portal, message_leaf_index);
}
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let _ = derive_claim_secret(claim_salt, recipient);
    self.context.consume_l1_to_l2_message(content_hash, claim_salt, config.portal, message_leaf_index);
}
EOF
	check_file "$tmp/dataflow.nr" >/dev/null 2>&1 && { echo "SELF-TEST FAIL: derive-but-consume-raw-salt dataflow bypass accepted" >&2; fails=1; }

	# Regression 5: a lower-level primitive path (process_l1_to_l2_message + push_nullifier) that never
	# calls consume_l1_to_l2_message, alongside a legit-looking claim_private that passes (a)-(c).
	cat >"$tmp/lowlevel.nr" <<'EOF'
use claim_secret_lib::derive_claim_secret;
fn claim_public(to: AztecAddress, amount: u128, secret: Field, message_leaf_index: Field) {
    self.context.consume_l1_to_l2_message(content_hash, secret, config.portal, message_leaf_index);
}
fn claim_private(recipient: AztecAddress, amount: u128, claim_salt: Field, message_leaf_index: Field) {
    let secret = derive_claim_secret(claim_salt, recipient);
    self.context.consume_l1_to_l2_message(content_hash, secret, config.portal, message_leaf_index);
}
fn claim_bearer(raw: Field, leaf: Field) {
    let m = self.context.process_l1_to_l2_message(raw, leaf);
    self.context.push_nullifier(m);
}
EOF
	check_file "$tmp/lowlevel.nr" >/dev/null 2>&1 && { echo "SELF-TEST FAIL: lower-level primitive bypass accepted" >&2; fails=1; }

	if [ "$fails" -ne 0 ]; then echo "❌ check-sole-consumer self-test FAILED" >&2; exit 1; fi
	echo "✅ check-sole-consumer self-test passed (real source upheld; 5 bearer regressions rejected)"
	exit 0
fi

if check_file "${1:-$here/token_bridge/src/main.nr}"; then
	echo "✅ sole-consumer invariant holds: 2 consume sites, claim_private derives (no raw-secret path)"
else
	exit 1
fi
