# Phase 2 lessons — the bounded chain-registration tail

## What landed (commit `145c1e7`)

Per plan.md Architecture: `probeChainId` (single-attempt, fetch-boundary abort) through
port+adapter+fake; `NetworkService.probeNodeStatus` RPC (spec+service+client);
`normalizeAccountStateSlice` shared trust boundary (caps/merge/violations);
`AccountStateService.restore` with per-launch deadline (clamped 0…30_000) + connectivity
fail-fast; `preflightNetworkConnectivity` (5s×3, backoff [2s,4s], semaphore, Active-only GO,
InvalidChain=wrong-network); `runImportChainSync` orchestrator (45s shared deadline, settled
guard); `collectRestoreErrors` top-level check (the vanishing-record fix); Continue/View-Errors
testids (both shells); smoke roundtrip errors-screen causal branch on the single
`submittedAt + 90_000` deadline; `import-dead-rpc.test.ts` (refused/blackhole/stateful).

## Gotchas worth keeping

1. **Virtual-clock race unfairness**: an injected `sleep` that resolves on the next microtask
   loses fairness against instant probes in `Promise.race` — the timeout branch settles first
   and every test sees "unreachable". Vitest fake timers (patching BOTH `Date.now` and
   `setTimeout`) are the honest tool; keep injected clocks for pure loops only.
2. **The aztec JSON-RPC client BATCHES**: request bodies arrive as ARRAYS of envelopes. A stub
   that reads `parsed.method` logs `<no-method>` and never matches its answer table — parse
   element-wise, answer batch-in/batch-out, and blackhole the whole batch if any element is
   unanswerable. (Phase-1's harness had this; the rewrite dropped it — cost one red run.)
3. **Error precedence is contract**: moving the contract-address parse ahead of the
   `Network not found` check flipped a pinned error message. Keep network-first precedence
   when touching the restore loops.
4. **Zero-work items no longer dial**: fixtures that used empty-children account-state items
   as remap observables stopped observing anything — remap pins now need ≥1 registrable child
   (`AS_SENDER`), and the spec mock needs `NodeStatus`.
5. **Full-log discipline (again)**: a background `| tail` pipe clipped the one failing file's
   name; the e2e-testing skill's tee-to-file rule applies to UNIT runs too.

## Gate evidence (2026-08-12)

- `bun run test`: 3991 passed / 2 skipped / 7 todo, exit 0 (full log:
  session scratchpad `unit-full.log`).
- `bun run lint` + `bun run typecheck`: exit 0 (formatted; two stale suppressions removed from
  `network/service.test.ts`).
- Armed CI-parity build: exit 0.
- `import-dead-rpc.test.ts` SOLO: 3/3 attempt-1, retry:0 per test — refused ≈7s to the errors
  screen, blackhole bounded by the aborted preflight, stateful proves the registration
  deadline with the observed `aztec_getNodeInfo → aztec_getL1ContractAddresses` sequence.
- `backup-roundtrip.test.ts` SOLO: 1/1 attempt-1 on the fixed build (90s bound byte-identical).
- FULL armed smoke suite SOLO (CI-faithful: runtime `NULO_E2E_MIGRATION_FIXTURE=1` set — the
  first run red was the ARMING-CONTRACT GUARD firing on a missing runtime flag, working as
  designed, not a fix regression): **24 passed / 1 designed skip (25 files), 82 tests, exit 0,
  zero vitest retries** (`e2e-smoke-full-run2.log`).
