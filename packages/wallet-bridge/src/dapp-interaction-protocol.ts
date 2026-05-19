/** Protocol-shape types for dApp-initiated interactions.
 *
 *  These mirror each `Operation` variant but replace `networkId` /
 *  `accountAddress` with CAIP-2 / CAIP-10 identifiers — the shape dApps
 *  actually send over the wire. The wallet-sdk dispatcher and the
 *  extension's DappInteractionService both consume them.
 *
 *  Lives in wallet-bridge because the dispatcher (also moving to
 *  wallet-bridge) needs them at the protocol boundary. */

import type { CaipAccount, CaipChain } from "./caip"
import type {
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
	GetCompleteAddressOperation,
	RegisterContractOperation,
	RegisterSenderOperation,
	RegisterTokenOperation,
	SendTransactionOperation,
	SimulateTransactionOperation,
	SimulateUtilityOperation,
	SimulateViewsOperation,
} from "./operation"
import type { OperationResult } from "./operation-result"

type NetworkParams = "networkId"
type AccountParams = NetworkParams | "accountAddress"
type SendParams = AccountParams | "feeSettings"

// Nulo interface:

export type GetCompleteAddressRequest = Omit<GetCompleteAddressOperation, AccountParams> & {
	account: CaipAccount
}

export type RegisterContractRequest = Omit<RegisterContractOperation, NetworkParams> & {
	chain: CaipChain
}

export type RegisterSenderRequest = Omit<RegisterSenderOperation, NetworkParams> & {
	chain: CaipChain
}

export type RegisterTokenRequest = Omit<RegisterTokenOperation, AccountParams> & {
	account: CaipAccount
}

export type SendTransactionRequest = Omit<SendTransactionOperation, SendParams> & {
	account: CaipAccount
}

export type SimulateTransactionRequest = Omit<SimulateTransactionOperation, AccountParams> & {
	account: CaipAccount
}

export type SimulateUtilityRequest = Omit<SimulateUtilityOperation, AccountParams> & {
	account: CaipAccount
}

export type SimulateViewsRequest = Omit<SimulateViewsOperation, AccountParams> & {
	account: CaipAccount
}

// Aztec.js interface:

export type AztecGetContractClassMetadataRequest = Omit<AztecGetContractClassMetadataOperation, NetworkParams> & {
	chain: CaipChain
}

export type AztecGetContractMetadataRequest = Omit<AztecGetContractMetadataOperation, NetworkParams> & {
	chain: CaipChain
}

export type AztecGetPrivateEventsRequest = Omit<AztecGetPrivateEventsOperation, NetworkParams> & {
	chain: CaipChain
}

export type AztecGetChainInfoRequest = Omit<AztecGetChainInfoOperation, NetworkParams> & {
	chain: CaipChain
}

export type AztecRegisterSenderRequest = Omit<AztecRegisterSenderOperation, NetworkParams> & {
	chain: CaipChain
}

export type AztecGetAddressBookRequest = Omit<AztecGetAddressBookOperation, NetworkParams> & {
	chain: CaipChain
}

export type AztecRegisterContractRequest = Omit<AztecRegisterContractOperation, NetworkParams> & {
	chain: CaipChain
}

export type AztecSimulateTxRequest = Omit<AztecSimulateTxOperation, AccountParams> & {
	account: CaipAccount
}

export type AztecExecuteUtilityRequest = Omit<AztecExecuteUtilityOperation, AccountParams> & {
	account: CaipAccount
}

export type AztecProfileTxRequest = Omit<AztecProfileTxOperation, AccountParams> & {
	account: CaipAccount
}

export type AztecSendTxRequest = Omit<AztecSendTxOperation, SendParams> & {
	account: CaipAccount
}

export type AztecCreateAuthWitRequest = Omit<AztecCreateAuthWitOperation, AccountParams> & {
	account: CaipAccount
}

export type OperationRequest =
	// Nulo interface:
	| GetCompleteAddressRequest
	| RegisterContractRequest
	| RegisterSenderRequest
	| RegisterTokenRequest
	| SendTransactionRequest
	| SimulateTransactionRequest
	| SimulateUtilityRequest
	| SimulateViewsRequest
	// Aztec.js interface:
	| AztecGetContractClassMetadataRequest
	| AztecGetContractMetadataRequest
	| AztecGetPrivateEventsRequest
	| AztecGetChainInfoRequest
	| AztecRegisterSenderRequest
	| AztecGetAddressBookRequest
	| AztecRegisterContractRequest
	| AztecSimulateTxRequest
	| AztecExecuteUtilityRequest
	| AztecProfileTxRequest
	| AztecSendTxRequest
	| AztecCreateAuthWitRequest

export type ExecutionParams = {
	sessionId: string
	operations: OperationRequest[]
}

export type ExecutionResult = OperationResult[]

export type CapabilityParams = {
	sessionId: string
	manifest: unknown
	delta: unknown[]
	existingGrants: unknown[]
	reRequested?: string[]
	availableAccounts?: Array<{ address: string; name: string; chainId: number }>
}

export type CapabilityResult = {
	granted: unknown[]
	selectedAccounts?: string[]
	accountAliases?: Record<string, string>
}
