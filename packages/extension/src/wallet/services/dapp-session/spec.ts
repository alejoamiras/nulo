import type { AccessLevel, DappPermissions, GrantedCapabilityRecord, RejectedCapabilityRecord } from "@nulo/wallet-bridge"

export const DAPP_SESSION_SERVICE_NAME = "dapp-session"

/**
 * Capability + scope types + AccessLevel + DappPermissions live in
 * `@nulo/wallet-bridge` (they belong to the wallet-sdk dispatcher layer,
 * not session storage). Re-exported here for backward compatibility with
 * existing consumers of `dapp-session/spec.ts`.
 */
export { AccessLevel } from "@nulo/wallet-bridge"
export type {
	AccountsCapability,
	Capability,
	ContractClassesCapability,
	ContractsCapability,
	DappPermissions,
	DataCapability,
	GrantedCapabilityRecord,
	RejectedCapabilityRecord,
	Scope,
	ScopePattern,
	SimulationCapability,
	TransactionCapability,
} from "@nulo/wallet-bridge"

export type DappMetadata = {
	name?: string
	description?: string
	logo?: string
	url?: string
}

export type DappSession = {
	id: string
	profileId: string
	/** Aztec chain id (composite `l1ChainId XOR rollupVersion`) as a
	 *  string, scoping the session. Sessions are per
	 *  `(origin, chainId, profileId)` — `chainId` is required so a session
	 *  remembered on testnet does not silently auto-approve on mainnet. */
	chainId: string
	dappMetadata: DappMetadata
	permissions: DappPermissions[]
	accounts: string[]
	confirmationLevel: AccessLevel
	expiry: number
	verificationHash?: string
	trustedVerification?: boolean
	accountAliases?: Record<string, string>
	capabilityGrants?: GrantedCapabilityRecord[]
	capabilityRejections?: RejectedCapabilityRecord[]
}

export type Methods = {
	getDappSessions(): DappSession[]
	getDappSession(sessionId: string): DappSession
	addDappSession(
		dappMetadata: DappMetadata,
		permissions: DappPermissions[],
		accounts: string[],
		confirmationLevel: AccessLevel,
		chainId: string,
	): DappSession
	updateDappSession(sessionId: string, permissions: DappPermissions[], accounts: string[], confirmationLevel: AccessLevel): DappSession
	deleteDappSession(sessionId: string): DappSession
	setVerificationHash(sessionId: string, verificationHash: string): DappSession
	setTrustedVerification(sessionId: string, trusted: boolean): DappSession
	setAccountAliases(sessionId: string, aliases: Record<string, string>): DappSession
	setCapabilityGrants(sessionId: string, grants: GrantedCapabilityRecord[]): DappSession
	getCapabilityGrants(sessionId: string): GrantedCapabilityRecord[]
	setCapabilityRejections(sessionId: string, rejections: RejectedCapabilityRecord[]): DappSession
	getCapabilityRejections(sessionId: string): RejectedCapabilityRecord[]
}

export type Events = {
	onDappSessionAdded: DappSession
	onDappSessionUpdated: DappSession
	onDappSessionDeleted: DappSession
}
