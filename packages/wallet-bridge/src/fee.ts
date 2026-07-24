export type FeePaymentMethod = FeeJuicePaymentMethod | FeeJuiceWithClaimPaymentMethod | FpcPaymentMethod | CustomPaymentMethod

export type FeeJuicePaymentMethod = {
	readonly kind: "fj"
}

export type FeeJuiceWithClaimPaymentMethod = {
	readonly kind: "fjwc"
	readonly claimAmount: string
	readonly claimSecret: string
	readonly messageLeafIndex: string
}

export type FpcPaymentMethod = {
	readonly kind: "fpc"
	readonly fpcId: string
}

export type CustomPaymentMethod = {
	readonly kind: "embedded"
}

export type PriorityLevel = "normal" | "fast" | "urgent"

export const PRIORITY_MULTIPLIERS: Record<PriorityLevel, number> = {
	normal: 2,
	fast: 3,
	urgent: 5,
}

export type FeeSettings = {
	readonly paymentMethod: FeePaymentMethod
	readonly priorityLevel?: PriorityLevel
}

export type GasBalances = {
	/** Public FeeJuice balance (raw, 18 decimals) */
	readonly publicFeeJuice: string
	/** Private FeeJuice balance via PrivateFPC (raw, 18 decimals), null if no PrivateFPC */
	readonly privateFeeJuice: string | null
}

export type TransferFeeEstimate = {
	/** Raw max fee as string (bigint serialized) */
	readonly maxFee: string
	/** Human-readable fee amount, e.g. "0.000123" */
	readonly maxFeeFormatted: string
	/** Gas breakdown */
	readonly gasDetails: {
		l2GasLimit: number
		daGasLimit: number
		teardownL2GasLimit: number
		teardownDaGasLimit: number
		feePerL2Gas: string
		feePerDaGas: string
	}
	/** Opaque token the popup hands back to the SW on Confirm to skip the
	 *  redundant `buildAndEstimateTxRequest` round-trip. The SW caches the
	 *  fully-built TxRequest under this id; on `executeTransfer` the SW
	 *  validates a snapshot (base fee + endpoint + actions hash) and reuses
	 *  the cached request when nothing has drifted. Optional — omitted when
	 *  the estimator path doesn't support reuse (e.g., embedded fee
	 *  payments, default_entrypoint dApp txs). See plan-v4 Branch 5. */
	readonly estimateId?: string
}
