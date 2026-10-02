# Phase 3 — Q5 proveAndSend (the keystone)

## Landed
- `ExecutionCoordinator.proveAndSend(ctx)` — the docblock's promise made real. Owns the frozen success sequence: checkCancelled → journal(proving) → prove → checkCancelled → [offchain hook] → toTx → journal(submitting) → checkCancelled → send → record → journal(succeeded). All four send paths converted; per-path variation is ctx DATA (scopes / journal closure / record closure / optional `wantOffchainOutput` between prove and toTx per CC5).
- Failure shaping + slot/claim handling stayed caller-side (R1-fable M2): transfer's `maybeRethrowAsRpcCancel` vs the sentinel-rethrow paths preserved verbatim; receipt shaping (2 of 4 paths) caller-side.
- `execution-coordinator.test.ts` (6): frozen 10-step ordering, scopes-passthrough identity, offchain-hook position + payload, cancel-before-send → zero broadcast, cancel-before-broadcast variant, send-failure propagation.
- Named pin `no-slot-for-executeSendTransaction` (R1-M2) + exact-scopes assertion `[account.address]` (R1-H1) in service.characterization.test.ts.

## Gates
- lint 0 errors · typecheck clean · unit 2,295 at commit.
- Codex parity (combined with P2): **confirmed** — all four tails verified through the helper with order/args/strings intact.
- e2e: cumulative P3+P4+P5 run, idle machine, purged state: **67/69 pass + 2 skip, ZERO failures** (incl. cancel-mid-prove, concurrent-sendtx, concurrent-sendtx-confirm, fee-methods, transfers, all tx-sendTx variants).

## Deviation
- NO_FROM's three-site scope assertion (discovery additionalScopes / sim scopesWithAccount / prove scopesWithAccount) deferred to P6's dapp-send-executor tests where the fixture cost amortizes; the prove-site scope is already pinned via the coordinator passthrough test + parity review verified the sim sites.

LESSONS_FILE=implementations-plan/execution-decomposition/lessons/phase-3.md
