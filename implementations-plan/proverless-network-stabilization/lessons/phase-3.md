# Phase 3 — baseline real-runner observation (run 27635146678, Phase 0-2 on CI)

Dispatched `pr-network-e2e.yml` on the branch (full matrix) to observe Mode 2/3/4 WITH my Phase 0-2
changes, before applying any Class-B fix (observe-first).

## THE WIN: Class-A fix validated on a real CI runner

- **shard 4/5: SUCCESS** — it carried the Mode-1 `expected 0 to be >= 2` failure in the original
  run (27570686950). Now green. The journal-truth migration (Phase 1) fixes the Mode-1 family
  end-to-end on a real runner. fee-methods + canary (real-proving) also green.

## Remaining failures (multiple distinct modes — the instrument earned its keep)

- **shard 1 — Mode 2 (CDP freeze).** `authwit-lifecycle`, `register-token`:
  `Caused by: ProtocolError: Runtime.callFunctionOn timed out` + `waitForHashGeneral 30000ms`.
  The browser/CDP is unresponsive (resource starvation). protocolTimeout already 300s. Phase 3 target.
- **shard 3 — Mode 3 (settle timeout).** `authwit-consume-smoke:75,103`: `waitForPgResult` 120/240s.
  The dApp promise never settles in budget. Phase 4.
- **shard 5 — NEW, revealed by journal-diag.** `multi-account-from:86` `waitForDappExecuteWorked`
  timed out, and the journal-diag printed the record **stuck at `queued`** on ALL 3 retry attempts
  (3 distinct sessionIds). So the tx's execution NEVER STARTS after approval (queued→pending claim
  doesn't happen) under CI load — it is NOT a helper race (the old DOM helper would have failed the
  same way). This was MASKED before (the old race-y helper). A real execution-start / approval-handoff
  stall under CI pressure. Mode-3-like. **The instrument (Phase 2) made this precisely visible.**
- **concurrent-confirm — Mode 4 (architectural).** `waitForPgResult` 300s. codex confirmed: the
  execution mutex releases at SUBMIT, not MINE; the PXE's pending-nullifier cache is per-execution,
  so T2 can't see T1's submitted-but-unmined spend → `duplicate siloed nullifier`. A REAL production
  race (documented precedent in auth-registry/service.ts), masked by real proving-time. See
  mode-4-local-repro.md + the codex verdict.

## Codex Mode-4 verdict (session 019ed174)

1. Hypothesis confirmed (submit-vs-mine; PXE pending-cache is per-execution).
2. Real production race, not a proverless artifact. Same SPEND SOURCE is the issue (not recipient).
3. **Fix test-side** — the test asserts a stronger contract than the architecture provides.
4. Execution-side fix is high-risk/architectural (pending-aware simulate = upstream PXE work;
   hold-until-mine regresses concurrency) — "product/design work, not a patch."

## Assessment (why this is an inflection)

Phase 1 (the core flakiness root) is DONE + validated on CI. The remaining modes are MULTIPLE,
DEEP, and decision-laden:
- **Mode 4** is architectural — the clean test-fix (distinct spend sources) is BLOCKED by the
  playground only sending from `selectedAccount` (same limitation multi-account-from hit). Viable
  test-fixes (re-scope to the valid mutex-ordering assertion; or sequential await-mine) change the
  test's identity → a design call.
- **Mode 2** (CDP freeze) may be irreducible on the standard runner → could need larger GitHub
  runners (a cost/infra decision) if load-reduction + watchdog don't suffice.
- **shard-5 queued-stall** is a newly-surfaced execution-start issue needing its own investigation.

"Zero flakiness → make required" requires ALL of these resolved — a substantial, multi-round,
decision-laden effort beyond the core Class-A fix already delivered.
