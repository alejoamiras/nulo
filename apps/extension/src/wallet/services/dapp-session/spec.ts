import { z } from "zod"
import { AccessLevel, type DappPermissions, type GrantedCapabilityRecord, type RejectedCapabilityRecord } from "@nulo/wallet-bridge"

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
	/** F-12: HMAC-SHA256 (base64) over the canonical row minus this field.
	 *  Written on persist, verified on read; a row that fails (or lacks it) is
	 *  dropped so a storage-tampered row can't mint grants. */
	mac?: string
}

const tolerantRecord = (v: unknown) => typeof v === "object" && v !== null

/** Storage codec row schema. Exact on the access-gating fields (permissions,
 *  accounts, confirmationLevel, chain/profile scoping — a drifted session row
 *  is HIDDEN, so the dApp must re-request: fail-closed); tolerant on the deep
 *  wallet-bridge capability records (display + re-grant bookkeeping). */
export const DappSessionSchema: z.ZodType<DappSession> = z.object({
	id: z.string(),
	profileId: z.string(),
	chainId: z.string(),
	dappMetadata: z.object({
		name: z.string().optional(),
		description: z.string().optional(),
		logo: z.string().optional(),
		url: z.string().optional(),
	}),
	permissions: z.array(z.object({ methods: z.array(z.string()).optional(), events: z.array(z.string()).optional() })),
	accounts: z.array(z.string()),
	confirmationLevel: z.nativeEnum(AccessLevel),
	expiry: z.number(),
	verificationHash: z.string().optional(),
	trustedVerification: z.boolean().optional(),
	accountAliases: z.record(z.string(), z.string()).optional(),
	capabilityGrants: z.array(z.custom<GrantedCapabilityRecord>(tolerantRecord)).optional(),
	capabilityRejections: z.array(z.custom<RejectedCapabilityRecord>(tolerantRecord)).optional(),
	// F-12: the per-row integrity tag. Written by `DappSessionMacStorage`, which
	// wraps this store — the schema MUST carry it so the boundary codec doesn't
	// strip the `mac` before the MAC layer can verify it (zod object-parse drops
	// unknown keys). Mirrors the `mac?: string` field on the DappSession type.
	mac: z.string().optional(),
})

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
