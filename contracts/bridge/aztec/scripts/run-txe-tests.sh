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

# Port is per-run, not fixed: many agents share this host, and a hardcoded 8080 either collides
# with another run or — worse — silently reuses ITS server and reports results from a foreign
# oracle. Ask the kernel for a free port unless the caller pins one.
if [ -z "${TXE_PORT:-}" ]; then
  TXE_PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
fi
# Cache the @aztec/txe install across runs; a fresh mktemp each time re-downloaded it every run.
TXE_PKG_DIR="${TXE_PKG_DIR:-$HOME/.cache/nulo-txe/5.0.1}"
mkdir -p "$TXE_PKG_DIR"
TXE_PID=""

# Tear down ONLY the server this script started. A run that reused a caller-supplied port leaves
# that server alone; `pkill -f txe` would kill another agent's oracle mid-suite.
cleanup() {
  [ -n "$TXE_PID" ] && kill "$TXE_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT INT TERM

# ── 1. Stage dependency artifacts into token_bridge/target/ ──────────────────────────
cp "$here/token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json" "$tb/target/"
# Resolved through bridge-core's declared dependency, not $repo_root/node_modules: this repo
# uses bun's isolated linker, so there is no hoisted root node_modules to look in.
TOKEN_ARTIFACT="$repo_root/packages/bridge-core/node_modules/@aztec-foundation/aztec-standards/artifacts/target/token_contract-Token.json"
[ -f "$TOKEN_ARTIFACT" ] || { echo "Token artifact missing at $TOKEN_ARTIFACT — run bun install." >&2; exit 1; }
cp "$TOKEN_ARTIFACT" "$tb/target/token_contract-Token.json"

# TXE speaks JSON-RPC and does not answer a bare GET, so `curl -sf` reports failure even once
# it is serving. Probe the TCP socket instead — the original HTTP probe never succeeded, which
# only went unnoticed because the wait loop fell through and ran the suite anyway.
txe_up() { (exec 3<>"/dev/tcp/127.0.0.1/$TXE_PORT") 2>/dev/null; }

# ── 2. Start our own TXE server ─────────────────────────────────────────────────────
if txe_up; then
  echo "reusing the TXE server already listening on :$TXE_PORT (caller-pinned)"
else
  echo "starting TXE server on :$TXE_PORT ..."
  if [ ! -f "$TXE_PKG_DIR/node_modules/@aztec/txe/dest/bin/index.js" ]; then
    (cd "$TXE_PKG_DIR" && bun add @aztec/txe@5.0.1 >/dev/null 2>&1)
  fi
  # NOTE: run under NODE, not bun — native lmdb bindings crash under bun.
  (cd "$TXE_PKG_DIR" && TXE_PORT="$TXE_PORT" NODE_OPTIONS="--max-old-space-size=8192" \
    node node_modules/@aztec/txe/dest/bin/index.js > "txe-$TXE_PORT.log" 2>&1 &
   echo $! > "$TXE_PKG_DIR/txe-$TXE_PORT.pid")
  TXE_PID="$(cat "$TXE_PKG_DIR/txe-$TXE_PORT.pid" 2>/dev/null)"
  for _ in $(seq 1 60); do
    txe_up && break
    sleep 1
  done
  txe_up || {
    echo "TXE server never came up on :$TXE_PORT — see $TXE_PKG_DIR/txe-$TXE_PORT.log" >&2
    exit 1
  }
fi

# ── 3. Run the suite ────────────────────────────────────────────────────────────────
export NARGO_FOREIGN_CALL_TIMEOUT=1200000
cd "$tb"
# One TXE server, bounded concurrency. The server's lmdb store opens with maxReaders 2, and
# nargo defaults to one test thread per core: past roughly two dozen tests the reader limit is
# exceeded and the native binding aborts the whole process with an uncaught Napi::Error. Every
# test still in flight then fails with "Failed calling external resolver", which reads like a
# suite-wide breakage rather than a capacity limit — and any bare `should_fail` test passes
# vacuously on that connect error. Override with TXE_TEST_THREADS if the server gains headroom.
TEST_THREADS="${TXE_TEST_THREADS:-4}"
# Not exec: that would replace this shell and skip the EXIT trap, orphaning the TXE server.
# tee, and assert a POSITIVE count afterwards: nargo exits 0 when it discovers no tests at all,
# so dropping `mod test;` would otherwise read as a clean pass.
set -o pipefail
"$NARGO" test --force --test-threads "$TEST_THREADS" --oracle-resolver "http://127.0.0.1:$TXE_PORT" "$@" \
  | tee "$tb/txe-run.log"
rc=$?
grep -qE "[1-9][0-9]* tests? passed" "$tb/txe-run.log" || {
  echo "run-txe-tests.sh: nargo reported no passing tests — is the test module still wired in?" >&2
  exit 1
}
exit "$rc"
