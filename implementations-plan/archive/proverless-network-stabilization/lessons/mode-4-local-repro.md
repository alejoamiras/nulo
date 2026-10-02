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

## Refined root-cause hypothesis (from reading the execution code, 2026-06-16)

The per-(profileId,chainId) FIFO execution mutex (`execution-lane.ts`, `execution-mutex.ts`)
serializes "build → simulate → prove → **submit**" (execution-lane.ts:62-65). But
`dapp-send-executor` releases the slot after `coordinator.proveAndSend(...)` returns a `txHash` —
i.e. after **submit (broadcast)**, NOT after the tx is **mined**. So when T1 releases, T2 acquires
the mutex and simulates while T1 is *submitted-but-not-yet-mined*. If T1 and T2 spend the same
public/private note, T2's simulate does not observe T1's nullifier → produces a colliding one →
`Attempted to emit duplicate siloed nullifier` when it lands.

This is a **submit-vs-mine serialization gap**. Likely **proverless-exposed**: under real proving
(minutes) T1 is usually mined before T2 simulates, masking it; under proverless (sub-second) the
window is wide open. Open questions for Phase 4 (codex — Aztec PXE specifics):
- Does the PXE track T1's submitted-but-unmined nullifiers as *pending* during T2's simulate? If
  not, that's the gap. If yes, why didn't T2 see it (PXE sync timing between the two sends)?
- Fix space: (a) hold the mutex until T1 is MINED (kills concurrency — probably too costly); (b)
  make T2's simulate account for pending submitted txs; (c) TEST-side: this may be an inherent
  property — concurrent same-note sends CAN'T both succeed without waiting for mine, so the test
  should either await T1's mine before approving T2, or use distinct notes/recipients per tx.
- DECIDE test-fix vs execution-fix with codex BEFORE changing production execution code.

## Scope note

The Phase-1 assertion migration is **NOT implicated** — the test reaches `:101-102` (past the
migrated `waitForDappExecuteStagesPresent(["proving","queued"])`, which uses a 30s timeout and
passed). concurrent-sendtx-confirm was already failing on CI before this branch (one of the
broken modes). So:
- Phase 1 (assertion migration for confirm): **validated** — reaches the settle.
- Phase 4 (confirm end-to-end green): blocked on the Mode-4 root cause above.

Use this local repro in Phase 4 instead of waiting on CI.
