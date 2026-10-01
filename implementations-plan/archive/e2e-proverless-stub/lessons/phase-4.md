# Phase 4 — CI two-build split

## `_network-e2e.yml` (reusable) — done
- New `proverless` boolean input. When true: `NULO_E2E_PROVERLESS=1` (agent.sh arms
  the double-opt-in VITE flags + asserts the positive stamp), and accelerator is
  forced OFF — `VITE_NULO_ACCELERATOR_REQUIRED` gains a `&& inputs.proverless == false`
  guard (same short-circuit shape as `disable_accelerator`, NOT inverted), and the
  accelerator setup/start/wait/surface steps gain `&& !inputs.proverless`.

## Canary set — codex consult (session in audit trail)
Decision: prover-ON canaries = **`transfers`** (wallet UI, waits through the real
prove → mine, 600s budget) + **`tx-sendTx-default`** (dApp, upgraded). Everything
else proverless.

Codex's load-bearing finding: every playground sendTx button hard-codes
`wait: "NO_WAIT"` (`packages/playground/src/sections/transactions.ts:77`), so
`waitForPgResult` proves **submit/`txHash`** (the node accepted the REAL proof at
`node.sendTx`) — not block-mine. That submit-acceptance IS the meaningful dApp
real-prove signal, so:
- **`tx-sendTx-default` upgrade:** keep the popup + active-stage assertions, then after
  approve assert `waitForPgResult(... ok)` + `txHash` present (300s budget). Catches a
  "real proof rejected by the node" regression on the dApp path. Validated PROVERLESS
  locally (the assertion logic); the REAL-prove timing is validated by the Phase-4 CI
  gate (no accelerator locally → can't run prover-ON here — inherent to the canary).
- `tx-sendTx-{feePayer,multicall,sponsoredFpc,noFrom}` → proverless pool (fee/entrypoint
  variants; their value is the simulate/active-stage path, preserved proverless).

Why a dApp canary at all (codex Q2): `transfers` covers the SHARED real-prove core
(both paths converge on `execution-coordinator.ts:147`), but NOT the dApp-specific
`dapp-send-executor.ts` plumbing. One mined dApp canary keeps a standing real-prove
guard on that path. Kept.

## Orchestration (pr-network-e2e.yml)
- `network-e2e` shard pool → `proverless: true`; `exclude_files` adds `transfers` +
  `tx-sendTx-default` (run prover-ON in the canary job) on top of the existing
  fee-methods + concurrent-confirm excludes (those run as proverless heavy jobs).
- `network-e2e-heavy` (fee-methods, PLAIN) + `network-e2e-heavy-concurrent` (STUB) →
  `proverless: true`.
- NEW `network-e2e-canary` → prover-ON (proverless:false default + accelerator),
  `test_files: "transfers.test.ts tx-sendTx-default.test.ts"`, disable_accelerator
  kill-switch retained.
- `status`: add `network-e2e-canary` to BOTH `needs` AND the aggregation shell loop
  (codex footgun — forgetting one drops it from the gate).

LESSONS_FILE=implementations-plan/e2e-proverless-stub/lessons/phase-4.md
