#!/usr/bin/env bash
# Parallel-safe e2e runner — one agent, one port pack.
#
# Sequence:
#   1) Resolve a fresh port pack (writes .e2e-state/ports.json).
#   2) Build the wallet with VITE_LOCAL_NETWORK_RPC_URL stamped into the seed.
#   3) Verify the bundle actually contains that URL (catches the case where the
#      vite env didn't propagate — vi.stubEnv style mistakes).
#   4) Run the network e2e suite with all relevant URLs/ports in env.
#
# Pass-through args go straight to vitest (e.g. test file selectors).
set -euo pipefail

cd "$(dirname "$0")/../.."

PORTS_JSON=".e2e-state/ports.json"

echo "[e2e:agent] resolving ports..."
bun run scripts/e2e/resolve-ports.ts

ANVIL_PORT=$(jq -r .anvil "$PORTS_JSON")
AZTEC_PORT=$(jq -r .aztec "$PORTS_JSON")
AZTEC_ADMIN_PORT=$(jq -r .aztecAdmin "$PORTS_JSON")
AZTEC_P2P_PORT=$(jq -r .aztecP2P "$PORTS_JSON")
PLAYGROUND_PORT=$(jq -r .playground "$PORTS_JSON")
ANVIL_URL=$(jq -r .anvilUrl "$PORTS_JSON")
AZTEC_NODE_URL=$(jq -r .aztecUrl "$PORTS_JSON")
PLAYGROUND_URL=$(jq -r .playgroundUrl "$PORTS_JSON")

# VITE_E2E_PROBE turns on the diagnostic probe call-sites for the network-
# recovery investigation. See implementations-plan/e2e-full-network-recovery/plan.md.
# Off by default in prod; the bundle-grep below verifies probes don't leak.
echo "[e2e:agent] building wallet with VITE_LOCAL_NETWORK_RPC_URL=$AZTEC_NODE_URL VITE_E2E_PROBE=1"
VITE_LOCAL_NETWORK_RPC_URL="$AZTEC_NODE_URL" VITE_E2E_PROBE=1 bun run build:chrome

# Bundle assertion — if the URL didn't actually land in dist, abort before the
# tests waste cycles. This catches the silent failure mode where vi.stubEnv-
# style mistakes leave the default URL hardcoded in the bundle.
if ! grep -rq "$AZTEC_NODE_URL" dist/chrome 2>/dev/null; then
  echo "[e2e:agent] FATAL: built bundle does not contain $AZTEC_NODE_URL" >&2
  echo "[e2e:agent] vite env did not propagate; check vite.config.ts for VITE_* exposure." >&2
  exit 2
fi
echo "[e2e:agent] bundle contains $AZTEC_NODE_URL ✓"

# E2E_PROBE assertion — the probe call-sites should be present in the e2e
# build (we WANT them on here). The inverse check (probes absent in a
# non-probe build) lives in CI as a separate workflow step.
if ! grep -rq '\[PROBE\]' dist/chrome 2>/dev/null; then
  echo "[e2e:agent] WARN: built bundle does not contain probe call-sites; investigation will yield no data." >&2
fi

echo "[e2e:agent] running network e2e..."
# `E2E_REQUIRE_SETUP=1` tells `tests/e2e/global-setup.ts` that this is the
# real agent runner (not a contributor running vitest directly without a
# sandbox), so a failed `deployContractsAndProvide` MUST surface as a loud
# failure rather than the historical silent `aztecTestConfig: undefined`
# pass-by-skip. Without this gate, every test gets `describe.skipIf(!config)`
# and vitest exits 0 with `61 skipped` — which is what hid this entire suite
# from CI for weeks.
E2E_REQUIRE_SETUP=1 \
ANVIL_URL="$ANVIL_URL" \
ANVIL_PORT="$ANVIL_PORT" \
AZTEC_NODE_URL="$AZTEC_NODE_URL" \
AZTEC_PORT="$AZTEC_PORT" \
AZTEC_ADMIN_PORT="$AZTEC_ADMIN_PORT" \
AZTEC_P2P_PORT="$AZTEC_P2P_PORT" \
PLAYGROUND_URL="$PLAYGROUND_URL" \
PLAYGROUND_PORT="$PLAYGROUND_PORT" \
  bun run vitest run --config vitest.e2e.network.config.ts "$@"
