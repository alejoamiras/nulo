import { z } from "zod"
import type { FnImpl } from "@/wallet/utils/fn"
import type { OperationContext } from "@/wallet/services/operation-journal/spec"

export const TOKEN_SERVICE_NAME = "token"

/** EntityStorage root for token rows (keyed by `String(token.id)`). Frozen:
 *  renaming detaches every existing row; the backup-migration registry pins it. */
export const TOKEN_STORAGE_ROOT = "nulo:core:tokens"

export type Token = {
	id: number
	profileId: string

	chainId: number
	contract: string

	name: string
	symbol: string
	decimals: number

	getNameFn?: FnImpl
	getSymbolFn?: FnImpl
	getDecimalsFn?: FnImpl
	balanceOfPublicFn?: FnImpl
	balanceOfPrivateFn?: FnImpl
	transferPublicFn?: FnImpl
	transferPrivateFn?: FnImpl
	transferPublicToPrivateFn?: FnImpl
	transferPrivateToPublicFn?: FnImpl
}

/** `FnImpl` on disk is its two data fields; parse yields a structurally
 *  equivalent plain object (same as the JSON.parse cast always did). */
const FnImplSchema = z.object({ name: z.string(), impl: z.number() })

/** Storage codec row schema — mirrors `Token` exactly. */
export const TokenSchema: z.ZodType<Token> = z.object({
	id: z.number(),
	profileId: z.string(),
	chainId: z.number(),
	contract: z.string(),
	name: z.string(),
	symbol: z.string(),
	decimals: z.number(),
	getNameFn: FnImplSchema.optional(),
	getSymbolFn: FnImplSchema.optional(),
	getDecimalsFn: FnImplSchema.optional(),
	balanceOfPublicFn: FnImplSchema.optional(),
	balanceOfPrivateFn: FnImplSchema.optional(),
	transferPublicFn: FnImplSchema.optional(),
	transferPrivateFn: FnImplSchema.optional(),
	transferPublicToPrivateFn: FnImplSchema.optional(),
	transferPrivateToPublicFn: FnImplSchema.optional(),
})

export type TokenInfo = {
	/** Internal id. */
	id: number
	/** Chain id. */
	chainId: number
	/** Token contract address. */
	contract: string
	/** Token name. */
	name: string
	/** Token symbol. */
	symbol: string
	/** Token decimals. */
	decimals: number
	/** Whether or not the token has this functionality. */
	hasPublicBalances: boolean
	/** Whether or not the token has this functionality. */
	hasPublicTransfers: boolean
	/** Whether or not the token has this functionality. */
	hasPublicToPrivateTransfers: boolean
	/** Whether or not the token has this functionality. */
	hasPrivateBalances: boolean
	/** Whether or not the token has this functionality. */
	hasPrivateTransfers: boolean
	/** Whether or not the token has this functionality. */
	hasPrivateToPublicTransfers: boolean
}

export type TokenInterface = {
	/** Chain id. */
	chainId: number
	/** Contract address. */
	contract: string

	/** Function to get token name. */
	getNameFn?: FnImpl
	/** Functions with `getNameFn`-like signature. */
	getNameFnCandidates: FnImpl[]

	/** Function to get token symbol. */
	getSymbolFn?: FnImpl
	/** Functions with `getSymbolFn`-like signature. */
	getSymbolFnCandidates: FnImpl[]

	/** Function to get token decimals. */
	getDecimalsFn?: FnImpl
	/** Functions with `getDecimalsFn`-like signature. */
	getDecimalsFnCandidates: FnImpl[]

	/** Function to get public balance. */
	balanceOfPublicFn?: FnImpl
	/** Functions with `balanceOfPublicFn`-like signature. */
	balanceOfPublicFnCandidates: FnImpl[]

	/** Function to get private balance. */
	balanceOfPrivateFn?: FnImpl
	/** Functions with `balanceOfPrivateFn`-like signature. */
	balanceOfPrivateFnCandidates: FnImpl[]

	/** Function to make public transfer. */
	transferPublicFn?: FnImpl
	/** Functions with `transferPublicFn`-like signature. */
	transferPublicFnCandidates: FnImpl[]

	/** Function to make private transfer. */
	transferPrivateFn?: FnImpl
	/** Functions with `transferPrivateFn`-like signature. */
	transferPrivateFnCandidates: FnImpl[]

	/** Function to make public to private transfer. */
	transferPublicToPrivateFn?: FnImpl
	/** Functions with `transferPublicToPrivateFn`-like signature. */
	transferPublicToPrivateFnCandidates: FnImpl[]

	/** Function to make private to public transfer. */
	transferPrivateToPublicFn?: FnImpl
	/** Functions with `transferPrivateToPublicFn`-like signature. */
	transferPrivateToPublicFnCandidates: FnImpl[]

	/** Whether or not the token has complete functionality */
	isComplete: boolean
}

/**
 * Where a default token that is NOT yet a token row stands. `failed` spent its
 * attempts for this extension version and can be retried by the user; `rejected`
 * failed a pin or a metadata bound and cannot.
 */
export type SeedStatus = "pending" | "seeding" | "failed" | "rejected"

/** One not-yet-seeded default. `symbol` and `displayName` are compiled-in literals, never chain data. */
export type SeedStatusEntry = {
	chainId: number
	contract: string
	symbol: string
	displayName: string
	status: SeedStatus
}

export type SeedScope = { profileId: string; chainId: number }

export type Methods = {
	/**
	 * Returns a list of tokens.
	 * @param profileId Profile id.
	 * @param chainId Chain id.
	 */
	getTokens(profileId?: string, chainId?: number): TokenInfo[]

	/**
	 * Returns a token with the specified id, or undefined if it doesn't exist.
	 * @param id Token id.
	 */
	getToken(id: number): TokenInfo

	/**
	 * Creates and returns a new token.
	 * @param profileId Profile id.
	 * @param networkId Network id.
	 * @param accountAddress Account address.
	 * @param tokenInterface Token interface, determining token's functionality.
	 */
	addToken(
		profileId: string,
		networkId: string,
		accountAddress: string,
		tokenInterface: TokenInterface,
		opContext: OperationContext,
	): TokenInfo

	/**
	 * Updates token and returns it.
	 * @param profileId Profile id.
	 * @param networkId Network id.
	 * @param accountAddress Account address.
	 * @param tokenId Token id.
	 * @param tokenInterface Token interface, determining token's functionality.
	 */
	updateToken(profileId: string, networkId: string, accountAddress: string, tokenId: number, tokenInterface: TokenInterface): TokenInfo

	/**
	 * Deletes token with the specified id and returns it.
	 * @param id Token id.
	 */
	deleteToken(id: number): TokenInfo

	/**
	 * Parses contract and returns token interface.
	 * @param networkId Network id.
	 * @param contract Token contract address.
	 */
	parseTokenInterface(networkId: string, contract: string): TokenInterface

	/**
	 * Resolve a token's user-facing metadata (name, symbol, decimals) WITHOUT
	 * adding the token to storage. Used by the dApp `register_token` popup so
	 * the user can see what they're about to add before clicking Allow.
	 *
	 * Also returns the parsed `TokenInterface` for display. It is never handed
	 * back to the executor: what `executeRegisterToken` persists is always its
	 * own `parseTokenInterface` result.
	 *
	 * Returns `{ name: "<name>", symbol: "<symbol>", decimals: 0 }` placeholder
	 * strings when the contract's interface is incomplete. Callers must NOT
	 * trust the strings as authentic — they come straight from the on-chain
	 * contract and a phishing contract can return any string. Always render
	 * the contract address alongside.
	 * @param networkId Network id.
	 * @param accountAddress Address of an account used to drive the simulation.
	 * @param contract Token contract address.
	 */
	previewTokenMetadata(
		networkId: string,
		accountAddress: string,
		contract: string,
	): { name: string; symbol: string; decimals: number; interface: TokenInterface }

	/**
	 * Default tokens of the active profile + network that are not token rows yet.
	 * A pure read: it never starts or retries seeding. Seeded and user-deleted
	 * defaults are omitted.
	 */
	getSeedStatus(): SeedStatusEntry[]

	/**
	 * Starts a seed pass when a default is still `pending` and nothing is working
	 * on it — the recovery for a service worker that died mid-seeding. Acts at most
	 * once per service-worker lifetime per (profile, chain); returns without
	 * waiting for the pass.
	 */
	ensureSeeding(): void

	/**
	 * Gives a `failed` default a fresh round of attempts. Resolves `false` — and
	 * changes nothing — for any other status, a contract outside the active
	 * network's seed list, or a retry already accepted for the same default.
	 */
	retrySeed(chainId: number, contract: string): boolean
}

/**
 * `onTokenDeleted` payload. `TokenInfo` is deliberately profile-stripped (it's
 * the RPC-facing shape), but deletion consumers MUST scope to the DELETED token's
 * profile — using the active profile instead wipes the wrong profile's data
 * (finding C). So the deletion event carries the authoritative `profileId`.
 */
export type TokenDeleted = TokenInfo & { profileId: string }

export type Events = {
	/** Emitted when a new token is created */
	onTokenAdded: TokenInfo
	/** Emitted when an existing token is updated */
	onTokenUpdated: TokenInfo
	/** Emitted when an existing token is deleted */
	onTokenDeleted: TokenDeleted
	/** A default's status changed in this scope. An invalidation: consumers refetch `getSeedStatus`. */
	onSeedStatusChanged: SeedScope
}
