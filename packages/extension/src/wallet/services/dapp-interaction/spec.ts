import type { DappSession, DappMetadata } from "@/wallet/services/dapp-session/spec"
import type { Operation } from "@/wallet/services/execution/spec"
import type { LocalTxOrigin } from "@/wallet/services/transaction/spec"
import type { CapabilityParams, CapabilityResult, ExecutionParams, ExecutionResult } from "@nulo/wallet-bridge"

/** Protocol-shape types (`ExecutionParams`, `ExecutionResult`,
 *  `CapabilityParams`, `CapabilityResult`, all `OperationRequest`
 *  variants, `CaipChain`, `CaipAccount`) live in `@nulo/wallet-bridge`.
 *  Re-exported here so extension consumers can keep importing them via
 *  this path. */
export type {
	AztecCreateAuthWitRequest,
	AztecExecuteUtilityRequest,
	AztecGetAddressBookRequest,
	AztecGetChainInfoRequest,
	AztecGetContractClassMetadataRequest,
	AztecGetContractMetadataRequest,
	AztecGetPrivateEventsRequest,
	AztecProfileTxRequest,
	AztecRegisterContractRequest,
	AztecRegisterSenderRequest,
	AztecSendTxRequest,
	AztecSimulateTxRequest,
	CaipAccount,
	CaipChain,
	CapabilityParams,
	CapabilityResult,
	ExecutionParams,
	ExecutionResult,
	GetCompleteAddressRequest,
	OperationRequest,
	RegisterContractRequest,
	RegisterSenderRequest,
	RegisterTokenRequest,
	SendTransactionRequest,
	SimulateTransactionRequest,
	SimulateUtilityRequest,
	SimulateViewsRequest,
} from "@nulo/wallet-bridge"

export const DAPP_INTERACTION_SERVICE_NAME = "dapp-interaction"

export type DappInteraction = {
	id: string
	payload: ExecutionPayload | CapabilityPayload | DiscoveryPayload
	handleId: string
	cancellationToken: string
}

export type ExecutionPayload = {
	params: ExecutionParams
	session: DappSession
}

export type CapabilityPayload = {
	params: CapabilityParams
	session: DappSession
}

export type DiscoveryPayload = {
	params: DiscoveryParams
}

export type DiscoveryParams = {
	dappMetadata: DappMetadata
}

export type DiscoveryResult = {
	approved: boolean
}

export type Methods = {
	getInteractionPayload(id: string): ExecutionPayload | CapabilityPayload | DiscoveryPayload
	approveInteraction(id: string, operations: Operation[], origin: LocalTxOrigin): void
	resolveInteraction(id: string, result: ExecutionResult | CapabilityResult | DiscoveryResult): void
	rejectInteraction(id: string, reason: string): void
}

export type Events = {
	onInteractionCancelled: string
}
