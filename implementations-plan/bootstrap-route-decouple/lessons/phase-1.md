# Phase 1 lessons — BLOCKING empirical verification

Goal (plan.md Phase 1): (a) inspect the REAL smoke-exported backup's account-state slice;
(b) reproduce the stall with doctored endpoints (blackhole + refused + control), stub logging
observed JSON-RPC methods; (c) negative control (no account-state slice) must complete;
(d) STOP + reassess if falsified.

Harness: temporary `apps/extension/tests/e2e/phase1-evidence.test.ts` (never committed;
deleted after evidence capture). Armed CI-parity build
(`VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet bun run build:chrome`).
Four probes: A real-export inspect + doctored blackhole import; B synthetic+account-state vs
blackhole; C synthetic+account-state vs refused (`http://localhost:1`); D control (dead RPC,
no account-state).

## Run 1+2 (2026-08-12) — 4/4 probes conclusive

| Probe | Setup | Terminal state | Wall clock | Stub-observed JSON-RPC |
|---|---|---|---|---|
| A | REAL exported backup, every endpoint doctored → blackhole (checksum recomputed) | `error:import-failed` ("Import failed" banner, route parked on `#/popup/import`) | **60.8s** | `aztec_getNodeInfo` ×2 → `aztec_getL1ContractAddresses` |
| B | synthetic backup + senders-only account-state slice → blackhole | `error:import-failed` | **60.7s** | `aztec_getNodeInfo` ×2 → `aztec_getL1ContractAddresses` |
| C | synthetic + account-state → refused (`http://localhost:1`) | `errors-screen:continue+view` (finished-with-errors, NO auto-route) | **7.0s** | n/a (refused) |
| D | **negative control**: same dead RPC, NO account-state slice | `route:general` | **0.5s** | none |

Readings:
- **Attribution CONFIRMED.** The account-state restore leg is the only import step that dials
  the network: with it, a dead RPC parks the import (A/B/C); without it, the same dead RPC
  completes in half a second (D). The doctored REAL backup dialed — its account-state slice is
  non-empty (exact counts below).
- **The hanging shape is exactly the audit-corrected shape (a)**: at ~60s the popup→SW
  messaging timeout kills the awaited `accountStateService.restore` RPC → outer catch →
  "Import failed" for an import whose storage restore SUCCEEDED and whose session is open. The
  route never advances; the CI test times out at 90s. (The draft's "90s+ silent Importing…
  park" shape was correctly rejected by the audits — the 60s timer always fires first.)
- **The refused shape is shape (b)**: ~7s to the finished-with-errors screen, which never
  auto-routes — a CI run in this shape parks forever because the test clicks nothing.
- **The stateful Phase-2 stub is now empirically grounded**: answer `aztec_getNodeInfo`,
  blackhole `aztec_getL1ContractAddresses` (the observed boot sequence, `chain-runtime.ts:157`).
- Harness gotcha for the ledger of tricks: vitest's reporter suppressed `console.log` evidence
  on passing tests — evidence MUST be appended to a file by the harness itself (the e2e-testing
  skill's "preserve full logs" lesson, extended).

Real slice content (probe A export, local run):
`networks=[Alpha V5 (4248422646), Testnet (1816023401), Local Network (0)]`,
`accountState=[{Alpha: 0 senders, 6 contracts}, {Testnet: 0 senders, 9 contracts}]` —
**Inference 5 CONFIRMED**: a fresh registered wallet's export carries real registrable work
(the account's own + protocol contracts). CI reconciliation: the EXPORT-side Active-status
filter (`account-state/service.ts:74` area) excludes unreachable networks at export time, so a
CI-exported backup carries ONLY the Testnet item — the import dials only drpc-testnet, whose
evening degradation is precisely the observed red cluster. Locally both public networks ride
(both reachable), which is why probe A dialed regardless of which endpoint degraded.

## Verdict

**PROCEED — the blocking gate PASSES.** The account-state leg is the flake's product root; the
plan's fix design (bounded preflight + per-launch deadline + skip-with-record + Continue gate)
targets exactly the confirmed mechanism. No reassessment needed.
