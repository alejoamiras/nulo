# Codex review — round 5 (BLOCKER)

**Date:** 2026-05-22
**Effort:** xhigh, read-only
**Session:** 019e5131-4407-73b1-9c2c-e80d3e260142

**Verdict: BLOCKER.** Two design issues (journal-layer race, executeOperations signature collision) + plan-drift cleanup needed.

## Findings

### F1 — F3 race from R4 is NOT actually closed (the killer)

**My v5 thought:** moving `activeControllers.set()` right after the `transitionOperation queued→pending` resolves closes the cancel race.

**Codex correction:** the microtask-continuation reasoning is correct (no JS-level interleaving between resolve and the next sync line), but that's not the real race. `OperationJournalService.transitionOperation()` (service.ts:169) is just load → validate → write with NO mutex/CAS. So `claim(queued→pending)` and `cancelJob(queued|pending→cancelled)` can race INSIDE the journal transition itself:

1. claim reads record (stage=queued)
2. cancel reads record (stage=queued)
3. claim validates: queued→pending ✓
4. cancel validates: queued→cancelled ✓
5. claim writes record (stage=pending)
6. cancel writes record (stage=cancelled)

Last write wins. The AbortController is registered after step 5 but the record state is now `cancelled` (from step 6). Or vice versa. **Per-record correctness requires a journal-layer mutex.**

This race exists today for ANY concurrent transitions on the same record, not just our new flow. It just hasn't been triggered because today's flow has natural serialization (single FIFO handler per record).

### F2 — Plan has accumulated stale references across 5 revisions

- A1 still passes `accountService`, omits `networkService`. v5 helper body uses `networkSvc.getNetworks(chainId)`.
- B4 still shows pre-v5 broken shape (`dappSession.accounts[0].address`, `networkId: String(chainId)`). B9 corrects it. Inconsistent.
- Tests #6, #7, #8 reference `queuedClaimed.value` and the claim-fallback model (R3 removed).
- Reaper section still says ">2 min → cancelled". R3 changed to "10 min → failed/stuck_queued".
- The "4001 message" mentioned `"user_rejected"`; actual `JobCancelledError` default is `"Transaction cancelled by user"`.

### F3 — `executeOperations` signature collision

The plan's hook plumbing repurposes the third parameter slot of `executeOperations()`. But that slot is already `parentTask?: WrappedTask` (service.ts:865). Need to use a fourth arg or an options bag.

## Direct answers (from codex)

**Q1 (microtask race):** correct narrowly — no JS interleaving between resolve and next sync line. But the REAL race is inside the journal transition itself, not at the JS event loop. Fix the journal.

**Q2 (cancelled pipeline reuse):** valid. `executeOperations` catches `JobCancelledSentinel`, routes through `classifyOperationCatch` → `OperationResult.status === "cancelled"` (service.ts:865 + rpc-cancel.ts:64). wallet-bridge unwraps to `JobCancelledError` (dispatcher.ts:91). background.ts maps to 4001 via `error-envelope.ts:21`. **Works even when thrown before `markJournal("simulating")`.**

**Q3 (imports):** `parseCaipAccount` at `@/wallet/utils/caip:49`, `networkService.getNetworks(chainId)` at `network/service.ts:191`. Scope is fine; just pass `networkService` in (drop `accountService`).

**Q4 (zod schema):** `z.discriminatedUnion("stage", [z.object({stage: z.literal("queued")}), z.object({stage: z.literal("pending")})])` — correct.

**Q5 (network lookup `[0]`):** correct semantically. Model enforces one Network per `(profileId, chainId)`; duplicates rejected at network/service.ts:246. CAIP helper docs first-row as unambiguous at caip.ts:74. **Use `resolveNetworkByChainId()` instead of open-coding `[0]`.**

**Q6 (batch test #10):** insufficient alone. Must assert both "no queued record" AND "inner sendTx still runs through normal path".

**Q7 (test #15):** not the right proof. It tests post-`await` microtask gap, which isn't the real race. Real race is inside `transitionOperation`. Needs a deterministic service-level concurrency test after serialization is added, or an integration test with a barrier.

**Extra:** don't map a journal storage-write failure to `JobCancelledSentinel`. That's not a user cancel; surfacing it as 4001 destroys observability. Use a distinct error path for true storage failures (e.g., re-throw the original error → executeOperations classifies as failed → dApp sees structured error, not 4001).

## What plan v6 needs

1. **New section: journal-layer per-record mutex** (or global mutex on transitionOperation). Resolves F1.
2. **Clean rewrite of A1 + B4 + B9** as a single coherent flow. Eliminate the patchwork.
3. **executeOperations signature uses options bag** or fourth arg.
4. **Tests rewritten** to reflect current architecture (drop queuedClaimed references, fix reaper test, separate cancel-race test).
5. **`use resolveNetworkByChainId`** instead of `getNetworks(chainId)[0]`.
6. **Distinguish journal-storage failures** from cancellation in claim helper.
