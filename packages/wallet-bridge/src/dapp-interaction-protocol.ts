// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
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
	RegisterContractOperation,
	RegisterSenderOperation,
	RegisterTokenOperation,
	SendTransactionOperation,
	SimulateTransactionOperation,
	SimulateUtilityOperation,
} from "./operation"
import type { OperationResult } from "./operation-result"

type NetworkParams = "networkId"
type AccountParams = NetworkParams | "accountAddress"
type SendParams = AccountParams | "feeSettings"

// Nulo interface:

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
	| RegisterContractRequest
	| RegisterSenderRequest
	| RegisterTokenRequest
	| SendTransactionRequest
	| SimulateTransactionRequest
	| SimulateUtilityRequest
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
	/** Every stored grant at dispatch entry, for the defaults, the fold and Details;
	 *  `existingGrants` drops a type with a stored rejection, for the echo. */
	heldGrants?: unknown[]
	/** The consent at dispatch entry; the window never reads the session it re-reads. */
	authorizationsWithoutAsking?: { broad: boolean }
	reRequested?: string[]
	availableAccounts?: Array<{ address: string; name: string; chainId: number }>
	/** The session's accounts on its chain at dispatch entry; `name` is the wallet's own, absent for
	 *  an account the wallet no longer lists. */
	heldAccounts?: Array<{ address: string; name?: string }>
	/** Raw hex addresses the session already holds on its chain (wallet-derived). Present only
	 *  when the session has an accounts grant: the popup locks these rows and pre-selects them. */
	grantedAccounts?: string[]
	/** The accounts request differs from the stored grant only by membership (same flags): the
	 *  authorizations permission shows as already granted and the decision never replaces the
	 *  grant. */
	accountsMembershipOnly?: boolean
	/** Contracts the wallet names by construction, addresses lower-cased. The wallet sets it when it
	 *  opens the window, replacing any value that arrived with the request. */
	knownContracts?: Array<{ address: string; name: string }>
}

export type CapabilityResult = {
	granted: unknown[]
	selectedAccounts?: string[]
	accountAliases?: Record<string, string>
	/** Present only when the window showed the authorizations switch. */
	authorizationsWithoutAsking?: boolean
}
