/**
 * Structural service interfaces consumed by the wallet-sdk dispatcher.
 *
 * The dispatcher deliberately does NOT import the concrete service
 * classes (`NetworkService`, `AccountService`, …). Those live in
 * `@nulo/extension` and are not reachable from `wallet-bridge`. The
 * dispatcher depends on these interfaces; the real services satisfy
 * them structurally at the wiring site (`background.ts`).
 *
 * These are narrowed CONSUMER interfaces — they declare only the methods
 * and parameters the dispatcher actually uses, not exact mirrors of each
 * service's full public API. Extra optional parameters on the real
 * services (e.g. `AccountService.getAccounts`'s `all?: boolean`,
 * `ExecutionService.executeOperations`'s `parentTask?: WrappedTask`) are
 * fine — concrete implementations stay assignable via TypeScript's
 * function-parameter bivariance for optional trailing params.
 *
 * Domain types (`INetworkRef`, `IAccountRef`, `IDappSessionRef`,
 * `Operation`, `OperationResult`, …) all live in `@nulo/wallet-bridge`.
 */

import type { GrantedCapabilityRecord, RejectedCapabilityRecord } from "./capabilities"
import type { CapabilityParams, CapabilityResult, ExecutionParams, ExecutionResult } from "./dapp-interaction-protocol"
import type { Operation } from "./operation"
import type { OperationResult } from "./operation-result"
import type { AccessLevel, DappPermissions, IAccountRef, IDappSessionRef, INetworkRef } from "./session-types"
import type { LocalTxOrigin } from "./transaction-origin"

export interface INetworkReader {
	getNetworks(chainId?: number): Promise<INetworkRef[]>
}

export interface IAccountReader {
	getAccounts(profileId: string, chainId: number): Promise<IAccountRef[]>
}

/**
 * Optional execution hooks bag. `onExecutionEnqueued` is invoked by the wallet
 * once the approved request has taken its place in the per-(profileId, chainId)
 * execution FIFO (the execution mutex). That — not popup approval — is the
 * point at which releasing the caller's session FIFO baton is safe: any later
 * request necessarily enqueues strictly behind this one, so execution order is
 * preserved while popups still open concurrently. `queuedJournalId` lets the
 * message-arrival layer pass a pre-allocated journal id (so the in-flight
 * surface is visible in the activity feed before the handler runs).
 *
 * `originKey` is the canonical browser origin of the calling dApp (NOT a display
 * name or sessionId). It scopes the per-origin execution-mutex backpressure cap
 * so one dApp can't monopolize the shared `(profileId, chainId)` lane and starve
 * another. The dispatcher sets it from `ctx.origin` on every sendTx.
 *
 * Kept as a structural type so wallet-bridge doesn't import from the extension
 * package. The extension's `ExecutionHooks` aliases this type directly, so the
 * field set stays in lockstep across the layer boundary.
 */
export interface IExecutionHooks {
	onExecutionEnqueued?: () => void
	queuedJournalId?: string
	originKey?: string
}

export interface IExecutionRunner {
	executeOperations(
		operations: Operation[],
		origin: LocalTxOrigin,
		parentTaskOrHooks?: unknown,
		hooks?: IExecutionHooks,
	): Promise<OperationResult[]>
}

export interface IDappInteractionRunner {
	execute(params: ExecutionParams, cancellationToken?: string, hooks?: IExecutionHooks): Promise<ExecutionResult>
	requestCapabilities(params: CapabilityParams, cancellationToken?: string): Promise<CapabilityResult>
}

export interface IDappSessionWriter {
	/** Look up a remembered session by `(origin, chainId)`. Sessions are
	 *  per-`(origin, chainId, profileId)` — a `chainId` is REQUIRED so a
	 *  session remembered on testnet does not silently auto-approve on
	 *  mainnet. Returns `undefined` when no matching session exists. */
	tryGetDappSessionByOriginAndChain(origin: string, chainId: string): Promise<IDappSessionRef | undefined>
	getDappSession(id: string): Promise<IDappSessionRef>
	updateDappSession(
		id: string,
		permissions: DappPermissions[],
		accounts: string[],
		confirmationLevel: AccessLevel,
	): Promise<IDappSessionRef>
	setAccountAliases(id: string, aliases: Record<string, string>): Promise<IDappSessionRef>
	setCapabilityGrants(id: string, grants: GrantedCapabilityRecord[]): Promise<IDappSessionRef>
	setCapabilityRejections(id: string, rejections: RejectedCapabilityRecord[]): Promise<IDappSessionRef>
}

/** Aggregated services dependency container. Exported for consumers
 *  that want to build a dispatcher test fixture without knowing the
 *  individual interface names — the constructor takes the five
 *  services as separate positional arguments, not this aggregate. */
export interface IDispatcherServices {
	networkService: INetworkReader
	accountService: IAccountReader
	executionService: IExecutionRunner
	dappInteractionService: IDappInteractionRunner
	dappSessionService: IDappSessionWriter
}
