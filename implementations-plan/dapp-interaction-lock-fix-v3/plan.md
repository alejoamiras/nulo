# dapp-interaction-lock-fix-v3 — parallel popups UX refactor (plan v2)

Layer B of the v2 plan, deferred from PR #68. Delivers: popup #2 opens **immediately after popup #1's approval**; T1 runs its full lifecycle while T2 sits "Queued"; then T2 takes its turn.

Branch: `fix/dapp-interaction-lock-scope-v3` off `dev` at `eb81950`.

**Revised after dual audit** (codex `audit-codex.md` + opus `audit-opus.md`). Both verdicted needs-revision. Two findings reframed the plan; folded in below.

## Target UX (acceptance invariants)

```
T1 sendTX → popup 1 opens
T2 sendTx  (fired while popup 1 open)
User Approves popup 1
   → popup 2 appears RIGHT AWAY                              [I1]
   → T1 activity card appears, subtitle "Estimating fee…"    [I2]
User Approves popup 2
   → T2 activity card appears as "Queued"                    [I4]
T1 estimates → simulates → proves → submits → succeeds       [I5]
   → T2 leaves "Queued", starts its own path                 [I6]
T2 proves → submits → succeeds                               [I7]
both dApp promises settle correctly; cancel yields 4001      [I8]
```

## Two findings that reframed the plan

### Finding A — the early baton release is DEAD in production (latent bug from PR #53)

Opus found, main agent verified against all four files:

- `background.ts:222-225` passes `{ releaseFifo, queuedJournalId }` into `handleWalletMessage`.
- `handleWalletMessage` forwards that object **unchanged** to `dispatch` as `hooks` (`background.ts:539`).
- `DispatchHooks` (`dispatcher.ts:90-97`) declares **`onTxRequestFinalized`**, NOT `releaseFifo`.
- `handleSendTx` reads `hooks.onTxRequestFinalized` (`dispatcher.ts:426`) → **`undefined`** → the explicit release at `execution/service.ts:1783` is a **no-op**.
- `queuedJournalId` maps fine (present on both shapes) — which is why queued visibility / v1 / v2 all work. Only the release hook is dead.

**Consequence:** the baton releases ONLY via the safety-net `.finally(releaseFifo)` at **handler completion**. Concurrent sendTx is currently serialized **end-to-end** — T2's handler (including its popup) does not start until T1 fully proves + submits + finalizes. **This dead hook IS the user's complaint** ("popup 2 waits for popup 1"). v3 is partly a bug-fix, not just a refactor.

### Finding B — moving the baton makes the exec-mutex CORRECTNESS-CRITICAL, not UX-only

Plan v1 claimed the mutex was "UX-sequencing only; correctness pre-exists via random nonce + chainGuard." **Codex falsified this (P0/P1):**

- **Nonce timing (P0):** the random nonce is created *inside* `buildStandard` and sealed only at `buildTxExecutionRequest` (`tx-request-builder.ts:126,353`) — **after** the proposed approval-release point. And `executeNoFromSendTx` (NO_FROM / default-entrypoint path) **has no nonce at all** (`Fr.ZERO`, `service.ts:1968`). PR #53's "nonce sealed before release" model does NOT transfer to v3.
- **Stale private-note interleaving (P1):** with the baton released at approval and no exec-mutex, T1 and T2 both enter execution. `withPxeWrite` serializes each PXE *call*, not the lifecycle (`pxe/service.ts:425`). T1 can `simulateTx` (selecting private notes / private-FPC state), drop the chainGuard, then T2 `simulateTx` against the **same note snapshot** before T1 proves → T2 builds a tx rejected on-chain (double-spent nullifier). The repo already treats note-selection drift as correctness-sensitive (`execution/service.ts:665`, `transaction/service.ts:96`).

**Corrected framing:**

| State | Behavior |
|---|---|
| Today (dead hook) | Execution serialized end-to-end. Correct; slow UX. |
| Naive v3 (move baton, no mutex) | Popup concurrency ✓; execution concurrency → T2 rejected on stale notes. **Broken.** |
| Correct v3 (move baton + exec-mutex before build, held through submit) | Popup concurrency ✓ + execution serialized ✓. |

**The exec-mutex restores the serialization that moving the baton breaks. It is correctness-critical.** This raises its test bar (correctness, not just UX) and makes the cancel/abort correctness load-bearing.

## Design decisions (revised)

### D0 (NEW, prerequisite) — fix the dead hook + pin it

Before anything else: correct the wiring so the FIFO release is actually reachable through `dispatch`, and add an **integration test** driving the real `onWalletMessage → handleWalletMessage → dispatch → executeAztecSendTx` chain that asserts the baton releases at the intended point. This is the test class that would have caught Finding A in #53 (the existing `session-baton.test.ts` tests the primitive with manual calls; the dispatcher test uses the correct-but-unwired field name — neither catches the production mismatch).

Implementation: rather than patch the `releaseFifo`→`onTxRequestFinalized` name gap, v3 replaces it with the new approval-seam hook (D1) wired correctly end-to-end, and deletes the dead `onTxRequestFinalized` path (or keeps it as a verified observability hook only if a test exercises it).

### D1 — baton release moves to the approval seam (corrected firing points)

Move FIFO release from (dead) post-build to **post-approval**. Codex corrected the seam: `interaction()` does NOT resolve on approval — it resolves when `executeAndResolve` settles the window handle (`spec.ts:46`, `dapp-interaction/service.ts:124`, `window-manager.ts:51`). So the hook canNOT fire "after `interaction()` resolves." Exact seams:

- **Popup path:** fire from `approveInteraction()` just before `executeAndResolve` (`dapp-interaction/service.ts:88`).
- **Silent path:** fire from `silentInteraction()` immediately before `executeOperations()` (`dapp-interaction/service.ts:295/305`, after the queued→pending fast-forward).
- **Keep the safety-net** `.finally(releaseFifo)` as the backstop for any path that throws before the explicit release.

New hook surface: `DispatchHooks.onInteractionApproved?: () => void` (or reuse a correctly-wired single release hook). `background.ts` subscribes `releaseFifo` to it.

### D2 — `ExecutionMutex` primitive (NOT the repo `Lock`)

Repo `Lock` force-releases after 5 min → would drop T1 mid-prove. New `packages/extension/src/wallet/services/execution/execution-mutex.ts`:
- FIFO per key; NO timeout / NO force-release; abortable `acquire(key, signal?)`; release-once via `try/finally`; per-key isolation.
- Key `(profileId, chainId)` — matches `chainGuard` (`getChainGuard`, `pxe/service.ts:105`). Per-account would under-serialize (two accounts on one chain share the PXE runtime + chainGuard).

### D3 — mutex wraps from BEFORE authwit discovery through submit, both paths

Codex #1/#3: authwit discovery runs `buildStandard` + `simulateTx` BEFORE `buildAndEstimateTxRequest` (`service.ts:1753`, `authwit-discoverer.ts:71`). The mutex must be acquired at the **top of the per-op execution** (`service.ts:1695` standard, `:1831` NO_FROM), before authwit/build/any PXE execution work, and held through submit. Applies to **both** `executeAztecSendTx` and `executeNoFromSendTx` (the NO_FROM path has no nonce, so it relies entirely on the mutex).

### D4 — T2 stays `queued` while waiting; claim moves AFTER acquire

Reaper sweeps `pending` aggressively (`reaper.ts`). T2 must stay `queued` during the wait. The claim-helper transition (queued → pending) moves to **after** `executionMutex.acquire()` succeeds.

### D5 — cancel-while-waiting needs a PRE-ACQUIRE waiter-abort registry

Both audits, P1. Today `cancelJob` flips journal → cancelled, then aborts a controller from `activeControllers` — but those controllers are registered only **after** claim (`claim-helper.ts:129/141`). With claim now after acquire, a waiting T2 has **no controller** → cancel can't wake `mutex.acquire(signal)` → delayed cancel (T2's promise doesn't reject until T1 finishes).

Fix: register a pre-acquire AbortController keyed by `queuedJournalId` **before** `mutex.acquire`; thread its signal in; claim-helper **reuses** it instead of `new AbortController()`. Chain: abort → `AbortError` from acquire → `{status:"cancelled"}` → `JobCancelledError` → SDK 4001 (`rpc-cancel.ts:47`, `dispatcher.ts:117`, `error-envelope.ts:22`). Lock order: acquire = exec-mutex → journal; cancel = journal → waiter-abort. No deadlock (verified by both).

**Edge (final codex pass):** the claim-helper retains a `record-not-found → createFreshRecord()` fallback (`claim-helper.ts:80`). If that path fires, the pre-registered controller keyed by `queuedJournalId` is orphaned (the fresh record has a different id). Migrate the controller entry to the fresh id, or delete it, on that branch — else the key leaks and the fresh id has no waiter controller. Edge cleanup, not a broader refactor. (`queuedJournalId` === the claimed record id on the normal path, so `cancelJob(id)` finds the same controller — confirmed.)

### D6 — reaper: heartbeat `updatedAt` while waiting (boot sweep stays unconditional)

Refines the user's "no tx > 10 min" (true per-tx, but the Nth concurrent tx waits (N-1)×per-tx queued; with the 8/session cap that can exceed 10 min). A record actively waiting in a live mutex queue is NOT stuck. Heartbeat its `updatedAt` on an interval while waiting (reaper keys on `updatedAt`, `reaper.ts:72`); churn is bounded by the caps and stops automatically on SW death. Codex prefers this over a persisted `reaperExempt` flag (flag complicates restart semantics).

**Stage-agnostic heartbeat (final codex pass) — important:** the heartbeat must cover any record with a **live mutex waiter, regardless of stage**, NOT just `queued`. The silent path fast-forwards queued→pending **before** `executeOperations` (`dapp-interaction/service.ts:295`, the v2 Layer A behavior), so a silent T2 waits on the mutex while in `pending` — and the `pending` reaper window is 2 min. If the heartbeat only refreshed `queued` records, silent waiters would false-reap at 2 min. Implementation: the `ExecutionMutex` owns the set of waiting job-ids; the heartbeat iterates that set and refreshes each, independent of journal stage. (Alternative considered: move the silent fast-forward to after `mutex.acquire` so silent waiters also stay `queued` — mirrors D4 for the popup path. The stage-agnostic heartbeat is the lower-touch choice; implementation may pick either, but the waiter-set-driven heartbeat is preferred because it doesn't perturb the v2 silent-path ordering.)

**Critical:** the boot sweep (`reaper.ts:121/168`, unconditional) stays unconditional — on SW restart it **fails** every non-terminal record (T1 → `sw_restart_post_prove`, T2 → `stuck_queued`). Neither resumes. That is the correct outcome (the SW that held the dApp connection died). The heartbeat only affects the periodic grace-window path within one SW lifetime.

### D7 — sequential execution (user confirmed)

Full-lifecycle mutex (T2 waits until T1 fully completes). The chainGuard prevents parallel proving anyway; sequential is the natural + lighter-CPU model.

## Phases

### Phase 0 — fix dead hook + integration test (D0)
Correct the release wiring end-to-end; add the `onWalletMessage → dispatch → executeAztecSendTx` integration test asserting the real release point. Land this first — it stabilizes the baseline every later phase reasons about.

### Phase 1 — baton release at approval seam (D1)
`onInteractionApproved` hook fired from `approveInteraction` (popup) + `silentInteraction` (silent); `background.ts` subscribes releaseFifo; keep safety-net. Tests: fires-on-approve-not-reject (popup), fires-before-executeOperations (silent), propagation.

### Phase 2 — ExecutionMutex (D2/D3/D4)
New primitive + exhaustive unit tests (FIFO, abort-while-waiting, no-force-release, release-once, per-key isolation). Wrap both `executeAztecSendTx` + `executeNoFromSendTx` from before authwit discovery through submit. Move claim-helper transition inside the mutex (after acquire). Thread AbortSignal.

### Phase 3 — cancel (D5) + reaper heartbeat (D6)
Pre-acquire waiter-abort registry; claim-helper reuses the controller. Cancel-while-waiting unit test (4001 preserved). Heartbeat waiting records; boot-sweep-stays-unconditional test. Lock-order + mutex-contract JSDoc on ExecutionService.

### Phase 4 — E2E
- **E1 popup-boundary** (standard SHA-1 matrix): approve popup 1 → assert popup 2 opens ≤1.5s → reject both (cheap, no prove). Pins I1.
- **E2 full-confirm** (network-e2e-heavy job): approve both → T1 succeeds then T2 succeeds → both promises resolve. **Routed to heavy from the start** — both the fee-methods precedent and codex say sequential prove×2 won't fit a standard shard. (Note: user preferred standard matrix; flagging the deviation for E2 specifically.)

### Phase 5 — manual QA build
Bump `0.23.0-qa.v3.1` (minor — UX change). Build + zip; user verifies the stated flow.

## Files (estimated ~600-800 LOC + tests)

```
packages/wallet-bridge/src/dispatcher.ts                              fix release hook wiring + onInteractionApproved
packages/wallet-bridge/src/dispatcher.test.ts                         propagation, real-field test
packages/extension/src/wallet/services/dapp-interaction/service.ts    fire approval hook at approveInteraction + silentInteraction
packages/extension/src/wallet/services/dapp-interaction/service.test.ts  approve-not-reject, silent-before-exec
packages/extension/src/wallet/services/wallet-sdk/background.ts       subscribe + integration test wiring
packages/extension/src/wallet/services/wallet-sdk/background.test.ts  Phase-0 integration test (real chain)
packages/extension/src/wallet/services/execution/execution-mutex.ts       (new)
packages/extension/src/wallet/services/execution/execution-mutex.test.ts  (new)
packages/extension/src/wallet/services/execution/service.ts           wrap both send paths; thread signal
packages/extension/src/wallet/services/execution/claim-helper.ts      transition after acquire; reuse pre-acquire controller
packages/extension/src/wallet/services/operation-journal/reaper.ts    heartbeat waiting records (periodic path only)
packages/extension/tests/e2e/network/concurrent-sendtx-approve.test.ts    (new) E1 standard matrix
packages/extension/tests/e2e/network/concurrent-sendtx-confirm.test.ts    (new) E2 heavy job
.github/workflows/pr-network-e2e.yml                                  add E2 to network-e2e-heavy
```

## Security & Adversarial Considerations

- **Exec-mutex is correctness-critical** (revised): it restores serialization that moving the baton breaks. Stale private-note selection + NO_FROM-no-nonce mean naive concurrency rejects T2 on-chain. Mutex must wrap from before authwit through submit, both paths.
- **Cancel race** (D5): pre-acquire waiter-abort registry; lock order exec→journal / cancel journal→waiter-abort; no deadlock (both audits verified).
- **SW restart** (D6): boot sweep fails both records; no resumption; correct. In-memory mutex GC'd with dead SW.
- **Mutex starvation** (T1 hangs): heartbeat keeps a legitimately-waiting T2 from false-reap within one SW lifetime; SW-restart boot-sweep recovers otherwise.
- **Silent-path release** (D1): fires before executeOperations; safety-net is the backstop; a silent T1 cannot permanently block T2.
- **dApp adversarial burst**: 8/session + 32/global caps survive; with parallel popups up to 8 could open — verify memory + caps still gate.
- **Lock ordering** exec-mutex → chainGuard, documented; no reverse path (both verified, `pxe/service.ts:425` never calls back into execute).
- **No new crypto / supply chain** — pure service layer.

Post-impl audit ask (codex + opus): *"Does the exec-mutex actually close the stale-private-note interleaving for BOTH standard and NO_FROM? Is the pre-acquire waiter-abort registry race-free against the journal mutex? Does the heartbeat stop correctly on SW death? Does the silent path release the baton on every exit?"*

## Open items for the FINAL codex pass (consolidated-plan review)

1. Confirm the corrected framing (mutex correctness-critical) + D3 acquire-point (before authwit) actually closes the codex P0/P1 interleaving.
2. Confirm D5's pre-acquire controller is the minimal correct fix (vs a broader cancel refactor).
3. Confirm heartbeat (D6) over flag, given the boot-sweep-unconditional constraint.
4. Sign off Phase 0 as the right prerequisite ordering.

## Tier B protocol

```
[✓] 0. Clarifying questions (user: sequential, heartbeat-refinement, standard-matrix(+E2-heavy deviation), skip-spike)
[✓] 0.5 Pre-spike research (chainGuard key, withPxeWrite granularity)
[✓] 1. Dual audit (codex xhigh + opus) — both needs-revision; folded in
[✓] 2. Consolidate findings → plan v2 (this doc)
[✓] 3. Final codex review of the consolidated plan — SHIP-IT, 0 residual P0/P1 (audit-codex-final.md)
[▶] 4. Approval gate (user) ← awaiting go/no-go
[ ] 5. Implementation + per-phase lessons
[ ] 6. Post-impl codex review
[ ] 7. Fix loop
[ ] 8. eli5.html (built alongside this plan)
```
