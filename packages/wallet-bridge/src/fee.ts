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
	/** Public FeeJuice balance (raw, 18 decimals). Null = UNKNOWN (the read
	 *  failed or timed out) — never a fabricated zero. Consumers must fail
	 *  closed on null for anything gating-grade; only a confirmed "0" is a
	 *  real empty balance. */
	readonly publicFeeJuice: string | null
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
	/** Key of the SW-owned preview snapshot this estimate wrote (equals `estimateId`
	 *  when both exist). Confirm refuses to sign an authorization the snapshot
	 *  under this id never listed. */
	readonly previewId?: string
	/** Private authorizations the wallet found it must sign while estimating a
	 *  dApp `aztec_sendTx`. Omitted where confirm adds none (`send_transaction`,
	 *  the Send page). */
	readonly discoveredAuthwits?: readonly DiscoveredAuthwit[]
}

/** One private authorization discovered by simulation: the call it authorizes,
 *  decoded from the `CallAuthorizationRequest` the contract emitted, with the
 *  message hash the wallet would sign. Every field is stringified — the record
 *  crosses the RPC boundary as JSON. */
export type DiscoveredAuthwit = {
	/** Contract that will consume the witness. */
	readonly consumer: string
	/** Address performing the authorized call (the delegate). */
	readonly caller: string
	/** Selector of the authorized function. */
	readonly selector: string
	/** Arguments of the authorized call, as field strings. */
	readonly args: readonly string[]
	readonly innerHash: string
	readonly messageHash: string
}

/** Result of a NO_FROM (`default_entrypoint`) authorization preview: the
 *  discovered set the wallet would sign at confirm, without signing. */
export type OperationAuthwitPreview = {
	readonly previewId: string
	readonly discoveredAuthwits: readonly DiscoveredAuthwit[]
}
