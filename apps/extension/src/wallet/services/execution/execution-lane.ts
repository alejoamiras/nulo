/**
 * `ExecutionLane` — the execution-lane state machine, moved verbatim off
 * the execution facade: the cancel-controller registry, the
 * per-(profileId, chainId) FIFO execution mutex, the queued-wait
 * heartbeat, the slot acquisition choreography, the queued-record claim
 * wrapper, and `cancelJob`.
 *
 * The facade consumes this as a handle and wires the executors' lane-
 * shaped deps to it. The lane also owns `dapp_execute` record CREATION
 * (`beginJournal`) — the single start path shared by the direct
 * `send_transaction` flow and the queued-claim flow.
 *
 * Frozen invariants (constraint registry — do not "fix" any of these):
 *   - The mutex has NO timeout and NO force-release. A wedged holder
 *     wedges the lane until SW restart; that is the chosen failure mode
 *     (silent overlap is worse — nullifier double-spends).
 *   - FIFO baton release point: `onEnqueued` fires after `acquire` is
 *     CALLED (synchronous enqueue) and before the grant is awaited.
 *   - `cancelJob` transitions the journal FIRST and aborts SECOND; an
 *     FSM rejection drops the cancel silently and never aborts.
 *   - `JobCancelledSentinel` never crosses the RPC boundary —
 *     `rpc-cancel.ts` stays the conversion point, caller-side.
 *   - Sync-register: the pre-acquire controller is registered under the
 *     queued id BEFORE the mutex acquire's first await, so a user-cancel
 *     during the wait always finds its controller.
 */

import { JobCancelledSentinel, type JobError, type JobProgress, normalizeError } from "@nulo/wallet-core/jobs"
import { TooManyPendingError } from "@nulo/extension-messaging/errors"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { pickPrimaryMethod } from "@/utils/primary-method"
import type { LocalTxOrigin } from "@/wallet/services/transaction/service"
import type { OperationJournalService } from "@/wallet/services/operation-journal/service"
import type { ExecutionHooks } from "@/wallet/services/dapp-interaction/spec"
import type { Network } from "@/wallet/services/network/service"
import type { ProfileInfo } from "@/wallet/services/profile/service"
import { claimOrCreateDappExecuteJournal as claimOrCreateDappExecuteJournalImpl } from "./claim-helper"
import {
	type AcquireCaps,
	ExecutionMutex,
	ExecutionMutexAbortError,
	ExecutionMutexCapacityError,
	type ExecutionMutexRelease,
} from "./execution-mutex"

export interface ExecutionLaneDeps {
	operationJournal: OperationJournalService
	getActiveProfile(): Promise<ProfileInfo | undefined>
	getNetwork(networkId: string): Promise<Network>
	logDebug(msg: string, ...rest: unknown[]): void
	logInfo(msg: string, ...rest: unknown[]): void
	logError(msg: string, ...rest: unknown[]): void
}

export class ExecutionLane {
	/** Cancel surface: jobId → AbortController. SW-internal only, never
	 *  crosses the wire. `cancelJob(id)` aborts the controller; the
	 *  in-flight prove pipeline checks `signal.aborted` at each stage
	 *  boundary and short-circuits with {@link JobCancelledSentinel}. */
	private readonly activeControllers = new Map<string, AbortController>()

	/** Per-(profileId, chainId) FIFO mutex serializing dApp sendTx
	 *  EXECUTION (build → simulate → prove → submit). Once the session-FIFO
	 *  baton releases at popup approval, two approved sendTx can both reach
	 *  execution; this mutex keeps them sequential so T2 doesn't simulate
	 *  against T1's not-yet-spent private notes (which would get T2 rejected
	 *  on-chain). Keyed to match PXE's own `chainGuard` scope. Held from
	 *  before authwit discovery through submit, both send paths. */
	private readonly executionMutex = new ExecutionMutex()

	/** Journal ids currently WAITING on `executionMutex.acquire` (not yet
	 *  holding). While non-empty, the heartbeat timer bumps each record's
	 *  `updatedAt` so the periodic reaper doesn't false-declare a legitimately-
	 *  waiting record "stuck" — the Nth concurrent sendTx can wait (N-1)×per-tx
	 *  while queued, which can exceed the 10-min queued / 2-min pending grace. */
	private readonly executionWaiters = new Set<string>()
	private executionHeartbeatTimer?: ReturnType<typeof setInterval>
	private static readonly EXECUTION_WAIT_HEARTBEAT_MS = 30_000

	private static readonly EXECUTION_ORIGIN_CAP = 8
	private static readonly EXECUTION_LANE_CAP = 32

	public constructor(private readonly deps: ExecutionLaneDeps) {}

	public registerController(journalId: string, controller: AbortController): void {
		this.activeControllers.set(journalId, controller)
	}

	public deleteController(journalId: string): void {
		this.activeControllers.delete(journalId)
	}

	/** Open a `dapp_execute` journal record covering an in-flight dApp send.
	 *  Returns the journal id (or `undefined` on failure — non-fatal). The
	 *  record carries the signing account, network, and the dApp identity
	 *  for activity-feed rendering. Method name lives in `title` so the
	 *  in-flight card shows the same value the settled card derives from
	 *  the tx history. */
	public async beginJournal(
		networkId: string,
		accountAddress: string,
		origin: LocalTxOrigin,
		calls?: { method?: string }[],
	): Promise<string | undefined> {
		try {
			const profile = await this.deps.getActiveProfile()
			if (!profile) return undefined
			const primaryMethod = pickPrimaryMethod(calls)
			const op = await this.deps.operationJournal.createOperation({
				kind: "dapp_execute",
				origin: "dapp",
				profileId: profile.id,
				accountAddress,
				networkId,
				title: primaryMethod ?? "Transaction",
				subtitle: origin.name,
			})
			return op.id
		} catch (error) {
			this.deps.logError("Failed to create dapp_execute journal record", getErrorMessage(error))
			return undefined
		}
	}

	/**
	 * Cancel an in-flight job (lossy-cancel).
	 *
	 * Transitions the journal record to `cancelled` synchronously, then
	 * fires the SW-internal AbortController so the running prove pipeline
	 * unwinds at its next stage boundary. The underlying offscreen prove
	 * may still complete (BB.wasm can't be preempted); its result is
	 * dropped silently when it arrives.
	 *
	 * No-op for unknown jobIds or jobs that already terminated (idempotent).
	 */
	public async cancelJob(jobId: string): Promise<void> {
		// Ownership gate: the PROFILE is the sole security principal for
		// cancel (an explicit product decision — one profile is one human,
		// who may cancel their own jobs from any of their accounts;
		// accountAddress/sessionId are deliberately not checked). A missing
		// record, a foreign profile, or a locked wallet (no active profile)
		// all drop the signal EXACTLY like an unknown id — existence
		// non-disclosure: callers cannot probe which job ids exist. The
		// read-then-transition window is benign: the FSM transition below
		// remains the arbiter of WHETHER cancel applies; this gate only
		// decides WHO may ask.
		const record = await this.deps.operationJournal.getOperation(jobId)
		if (!record) return
		const profile = await this.deps.getActiveProfile()
		if (!profile || record.profileId !== profile.id) return

		// Try the journal transition first. If the FSM accepts it, the job
		// is in a pre-submit stage and cancel is meaningful — abort the
		// in-flight controller so the prove pipeline unwinds.
		//
		// If the FSM REJECTS the transition (job already terminal, or past
		// `submitting` where the tx is mid-broadcast and on-chain effect is
		// no longer preventable), drop the cancel signal silently and do
		// NOT abort the controller. The in-flight flow continues to its
		// natural `succeeded` or `failed` terminal — preserving consistency
		// between journal stage and on-chain state.
		//
		// This guards the cancel-after-submit race: previously the journal
		// would flip to `cancelled` and the tx-was-already-broadcast path
		// would log a swallowed illegal
		// `cancelled → succeeded` transition, leaving the journal saying
		// "cancelled" while a real tx existed in chain history.
		try {
			await this.deps.operationJournal.transitionOperation(jobId, { stage: "cancelled" })
		} catch (err) {
			this.deps.logDebug("cancelJob: too late to cancel — dropping signal", getErrorMessage(err))
			return
		}

		const controller = this.activeControllers.get(jobId)
		if (controller) {
			controller.abort()
			this.activeControllers.delete(jobId)
		}
	}

	/** Resolve the execution-mutex key for a dApp sendTx: `(profileId, chainId)`,
	 *  matching PXE's `chainGuard` scope exactly. Both lookups are metadata-only
	 *  (no PXE call), so calling them before acquiring the mutex is safe — they
	 *  don't contend on the chain guard. `getNetwork` is re-resolved inside
	 *  the build later; the duplicate lookup is a negligible in-memory cost
	 *  paid for keying correctness. */
	private async resolveExecutionMutexKey(networkId: string): Promise<string> {
		const profile = await this.deps.getActiveProfile()
		const network = await this.deps.getNetwork(networkId)
		return `${profile?.id ?? "noprofile"}:${network.chainId}`
	}

	/**
	 * Acquire the per-(profileId, chainId) execution slot for a dApp sendTx,
	 * FIFO. When a `queuedJournalId` exists (a "Queued" record the user can see
	 * + cancel), an AbortController is registered under it BEFORE the acquire so
	 * a user-cancel during the wait aborts `acquire` → surfaces as
	 * `JobCancelledSentinel` → the dApp sees EIP-1193 4001. That same controller
	 * is reused by the journal claim (claimed id === queuedJournalId), so it
	 * lives in `activeControllers` continuously from before the wait through
	 * execution — strictly safer for the cancel-vs-claim race than registering
	 * one only after the claim transition.
	 *
	 * The waiting record is heartbeated (updatedAt bumped) for the duration of
	 * the wait so the periodic reaper doesn't declare it stuck.
	 *
	 * Returns the mutex release callback (call in `finally`) and the
	 * pre-acquire controller to thread into the claim.
	 */
	public async acquireSlot(
		networkId: string,
		queuedJournalId: string | undefined,
		onEnqueued?: () => void,
		originKey?: string,
	): Promise<{ release: ExecutionMutexRelease; preController: AbortController | undefined }> {
		const mutexKey = await this.resolveExecutionMutexKey(networkId)
		// Per-origin + total-lane backpressure cap. `originKey` is the canonical
		// dApp origin (threaded from ctx.origin); the sentinel keeps an unexpected
		// absent origin capped under one bucket rather than bypassing the cap.
		const caps: AcquireCaps = {
			originKey: originKey ?? "__no_origin__",
			maxOriginDepth: ExecutionLane.EXECUTION_ORIGIN_CAP,
			maxLaneDepth: ExecutionLane.EXECUTION_LANE_CAP,
		}

		let preController: AbortController | undefined
		if (queuedJournalId) {
			preController = new AbortController()
			this.activeControllers.set(queuedJournalId, preController)
			this.beginExecutionWait(queuedJournalId)
		}

		try {
			// `acquire` installs this request as the FIFO tail SYNCHRONOUSLY, before
			// its first await (execution-mutex.ts). The instant we've called it we
			// are enqueued ahead of anyone who calls `acquire` later. Fire the baton
			// release HERE — before awaiting the grant — so the next session
			// message's popup opens immediately WHILE execution order is preserved:
			// that later request can only reach its own `acquire` after the baton
			// advances, i.e. strictly behind us in the FIFO. Releasing at popup
			// approval (before this point) would let a faster successor overtake us.
			// (On a capacity reject `acquire`'s synchronous cap-check rejects before
			// enqueue; onEnqueued still fires, which is a harmless early baton-advance
			// for a request that has just failed.)
			const acquirePromise = this.executionMutex.acquire(mutexKey, preController?.signal, caps)
			onEnqueued?.()
			const release = await acquirePromise
			return { release, preController }
		} catch (err) {
			// Clean the pre-acquire controller for any non-grant exit.
			if (queuedJournalId) this.activeControllers.delete(queuedJournalId)
			if (err instanceof ExecutionMutexCapacityError) {
				// Lane/origin backpressure. Terminalize the journal record HERE: the
				// caller's claim never runs, and the background safety-net only
				// terminalizes records still at `queued` — but the silent path
				// fast-forwards to `pending` before executing, so without this an
				// over-cap silent sendTx would leave a stuck `pending` card until the
				// reaper grace expires. Surface to the dApp as -32005.
				await this.markJournal(queuedJournalId, { stage: "failed" }, normalizeError(err, "dapp_execute"))
				throw new TooManyPendingError()
			}
			// Aborted while waiting (user cancelled the Queued record) — surface via
			// the cancelled pipeline.
			if (err instanceof ExecutionMutexAbortError) throw new JobCancelledSentinel(queuedJournalId ?? "")
			throw err
		} finally {
			// Wait is over (granted, aborted, or capacity-rejected). A holder no
			// longer needs the heartbeat — its stage transitions bump updatedAt;
			// proving grace is 35 min.
			if (queuedJournalId) this.endExecutionWait(queuedJournalId)
		}
	}

	private beginExecutionWait(journalId: string): void {
		this.executionWaiters.add(journalId)
		if (!this.executionHeartbeatTimer) {
			this.executionHeartbeatTimer = setInterval(() => {
				void this.heartbeatExecutionWaiters()
			}, ExecutionLane.EXECUTION_WAIT_HEARTBEAT_MS)
		}
	}

	private endExecutionWait(journalId: string): void {
		this.executionWaiters.delete(journalId)
		if (this.executionWaiters.size === 0 && this.executionHeartbeatTimer) {
			clearInterval(this.executionHeartbeatTimer)
			this.executionHeartbeatTimer = undefined
		}
	}

	private async heartbeatExecutionWaiters(): Promise<void> {
		// Snapshot — touchOperation awaits and the set can mutate mid-iteration.
		for (const id of [...this.executionWaiters]) {
			try {
				await this.deps.operationJournal.touchOperation(id)
			} catch {
				// Record gone (reaped / cancelled / completed) — harmless; the next
				// settle removes it from the wait-set.
			}
		}
	}

	/**
	 * Claim a pre-allocated queued journal record (transition queued → pending)
	 * OR create a new in-flight record if no queued id was provided.
	 *
	 * Decision tree + invariants live in `./claim-helper.ts` so they're
	 * unit-testable without spinning up the full ExecutionService harness.
	 * This thin wrapper just binds lane dependencies into the helper's
	 * dependency injection shape.
	 */
	public async claimOrCreateJournal(
		networkId: string,
		accountAddress: string,
		origin: LocalTxOrigin,
		calls: { method?: string }[] | undefined,
		hooks: ExecutionHooks | undefined,
		reuseController?: AbortController,
	): Promise<{ journalId: string | undefined; controller: AbortController | undefined }> {
		return claimOrCreateDappExecuteJournalImpl(
			{
				operationJournal: this.deps.operationJournal,
				activeControllers: this.activeControllers,
				createFreshRecord: (n, a, o, c) => this.beginJournal(n, a, o, c),
				logger: {
					debug: (msg) => this.deps.logDebug(msg),
					info: (msg) => this.deps.logInfo(msg),
					error: (msg, raw) => this.deps.logError(msg, raw),
				},
			},
			{ networkId, accountAddress, origin, calls, queuedJournalId: hooks?.queuedJournalId, reuseController },
		)
	}

	public async markJournal(journalId: string | undefined, progress: JobProgress, error?: JobError | null): Promise<void> {
		if (!journalId) return
		try {
			await this.deps.operationJournal.transitionOperation(journalId, progress, error)
		} catch (err) {
			this.deps.logError("Failed to update journal operation", getErrorMessage(err))
		}
	}
}
