# journal-reaper — batch 8 of the PR #448 audit remediation [mid]

Findings N-07 (Major, RED proof c2-1), N-16, N-25 (`audit/bugs/2026-08-22-production-ready/`): the operation-journal reaper falsely fails FIFO-waiting dApp ops; `waitForTx` spins unbounded; a claim-time throw leaks the pre-registered abort controller. Runbook batch 8; N-07's design is codex-mediated. Recon: [recon.md](recon.md).

## Success criterion

c2-1's scenario provably closed (adopted per the chosen design — see below), `waitForTx` bounded + cancellation-honoring, the controller leak closed with the bug-pinning test corrected; audit:vue + smoke + solo network e2e green; PR merged under all three required gates with codex final-diff sign-off.

## The N-07 design decision (THE mid-tier question — codex-mediated)

**Primary outline — (b) claim-eligibility keying, minimal form**: teach `reap()` that a `queued` record is reap-eligible only when it is genuinely orphaned, by keying the queued grace on the arrival clock AND a liveness signal that exists today: on reap-candidacy (age past grace), consult the wallet-sdk's session-FIFO registry — if the record's id is REGISTERED as a live FIFO waiter, spare it. Concretely: a narrow `isLiveWaiter(journalId): boolean` hook injected into the reaper (default: () => false), wired by the composition root to a new exported registry on the wallet-sdk side (a `Set<string>` maintained around `background.ts:308-376`: add at queued-record creation, remove at `releaseFifo`/handler settle). The literal c2-1 proof adopts nearly verbatim (aged + live → survives; aged + NOT live → still reaped, preserving crash detection).
- Why primary: it keeps the reaper the single arbiter, adds no new timer, makes the proof adoptable as written, and degrades safely — a SW restart clears the set, so genuinely-orphaned records (the grace's raison d'être) still reap.

**Competing outline — (a) heartbeat session-FIFO waiters**: mirror `executionWaiters` one level up — a second set + 30 s `setInterval` bumping `touchOperation` for ids between arrival and baton grant (wired in `background.ts`). No reaper change. The c2-1 proof cannot adopt literally (a live waiter's `updatedAt` never goes stale); the pin becomes "FIFO wait keeps the record fresh across the grace" (fake-timers, execution-lane.test.ts style).
- Trade-offs: reuses a proven mechanism verbatim; but adds a second global timer in the SW hot path, duplicates the heartbeat pattern at a different layer, makes staleness-semantics ("updatedAt = alive") do double duty, and weakens the proof's literal adoption.

Both spare the rejected third option (reap-on-FIFO-position). Codex picks or amends; the ledger records it.

## Assumptions (verified Facts)

1. **F**: queued grace = `now − updatedAt ≥ 10 min` (`reaper.ts:77,:193-195`); heartbeat covers only `acquireSlot` waiters (`execution-lane.ts:239-283`); the session-FIFO wait is unheartbeated (`background.ts:276-347`).
2. **F**: c2-1 proof backdates a queued record and asserts survival of a non-unconditional reap — green only under (b)-family fixes; under (a) the scenario means "dead" and SHOULD reap.
3. **F**: `waitForTx` = unbounded 100 ms spin (`transaction/service.ts:221-227`); two callers (auth-registry :229/:278); sibling `waitForTxProven` has `timeoutMs = 120_000`; `WrappedTask.complete()` on a cancelled task throws.
4. **F**: `runInSlot`'s finally deletes only under `journalId` (`dapp-send-executor.ts:234`), which is unset on every pre-claim throw; `acquireSlot` registered under `queuedJournalId` at `execution-lane.ts:242`; the existing test at `dapp-send-executor.test.ts:590-607` pins the leak with `queuedJournalId` undefined (vacuous vs the fix).
5. **F**: adjudication widened N-25 to the reaped-sentinel path; claim-helper's :101/:160 branches already clean up — the fix covers the REMAINING pre-claim throws uniformly via the finally.
6. **I** (challenge): the wallet-sdk background handler and the reaper live in the same SW context, so a synchronous registry read from the reaper is race-free enough (single-threaded; the set mutates only between awaits).

## Architecture & implementation (per the primary outline; the competing outline swaps §N-07)

### N-07 (b): live-waiter registry + reaper spare

- NEW `wallet-sdk/fifo-waiter-registry.ts`: module-scoped `Set<string>` + `registerFifoWaiter(id)` / `releaseFifoWaiter(id)` / `isLiveFifoWaiter(id)` (TSDoc: SW-lifetime, restart clears — that IS the crash-detection story).
- `background.ts`: after `tryCreateQueuedJournal` resolves an id (:308-332), register; release in the same `.finally` that releases the baton (:376) — exactly one release path.
- `reaper.ts`: ctor gains optional `isLiveWaiter?: (id: string) => boolean` (default `() => false`); in `reap()`, the `queued` branch spares when `isLiveWaiter(op.id)` (age check unchanged for every other stage; unconditional boot sweep UNCHANGED — a boot has a fresh empty registry, so the sweep still clears genuinely-dead records).
- Composition root wires the registry into the reaper.
- Adopted proof: colocated in `reaper.test.ts` conventions (injected `now`), asserting aged+live survives AND aged+not-live reaps (the crash-detection negative control the original proof lacked).

### N-16: bounded, cancellation-honoring waitForTx

- `waitForTx(txHash, parentTask?, timeoutMs = 120_000)` — loop exits on: (1) hash left `pending` → complete subtask; (2) timeout → fail subtask + throw a typed timeout error (mirrors `waitForTxProven`); (3) `parentTask?.isFinished` (cancellation observed) → abandon silently WITHOUT completing/failing the subtask (completing a cancelled task throws — recon trap).
- Callers unchanged (their existing try/catch + `task.fail` handles the new throw); 120 s matches the sibling bound.

### N-25: finally cleanup under queuedJournalId

- `runInSlot`'s finally: `if (journalId) deleteController(journalId); else if (params.hooks?.queuedJournalId) deleteController(queuedJournalId)` — covers every pre-claim throw (sentinel AND storage error AND reaped-sentinel) uniformly; the double-delete case is impossible (journalId === queuedJournalId when claimed under the same key, and delete is idempotent anyway).
- Correct the vacuous pin: keep the existing no-queuedJournalId case (deleteController still not called — nothing registered), ADD the with-queuedJournalId case asserting the delete fires; plus a claim-helper-level test against the REAL Map proving no entry survives a pre-claim sentinel throw end-to-end (real ExecutionLane acquireSlot + throwing claim).

## Test plan (succinct; every mechanism revert-probed)

- N-07: adopted-proof pair (aged+live survives / aged+dead reaps) in `reaper.test.ts`; registry lifecycle unit (register→release→restart-clear semantics via fresh module state); background wiring pinned via `queued-journal.test.ts`-style stub harness asserting register-on-create + release-on-settle. Probes: strip the spare → aged+live reds; strip a release path → a leak-shaped assertion reds.
- N-16: fake-timers tests — timeout throws typed error + subtask failed; cancellation observed mid-wait → returns without touching the subtask (and no throw); happy path completes. Probe: revert the bound → timeout pin reds (fake timers make the unbounded loop detectable via advance + still-pending).
- N-25: the corrected executor pins + the real-Map claim-helper leak test. Probe: revert the finally else-branch → both red.

## Validation gates

audit:vue → armed smoke → SOLO network e2e (`e2e:agent`) — dApp/journal behavior touched. Then max review → codex fix loop → PR → required checks → codex final-diff → squash-merge.

## Security & adversarial considerations

- The registry is SW-internal (no RPC surface, no attacker input); ids are journal ids the SW itself minted. A hostile dApp cannot pin records alive: registration happens only for records the wallet itself created at arrival, and release is tied to the baton lifecycle the wallet drives.
- The spare must NOT extend to the boot sweep: a crashed SW restarts with an empty registry, so pre-crash records reap normally — crash detection preserved (pinned).
- `waitForTx`'s timeout error is typed and honest ("timed out waiting for confirmation"), replacing the misleading 60 s transport error the adjudication flagged.
- N-25 removes a growth vector (Map entries surviving until SW death).

## Out of scope (logged)

- Batch-excluded queued-journal records (`background.ts` TODO) — pre-existing design note, not this batch.
- `runWorker`'s locked-wallet stall itself (N-16's root) — the audit scoped the fix to bounding the wait, not reworking the sync worker.

## Delivery

Single arc, one PR: `fix(execution): fifo-aware reaper grace, bounded waitfortx, claim-throw controller cleanup`. First commit carries batch 7's index row.
