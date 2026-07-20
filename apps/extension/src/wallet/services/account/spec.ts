import { z } from "zod"

export const ACCOUNT_SERVICE_NAME = "account"

/** EntityStorage root for account rows (keyed by `account.address`). Frozen:
 *  renaming detaches every existing row; the backup-migration registry pins it. */
export const ACCOUNT_STORAGE_ROOT = "nulo:core:accounts"

export enum AccountType {
	// SECURITY: Numeric value is used in poseidon2Hash for key derivation. NEVER change it.
	/** Upstream-canonical Schnorr account (Aztec `@aztec/accounts/schnorr`). */
	Nulo_v1 = 0,
}

export type Account = {
	/** Profile Id (part of the derivation path). */
	profileId: string
	/** Chain Id (part of the derivation path). */
	chainId: number
	/** Address of the account contract. */
	address: string
	/** Index (part of the derivation path). */
	index: number
	/** Type of the account contract (part of the derivation path). */
	type: AccountType
	/** Display name */
	name: string
	/** Flag, determining whether the account is active or hidden. */
	visible: boolean
}

/** Storage codec row schema — mirrors `Account` exactly. */
export const AccountSchema: z.ZodType<Account> = z.object({
	profileId: z.string(),
	chainId: z.number(),
	address: z.string(),
	index: z.number(),
	type: z.nativeEnum(AccountType),
	name: z.string(),
	visible: z.boolean(),
})

export type Methods = {
	/**
	 * Returns a list of accounts.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param all Whether to return all (including hidden) or only active accounts.
	 */
	getAccounts(profileId: string, chainId: number, all?: boolean): Account[]

	/**
	 * Returns an account with the specified address, or undefined if it doesn't exist.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param address Account contract address.
	 */
	getAccount(profileId: string, chainId: number, address: string): Account | undefined

	/**
	 * Creates and returns a new account.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param type Account contract type.
	 * @param name Display name.
	 */
	createAccount(profileId: string, chainId: number, type: AccountType, name: string): Account

	/**
	 * Idempotent default-account provisioning. Returns the lowest-index existing
	 * account for `(profileId, chainId)` if one exists, otherwise creates the
	 * index-0 account and returns it. Serialized per-tuple — concurrent callers
	 * resolve to the same account, never to a duplicate.
	 */
	ensureDefaultAccount(profileId: string, chainId: number, type: AccountType, name: string): Account

	/**
	 * Changes an account name and returns the account, or undefined if it doesn't exist.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param address Account contract address.
	 * @param name Display name.
	 */
	changeAccountName(profileId: string, chainId: number, address: string, name: string): Account | undefined

	/**
	 * Changes an account visibility and returns the account, or undefined if it doesn't exist.
	 * @param profileId Profile, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param chainId Chain, determining accounts scope (each profile + chain has its own set of accounts).
	 * @param address Account contract address.
	 * @param visible Visibility flag.
	 */
	changeAccountVisibility(profileId: string, chainId: number, address: string, visible: boolean): Account | undefined
}

export type Events = {
	/** Emitted when a new account is created */
	onAccountAdded: Account
	/** Emitted when an existing account is updated */
	onAccountUpdated: Account
	/** Emitted when an existing account is deleted */
	onAccountDeleted: Account
}
