# Opus post-impl review

**Date:** 2026-05-22
**Subagent:** general-purpose with model=opus
**Commit reviewed:** 3ce7f58
**Verdict:** **needs-work**

> *Independent second-opinion review explicitly asked to disagree with the planned design. Found 7 numbered findings; 2 are must-fix, 4 are cosmetic/defensive, 1 is architectural follow-up.*

## Correctness verification (positive)

- **Bug fix works.** Traced T1+T2 through `onWalletMessage → tryCreateQueuedJournal → handler chain → claim helper → onTxRequestFinalized`. T2's queued card appears immediately; T2's popup opens once T1's `buildAndEstimateTxRequest` finishes (not after T1's full confirm).
- **Claim-vs-cancel race is handled.** Journal mutex serializes the transitions. Even in the loser-cancel-wins-lock-second case, `markJournal("simulating")` fails silently and the next `checkCancelled()` line catches the abort. No path where a user-cancelled tx still executes.
- **`JobCancelledSentinel → 4001` catch chain confirmed.** Sentinel from claim helper → `executeAztecSendTx` catch → `executeOperations` per-op catch → `classifyOperationCatch` → `OperationResult.status === "cancelled"` → `unwrapOperationResult` throws `JobCancelledError` → `toWalletResponseError` produces 4001. Clean.

## Findings

### F1 — Per-session cap is bypassable under bursts (medium, design tradeoff)

Same as codex F1. `countOperations` and `createOperation` aren't atomic; concurrent arrivals all see the same count, all create records.

Codex round-6 accepted this as a "soft cap" tradeoff. The doc/commit language overstates the protection.

**Fix:** atomic count-then-create (either per-session lock or downgrade doc claims).

### F2 — Cancel-after-claim-mid-handler still has theoretical window (low, defense-in-depth)

After `claimOrCreateDappExecuteJournal` returns, `executeAztecSendTx` does several awaits BEFORE the first `checkCancelled()`:
- `planner.processAztecJsPayload`
- (conditionally) `authwit.discoverPrivateAuthwits`
- `markJournal("simulating")`

A user-cancel landing during these awaits won't be observed until the next `checkCancelled()`. Side effects (PXE state writes, simulation network traffic) execute anyway. Not a correctness issue — the tx itself won't be submitted — but observability degrades ("cancelled" record but wallet did extra work).

**Fix:** add a `checkCancelled()` immediately after `claimOrCreateDappExecuteJournal` returns, before `planner.processAztecJsPayload`. Same for `executeNoFromSendTx`.

### F3 — Documentation drift: hook persistence storage backend (cosmetic, misleading)

Plan + commit message describe hook persistence as "via storage on the DappInteraction record" — actual implementation is an in-memory `Map<string, DappInteraction>` (`dapp-interaction/service.ts:52`), NOT chrome.storage.

If the SW restarts between popup-open and approveInteraction, the queued journal record persists at "queued" but the hook plumbing dies. Reaper sweeps the journal record after 10 min. Hooks die silently. Acceptable but worth documenting honestly.

### F4 — Test coverage gap (medium)

Implemented: journal mutex/queued stage tests + FSM queued-edge tests. Solid.
Missing (from plan):
- `background.ts` unit tests — cap logic, `tryCreateQueuedJournal` pre-auth gates, FIFO baton mechanics, `handleWalletMessage` catch block. **Untested.**
- Claim helper unit tests — the 4-path decision tree. **Untested.**
- Dispatcher batch-no-forward-hooks invariant. **Untested.**
- E2E concurrent-sendtx. **Untested.**

The mutex's foundational invariant is well-tested. The cap, FIFO, and claim-helper logic — which contain the BULK of the new code — are untested except through existing e2e suites that might exercise them incidentally.

### F5 — `cancelJob` race with claim's controller registration (verified safe, fragile)

Microtask ordering works out because cancel's `_transitionLocked` body has its own awaits which yield before `controller.abort()`. **Correctness-by-microtask-interleaving** — fragile against future refactors of `_transitionLocked` (removing an await flips the ordering).

**Fix:** defensive comment AT the `activeControllers.set` call site explaining the cancel-side invariant.

The current comment explains the "no await" claim, but the *real* safety comes from the cancel side having its own internal awaits — that side of the invariant is undocumented.

### F6 — Reaper error kind drift (cosmetic)

Plan §14 said queued-stage reaping uses `kind: "stuck_proving"` (or `"stuck_queued"`). Implementation falls into catch-all `else` and uses `"stale_on_resume"` (`reaper.ts:188`). Documentation/observability drift.

### F7 — Silent path queued visibility (minor UX)

`silentInteraction` forwards hooks. Good. But silent sendTx never opens a popup; the queued card shows "Queued..." for a transaction the user can't see / interact with. Minor UX concern — they might wonder what's blocking.

## Architectural notes

- **Queued FSM stage is load-bearing but conceptually thin.** An alternative model (separate `intent: "received" | "active"` flag) could keep FSM at 7 stages. Pragmatic choice; acceptable.
- **Global journal mutex is broad.** For current load (handfuls of concurrent records), fine. Future scaling → per-record locks would be better.
- **Hook plumbing as 4th `executeOperations` arg + 3rd `execute` arg + structural `IExecutionRunner` interface** is a smell. `parentTaskOrHooks?: unknown` in `IExecutionRunner.executeOperations` (`services-contract.ts:57`) accepts `unknown` because the interface can't express "either a WrappedTask OR a hooks bag in that slot". Consider options-bag refactor in follow-up.

## Bottom line

> *"The fix's correctness foundation is solid (journal mutex closes the storage-layer race, FSM is well-defined, claim helper handles the cancel pipeline correctly). The architectural choices are pragmatic. The seven-round codex cycle caught real bugs."*
>
> *"But the missing unit tests for the new background.ts logic and the claim helper, combined with the documented-but-undocumented bypassability of the per-session cap under bursts, mean this PR should land with at least:*
> *1. Unit tests for `tryCreateQueuedJournal` (caps, pre-auth gates, error path).*
> *2. Unit tests for `claimOrCreateDappExecuteJournal` (the four documented paths).*
> *3. A defensive `checkCancelled()` call after the claim helper returns in both `executeAztecSendTx` and `executeNoFromSendTx`.*
> *4. Plan to either harden the cap (atomic count-then-create) or relax the doc claims to match the soft-cap reality."*

Remaining items (e2e test, microtask ordering doc comment, reaper kind alignment) are good follow-ups but not blockers.
