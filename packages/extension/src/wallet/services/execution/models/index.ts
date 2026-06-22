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

import type { RegisterTokenOperation } from "@nulo/wallet-bridge"
import type { TokenInterface } from "@/wallet/services/token/spec"

/**
 * Materialized form of `RegisterTokenOperation` carrying the optional
 * `previewedInterface` hint that the popup attaches in its approve mapper
 * after `previewTokenMetadata` resolves. The wire `RegisterTokenOperation`
 * in `@nulo/wallet-bridge` stays clean of any `TokenInterface` import
 * (wallet-bridge has no dependency on extension types — layer hierarchy
 * forbids it). The executor accepts this extended type, validates
 * `previewedInterface.contract === op.address` + `chainId === network.chainId`
 * before trusting the hint, and falls back to `parseTokenInterface` on mismatch.
 */
export type MaterializedRegisterTokenOperation = RegisterTokenOperation & {
	readonly previewedInterface?: TokenInterface
}
