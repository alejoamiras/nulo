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
FAUCET_PORT=$(jq -r .faucet "$PORTS_JSON")
ANVIL_URL=$(jq -r .anvilUrl "$PORTS_JSON")
AZTEC_NODE_URL=$(jq -r .aztecUrl "$PORTS_JSON")
PLAYGROUND_URL=$(jq -r .playgroundUrl "$PORTS_JSON")
FAUCET_URL=$(jq -r .faucetUrl "$PORTS_JSON")

echo "[e2e:agent] building wallet with VITE_LOCAL_NETWORK_RPC_URL=$AZTEC_NODE_URL"
VITE_LOCAL_NETWORK_RPC_URL="$AZTEC_NODE_URL" bun run build:chrome

# Bundle assertion — if the URL didn't actually land in dist, abort before the
# tests waste cycles. This catches the silent failure mode where vi.stubEnv-
# style mistakes leave the default URL hardcoded in the bundle.
if ! grep -rq "$AZTEC_NODE_URL" dist/chrome 2>/dev/null; then
  echo "[e2e:agent] FATAL: built bundle does not contain $AZTEC_NODE_URL" >&2
  echo "[e2e:agent] vite env did not propagate; check vite.config.ts for VITE_* exposure." >&2
  exit 2
fi
echo "[e2e:agent] bundle contains $AZTEC_NODE_URL ✓"

echo "[e2e:agent] running network e2e..."
ANVIL_URL="$ANVIL_URL" \
ANVIL_PORT="$ANVIL_PORT" \
AZTEC_NODE_URL="$AZTEC_NODE_URL" \
AZTEC_PORT="$AZTEC_PORT" \
AZTEC_ADMIN_PORT="$AZTEC_ADMIN_PORT" \
AZTEC_P2P_PORT="$AZTEC_P2P_PORT" \
PLAYGROUND_URL="$PLAYGROUND_URL" \
PLAYGROUND_PORT="$PLAYGROUND_PORT" \
FAUCET_URL="$FAUCET_URL" \
FAUCET_DEV_PORT="$FAUCET_PORT" \
  bun run vitest run --config vitest.e2e.network.config.ts "$@"
