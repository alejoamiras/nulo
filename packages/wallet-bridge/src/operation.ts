import type { CallIntent, IntentInnerHash } from "@aztec/aztec.js/authorization"
import type { InteractionWaitOptions } from "@aztec/aztec.js/contracts"
import type { PrivateEventFilter, ProfileOptions, SendOptions, SimulateOptions, ExecuteUtilityOptions } from "@aztec/aztec.js/wallet"
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact, EventMetadataDefinition, FunctionCall } from "@aztec/stdlib/abi"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import type { ExecutionPayload } from "@aztec/stdlib/tx"
import type { Action, CallAction, EncodedCallAction } from "./action"
import type { FeeSettings } from "./fee"

export type OperationKind = Operation["kind"]

export type Operation =
	// Nulo interface:
	| RegisterContractOperation
	| RegisterSenderOperation
	| RegisterTokenOperation
	| SendTransactionOperation
	| SimulateTransactionOperation
	| SimulateUtilityOperation
	// Aztec.js interface:
	| AztecGetContractClassMetadataOperation
	| AztecGetContractMetadataOperation
	| AztecGetPrivateEventsOperation
	| AztecGetChainInfoOperation
	| AztecRegisterSenderOperation
	| AztecGetAddressBookOperation
	| AztecRegisterContractOperation
	| AztecSimulateTxOperation
	| AztecExecuteUtilityOperation
	| AztecProfileTxOperation
	| AztecSendTxOperation
	| AztecCreateAuthWitOperation

// Nulo interface:

export type RegisterContractOperation = {
	readonly kind: "register_contract"
	readonly networkId: string
	readonly address: string
	readonly instance?: unknown
	readonly artifact?: unknown
}

export type RegisterSenderOperation = {
	readonly kind: "register_sender"
	readonly networkId: string
	readonly address: string
}

export type RegisterTokenOperation = {
	readonly kind: "register_token"
	readonly networkId: string
	readonly accountAddress: string
	readonly address: string
}

export type FeeOptions = {
	readonly embeddedFeePayment?: "fjwc" | "fpc"
	readonly gasLimits?: GasLimits
	readonly teardownGasLimits?: GasLimits
	readonly maxFeesPerGas?: { feePerDaGas: number | string; feePerL2Gas: number | string }
	/** Optional. Undefined means "use upstream default of `GasFees.empty()`".
	 *  Pre-existing serialized `FeeOptions` records without this field are
	 *  treated identically to the empty default, so no data migration is
	 *  needed. Previously, priority fees were dropped silently between the
	 *  dApp's `opts.fee.gasSettings.maxPriorityFeesPerGas` and the local
	 *  shim; carrying this field through fixes that. */
	readonly maxPriorityFeesPerGas?: { feePerDaGas: number | string; feePerL2Gas: number | string }
	readonly gasPadding?: number
}

export type GasLimits = {
	readonly daGas: number
	readonly l2Gas: number
}

export type SendTransactionOperation = {
	readonly kind: "send_transaction"
	readonly networkId: string
	readonly accountAddress: string
	feeSettings: FeeSettings
	readonly actions: Action[]
	readonly fee?: FeeOptions
}

export type SimulateTransactionOperation = {
	readonly kind: "simulate_transaction"
	readonly networkId: string
	readonly accountAddress: string
	readonly actions: Action[]
	readonly fee?: FeeOptions
	readonly simulatePublic?: boolean
}

export type SimulateUtilityOperation = {
	readonly kind: "simulate_utility"
	readonly networkId: string
	readonly accountAddress: string
	readonly contract: string
	readonly method: string
	readonly args: unknown[]
}

// Aztec.js interface:

export type AztecGetContractClassMetadataOperation = {
	readonly kind: "aztec_getContractClassMetadata"
	readonly networkId: string
	readonly id: Fr
}

export type AztecGetContractMetadataOperation = {
	readonly kind: "aztec_getContractMetadata"
	readonly networkId: string
	readonly address: AztecAddress
}

export type AztecGetPrivateEventsOperation = {
	readonly kind: "aztec_getPrivateEvents"
	readonly networkId: string
	readonly eventMetadata: EventMetadataDefinition
	readonly eventFilter: PrivateEventFilter
}

export type AztecGetChainInfoOperation = {
	readonly kind: "aztec_getChainInfo"
	readonly networkId: string
}

export type AztecRegisterSenderOperation = {
	readonly kind: "aztec_registerSender"
	readonly networkId: string
	readonly address: AztecAddress
	readonly alias?: string
}

export type AztecGetAddressBookOperation = {
	readonly kind: "aztec_getAddressBook"
	readonly networkId: string
}

export type AztecRegisterContractOperation = {
	readonly kind: "aztec_registerContract"
	readonly networkId: string
	readonly instance: ContractInstanceWithAddress
	readonly artifact?: ContractArtifact
	readonly secretKey?: Fr
}

export type AztecSimulateTxOperation = {
	readonly kind: "aztec_simulateTx"
	readonly networkId: string
	readonly accountAddress: string
	readonly exec: ExecutionPayload
	readonly opts: SimulateOptions
}

export type AztecExecuteUtilityOperation = {
	readonly kind: "aztec_executeUtility"
	readonly networkId: string
	readonly accountAddress: string
	readonly call: FunctionCall
	readonly opts: ExecuteUtilityOptions
}

export type AztecProfileTxOperation = {
	readonly kind: "aztec_profileTx"
	readonly networkId: string
	readonly accountAddress: string
	readonly exec: ExecutionPayload
	readonly opts: ProfileOptions
}

export type AztecSendTxOperation = {
	readonly kind: "aztec_sendTx"
	readonly networkId: string
	readonly accountAddress: string
	feeSettings: FeeSettings
	readonly exec: ExecutionPayload
	readonly opts: SendOptions<InteractionWaitOptions>
	readonly executionMode?: "account" | "default_entrypoint"
}

export type AztecCreateAuthWitOperation = {
	readonly kind: "aztec_createAuthWit"
	readonly networkId: string
	readonly accountAddress: string
	readonly messageHashOrIntent: IntentInnerHash | CallIntent
}

// ── Draft operations ────────────────────────────────────────────────────────
//
// The executable `Operation` requires `feeSettings` on the two send-like kinds.
// A DRAFT is the same union with `feeSettings` honestly optional — the shape that
// exists (a) in the popup while the user hasn't picked a fee method yet, and (b)
// as the materializer's output before the silent-path fee is asserted. Sharing it
// here (beside `Operation`) lets the dApp-interaction materializer AND the popup
// narrow a draft to `Operation` via the SAME `assertExecutableOperation`
// (operation-validation.ts) instead of an `as unknown as Operation` cast.
// `Operation` itself is intentionally NOT loosened.

/** `aztec_sendTx` with `feeSettings` optional (executable once it's set). */
export type DraftAztecSendTxOperation = Omit<AztecSendTxOperation, "feeSettings"> & {
	feeSettings?: FeeSettings
}

/** `send_transaction` with `feeSettings` optional. */
export type DraftSendTransactionOperation = Omit<SendTransactionOperation, "feeSettings"> & {
	feeSettings?: FeeSettings
}

/** All `Operation` variants, with `feeSettings` optionalised on the two send-like
 *  kinds where the wallet (not the dApp) supplies it. Discriminated by `kind`. */
export type DraftOperation =
	| Exclude<Operation, AztecSendTxOperation | SendTransactionOperation>
	| DraftAztecSendTxOperation
	| DraftSendTransactionOperation
