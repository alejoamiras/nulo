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
import type { ILogger } from "@/wallet/logger"
import type { IPXE } from "@/wallet/services/pxe/client"
import { StepContent, type TaskService, type WrappedTask } from "@/wallet/services/task/service"

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
	/** Cancel checkpoint — throws (JobCancelledSentinel) when the op's
	 *  controller aborted. Checked before prove, before toTx, before send. */
	checkCancelled: () => void
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
}

export class ExecutionCoordinator {
	public constructor(
		private readonly tasks: TaskService,
		readonly _logger: ILogger,
	) {}

	/** Wrap `pxe.simulateTx` in a TaskService step. Fee strategies pass
	 *  this as a callback so they stay decoupled from TaskService. */
	public async simulateTxTask(
		pxe: IPXE,
		txRequest: TxExecutionRequest,
		opts: SimulateTxOpts,
		parentTask?: WrappedTask,
	): Promise<TxSimulationResult> {
		const step = new StepContent("Simulating transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.tasks.startNewTask(step)
		try {
			const simulatedTx = await pxe.simulateTx(txRequest, opts)
			task.complete()
			return simulatedTx
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	/** Wrap `pxe.proveTx` in a TaskService step. */
	public async proveTxTask(
		pxe: IPXE,
		txRequest: TxExecutionRequest,
		scopes: AztecAddress[],
		parentTask?: WrappedTask,
	): Promise<TxProvingResult> {
		const step = new StepContent("Generating proof")
		const task = parentTask ? parentTask.startSubtask(step) : this.tasks.startNewTask(step)
		try {
			const provedTx = await pxe.proveTx(txRequest, scopes)
			task.complete()
			return provedTx
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	/** Wrap `node.sendTx` in a TaskService step. */
	public async sendTxTask(node: AztecNode, tx: Tx, parentTask?: WrappedTask): Promise<void> {
		const step = new StepContent("Sending transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.tasks.startNewTask(step)
		try {
			await node.sendTx(tx)
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	/** The shared prove → toTx → send → record → journal SUCCESS pipeline.
	 *
	 *  Owns the success-path stage transitions and the cancel checkpoints;
	 *  callers keep their own catch/finally (failure shaping diverges
	 *  per-path and is preserved verbatim) and their slot/claim handling.
	 *
	 *  Sequence (frozen — extracted byte-for-byte from the four send
	 *  paths):
	 *    checkCancelled → journal(proving) → prove → checkCancelled →
	 *    [offchain hook] → toTx → journal(submitting) → checkCancelled →
	 *    send → record → journal(succeeded)
	 *
	 *  A cancel between prove and send drops the proof artifact silently —
	 *  that is the contract `cancel-mid-prove` pins end-to-end. */
	public async proveAndSend<TOffchain = unknown>(
		ctx: ProveAndSendContext<TOffchain>,
	): Promise<{ txHash: TxHash; offchainOutput?: TOffchain }> {
		ctx.checkCancelled()
		await ctx.markJournal({ stage: "proving", enteredProveAt: Date.now() })
		const provedTx = await this.proveTxTask(ctx.pxe, ctx.txRequest, ctx.scopes, ctx.parentTask)
		// Key checkpoint: if cancel fired during prove, this prevents
		// submission. The proof artifact is dropped silently when this throws.
		ctx.checkCancelled()
		const offchainOutput = ctx.wantOffchainOutput?.(provedTx)
		const tx = await provedTx.toTx()
		const txHash = tx.getTxHash()
		await ctx.markJournal({ stage: "submitting", txHash: txHash.toString() })
		ctx.checkCancelled()
		await this.sendTxTask(ctx.node, tx, ctx.parentTask)
		await ctx.recordTransaction(txHash.toString())
		await ctx.markJournal({ stage: "succeeded", txHash: txHash.toString() })
		return { txHash, offchainOutput }
	}
}
