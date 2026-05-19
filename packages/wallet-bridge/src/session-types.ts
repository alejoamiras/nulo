import type { GrantedCapabilityRecord, RejectedCapabilityRecord } from "./capabilities"

/** The dApp's requested method / event surface — passed through by the
 *  dispatcher unchanged. Lives in `wallet-bridge` alongside `AccessLevel`
 *  so the dispatcher's session-writer contract can accept the same
 *  concrete type the extension's session service returns.
 *
 *  Chain is NOT a field on `DappPermissions`. Sessions are per
 *  `(origin, chainId, profileId)` and the parent `DappSession.chainId`
 *  scopes the entire permissions list — so the permissions shape can't
 *  drift from the session-lookup model. */
export type DappPermissions = {
	methods?: string[]
	events?: string[]
}

/** Confirmation-prompt strictness for a dApp session. The enum is numeric and
 *  opaque to the dispatcher (it only ferries the value between get/update
 *  calls), but the value comparisons happen in the extension (confirmation
 *  policies + dapp-interaction service), so the enum stays as a value export. */
export enum AccessLevel {
	None = 0,
	AppState = 1,
	PublicData = 2,
	PxeState = 3,
	PrivateData = 4,
	Transactions = 5,
}

/** Structural subset of `Network` used by the dispatcher — only `.id`
 *  and `.chainId` are read directly. The network model guarantees exactly
 *  one `Network` per `(profileId, chainId)` pair, so no `isDefault`
 *  disambiguation is needed. */
export interface INetworkRef {
	readonly id: string
	readonly chainId: number
}

/** Structural subset of Account used by the dispatcher — only `.address`,
 *  `.name`, `.chainId` are read. */
export interface IAccountRef {
	readonly address: string
	readonly name: string
	readonly chainId: number
}

/** Structural subset of `DappSession` used by the dispatcher. Covers
 *  every `session.*` access inside `dispatcher.ts`. `permissions` and
 *  `confirmationLevel` are pass-through fields (get → update), so they
 *  use the shared `wallet-bridge` vocabulary so concrete impls satisfy
 *  this structurally.
 *
 *  `chainId` is REQUIRED. Sessions are per-`(origin, chainId)` so a
 *  remembered dApp on testnet does not silently auto-approve on
 *  mainnet. Stored as `string` for storage-key parity with the existing
 *  chain-string format. */
export interface IDappSessionRef {
	readonly id: string
	readonly chainId: string
	readonly accounts: string[]
	readonly permissions: DappPermissions[]
	readonly confirmationLevel: AccessLevel
	readonly accountAliases?: Record<string, string>
	readonly capabilityGrants?: GrantedCapabilityRecord[]
	readonly capabilityRejections?: RejectedCapabilityRecord[]
}
