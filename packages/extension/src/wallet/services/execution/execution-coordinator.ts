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
import type { Tx, TxExecutionRequest, TxProvingResult, TxSimulationResult } from "@aztec/stdlib/tx"
import type { ILogger } from "@/wallet/logger"
import type { IPXE } from "@/wallet/services/pxe/client"
import { StepContent, type TaskService, type WrappedTask } from "@/wallet/services/task/service"

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
}
