import type { TransferType, LocalTxOrigin } from "@/wallet/services/transaction/spec"
import type { FeeSettings, GasBalances, TransferFeeEstimate, Operation, OperationResult } from "./models"

export const EXECUTION_SERVICE_NAME = "execution"

export * from "./models"

export type Methods = {
	/**
	 * Executes batch request and returns transaction hash.
	 * @param network Network id.
	 * @param account Sender account address.
	 * @param token Token id.
	 * @param transferType Transfer type.
	 * @param recipient Recipient address.
	 * @param amount Amount.
	 */
	executeTransfer(
		networkId: string,
		accountAddress: string,
		tokenId: number,
		transferType: TransferType,
		recipientAddress: string,
		amount: bigint,
		feeSettings: FeeSettings,
		precomputedEstimateId?: string,
	): string
	/**
	 * Executes batch of operations.
	 * @param operations Operations to execute.
	 * @param origin Origin.
	 */
	executeOperations(operations: Operation[], origin: LocalTxOrigin): OperationResult[]

	/**
	 * Returns public FeeJuice balance and private FeeJuice balance (via PrivateFPC).
	 * Cached for 5 minutes in the service worker; pass forceRefresh to bypass.
	 * @param networkId Network id.
	 * @param accountAddress Account address.
	 * @param forceRefresh Bypass cache and fetch fresh values.
	 */
	getGasBalances(networkId: string, accountAddress: string, forceRefresh?: boolean): GasBalances

	/**
	 * Estimates the fee for a transfer without executing it.
	 * Runs simulation in the background and returns fee breakdown.
	 */
	estimateTransferFee(
		networkId: string,
		accountAddress: string,
		tokenId: number,
		transferType: TransferType,
		recipientAddress: string,
		amount: bigint,
		feeSettings: FeeSettings,
	): TransferFeeEstimate

	/**
	 * Estimates the fee for a pre-built operation (send_transaction or aztec_sendTx).
	 */
	estimateOperationFee(operation: Operation, feeSettings: FeeSettings): TransferFeeEstimate

	/**
	 * Cancel an in-flight job by its operation-journal id.
	 *
	 * Lossy-cancel semantics: the journal is transitioned to
	 * `cancelled` synchronously and the SW-side AbortSignal for that job
	 * is fired. The underlying prove call may still be running in the
	 * offscreen document (BB.wasm can't be preempted); its result is
	 * dropped silently when it eventually resolves.
	 *
	 * Submission is blocked: the SW pipeline checks `signal.aborted` at
	 * each stage boundary and short-circuits before `sendTxTask`. If the
	 * cancel arrives once the journal has already transitioned to
	 * `submitting` (the broadcast is in flight), the FSM rejects the
	 * `submitting → cancelled` transition and `cancelJob` drops the
	 * abort signal silently — the flow proceeds to its natural
	 * `succeeded` / `failed` terminal. This was the codex W2 review
	 * fix: pre-fix the journal would flip to cancelled while the tx
	 * still landed on chain, producing a contradictory record.
	 *
	 * No-op for unknown jobIds or jobs that already terminated.
	 */
	cancelJob(jobId: string): void
}
