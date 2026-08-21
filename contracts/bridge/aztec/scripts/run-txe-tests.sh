#!/usr/bin/env bash
# Runs the TokenBridge TXE suite (src/test/) against a live TXE oracle server.
#
# Architecture (discovered the hard way — see implementations-plan/bridge-hardening/lessons/txe-testing.md):
#   - aztec-nargo's built-in test runner does NOT resolve TXE oracles; they must be served by
#     @aztec/txe over HTTP and passed via --oracle-resolver.
#   - The TXE server resolves DEPENDENCY contract artifacts from THIS package's target/, under
#     "<dependency_package_name>-<ContractName>.json". We stage all three before running.
#   - The Token artifact MUST be the transpiled one (@aztec-foundation/aztec-standards ships it);
#     plain `nargo compile` output is rejected ("public bytecode has not been transpiled").
#   - Long TXE calls die on nargo's default foreign-call timeout; upstream CI raises it.
#
# Usage: scripts/run-txe-tests.sh [extra nargo test args...]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"          # contracts/bridge/aztec
repo_root="$(cd "$here/../../.." && pwd)"
tb="$here/token_bridge"
AZTEC_HOME="${AZTEC_HOME:-$HOME/.aztec/versions/5.0.1}"
NARGO="$AZTEC_HOME/bin/aztec-nargo"
[ -x "$NARGO" ] || { echo "aztec-nargo not found at $NARGO" >&2; exit 1; }

TXE_PORT="${TXE_PORT:-8080}"
TXE_PKG_DIR="${TXE_PKG_DIR:-$(mktemp -d)}"
mkdir -p "$TXE_PKG_DIR"

# ── 1. Stage dependency artifacts into token_bridge/target/ ──────────────────────────
cp "$here/token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json" "$tb/target/"
cp "$tb/target/token_bridge_contract-TokenBridge.json" "$tb/target/token_bridge_contract-TokenBridge.json" 2>/dev/null || true
TOKEN_ARTIFACT="$repo_root/node_modules/@aztec-foundation/aztec-standards/artifacts/target/token_contract-Token.json"
[ -f "$TOKEN_ARTIFACT" ] || { echo "Token artifact missing — run bun install at repo root." >&2; exit 1; }
cp "$TOKEN_ARTIFACT" "$tb/target/token_contract-Token.json"

# ── 2. Ensure a TXE server is up (installing @aztec/txe locally if needed) ───────────
if ! curl -sf "http://127.0.0.1:$TXE_PORT" >/dev/null 2>&1; then
  echo "starting TXE server on :$TXE_PORT ..."
  if [ ! -f "$TXE_PKG_DIR/node_modules/@aztec/txe/dest/bin/index.js" ]; then
    (cd "$TXE_PKG_DIR" && bun add @aztec/txe@5.0.1 >/dev/null 2>&1)
  fi
  # NOTE: run under NODE, not bun — native lmdb bindings crash under bun.
  (cd "$TXE_PKG_DIR" && NODE_OPTIONS="--max-old-space-size=8192" \
    node node_modules/@aztec/txe/dest/bin/index.js > txe.log 2>&1 &)
  for _ in $(seq 1 20); do
    curl -sf "http://127.0.0.1:$TXE_PORT" >/dev/null 2>&1 && break
    sleep 1
  done
fi

# ── 3. Run the suite ────────────────────────────────────────────────────────────────
export NARGO_FOREIGN_CALL_TIMEOUT=1200000
cd "$tb"
exec "$NARGO" test --force --oracle-resolver "http://127.0.0.1:$TXE_PORT" "$@"
