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

# Clear stale boot-sentinel markers from a prior run so the boot-failure
# classifier (scripts/e2e/classify-exit.ts) sees only THIS run's state.
rm -f .e2e-state/boot-started .e2e-state/boot-ready .e2e-state/tests-started

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
# VITE_NULO_E2E_DEFAULT_NET=testnet pins the SEEDED-ACTIVE network: fresh-extension import flows
# bootstrap on the default before any fixture can switch, and CI cannot reliably reach the Alpha
# mainnet RPC (each blocked call eats the node client's 60s-abort x retry envelope).
# NULO_E2E_PROVERLESS=1 builds a proverless wallet (skips BB-SNARK generation;
# kernel simulation + on-chain submission stay real). Arms the double-opt-in
# flags so apps/extension/src/e2e/config.ts enables the proverless PXE +
# ChromeStorageProofGate. Mutually exclusive with accelerator-required.
# The migration-fixture stamp arms the e2e-only fixture migrations (live 9001
# + the declarative BACKUP 9001) so backup-migration-roundtrip.test.ts can
# drive a vN backup through the whole import path on a live sandbox. Inert for
# every other network test (fresh installs stamp max and run nothing; the
# backup fixture only runs on backup import). Never ships: prod builds omit
# the env and _build-extension.yml greps release bundles for the markers.
if [ "${NULO_E2E_PROVERLESS:-}" = "1" ]; then
  if [ "${VITE_NULO_ACCELERATOR_REQUIRED:-}" = "1" ]; then
    echo "[e2e:agent] FATAL: NULO_E2E_PROVERLESS and VITE_NULO_ACCELERATOR_REQUIRED are mutually exclusive" >&2
    exit 2
  fi
  echo "[e2e:agent] PROVERLESS build — BB-SNARK generation skipped (double opt-in)"
  VITE_LOCAL_NETWORK_RPC_URL="$AZTEC_NODE_URL" \
  VITE_NULO_E2E_DEFAULT_NET=testnet \
  VITE_NULO_E2E_MIGRATION_FIXTURE=1 \
  VITE_NULO_E2E_PROVERLESS=1 \
  VITE_NULO_E2E_PROVERLESS_CONFIRM=1 \
    bun run build:chrome
else
  # Scrub any inherited proverless flags so a non-proverless build (e.g. the
  # prover-ON canary job) can't silently build proverless from leaked runner
  # env — the double-opt-in would otherwise arm if both vars are already set
  # (codex post-impl audit).
  unset VITE_NULO_E2E_PROVERLESS VITE_NULO_E2E_PROVERLESS_CONFIRM
  VITE_LOCAL_NETWORK_RPC_URL="$AZTEC_NODE_URL" \
  VITE_NULO_E2E_DEFAULT_NET=testnet \
  VITE_NULO_E2E_MIGRATION_FIXTURE=1 \
    bun run build:chrome
fi

# Bundle assertion — if the URL didn't actually land in dist, abort before the
# tests waste cycles. This catches the silent failure mode where vi.stubEnv-
# style mistakes leave the default URL hardcoded in the bundle.
if ! grep -rq "$AZTEC_NODE_URL" dist/chrome 2>/dev/null; then
  echo "[e2e:agent] FATAL: built bundle does not contain $AZTEC_NODE_URL" >&2
  echo "[e2e:agent] vite env did not propagate; check vite.config.ts for VITE_* exposure." >&2
  exit 2
fi
echo "[e2e:agent] bundle contains $AZTEC_NODE_URL ✓"

# Positive fixture-stamp assertion: the backup-migration round-trip spec FAILS
# (never skips) when the runner declares the fixture armed but the build lacks
# it — catch the propagation failure here, before tests waste cycles.
if ! grep -rq "nulo:e2e:backup-mig-fixture" dist/chrome 2>/dev/null; then
  echo "[e2e:agent] FATAL: migration-fixture stamp did not propagate (backup fixture marker absent from dist/chrome)" >&2
  exit 2
fi
echo "[e2e:agent] bundle contains the backup-migration fixture ✓"

# Parallel bundle assertion for VITE_NULO_ACCELERATOR_REQUIRED. Codex post-impl
# audit (finding #3): without this check, if the env var ever stops propagating
# from the workflow into the build, Layer 2 (chain-runtime.ts onPhase throw)
# silently disappears and tests can pass on WASM even when the server is up but
# unhealthy mid-test. The stamp is emitted by apps/extension/src/accelerator/config.ts
# and pinned into the bundle by offscreen/index.ts. Only enforced when the env
# var is set (i.e. CI required-mode); locally the var is unset and the assertion
# is skipped.
if [ "${VITE_NULO_ACCELERATOR_REQUIRED:-}" = "1" ]; then
  if ! grep -rq "NULO_ACCELERATOR_REQUIRED_BUILD_STAMP" dist/chrome 2>/dev/null; then
    echo "[e2e:agent] FATAL: VITE_NULO_ACCELERATOR_REQUIRED=1 but build stamp absent from dist/chrome" >&2
    echo "[e2e:agent] env didn't propagate; Layer 2 enforcement would silently disappear" >&2
    exit 2
  fi
  echo "[e2e:agent] bundle contains NULO_ACCELERATOR_REQUIRED_BUILD_STAMP ✓"
fi

# Positive proverless stamp assertion (mirror the accelerator stamp). If the
# double-opt-in flags didn't propagate into the build, the suite would
# silently run with REAL proving — defeating the speed/CDP-stability goal and
# masking the proverless path entirely. Emitted by src/e2e/config.ts, pinned
# by offscreen/index.ts.
if [ "${NULO_E2E_PROVERLESS:-}" = "1" ]; then
  if ! grep -rq "NULO_E2E_PROVERLESS_BUILD_STAMP" dist/chrome 2>/dev/null; then
    echo "[e2e:agent] FATAL: NULO_E2E_PROVERLESS=1 but proverless build stamp absent from dist/chrome" >&2
    echo "[e2e:agent] double-opt-in flags didn't propagate; suite would silently run with real proving" >&2
    exit 2
  fi
  echo "[e2e:agent] bundle contains NULO_E2E_PROVERLESS_BUILD_STAMP ✓"
fi

# Fail loudly if VITE_NULO_FEE_MULTIPLIER didn't propagate into the bundle.
# Without this, a silently-default 2× envelope keeps causing the heavy
# multi-prove tests (transfers, concurrent-sendtx-confirm) to flake on
# loaded GHA runners, but the failures look identical to the pre-fix
# state. Asserting the bundle contains `parseFloat(\`<value>\`)` proves
# Vite statically substituted the env var.
if [ -n "${VITE_NULO_FEE_MULTIPLIER:-}" ]; then
  if ! grep -rq "parseFloat(\`${VITE_NULO_FEE_MULTIPLIER}\`)" dist/chrome 2>/dev/null; then
    echo "[e2e:agent] FATAL: VITE_NULO_FEE_MULTIPLIER=${VITE_NULO_FEE_MULTIPLIER} but bundle does not contain parseFloat(\`${VITE_NULO_FEE_MULTIPLIER}\`)" >&2
    echo "[e2e:agent] env didn't propagate into Vite; gas-envelope widening would silently disappear" >&2
    exit 2
  fi
  echo "[e2e:agent] bundle contains parseFloat(\`${VITE_NULO_FEE_MULTIPLIER}\`) ✓"
fi

echo "[e2e:agent] running network e2e..."
# `E2E_REQUIRE_SETUP=1` tells `tests/e2e/global-setup.ts` that this is the
# real agent runner (not a contributor running vitest directly without a
# sandbox), so a failed `deployContractsAndProvide` MUST surface as a loud
# failure rather than the historical silent `aztecTestConfig: undefined`
# pass-by-skip. Without this gate, every test gets `describe.skipIf(!config)`
# and vitest exits 0 with `61 skipped` — which is what hid this entire suite
# from CI for weeks.
# Capture vitest's exit without `set -e` aborting, so the boot classifier runs.
set +e
E2E_REQUIRE_SETUP=1 \
NULO_E2E_MIGRATION_FIXTURE=1 \
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
VITEST_EXIT=$?
set -e

# Map an infra-boot failure (sandbox never became ready AND no test ran) to exit
# 86 so _network-e2e.yml retries the agent ONCE. Any other non-zero — including a
# real test failure — passes through unchanged and is never retried. The
# classifier reads the .e2e-state boot markers written by global-setup + the
# network setupFile.
exec bun run scripts/e2e/classify-exit.ts "$VITEST_EXIT"
