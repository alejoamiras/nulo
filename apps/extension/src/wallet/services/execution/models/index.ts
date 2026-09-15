/** Operation type family lives in `@nulo/wallet-bridge`. This barrel
 *  re-exports the types so extension consumers can keep importing them
 *  from `@/wallet/services/execution/service`. */
export type {
	Action,
	ActionKind,
	AddCapsuleAction,
	AddExtraArgsAction,
	AddPrivateAuthwitAction,
	AddPublicAuthwitAction,
	CallAction,
	EncodedCallAction,
} from "@nulo/wallet-bridge"
export type {
	AuthwitContent,
	CallAuthwitContent,
	EncodedCallAuthwitContent,
	IntentAuthwitContent,
	MessageHashAuthwitContent,
} from "@nulo/wallet-bridge"
export type {
	CustomPaymentMethod,
	FeeJuicePaymentMethod,
	FeeJuiceWithClaimPaymentMethod,
	FeePaymentMethod,
	FeeSettings,
	FpcPaymentMethod,
	GasBalances,
	PriorityLevel,
	TransferFeeEstimate,
	DiscoveredAuthwit,
	OperationAuthwitPreview,
} from "@nulo/wallet-bridge"
export { PRIORITY_MULTIPLIERS } from "@nulo/wallet-bridge"
export type {
	AztecCreateAuthWitOperation,
	AztecExecuteUtilityOperation,
	AztecGetAddressBookOperation,
	AztecGetChainInfoOperation,
	AztecGetContractClassMetadataOperation,
	AztecGetContractMetadataOperation,
	AztecGetPrivateEventsOperation,
	AztecProfileTxOperation,
	AztecRegisterContractOperation,
	AztecRegisterSenderOperation,
	AztecSendTxOperation,
	AztecSimulateTxOperation,
	FeeOptions,
	GasLimits,
	Operation,
	OperationKind,
	RegisterContractOperation,
	RegisterSenderOperation,
	RegisterTokenOperation,
	SendTransactionOperation,
	SimulateTransactionOperation,
	SimulateUtilityOperation,
} from "@nulo/wallet-bridge"
export type {
	FailedOperationResult,
	OkOperationResult,
	OperationResult,
	SkippedOperationResult,
} from "@nulo/wallet-bridge"

/** Where a popup approval binds one operation's execution: the stored dApp
 *  interaction and the operation's index in it, plus the SW-minted ids the
 *  popup handed back. The silent path carries none — its executions are not
 *  held to a preview. */
export type OperationApprovalEnvelope = {
	readonly interactionId: string
	readonly index: number
	/** Estimate→confirm reuse id (standard-mode `aztec_sendTx`). */
	readonly estimateId?: string
	/** Preview-snapshot key: the discovered authorizations the card showed. */
	readonly previewId?: string
}

/** The `(interactionId, index)` a preview or estimate is written under. */
export type PreviewContext = Pick<OperationApprovalEnvelope, "interactionId" | "index">
import type { ProveBackend } from "@nulo/wallet-core/jobs"

/** Every phase the Presto SDK emits; the coordinator drops anything else at the wire. */
export type ProvePhaseName =
	| "detect"
	| "secure-connection-unavailable"
	| "serialize"
	| "transmit"
	| "proving"
	| "proved"
	| "receive"
	| "fallback"
	| "downloading"
	| "denied"
	| "version-mismatch"

/** The latest accepted prove-phase event, as a hint for the UI. */
export interface ProveOutcomeHint {
	at: number
	phase: ProvePhaseName
	backend?: ProveBackend
}

/**
 * SW-memory records (both reset on SW restart — the journal is the record,
 * these are hints). `denial` is held apart from `outcome` because later phases
 * of the same attempt (`fallback`, `proving`, `proved`) would otherwise bury
 * the one phase Settings needs to explain a WASM proof.
 */
export interface LastProveOutcome {
	outcome: ProveOutcomeHint | null
	denial: { at: number } | null
}
