// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
/**
 * `ExecutionCoordinator` — owns the shared prove → send → record →
 * journal pipeline that would otherwise be duplicated across
 * `executeTransfer`, `executeSendTransaction`, `executeAztecSendTx`,
 * and `executeNoFromSendTx` in `ExecutionService`.
 *
 * ## Scope (deliberately narrow)
 *
 * This PR does NOT move the `executeOperations` dispatcher or the 22
 * per-operation-kind handlers off the facade — each handler is RPC
 * surface + has unique op-specific plumbing that doesn't fit a generic
 * coordinator shape. What DOES move:
 *
 *   - `simulateTxTask` / `proveTxTask` / `sendTxTask` — the 3 task-
 *     lifecycle wrappers. Used by every handler + FeeStrategy impls
 *     (via the simulate callback).
 *   - `proveAndSend` — the shared "prove → toTx → send → addTransaction →
 *     mark journal submitted" sequence, called 4 times in the facade
 *     with minor op-specific variation.
 *
 * Future work:
 *   - Move the `executeOperations` dispatcher + per-kind handlers.
 *   - Fold in `GasBalanceCache` (facade-owned today — coordinator only
 *     shares / invalidates, never owns).
 *   - `AuthwitDiscoverer.trackAuthwit` post-send flush (requires the
 *     coordinator to own the send-complete point).
 *
 * ## Coordinator does NOT own the RPC surface
 *
 * Facade still owns `ensureInitialized`, RPC binding, and the RPC
 * methods on `Methods`. Coordinator is a pure collaborator — injected
 * via ctor, called by facade methods, no `Service<Methods>` base.
 */

import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { SimulateTxOpts } from "@aztec/pxe/client/bundle"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { Tx, TxExecutionRequest, TxHash, TxProvingResult, TxSimulationResult } from "@aztec/stdlib/tx"
import z from "zod"
import { type ILogger, LogLevel } from "@/wallet/logger"
import type { ExecutionFence } from "@/wallet/services/profile/profile-deletion-state"
import type { IPXE } from "@/wallet/services/pxe/client"
import { StepContent, type TaskService, type WrappedTask } from "@/wallet/services/task/service"
import type { LegalAdmission } from "@/wallet/services/legal/spec"
import { type ProofGate, NOOP_PROOF_GATE } from "@/e2e/proof-gate"
import { DuplicateInitializationError, SessionEndedError } from "@nulo/extension-messaging/errors"
import type { ProveBackend } from "@nulo/wallet-core/jobs"
import { errorMessageFromUnknown } from "@nulo/wallet-core/utils"
import type { LastProveOutcome, ProveOutcomeHint, ProvePhaseName } from "./models"

const PROVE_PHASES = [
	"detect",
	"secure-connection-unavailable",
	"serialize",
	"transmit",
	"proving",
	"proved",
	"receive",
	"fallback",
	"downloading",
	"denied",
	"version-mismatch",
] as const satisfies readonly ProvePhaseName[]

/** The offscreen event is sender-gated by the transport but its payload is
 *  still untyped bytes until this parse: `seq` drives the ordering check and
 *  `backend` is written to the journal verbatim. */
export const ProvePhaseEventSchema = z.object({
	proveId: z.string().uuid(),
	seq: z.number().int().nonnegative(),
	phase: z.enum(PROVE_PHASES),
	backend: z.enum(["presto", "browser"]).optional(),
})

/** The journal seam the coordinator writes backend evidence through. */
export interface ProveEvidenceSink {
	updateProvingBackend(journalId: string, backend: ProveBackend): Promise<unknown>
}

interface ProveAttempt {
	journalId: string
	/** Highest sequence number accepted so far; lower or equal → stale, dropped. */
	lastSeq: number
	/** Last backend the journal confirmed — the same evidence is not rewritten; a failed write leaves it unchanged so the next event retries. */
	backend?: ProveBackend
	/** `denialGeneration` at dispatch: only an attempt from the current generation may clear a denial. */
	denialGeneration: number
}

/** Journal patches the shared pipeline tail emits. Structural subset of
 *  the operation-journal patch shape — callers bind their own journal id
 *  (or a no-op) in the `markJournal` closure. */
type ProveAndSendJournalPatch =
	| { stage: "proving"; enteredProveAt: number }
	| { stage: "submitting"; txHash: string }
	| { stage: "succeeded"; txHash: string }

/** Everything `proveAndSend` needs. Per-path variation is DATA here —
 *  scopes, journal binding, activity-record shape, offchain extraction —
 *  never op-kind branches inside the coordinator. */
export interface ProveAndSendContext<TOffchain = unknown> {
	pxe: IPXE
	node: AztecNode
	txRequest: TxExecutionRequest
	/** Proving scopes — per-path data. The four call sites differ
	 *  (`[account.address]`, `+additionalScopes`, `scopesWithAccount`);
	 *  the coordinator NEVER computes scopes itself. */
	scopes: AztecAddress[]
	parentTask?: WrappedTask
	/** The op's journal row. The prove attempt's phase events are attributed to
	 *  it; `undefined` (no row) means the attempt emits nothing attributable. */
	journalId?: string
	/** Cancel checkpoint — throws (JobCancelledSentinel) when the op's
	 *  controller aborted. Checked before prove, before toTx, before send. */
	checkCancelled: () => void
	/** Throws unless the session that authorized the op is still live. Awaited
	 *  once the proof exists, before any of it is turned into a tx. */
	assertAuthorization: () => Promise<void>
	/** The same question answered synchronously, in the tick that issues
	 *  `node.sendTx` — no session end can land between the answer and the send. */
	assertLive: () => void
	/** Journal binding. Success-path stages only — failure transitions
	 *  stay in the caller's catch (per-path failure shaping is preserved
	 *  divergent by design). */
	markJournal: (patch: ProveAndSendJournalPatch) => Promise<void>
	/** Offchain-output extraction hook. Runs BETWEEN prove and `toTx()` —
	 *  the only point where `provedTx` is reachable. dApp paths use it;
	 *  transfer paths omit it. */
	wantOffchainOutput?: (provedTx: TxProvingResult) => TOffchain
	/** Persist the activity record after a successful send. Receives the
	 *  txHash string; everything else the record needs is closed over.
	 *  Return value ignored (addTransaction returns the created record). */
	recordTransaction: (txHash: string) => Promise<unknown>
	/** Build provenance: true iff the tx request wrapped the account ctor
	 *  (first-tx multicall). Gates the send-path existing-nullifier
	 *  classification — without it, an ordinary double-spend would be
	 *  mislabeled "account initialized elsewhere". */
	initializesAccount?: boolean
}

/** The fence's two checks, shaped for {@link ProveAndSendContext}. */
export function fenceChecks(
	profile: { assertFence(fence: ExecutionFence): Promise<void>; isFenceLive(fence: ExecutionFence): boolean },
	fence: ExecutionFence,
): Pick<ProveAndSendContext, "assertAuthorization" | "assertLive"> {
	return {
		assertAuthorization: () => profile.assertFence(fence),
		assertLive: () => {
			if (!profile.isFenceLive(fence)) throw new SessionEndedError()
		},
	}
}

/** The send-time validator text for a nullifier-tree membership collision —
 *  Aztec 5.0's "Invalid tx: Existing nullifier". Deliberately NARROW: the
 *  validator's sibling text "Duplicate nullifier in tx" means the same
 *  nullifier twice WITHIN one tx (a malformed tx, no race involved), and the
 *  simulator's "Attempted to emit duplicate nullifier" texts never reach the
 *  send catch — matching either would label a wallet/dApp bug as a benign
 *  race and prescribe an infinite retry. Mined REVERTED receipts carry NO
 *  error data and are never classified. */
function isExistingNullifierError(error: unknown): boolean {
	const message = errorMessageFromUnknown(error)
	return /existing nullifier/i.test(message)
}

export class ExecutionCoordinator {
	/** In-flight prove attempts by `proveId`; an entry lives exactly as long as its `pxe.proveTx` call. */
	private readonly attempts = new Map<string, ProveAttempt>()
	private lastProveOutcome: ProveOutcomeHint | null = null
	private lastDenial: { at: number } | null = null
	/** Bumped on every `denied`; attempts record it at dispatch (see {@link ProveAttempt}). */
	private denialGeneration = 0

	public constructor(
		private readonly tasks: TaskService,
		readonly _logger: ILogger,
		/** Required, never defaulted: a coordinator built without it could broadcast unasked. */
		private readonly legal: LegalAdmission,
		/** E2E-only proving hold-point. The no-op default never blocks, so
		 *  production proving is unimpeded. See {@link ProofGate}. */
		private readonly proofGate: ProofGate = NOOP_PROOF_GATE,
		private readonly evidence?: ProveEvidenceSink,
	) {}

	public getLastProveOutcome(): LastProveOutcome {
		return { outcome: this.lastProveOutcome, denial: this.lastDenial }
	}

	/**
	 * Receive one prove-phase event from the offscreen prover. Memory records and
	 * the ordering check update synchronously; the journal write is awaited
	 * afterwards and never throws into the event path. Unknown or finished
	 * attempts and out-of-order sequence numbers are ignored: the source stamps
	 * both `seq` and `backend`, so a lost or reordered event can only leave the
	 * evidence stale, never make it wrong.
	 */
	public async onProvePhase(raw: unknown): Promise<void> {
		const parsed = ProvePhaseEventSchema.safeParse(raw)
		if (!parsed.success) return
		const event = parsed.data
		const attempt = this.attempts.get(event.proveId)
		if (!attempt || event.seq <= attempt.lastSeq) return
		attempt.lastSeq = event.seq
		const at = Date.now()
		this.lastProveOutcome = { at, phase: event.phase, backend: event.backend }
		if (event.phase === "denied") {
			this.denialGeneration += 1
			this.lastDenial = { at }
		} else if (event.phase === "proved" && event.backend === "presto" && attempt.denialGeneration >= this.denialGeneration) {
			// Presto produced this proof, so approval exists now — unless a newer
			// attempt was denied after this one was dispatched.
			this.lastDenial = null
		}
		if (event.backend === undefined || event.backend === attempt.backend) return
		try {
			await this.evidence?.updateProvingBackend(attempt.journalId, event.backend)
			attempt.backend = event.backend
		} catch (error) {
			this._logger.log("execution", LogLevel.Warn, "prove backend not journaled", { error })
		}
	}

	/** Wrap `pxe.simulateTx` in a TaskService step. Fee strategies pass
	 *  this as a callback so they stay decoupled from TaskService. */
	public async simulateTxTask(
		pxe: IPXE,
		txRequest: TxExecutionRequest,
		opts: SimulateTxOpts & { stubAccountAddresses?: string[] },
		parentTask?: WrappedTask,
	): Promise<TxSimulationResult> {
		const step = new StepContent("Simulating transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.tasks.startNewTask(step)
		try {
			// The stub list rides IPXE.simulateTx's third parameter, not the
			// upstream opts object (the runtime schema-parses opts — an extra
			// key there would be stripped or rejected).
			const { stubAccountAddresses, ...simOpts } = opts
			const simulatedTx = await pxe.simulateTx(txRequest, simOpts, stubAccountAddresses)
			task.complete()
			return simulatedTx
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	/** Wrap `pxe.proveTx` in a TaskService step. Each call is one prove attempt
	 *  with a fresh `proveId`, registered before dispatch so no phase event can
	 *  arrive unmapped and removed in `finally` so a late one is ignored. */
	public async proveTxTask(
		pxe: IPXE,
		txRequest: TxExecutionRequest,
		scopes: AztecAddress[],
		parentTask?: WrappedTask,
		journalId?: string,
	): Promise<TxProvingResult> {
		const step = new StepContent("Generating proof")
		const task = parentTask ? parentTask.startSubtask(step) : this.tasks.startNewTask(step)
		const proveId = crypto.randomUUID()
		if (journalId !== undefined) this.attempts.set(proveId, { journalId, lastSeq: 0, denialGeneration: this.denialGeneration })
		try {
			// E2E-only hold-point. No-op in production. Awaited HERE — after the
			// coordinator journaled `proving`, immediately before `pxe.proveTx`,
			// between the existing pre-/post-prove cancel checkpoints — so the
			// hold replaces prove duration without adding a cancel checkpoint.
			await this.proofGate.wait()
			const provedTx = await pxe.proveTx(txRequest, scopes, proveId)
			task.complete()
			return provedTx
		} catch (error) {
			task.fail(error)
			throw error
		} finally {
			this.attempts.delete(proveId)
		}
	}

	/** Wrap `node.sendTx` in a TaskService step. When `initializesAccount` is
	 *  true, an existing-nullifier rejection is re-thrown as the typed
	 *  {@link DuplicateInitializationError} BEFORE `task.fail`, so the task
	 *  carries the honest copy instead of the raw validator text. `assertLive`
	 *  runs as the statement before the send: nothing may be awaited between.
	 *
	 *  This is the only `node.sendTx` in the wallet, so the Terms check here covers every
	 *  broadcast whatever entry point started it. It is awaited BEFORE `assertLive` for the
	 *  reason above: a session can end while the storage read is in flight. */
	public async sendTxTask(
		node: AztecNode,
		tx: Tx,
		assertLive: () => void,
		parentTask?: WrappedTask,
		initializesAccount?: boolean,
	): Promise<void> {
		const step = new StepContent("Sending transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.tasks.startNewTask(step)
		try {
			await this.legal.assertCurrent()
			assertLive()
			await node.sendTx(tx)
			task.complete()
		} catch (error) {
			const classified =
				initializesAccount === true && isExistingNullifierError(error)
					? new DuplicateInitializationError(undefined, { cause: errorMessageFromUnknown(error) })
					: error
			task.fail(classified)
			throw classified
		}
	}

	/** The shared prove → toTx → send → record → journal SUCCESS pipeline.
	 *
	 *  Owns the success-path stage transitions and the cancel checkpoints;
	 *  callers keep their own catch/finally (failure shaping diverges
	 *  per-path and is preserved verbatim) and their slot/claim handling.
	 *
	 *  Sequence (frozen):
	 *    checkCancelled → journal(proving) → prove → checkCancelled →
	 *    assertAuthorization → [offchain hook] → toTx → journal(submitting) →
	 *    checkCancelled → assertLive + send → record → journal(succeeded)
	 *
	 *  A cancel between prove and send drops the proof artifact silently —
	 *  that is the contract `cancel-mid-prove` pins end-to-end. The
	 *  cancellation checks and the session checks answer different questions:
	 *  a cancel can land while the session stays open, and a session can end
	 *  with no cancel, so neither replaces the other. */
	public async proveAndSend<TOffchain = unknown>(
		ctx: ProveAndSendContext<TOffchain>,
	): Promise<{ txHash: TxHash; offchainOutput?: TOffchain }> {
		ctx.checkCancelled()
		await ctx.markJournal({ stage: "proving", enteredProveAt: Date.now() })
		const provedTx = await this.proveTxTask(ctx.pxe, ctx.txRequest, ctx.scopes, ctx.parentTask, ctx.journalId)
		// Key checkpoint: if cancel fired during prove, this prevents
		// submission. The proof artifact is dropped silently when this throws.
		ctx.checkCancelled()
		await ctx.assertAuthorization()
		const offchainOutput = ctx.wantOffchainOutput?.(provedTx)
		const tx = await provedTx.toTx()
		const txHash = tx.getTxHash()
		await ctx.markJournal({ stage: "submitting", txHash: txHash.toString() })
		ctx.checkCancelled()
		await this.sendTxTask(ctx.node, tx, ctx.assertLive, ctx.parentTask, ctx.initializesAccount)
		await ctx.recordTransaction(txHash.toString())
		await ctx.markJournal({ stage: "succeeded", txHash: txHash.toString() })
		return { txHash, offchainOutput }
	}
}
