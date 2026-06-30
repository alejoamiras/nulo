import type { ServiceSpec } from "@/wallet/base"
import { ServiceClient } from "@nulo/extension-messaging/background"
import { LoggerServiceClient } from "@/wallet/services/logger/client"
import type { TransferType, LocalTxOrigin } from "@/wallet/services/transaction/service"
import {
	EXECUTION_SERVICE_NAME,
	type FeeSettings,
	type GasBalances,
	type TransferFeeEstimate,
	type Operation,
	type OperationResult,
	type Methods,
} from "./spec"

export * from "./spec"

export class ExecutionServiceClient extends ServiceClient<Methods> implements ServiceSpec<Methods> {
	public constructor(name?: string) {
		super(EXECUTION_SERVICE_NAME, new LoggerServiceClient(), name)
	}

	public executeTransfer(
		networkId: string,
		accountAddress: string,
		tokenId: number,
		transferType: TransferType,
		recipientAddress: string,
		amount: bigint,
		feeSettings: FeeSettings,
		precomputedEstimateId?: string,
	): Promise<string> {
		return this.request(
			"executeTransfer",
			networkId,
			accountAddress,
			tokenId,
			transferType,
			recipientAddress,
			amount,
			feeSettings,
			precomputedEstimateId,
		)
	}

	public executeOperations(operations: Operation[], origin: LocalTxOrigin): Promise<OperationResult[]> {
		return this.request("executeOperations", operations, origin)
	}

	public getGasBalances(networkId: string, accountAddress: string, forceRefresh?: boolean): Promise<GasBalances> {
		return this.request("getGasBalances", networkId, accountAddress, forceRefresh)
	}

	public estimateTransferFee(
		networkId: string,
		accountAddress: string,
		tokenId: number,
		transferType: TransferType,
		recipientAddress: string,
		amount: bigint,
		feeSettings: FeeSettings,
	): Promise<TransferFeeEstimate> {
		return this.request("estimateTransferFee", networkId, accountAddress, tokenId, transferType, recipientAddress, amount, feeSettings)
	}

	public estimateOperationFee(operation: Operation, feeSettings: FeeSettings): Promise<TransferFeeEstimate> {
		return this.request("estimateOperationFee", operation, feeSettings)
	}

	/**
	 * Cancel an in-flight job by its operation-journal id. Lossy-cancel
	 * semantics — see {@link Methods.cancelJob}.
	 *
	 * Idempotent: no-op for unknown ids or already-terminated jobs.
	 */
	public cancelJob(jobId: string): Promise<void> {
		return this.request("cancelJob", jobId)
	}
}
