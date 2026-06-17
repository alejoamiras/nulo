# Phase 6 — De-flake the revealed retry-masked set

The Phase-2 de-retry exposed the true flaky set. Result: it is much smaller than
feared — the removed `retry:1/2` overrides were over-cautious, not masking real
flakes.

## Evidence
1. **De-retry soak** (27715586770, the 8 de-retried files ×7, retry=0): 6/7 green;
   the 1 red was an INFRA boot failure (sentinel exit 86 + retried, double-boot),
   NOT an app flake. ⇒ the 8 de-retried files have no observed app flake.
2. **C2 (incoming-transfers)** — un-quarantined in Phase 2, fixture fixed in this
   phase (seed the missing `nulo:core:tokens` row so `replayPendingPrompts`
   doesn't skip). CONFIRMED green: the full sharded run 27719222383 (commit
   5f31955, which includes the C2 fix) was 7/8 jobs green and incoming-transfers
   ran on a GREEN shard (shard 1 — the only red — contained cancel-mid-prove,
   authwit-lifecycle, tx-sendTx-multicall, NOT incoming-transfers).
3. **Full sharded strict run** (27719222383, retry=0): heavy/fee-methods ✓,
   heavy/concurrent-confirm ✓, canary/real-proving ✓, shards 2/3/4/5 ✓ — only
   shard 1 red, and its sole failure was **authwit-lifecycle** (F1,
   `1 failed | 11 passed`). So the ENTIRE suite is green at retry=0 EXCEPT F1,
   which the Phase-4 PXE-barrier fix (ed5b49a) targets.

## `grep -rnE "retry:\s*[12]" tests/e2e/network` → empty (verified Phase 2).

## Remaining for Phase 6 done
- F1 (authwit-lifecycle) stable: Phase-4 re-soak 27719585565 (10/10, with the PXE
  barrier) — IN PROGRESS.
- One full sharded strict run all-green on the barrier commit (ed5b49a) — pending
  the re-soak confirmation.

LESSONS_FILE=implementations-plan/network-e2e-required/lessons/phase-6.md
