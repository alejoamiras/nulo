# Concurrent dApp sendTx — plan v6

**Date:** 2026-05-22
**Tier:** B-strong — concurrency-correctness + new FSM stage + new journal-layer mutex.
**Audit cycle:** Plan iterated 5 rounds with codex (xhigh). v6 is the clean rewrite consolidating findings; goes back to codex for round-6.

**Earlier audits archived (DO read before reviewing — full context):**
- [audit-codex-round-1.md](audit-codex-round-1.md) — diagnosed wrong layer (popup-lock). BLOCKER.
- [audit-codex-round-2.md](audit-codex-round-2.md) — direction sound, batch + NO_FROM corrections.
- [audit-codex-round-3.md](audit-codex-round-3.md) — popup-handoff hooks + unsafe claim fallback + batch contradiction. BLOCKER.
- [audit-codex-round-4.md](audit-codex-round-4.md) — error-pipeline + record-shape + cancel race + sessionId field. NEEDS-WORK.
- [audit-codex-round-5.md](audit-codex-round-5.md) — journal-layer mutex needed (transitionOperation has no CAS). BLOCKER.

---

## Problem

Two pending dApp transactions submit to the wallet. Only one shows in the activity feed; second appears only after the first confirms.

**Diagnosis (round 1 BLOCKER → corrected):**
- NOT the popup-lock in `DappInteractionService` (releases sync via `finally` when `return` evaluates).
- IS the per-session FIFO at `background.ts:181-189` chaining on full `handleWalletMessage` completion (which awaits the full execution).

**User goal:** both transactions visible immediately; second's popup opens as soon as first's user-interaction is done.

---

## Solution architecture (v6)

```
┌────────────────────────────────────────────────────────────────────┐
│ Layer 1: Session FIFO baton release (popup-faster path)            │
│                                                                    │
│ background.ts: queue advances when handler signals via releaseFifo│
│   ↓ executeAztecSendTx fires releaseFifo after tx-build           │
│   ↓ (before proving, after nonce+txRequest sealed)                │
└────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────┐
│ Layer 2: Queued journal stage (immediate visibility)               │
│                                                                    │
│ background.ts: creates journal record at stage="queued" on         │
│   sendTx message arrival, BEFORE the handler runs.                 │
│                                                                    │
│ Hooks carrying queuedJournalId persist across the popup            │
│ handoff via storage on the DappInteraction record.                 │
│                                                                    │
│ executeAztecSendTx claims (queued → pending) instead of            │
│ creating a new record.                                             │
└────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────┐
│ Layer 3: Journal-layer mutex (correctness foundation)              │
│                                                                    │
│ OperationJournalService.transitionOperation acquires a global      │
│ mutex around load → validate → write. Closes the claim-vs-cancel  │
│ race codex-round-5 caught. Required by Layer 2.                   │
└────────────────────────────────────────────────────────────────────┘
```

The three layers stack. **Layer 3 is the new R5 finding and is foundational** — without it, Layer 2's claim helper races with `cancelJob` at the storage layer.

---

## Implementation

### Step 1 — Journal mutex (NEW, codex-round-5)

`packages/extension/src/wallet/services/operation-journal/service.ts`:

Add a single mutex around `transitionOperation`. Global (not per-record) — each transition is fast (~ms storage write), serializing them is invisible.

```ts
import { Lock } from "@nulo/wallet-core/utils/lock"

export class OperationJournalService extends Service<...> {
  // ... existing fields ...
  private readonly transitionLock = new Lock("operation-journal:transition", this.logger)

  public async transitionOperation(id: string, progress: JobProgress, error?: JobError | null): Promise<OperationRecord> {
    validateParams(OperationJournalMethodSchemas.transitionOperation.params, [id, progress, error], "transitionOperation")
    await this.ensureInitialized()
    await this.transitionLock.enter()
    try {
      const record = await this.storage.get(id)
      if (!record) throw new Error(`transitionOperation: ${id} not found`)
      assertCanTransition(record.progress.stage, progress.stage)
      // ... existing terminalAt + error invariants ...
      const updated: OperationRecord = {
        ...record,
        progress,
        error: error ?? null,
        terminalAt: isTerminal(progress.stage) ? Date.now() : record.terminalAt,
        updatedAt: Date.now(),
      }
      await this.storage.set(id, updated)
      this.emit("onOperationUpdated", updated)
      return updated
    } finally {
      this.transitionLock.leave()
    }
  }
}
```

**Why global, not per-record:**
- Per-record requires a `Map<id, Lock>` with cleanup challenges (when to evict?).
- Global mutex serializes ALL transitions across ALL records. Each transition is fast; concurrency loss is negligible.
- Simpler invariant: "at any time, at most one transition is in flight". Trivial to reason about.

**Why only `transitionOperation`:**
- `createOperation` writes a fresh record at a new id — no read-then-write race (id is generated, collision-checked, then written).
- `deleteOperation` is a single write — atomic.
- Only the load-validate-write pattern in `transitionOperation` races.

**Tests for the mutex (Step 7):**
- Two concurrent transitions on the same record serialize correctly (no last-write-wins).
- Two concurrent transitions on DIFFERENT records also serialize (global mutex), but both complete.
- Storage write failure during transition releases the lock + propagates the error (no deadlock).
- Mutex hold time is bounded by storage I/O (~ms); no force-release scenarios.

### Step 2 — `JobStage` adds `queued` (FSM)

`packages/wallet-core/src/jobs/types.ts:17`:

```ts
export type JobStage =
  | "queued"
  | "pending"
  | "simulating"
  | "proving"
  | "submitting"
  | "succeeded"
  | "failed"
  | "cancelled"

export type JobProgress =
  | { stage: "queued" }
  | { stage: "pending" }
  | { stage: "simulating" }
  | { stage: "proving"; enteredProveAt: number }
  | { stage: "submitting"; txHash?: string }
  | { stage: "succeeded"; txHash?: string }
  | { stage: "failed" }
  | { stage: "cancelled" }
```

`packages/wallet-core/src/jobs/fsm.ts:38`:

```ts
const LEGAL_TRANSITIONS: Readonly<Record<JobStage, ReadonlySet<JobStage>>> = {
  queued: new Set<JobStage>(["pending", "failed", "cancelled"]),
  pending: new Set<JobStage>(["simulating", "failed", "cancelled"]),
  simulating: new Set<JobStage>(["proving", "succeeded", "failed", "cancelled"]),
  proving: new Set<JobStage>(["submitting", "failed", "cancelled"]),
  submitting: new Set<JobStage>(["succeeded", "failed"]),
  succeeded: new Set<JobStage>(),
  failed: new Set<JobStage>(),
  cancelled: new Set<JobStage>(),
}
```

`TERMINAL_STAGES` unchanged (`queued` is non-terminal).

### Step 3 — `OperationRecord` schema additions

`packages/extension/src/wallet/services/operation-journal/spec.ts`:

```ts
export interface OperationRecord {
  // ... existing fields ...
  /** Session id for dapp_execute records originating from a wallet-sdk
   *  message. Populated by `tryCreateQueuedJournal` from
   *  `ActiveSession.sessionId`. Undefined for UI-initiated records
   *  (transfers, token imports). Used by per-session queued cap. */
  sessionId?: string
}

export type NewOperationInput = {
  // ... existing fields ...
  sessionId?: string
  /** Narrowed pre-execution-stage override. Defaults to `{ stage: "pending" }`.
   *  Restricted to non-terminal stages so callers can't mint impossible
   *  terminal-stage records by accident. */
  initialStage?: { stage: "queued" } | { stage: "pending" }
}
```

**Zod schema updates (required for round-trip):**

```ts
const JobStageSchema = z.enum(["queued", "pending", "simulating", "proving", "submitting", "succeeded", "failed", "cancelled"])

const JobProgressSchema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("queued") }),
  z.object({ stage: z.literal("pending") }),
  z.object({ stage: z.literal("simulating") }),
  z.object({ stage: z.literal("proving"), enteredProveAt: z.number() }),
  z.object({ stage: z.literal("submitting"), txHash: z.string().optional() }),
  z.object({ stage: z.literal("succeeded"), txHash: z.string().optional() }),
  z.object({ stage: z.literal("failed") }),
  z.object({ stage: z.literal("cancelled") }),
])

const InitialStageSchema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("queued") }),
  z.object({ stage: z.literal("pending") }),
])

// OperationRecordSchema, NewOperationInputSchema, OperationJournalMethodSchemas.createOperation.params
// all reference these. Add `sessionId: z.string().optional()` to each.
```

**No STORAGE_VERSION bump.** Additive — pre-change records never had `queued`, round-trip unchanged.

### Step 4 — `tryCreateQueuedJournal` helper (in `background.ts`)

```ts
const MAX_QUEUED_PER_SESSION = 8
const MAX_QUEUED_GLOBAL = 32

async function tryCreateQueuedJournal(
  message: WalletMessage,
  session: ActiveSession,
  journal: OperationJournalService,
  profile: ProfileService,
  dappSession: DappSessionService,
  networkSvc: NetworkService,
  logger: ILogger,
): Promise<string | undefined> {
  try {
    // Cheap pre-auth gates — return undefined to skip queued visibility
    // (handler still runs, creates its own in-flight record via beginDappExecuteJournal).
    const activeProfile = await profile.getActiveProfile()
    if (!activeProfile) return undefined

    const chainId = chainInfoToChainId(session)
    const dapp = await dappSession.tryGetDappSessionByOriginAndChain(session.origin, String(chainId))
    if (!dapp?.accounts?.length) return undefined
    const hasSendTxGrant = (dapp.capabilityGrants ?? []).some((g) => g.capability.type === "transaction")
    if (!hasSendTxGrant) return undefined

    // DappSession.accounts is string[] of CAIP. Parse the first one.
    const { address: accountAddress } = parseCaipAccount(dapp.accounts[0] as CaipAccount)

    // Resolve internal network row (NOT String(chainId) — that's not what
    // RecentActivityView.journalRecordInScope filters on).
    const network = await resolveNetworkByChainId(networkSvc, chainId)
    if (!network) return undefined

    // Caps — codex-round-3 T1 mitigation
    const sessionCount = await journal.countOperations({ sessionId: session.sessionId, stage: "queued" })
    if (sessionCount >= MAX_QUEUED_PER_SESSION) return undefined
    const globalCount = await journal.countOperations({ stage: "queued" })
    if (globalCount >= MAX_QUEUED_GLOBAL) return undefined

    const callsMeta = extractCallsMetadata(message)
    const record = await journal.createOperation({
      kind: "dapp_execute",
      origin: "dapp",
      profileId: activeProfile.id,
      sessionId: session.sessionId,
      accountAddress,
      networkId: network.id,
      title: callsMeta?.primaryMethod ?? "Transaction",
      subtitle: session.origin,
      initialStage: { stage: "queued" },
    })
    return record.id
  } catch (error) {
    logger.log("wallet-sdk-bg", LogLevel.Warn, `tryCreateQueuedJournal failed: ${getErrorMessage(error)}`)
    return undefined
  }
}
```

`countOperations({ sessionId?, stage? })` is a NEW lightweight method on `OperationJournalService`. Filters in-memory (storage size is small):

```ts
public async countOperations(filter: { sessionId?: string; stage?: JobStage }): Promise<number> {
  await this.ensureInitialized()
  const all = await this.storage.getAllValues()    // existing method
  let n = 0
  for (const op of all) {
    if (filter.sessionId !== undefined && op.sessionId !== filter.sessionId) continue
    if (filter.stage !== undefined && op.progress.stage !== filter.stage) continue
    n++
  }
  return n
}
```

### Step 5 — `onWalletMessage` (background.ts:181-189)

```ts
onWalletMessage: (session, message) => {
  const key = session.sessionId
  const prev = sessionQueues.get(key) ?? Promise.resolve()
  let resolveBaton!: () => void
  const baton = new Promise<void>((resolve) => { resolveBaton = resolve })
  let released = false
  const releaseFifo = () => {
    if (released) return
    released = true
    resolveBaton()
  }

  // ONLY for top-level sendTx — batch + others go through the existing
  // flow without queued visibility (codex-round-3 F3, codex-round-4 batch TODO).
  const queuedJournalIdPromise: Promise<string | undefined> = message.type === "sendTx"
    ? tryCreateQueuedJournal(message, session, operationJournal, profileService, dappSessionService, networkService, logger)
    : Promise.resolve(undefined)

  const handlerChain = queuedJournalIdPromise.then((queuedJournalId) =>
    prev.then(() =>
      handleWalletMessage(session, message, handler, dispatcher, profileService, operationJournal, logger, {
        releaseFifo,
        queuedJournalId,
      }),
    ),
  )
  handlerChain.finally(releaseFifo)
  sessionQueues.set(key, baton.catch(() => {}))
}
```

**Note:** `queuedJournalIdPromise` resolves before the handler chain runs (we `await` it inside the `.then`). This way the queued record exists in the UI before the handler picks up the FIFO baton.

**TODO inline:**
```ts
// TODO(queued-visibility-for-batch): batched sendTx legs currently bypass
// the queued-record creation path because `handleBatch` recurses through
// `dispatch()` without forwarding hooks (intentional — keeps the batch
// FIFO contract intact). Lifting this requires a per-leg queued-record
// model or a relaxation of the batch contract; out of scope for the
// concurrent-dApp-sendTx fix.
```

### Step 6 — `handleWalletMessage` (background.ts:432-489)

```ts
type WalletMessageHooks = {
  releaseFifo?: () => void
  queuedJournalId?: string
}

async function handleWalletMessage(
  session: ActiveSession,
  message: WalletMessage,
  handler: BackgroundConnectionHandler,
  dispatcher: WalletSdkDispatcher,
  profileService: ProfileService,
  operationJournal: OperationJournalService,
  logger: ILogger,
  hooks?: WalletMessageHooks,
): Promise<void> {
  // ... existing setup + profile auth check ...

  try {
    const ctx: SessionContext = { /* unchanged — no hooks inside ctx */ }
    const raw = await dispatcher.dispatch(message.type, message.args, ctx, hooks)
    response.result = toJsonSafe(raw)
  } catch (error) {
    // ... existing error envelope ...
    // If queued record exists AND is still at queued stage (handler failed
    // before claiming), transition to failed. Journal is source of truth.
    if (hooks?.queuedJournalId) {
      const record = await operationJournal.getOperation(hooks.queuedJournalId).catch(() => null)
      if (record?.progress?.stage === "queued") {
        void operationJournal.transitionOperation(hooks.queuedJournalId, { stage: "failed" }, normalizeJobError(error))
      }
    }
  }
  // ... existing response send ...
}
```

### Step 7 — Dispatcher (`packages/wallet-bridge/src/dispatcher.ts`)

```ts
export interface DispatchHooks {
  onTxRequestFinalized?: () => void
  queuedJournalId?: string
}

async dispatch(
  methodName: string,
  args: unknown[],
  ctx: SessionContext,
  hooks?: DispatchHooks,
): Promise<unknown> {
  // ... capability + scope enforcement unchanged ...

  if (methodName === "batch") {
    // CRITICAL: do NOT forward hooks into batch legs.
    return this.handleBatch(args[0] as ..., ctx)
  }
  if (methodName === "sendTx") {
    return this.handleSendTx(args, ctx, hooks)
  }
  // ... other methods unchanged ...
}

private async handleSendTx(args: unknown[], ctx: SessionContext, hooks?: DispatchHooks): Promise<unknown> {
  // ... existing setup unchanged ...
  // Codex-round-7: pass `undefined` for cancellationToken (arg 2 — existing
  // contract); hooks ride on arg 3 (NEW).
  const results: ExecutionResult = await this.dappInteractionService.execute(
    { sessionId: dappSession.id, operations: [sendOp] },
    undefined,
    {
      onTxRequestFinalized: hooks?.onTxRequestFinalized,
      queuedJournalId: hooks?.queuedJournalId,
    },
  )
  return this.unwrapResult(results[0])
}
```

**Companion update — `IDappInteractionRunner` interface contract:**

`packages/wallet-bridge/src/services-contract.ts:41` defines the interface today as `execute(payload, cancellationToken?): Promise<ExecutionResult>`. Add the optional third arg:

```ts
execute(
  payload: ExecutionPayload,
  cancellationToken?: string,
  hooks?: ExecutionHooks,
): Promise<ExecutionResult>
```

Also update any dispatcher test stubs that implement this interface to match the new signature. Compile-time-checked, so tsc will catch any miss during `bun run audit:vue`.

### Step 8 — DappInteractionService persists hooks across popup handoff

`packages/extension/src/wallet/services/dapp-interaction/spec.ts:43`:

```ts
export type DappInteraction = {
  id: string
  payload: ExecutionPayload | CapabilityPayload | DiscoveryPayload
  handleId: string
  cancellationToken: string
  /** Hooks bag carried across the popup handoff. interaction() persists;
   *  approveInteraction → executeAndResolve reads them from the lookup. */
  hooks?: ExecutionHooks
}
```

`packages/extension/src/wallet/services/dapp-interaction/service.ts`:

**Codex-round-6 catch:** `execute`'s arg 2 is already `cancellationToken?: string` per the wallet-bridge `services-contract.ts:41`. Use a THIRD arg for hooks; don't steal arg 2.

```ts
public async execute(payload: ExecutionPayload, cancellationToken?: string, hooks?: ExecutionHooks): Promise<ExecutionResult> {
  return (await this.interaction("execute", payload, cancellationToken, hooks)) as ExecutionResult
}

private async interaction(
  type: string,
  payload: ExecutionPayload | CapabilityPayload | DiscoveryPayload,
  cancellationToken?: string,
  hooks?: ExecutionHooks,
): Promise<...> {
  // ... existing lock + popup + storage.set, with hooks now stored on the interaction ...
  interaction = { id, payload, handleId: handle.handleId, cancellationToken: ..., hooks }
  // ... rest unchanged ...
}

private async executeAndResolve(interaction: DappInteraction, operations: Operation[], origin: LocalTxOrigin): Promise<void> {
  try {
    await this.profileService.refreshSession()
    // Forward hooks captured at interaction-creation time. Survives popup handoff.
    const result = await this.executionService.executeOperations(operations, origin, undefined, interaction.hooks)
    this.windowManager.settle(interaction.handleId, result)
  } catch (error) {
    this.windowManager.cancel(interaction.handleId, error instanceof Error ? error.message : "Execution failed")
  }
}
```

### Step 9 — ExecutionService (codex-round-5 signature collision)

`packages/extension/src/wallet/services/execution/service.ts:865`:

`executeOperations` already takes `(operations, origin, parentTask?)`. Add a fourth arg, not a third:

```ts
public async executeOperations(
  operations: Operation[],
  origin: LocalTxOrigin,
  parentTask?: WrappedTask,
  hooks?: ExecutionHooks,    // NEW — fourth arg
): Promise<ExecutionResult> {
  // ... iterate operations, dispatch per-op ...
  // For aztec_sendTx ops: pass hooks. Others: ignore.
}
```

`executeAztecSendTx(op, ..., hooks?)` and `executeNoFromSendTx(op, ..., hooks?)` accept the same hooks bag.

### Step 10 — Claim helper (per-record, no race because of journal mutex)

`packages/extension/src/wallet/services/execution/service.ts`:

```ts
/**
 * Claim a queued journal record (queued → pending) OR create a new
 * in-flight record if no queued id was provided.
 *
 * The journal-layer mutex (Step 1) serializes the transition with any
 * concurrent cancelJob. No mid-transition race.
 *
 * Cancellation behavior:
 *   - hooks.queuedJournalId UNSET    → create new (original path)
 *   - record not found in journal     → create new (reaper deleted it)
 *   - record stage === "queued"       → claim. Returns {journalId, controller}.
 *   - record stage NOT "queued"       → throw JobCancelledSentinel(queuedId).
 *                                       Reuses the existing cancelled pipeline
 *                                       which surfaces as EIP-1193 4001.
 *
 * Journal-storage failures (write error during transition) re-throw the
 * original error. Don't conflate storage failures with cancellation —
 * preserves observability per codex-round-5.
 */
private async claimOrCreateDappExecuteJournal(
  networkId: string,
  accountAddress: string,
  origin: LocalTxOrigin,
  calls: { method?: string }[] | undefined,
  hooks: ExecutionHooks | undefined,
): Promise<{ journalId: string | undefined; controller: AbortController | undefined }> {
  if (!hooks?.queuedJournalId) {
    const id = await this.beginDappExecuteJournal(networkId, accountAddress, origin, calls)
    const controller = id ? new AbortController() : undefined
    if (id && controller) this.activeControllers.set(id, controller)
    return { journalId: id, controller }
  }

  const queuedId = hooks.queuedJournalId
  const record = await this.operationJournal.getOperation(queuedId).catch(() => null)
  if (!record) {
    this.logDebug(`Queued record ${queuedId} not found; creating new in-flight record`)
    const id = await this.beginDappExecuteJournal(networkId, accountAddress, origin, calls)
    const controller = id ? new AbortController() : undefined
    if (id && controller) this.activeControllers.set(id, controller)
    return { journalId: id, controller }
  }
  if (record.progress?.stage !== "queued") {
    this.logInfo(`Queued record ${queuedId} is ${record.progress?.stage}; cancelled-path`)
    throw new JobCancelledSentinel(queuedId)
  }

  // Journal-mutex protected. Cancel + claim serialize — no race.
  try {
    await this.operationJournal.transitionOperation(queuedId, { stage: "pending" })
  } catch (error) {
    const recheck = await this.operationJournal.getOperation(queuedId).catch(() => null)
    if (recheck && recheck.progress?.stage === "cancelled") {
      // Cancelled WON the race (inside the mutex). Surface as cancelled.
      throw new JobCancelledSentinel(queuedId)
    }
    // Genuine storage failure or FSM-illegal-transition. Don't mask as
    // cancellation; let it propagate as a failed operation result.
    throw error
  }

  const controller = new AbortController()
  this.activeControllers.set(queuedId, controller)

  // Codex-round-6: NO updateMetadata call here. `title` was already set
  // by tryCreateQueuedJournal from the same message payload — primaryMethod
  // doesn't change between queue-time and execute-time. Avoiding this call
  // sidesteps the lost-update race that any non-mutexed load+merge+write
  // would create vs. transitionOperation. If a future need to update metadata
  // mid-flight emerges, gate it under the same transition mutex.

  return { journalId: queuedId, controller }
}
```

**Codex-round-6 catch:** dropped the `updateMetadata` call entirely. The `title` field (primaryMethod) is already set at queued-record creation in `tryCreateQueuedJournal` from the same message payload — no information added between queued and pending stages. Eliminating the call removes the only other "load+merge+write" path on the same record and keeps `transitionOperation` as the sole whole-record writer protected by the journal mutex.

### Step 11 — Fire `onTxRequestFinalized` in `executeAztecSendTx`

Around service.ts:1912-1919:

```ts
const [txRequest, node, pxe, account, network, nonce, txCalls, feePaymentMethod] = await this.buildAndEstimateTxRequest(
  { ...op, actions, fee },
  op.feeSettings,
  parentTask,
)

checkCancelled()
hooks?.onTxRequestFinalized?.()
await this.markJournal(journalId, { stage: "proving", enteredProveAt: Date.now() })
```

### Step 12 — Mirror in `executeNoFromSendTx` (NO_FROM path)

At service.ts:2070-2081 (the analogous "txRequest finalized + cancellation checked" boundary). Same pattern — fire `hooks?.onTxRequestFinalized?.()` right after the cancel check, before any journal write.

### Step 13 — UI surface (RecentActivityView)

`packages/extension/src/popup/components/modules/general/RecentActivityView.vue:`

`inFlightJournalOps` (line 200) already filters by `terminalAt === null`, so queued records naturally pass. Just update `cardSubtitleFor`:

```ts
switch (op.progress?.stage) {
  case "queued":
    return "Queued..."
  case "pending":
    return "Preparing..."
  // ... existing cases ...
}
```

Visual: reuse `TransactionAwaitingCard` as-is. The neutral waiting styling at TransactionAwaitingCard.vue:17 already fits.

### Step 14 — Reaper sweep for stuck queued records

`packages/extension/src/wallet/services/operation-journal/reaper.ts`:

Boot sweep at reaper.ts:112 already reaps non-terminal records on SW restart. For runtime staleness (record stuck queued because background.ts crashed mid-enqueue), add:

```ts
const QUEUED_STALE_MS = 10 * 60_000   // matches INTERACTION_TIMEOUT_MS

// Inside periodic sweep:
if (op.progress?.stage === "queued" && now - op.createdAt > QUEUED_STALE_MS) {
  await journal.transitionOperation(op.id, { stage: "failed" }, {
    kind: "stuck_proving",   // or new "stuck_queued" if taxonomy demands
    message: "Queued request never picked up by handler",
  })
}
```

### Step 15 — `requestId` entropy upgrade

`getRandomHex(8)` → `getRandomHex(16)` for interaction IDs + journal IDs. Defense-in-depth per codex-round-1.

---

## Security & adversarial considerations

### T1 — DoS via queued-record flooding

**Threat:** Malicious dApp fires N sendTx → N journal records created → storage growth.
**Mitigation:** per-session cap (8) + global cap (32) in `tryCreateQueuedJournal`. Beyond cap, visibility is skipped (handler still runs via FIFO).

### T2 — Cross-session storage pollution

**Threat:** dApp B in different session creates queued records that share global storage with dApp A.
**Mitigation:** per-session cap prevents B from monopolizing the visibility surface. Global cap as backstop. RecentActivityView filters by `accountAddress` + `network.id` — B's records don't show on A's view.

### T3 — Pre-auth journal record creation

**Threat:** sendTx arrives while wallet is locked. `tryCreateQueuedJournal` creates a record before auth check.
**Mitigation:** cheap gates in `tryCreateQueuedJournal` (no profile → undefined). When wallet IS unlocked but session lacks sendTx grant: also returns undefined. Queued record only created when at minimum: active profile + matching dapp session + transaction grant.

### T4 — Cancel-during-claim race (the round-5 finding)

**Threat:** `claim(queued→pending)` and `cancelJob(queued|pending→cancelled)` race inside the journal transition.
**Mitigation:** Step 1 — journal-layer global mutex on `transitionOperation`. Claim and cancel serialize at the journal. Whichever acquires the mutex first wins; the loser sees the new stage and acts appropriately.

### T5 — Storage failure masquerading as cancellation

**Threat:** if a genuine storage write fails, we erroneously surface as 4001 (user-cancelled).
**Mitigation:** Step 10 — after a failed transition, re-read and check stage. Only treat as cancelled if stage IS `cancelled`. Otherwise re-throw original error → executeOperations classifies as failed → dApp sees structured failure.

### T6 — Out-of-order responses

User correctly noted (round-4 follow-up): impossible given PXE serialization at `withPxeWrite`. Test #14 still verifies messageId correlation for completeness.

### T7 — `requestId` brute force

Bumped to 128 bits. ~2^-128 collision probability. Defense-in-depth.

---

## Tests

### Unit — FSM (`wallet-core/src/jobs/fsm.test.ts`)

1. `queued → pending` legal
2. `queued → failed` legal
3. `queued → cancelled` legal
4. `queued → simulating` ILLEGAL
5. `queued → proving` ILLEGAL
6. `queued → succeeded` ILLEGAL

### Unit — Journal mutex (`operation-journal/service.test.ts`)

7. Two concurrent `transitionOperation` on the SAME record serialize correctly. Deterministic: use a deferred storage stub; assert second transition waits for first.
8. Two concurrent transitions on DIFFERENT records also serialize (global mutex) but both complete.
9. Storage write failure during transition releases the mutex + propagates the error.
10. `createOperation({ initialStage: { stage: "queued" } })` produces a queued record.
11. `transitionOperation(id, { stage: "pending" })` succeeds when current stage is queued.
12. `countOperations({sessionId, stage})` filters correctly.

### Unit — background.ts (`wallet-sdk/background.test.ts` — NEW file)

13. `onWalletMessage` with `message.type === "sendTx"` creates a queued record before handler runs.
14. Non-sendTx messages don't create queued records.
15. Per-session cap (N=8) skips creation when reached.
16. Global cap (N=32) skips creation when reached.
17. Handler completes without calling `releaseFifo` → baton resolves at completion (safety net).
18. Handler calls `releaseFifo` mid-execution → baton resolves immediately; next message handler starts.
19. Idempotent release: double-call to `releaseFifo` no-ops.
20. Safety net on handler failure: handler throws → baton resolves → queued record (if any) transitions to failed.
21. Order preservation: A → B → C messages with mixed release timing preserve correct ordering.

### Unit — Claim helper (`execution/service.test.ts`)

22. `onTxRequestFinalized` fires after `buildAndEstimateTxRequest`, before `markJournal({stage: "proving"})`.
23. `queuedJournalId` claim: queued record transitions to pending; controller registered immediately.
24. Cancelled record → throws `JobCancelledSentinel`, never executes.
25. Failed record → throws `JobCancelledSentinel`.
26. Reaped (deleted) record → falls through to `beginDappExecuteJournal`, creates new.
27. Storage failure during claim transition (re-read shows queued still) → re-throws original error (not cancelled-pipeline).
28. NO_FROM path receives + uses hooks identically.

### Unit — Pipeline (`execution/service.test.ts`)

29. `JobCancelledSentinel` thrown from `claimOrCreate` (before `markJournal("simulating")`) → `executeOperations` catches → `OperationResult.status === "cancelled"` → dApp sees 4001 (`JobCancelledError`).
30. Genuine storage failure → not cancelled-pipeline → dApp sees structured failure (not 4001).

### Unit — UI rendering

31. `RecentActivityView` renders queued-stage card with `"Queued..."` subtitle.
32. Card transitions to "Preparing..." when stage → pending.

### Unit — Reaper

33. Stale queued (>10min) → transitions to failed with `stuck_proving` (or `stuck_queued`).
34. Fresh queued (<10min) → survives sweep.
35. Boot sweep handles non-terminal queued records on restart.

### Integration — Background → Dispatcher → Service

36. Hooks survive popup handoff: queue record created at message arrival → popup approved → executeAndResolve picks up hooks from interaction record → executeAztecSendTx claims queued.

### E2E (`tests/e2e/network/concurrent-sendtx.test.ts` — NEW)

37. **Two concurrent sendTx, same dApp session.**
    - Fire T1, T2 without awaiting T1.
    - T1 popup opens <1s.
    - T2 queued record visible in activity feed <500ms after fire.
    - Approve T1.
    - T1 transitions queued → pending → ... → succeeded.
    - T2 popup opens <1s of T1's tx-build (not waiting for T1's confirm).
    - Approve T2.
    - Both confirm.
38. **Single sendTx (regression check).**
39. **registerContract → executeUtility** — FIFO preserved.
40. **Wallet locked + sendTx** — queued briefly exists → handler throws "wallet locked" → queued → failed in <500ms.
41. **User cancels pre-claim (deterministic via injected cancel).** dApp sees 4001 (not generic failure).
42. **Batch containing sendTx** — no queued record at arrival (known limitation), BUT the inner sendTx still runs through `beginDappExecuteJournal` path and succeeds.
43. **Out-of-order response correlation** — wallet-sdk demultiplexes by messageId correctly (sanity check).

---

## Status

```
[✓] R1 — wrong layer (BLOCKER)
[✓] R2 — direction sound, batch+NO_FROM
[✓] R3 — popup hooks + claim-fallback + batch (BLOCKER)
[✓] R4 — error pipeline + record shape + cancel race + sessionId (NEEDS-WORK)
[✓] R5 — journal-layer mutex needed (BLOCKER)
[✓] Plan v6 — clean rewrite consolidating all corrections
[✓] R6 — codex review (NEEDS-WORK: drop updateMetadata + fix execute arg-slot)
[✓] Plan v7 — applied R6's two mechanical fixes
[✓] R7 — needs-work on plan-text consistency only (Step 7 call site + contract interface)
[✓] Plan v8 — Step 7 + interface contract update added (THIS DOC; codex effectively cleared)
[▶] User approval
[ ] Implementation
[ ] Codex post-impl review
[ ] PR to dev
```

## Known limitations (deferred to follow-up PRs)

- **Batch-with-sendTx visibility** — TODO inline in `onWalletMessage`. Test #42 asserts the limitation.
- **Per-record mutex granularity** — using global mutex on `transitionOperation`. Tradeoff: simpler, slightly less concurrent. Acceptable given storage write times.
- **Settlement race in WindowManager** — pre-existing, not addressed in this PR. Codex-round-1 noted; out of scope.
