#!/usr/bin/env bash
# The tools browser suite, one run = one sandbox: ports → sandbox up → local tools build → test-wallet
# build → bundle assertions → playwright → reap. Parallelism is `--shard=i/n` across separate runs.
#
#   bun run e2e:tools [-- <playwright args, e.g. --shard=1/2 or specs/drip.spec.ts>]
#   bun run e2e:tools:reap        # stop every sandbox a run of THIS checkout left behind
#
# Iterating on specs: NULO_E2E_KEEP=1 leaves the sandbox and both builds alive and prints the attach
# line; NULO_E2E_ATTACH=<that state dir> reuses them (NULO_E2E_REBUILD=1 to rebuild the two apps).
# Every process this script starts is its own process group; the trap kills exactly those groups.
set -euo pipefail

cd "$(dirname "$0")/../.."
APP_DIR=$(pwd)

# Orphan recovery by OWNERSHIP: only the pgids this checkout's runs wrote to their pid files — never
# a name match, which would take down another agent's network on the same host.
if [ "${1:-}" = "reap" ]; then
  found=0
  for pidfile in "$APP_DIR"/.e2e-state/*/sandbox.pid; do
    [ -f "$pidfile" ] || continue
    pgid=$(cat "$pidfile")
    if [ -n "$pgid" ] && kill -0 -- "-$pgid" 2>/dev/null; then
      found=1
      echo "[e2e:tools] reaping sandbox pgid $pgid ($(dirname "$pidfile"))"
      kill -TERM -- "-$pgid" 2>/dev/null || true
      for _ in $(seq 1 60); do kill -0 -- "-$pgid" 2>/dev/null || break; sleep 1; done
      kill -KILL -- "-$pgid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  done
  [ "$found" = 1 ] || echo "[e2e:tools] nothing to reap"
  exit 0
fi
RUN_ID="tools-e2e-$$-$(date +%s | tail -c 6)"
STATE_DIR="${NULO_E2E_ATTACH:-${NULO_E2E_STATE_DIR:-$APP_DIR/.e2e-state/$RUN_ID}}"
mkdir -p "$STATE_DIR"
ARTIFACTS="$STATE_DIR/sandbox"
TOOLS_DIST="$STATE_DIR/tools-dist"
WALLET_DIST="$STATE_DIR/wallet-dist"
LOG="$STATE_DIR/sandbox.log"
SANDBOX_PID=""

log() { echo "[e2e:tools] $*"; }

# shellcheck disable=SC2329  # invoked by the EXIT trap
reap() {
  if [ -n "$SANDBOX_PID" ] && kill -0 "$SANDBOX_PID" 2>/dev/null; then
    if [ "${NULO_E2E_KEEP:-}" = "1" ]; then
      log "sandbox kept (pgid $SANDBOX_PID) — attach with: NULO_E2E_ATTACH=$STATE_DIR bun run e2e:tools -- <args>; stop with: kill -TERM -- -$SANDBOX_PID"
      return
    fi
    log "stopping sandbox (pgid $SANDBOX_PID)"
    kill -TERM -- "-$SANDBOX_PID" 2>/dev/null || true
    for _ in $(seq 1 60); do kill -0 "$SANDBOX_PID" 2>/dev/null || break; sleep 1; done
    kill -KILL -- "-$SANDBOX_PID" 2>/dev/null || true
  fi
}
trap reap EXIT

boot_sandbox() {
  log "booting the sandbox (log: $LOG)"
  setsid bun run --cwd ../../packages/bridge-core sandbox:up --artifacts "$ARTIFACTS" >"$LOG" 2>&1 &
  SANDBOX_PID=$!
  echo "$SANDBOX_PID" >"$STATE_DIR/sandbox.pid"
  for _ in $(seq 1 600); do
    if [ -f "$ARTIFACTS/handle.json" ] && grep -q "sandbox up" "$LOG"; then break; fi
    if ! kill -0 "$SANDBOX_PID" 2>/dev/null; then log "FATAL: the sandbox died while booting — see $LOG"; tail -40 "$LOG" >&2; exit 2; fi
    sleep 2
  done
  [ -f "$ARTIFACTS/handle.json" ] || { log "FATAL: sandbox did not come up in 20 min"; exit 2; }
}

attach_sandbox() {
  [ -f "$ARTIFACTS/handle.json" ] || { log "FATAL: $ARTIFACTS/handle.json missing — nothing to attach to"; exit 2; }
  local node
  node=$(jq -r .nodeUrl "$ARTIFACTS/handle.json")
  curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"node_getNodeInfo","params":[]}' "$node" >/dev/null \
    || { log "FATAL: the kept sandbox at $node does not answer — start a fresh run"; exit 2; }
  log "attached to the kept sandbox at $node"
}

build_apps() {
  log "building tools (local target) → $TOOLS_DIST"
  NULO_SANDBOX_ARTIFACTS="$ARTIFACTS" NULO_TOOLS_WEB_WALLETS="$WEB_WALLETS" \
    bun run build:local -- --outDir "$TOOLS_DIST" >"$STATE_DIR/build-tools.log" 2>&1
  NULO_SANDBOX_ARTIFACTS="$ARTIFACTS" bun run verify:build-target local --dist "$TOOLS_DIST"
  grep -rqF -- "$NODE_URL" "$TOOLS_DIST/assets" || { log "FATAL: the tools bundle does not name the node $NODE_URL"; exit 2; }
  grep -rqF -- "$WALLET_ORIGIN/?profile=plain" "$TOOLS_DIST/assets" || { log "FATAL: the tools bundle does not list the test wallet"; exit 2; }

  log "building the test wallet → $WALLET_DIST"
  NULO_SANDBOX_ARTIFACTS="$ARTIFACTS" NULO_TOOLS_ORIGIN="$TOOLS_ORIGIN" NULO_TEST_WALLET_OUT_DIR="$WALLET_DIST" \
    bun run build:test-wallet >"$STATE_DIR/build-wallet.log" 2>&1
  grep -rqF -- "$NODE_URL" "$WALLET_DIST/assets" || { log "FATAL: the wallet bundle does not name the node $NODE_URL"; exit 2; }
}

if [ -n "${NULO_E2E_ATTACH:-}" ]; then
  [ -f "$STATE_DIR/ports.json" ] || { log "FATAL: $STATE_DIR/ports.json missing — nothing to attach to"; exit 2; }
else
  log "resolving ports"
  bun scripts/e2e/resolve-ports.ts "$STATE_DIR"
fi
TOOLS_PORT=$(jq -r .tools "$STATE_DIR/ports.json")
WALLET_PORT=$(jq -r .testWallet "$STATE_DIR/ports.json")
TOOLS_ORIGIN="http://127.0.0.1:$TOOLS_PORT"
WALLET_ORIGIN="http://127.0.0.1:$WALLET_PORT"
WEB_WALLETS="$WALLET_ORIGIN/?profile=plain,$WALLET_ORIGIN/?profile=selfpay,$WALLET_ORIGIN/?profile=full"

if [ -n "${NULO_E2E_ATTACH:-}" ]; then attach_sandbox; else boot_sandbox; fi
NODE_URL=$(jq -r .nodeUrl "$ARTIFACTS/handle.json")
log "sandbox up — node $NODE_URL"

if [ -z "${NULO_E2E_ATTACH:-}" ] || [ "${NULO_E2E_REBUILD:-}" = "1" ] || [ ! -f "$TOOLS_DIST/build.json" ]; then
  build_apps
else
  log "reusing the builds in $STATE_DIR"
fi

log "running playwright ($*)"
set +e
NULO_SANDBOX_ARTIFACTS="$ARTIFACTS" NULO_TOOLS_PORT="$TOOLS_PORT" NULO_TEST_WALLET_PORT="$WALLET_PORT" \
NULO_TOOLS_DIST="$TOOLS_DIST" NULO_TEST_WALLET_DIST="$WALLET_DIST" NULO_TOOLS_WEB_WALLETS="$WEB_WALLETS" NULO_E2E_STATE_DIR="$STATE_DIR" \
NODE_OPTIONS="--import $APP_DIR/tests/browser/node-json-imports.mjs ${NODE_OPTIONS:-}" \
  ./node_modules/.bin/playwright test --config tests/browser/playwright.config.ts "$@"
STATUS=$?
set -e
log "playwright exit $STATUS (state in $STATE_DIR)"
exit $STATUS
