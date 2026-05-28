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
	OperationRequest,
	RegisterContractRequest,
	RegisterSenderRequest,
	RegisterTokenRequest,
	SendTransactionRequest,
	SimulateTransactionRequest,
	SimulateUtilityRequest,
} from "@nulo/wallet-bridge"

export const DAPP_INTERACTION_SERVICE_NAME = "dapp-interaction"

/**
 * Execution-side hooks carried across the popup handoff.
 *
 * The user-approval popup splits the request handling into two phases:
 *
 *   1) `interaction()` opens the popup, returns a `handle.promise` that
 *      resolves with the final ExecutionResult.
 *   2) After the user approves, the popup calls `approveInteraction(id, ...)`
 *      which then dispatches `executeAndResolve` to actually run the operation.
 *
 * The hooks must survive that gap — they're set on the interaction record at
 * step 1, picked up by `executeAndResolve` at step 2. Without this storage,
 * the hooks would die at step 1's return and the post-popup execution path
 * would never see them.
 */
export type ExecutionHooks = {
	/** Release the wallet-sdk session FIFO baton when the txRequest is built. */
	onTxRequestFinalized?: () => void
	/**
	 * Pre-allocated journal id from `background.ts:onWalletMessage`. Handler
	 * claims (queued → pending) this record instead of creating a new one.
	 */
	queuedJournalId?: string
}

export type DappInteraction = {
	id: string
	payload: ExecutionPayload | CapabilityPayload | DiscoveryPayload
	handleId: string
	cancellationToken: string
	/**
	 * Hooks bag carried across the popup handoff. `interaction()` sets it;
	 * `approveInteraction → executeAndResolve` reads it back via storage
	 * lookup. Undefined for popups that don't carry execution hooks (e.g.
	 * verify, discover).
	 */
	hooks?: ExecutionHooks
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
