# Mode 4 — LOCAL repro found during Phase 1 (2026-06-16)

**This is a Phase 4 lead, surfaced early.** `concurrent-sendtx-confirm` reproduces Mode 4
LOCALLY under proverless on the dev Mac — no CI round-trip needed.

## Observed

Running `NULO_E2E_PROVERLESS=1 bun run e2e:agent tests/e2e/network/concurrent-sendtx-confirm.test.ts`:

- T1 settles `ok` (`r1` at `concurrent-sendtx-confirm.test.ts:101`).
- T2 **never settles** — `r2` (`:102`, `waitForPgResult` 300s) **times out** rather than erroring.
- The aztec-node log shows, on T2's simulation:
  `C++ simulation failed: AVM simulation failed: Attempted to emit duplicate siloed [nullifier]`
  (timestamps 08:37:27, 08:42:42 in the run) — the double-spend signature.
- Total run ~949s (300s timeout x retry:2).

## Two leads to triage (Phase 4, with codex)

1. **Stale-state simulation:** the execution mutex may let T2 **simulate against pre-T1 state**
   (e.g. at approval-time fee estimation, before acquiring the mutex / before T1's nullifier
   commits) → duplicate siloed nullifier. If so, this is a **real serialization defect** the test
   correctly catches — fix in execution, NOT the test (do not paper over with a fee bump).
2. **Hang-instead-of-reject:** T2's sim-failure path appears to **hang the dApp promise** rather
   than rejecting it (we got a 300s timeout, not an `error` result). On CI Mode 4 surfaced as
   `expected 'error' to be 'ok'` — possibly the same root with different timing.

## Scope note

The Phase-1 assertion migration is **NOT implicated** — the test reaches `:101-102` (past the
migrated `waitForDappExecuteStagesPresent(["proving","queued"])`, which uses a 30s timeout and
passed). concurrent-sendtx-confirm was already failing on CI before this branch (one of the
broken modes). So:
- Phase 1 (assertion migration for confirm): **validated** — reaches the settle.
- Phase 4 (confirm end-to-end green): blocked on the Mode-4 root cause above.

Use this local repro in Phase 4 instead of waiting on CI.
