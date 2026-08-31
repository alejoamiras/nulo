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
# oracle.
#
# Asking the kernel for a free port and releasing it leaves a window in which another process
# can take it, so retry the whole claim-and-bind rather than trusting one probe. The retry is
# what makes this safe, not the probe itself.
pick_free_port() {
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p))})'
}
PORT_PINNED=1
if [ -z "${TXE_PORT:-}" ]; then
  PORT_PINNED=0
  TXE_PORT="$(pick_free_port)"
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
if [ "$PORT_PINNED" = "1" ] && txe_up; then
  echo "reusing the TXE server already listening on :$TXE_PORT (caller-pinned)"
else
  if [ ! -f "$TXE_PKG_DIR/node_modules/@aztec/txe/dest/bin/index.js" ]; then
    (cd "$TXE_PKG_DIR" && bun add @aztec/txe@5.0.1 >/dev/null 2>&1)
  fi
  # Retry the whole claim-and-bind: another process can take the port between our probe
  # releasing it and the server binding it. Only an unpinned port may be re-picked — a caller
  # who named a port gets one attempt and a clear failure.
  started=0
  for attempt in 1 2 3; do
    echo "starting TXE server on :$TXE_PORT (attempt $attempt) ..."
    # NOTE: run under NODE, not bun — native lmdb bindings crash under bun. `exec` so $! is the
    # server itself rather than a subshell that exits and orphans it.
    (cd "$TXE_PKG_DIR" && TXE_PORT="$TXE_PORT" NODE_OPTIONS="--max-old-space-size=8192" \
      exec node node_modules/@aztec/txe/dest/bin/index.js > "$TXE_PKG_DIR/txe-$TXE_PORT.log" 2>&1) &
    TXE_PID=$!
    for _ in $(seq 1 60); do
      txe_up && break
      kill -0 "$TXE_PID" 2>/dev/null || break   # died early — stop waiting, read the log
      sleep 1
    done
    if txe_up && kill -0 "$TXE_PID" 2>/dev/null; then
      started=1
      break
    fi
    cleanup
    TXE_PID=""
    [ "$PORT_PINNED" = "1" ] && break
    TXE_PORT="$(pick_free_port)"
  done
  [ "$started" = "1" ] || {
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
