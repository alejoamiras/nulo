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
	GetCompleteAddressOperation,
	Operation,
	OperationKind,
	RegisterContractOperation,
	RegisterSenderOperation,
	RegisterTokenOperation,
	SendTransactionOperation,
	SimulateTransactionOperation,
	SimulateUtilityOperation,
	SimulateViewsOperation,
} from "@nulo/wallet-bridge"
export type {
	FailedOperationResult,
	OkOperationResult,
	OperationResult,
	SkippedOperationResult,
} from "@nulo/wallet-bridge"
