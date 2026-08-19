import { z } from "zod"

export const ACCOUNT_SERVICE_NAME = "account"

/** EntityStorage root for account rows. Frozen:
 *  renaming detaches every existing row; the backup-migration registry pins it. */
export const ACCOUNT_STORAGE_ROOT = "nulo:core:accounts"

/**
 * Storage id for an account row: `(profileId, chainId, address)`, not the bare
 * address.
 *
 * The address derives from `deriveAccountSeed(master, l1ChainId, type, index)` (NULO-ACCOUNT-KDF
 * v2), so two profiles restored from the same mnemonic derive the SAME address — under
 * an address-only key they collide on one row and the later write takes ownership
 * of the earlier profile's account. Including the profile in the id lets both
 * coexist.
 *
 * JSON-encoded rather than delimiter-joined: a separator could also occur inside
 * a profile id, which would make two different tuples encode identically.
 */
export function accountRowId(profileId: string, chainId: number, address: string): string {
	return JSON.stringify(["account", profileId, chainId, address])
}

/** `accountRowId` for a row that already carries its own scope fields. */
export function accountRowIdOf(account: Pick<Account, "profileId" | "chainId" | "address">): string {
	return accountRowId(account.profileId, account.chainId, account.address)
}

/**
 * Inverse of `accountRowId`: the scope tuple a canonical row key encodes, or
 * undefined for a non-canonical key (legacy/foreign shapes).
 *
 * The KEY is the trustworthy identity of a row whose VALUE cannot be decoded:
 * only this profile's own writers ever produce this profile's canonical keys,
 * while the value's self-reported fields are whatever the malformed bytes
 * happen to claim. Purge attribution and cascade harvesting must key off THIS,
 * never off the value.
 */
export function parseAccountRowId(id: string): { profileId: string; chainId: number; address: string } | undefined {
	let parsed: unknown
	try {
		parsed = JSON.parse(id)
	} catch {
		return undefined
	}
	if (!Array.isArray(parsed) || parsed.length !== 4 || parsed[0] !== "account") return undefined
	const [, profileId, chainId, address] = parsed
	if (typeof profileId !== "string" || typeof chainId !== "number" || typeof address !== "string") return undefined
	// Ownership evidence must be BYTE-canonical: JSON.parse also accepts
	// whitespace/escape/-0 variants no writer ever emits, and accepting one
	// would let a crafted key donate an arbitrary address to a purge cascade
	// (the unscoped auth purge would then delete a real account's authwits).
	if (accountRowId(profileId, chainId, address) !== id) return undefined
	return { profileId, chainId, address }
}

/**
 * An imported account's stored key is unusable (missing, un-decryptable, or its recomputed
 * address no longer matches the stored row). Fail-closed for THAT account only — never a
 * profile-wide block (imported key material is external; owner decision A4). The UI surfaces
 * this and offers delete + re-import as the repair.
 */
export class ImportedAccountUnusableError extends Error {
	public readonly address: string
	public constructor(address: string, reason: string) {
		super(`Imported account ${address} is unusable: ${reason}`)
		this.name = "ImportedAccountUnusableError"
		this.address = address
	}
}

export enum AccountType {
	// SECURITY: Numeric value is used in poseidon2Hash for key derivation. NEVER change it.
	/** Derived Schnorr account (NULO-ACCOUNT-KDF v2 — the wallet's own recovery-phrase accounts). */
	Nulo_v1 = 0,
	/** An account IMPORTED from another wallet install via an account-export file. Its signing key
	 *  is external key material stored (encrypted) in the imported-keys root; it does NOT derive
	 *  from this profile's recovery phrase, and it has its OWN per-type index sequence. */
	Imported = 1,
}

/** EntityStorage root for the encrypted signing keys of IMPORTED accounts. Keyed exactly like an
 *  Account row (`accountRowId`) so the two stay 1:1. Frozen. */
export const IMPORTED_KEYS_STORAGE_ROOT = "nulo:core:imported-account-keys"

/** Backup slice / service name that OWNS the imported-keys root (its own registry entry — the
 *  Account root belongs to AccountService, so the key root needs a distinct owner). */
export const IMPORTED_KEYS_SERVICE_NAME = "imported-account-keys"

/** A stored imported-account signing key: base64 AES-GCM ciphertext under HKDF(master, per-row
 *  info). The row id is the SAME composite as the Account row it belongs to. */
export type ImportedAccountKey = {
	profileId: string
	chainId: number
	address: string
	/** Base64 ciphertext of the 32-byte Schnorr signing key. */
	encryptedSigningKey: string
}

export const ImportedAccountKeySchema: z.ZodType<ImportedAccountKey> = z.object({
	profileId: z.string(),
	chainId: z.number(),
	address: z.string(),
	encryptedSigningKey: z.string(),
})

export type Account = {
	/** Profile Id (row scoping; selects the master secret the derivation starts from). */
	profileId: string
	/** Composite chain id — STORAGE SCOPING ONLY, never a derivation input. */
	chainId: number
	/** Address of the account contract. */
	address: string
	/** Index (part of the derivation path). */
	index: number
	/** Type of the account contract (part of the derivation path). */
	type: AccountType
	/** The EXACT L1 chain id this account derives under (part of the derivation path). Written
	 *  once at creation from the verified Network row; self-contained so re-derivation (signing,
	 *  the integrity coordinator's pre-session verify) never needs a network lookup — and a
	 *  tampered value re-derives a different address and fails closed like a tampered index. */
	l1ChainId: number
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
	// `index` feeds key derivation (poseidon2Hash → Fr) AND the `array_max(index) + 1` next-index math.
	// A hostile backup could otherwise carry a negative/fractional/NaN/Infinity index that throws during
	// Fr construction, or one near 2^53 where `max + 1 === max` silently wedges new-account creation.
	// Bound it to a nonnegative safe integer whose `+ 1` is still exactly representable.
	index: z.number().int().nonnegative().lt(Number.MAX_SAFE_INTEGER),
	type: z.nativeEnum(AccountType),
	// Derivation chain input — canonical u32, bounded like `index` (a hostile backup must not
	// smuggle a value the derivation would reject or truncate).
	l1ChainId: z.number().int().nonnegative().max(0xffffffff),
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

	/**
	 * Export one account as a portable file body (the NULO-ACCOUNT-EXPORT v1 envelope). Requires
	 * the profile password (service-side auth — the caller cannot bypass it from a compromised
	 * popup). `encrypt` picks the password-encrypted variant (default) vs the plaintext one.
	 * @returns the file's string body (encrypted base64, or the plaintext JSON).
	 */
	exportAccount(profileId: string, chainId: number, address: string, password: string, encrypt: boolean): string

	/**
	 * Import an account from a NULO-ACCOUNT-EXPORT file body into `(profileId, chainId)`. Validates
	 * the envelope (regime digests, canonical signing key, checksum), recomputes the address from
	 * the signing key and requires it to equal `expectedAddress` (the address the UI showed the
	 * user for confirmation), rejects a duplicate, seals the signing key, and writes the row.
	 * `password` decrypts an encrypted file (omit/empty for plaintext).
	 */
	importAccount(profileId: string, chainId: number, fileBody: string, expectedAddress: string, password: string): Account
}

export type Events = {
	/** Emitted when a new account is created */
	onAccountAdded: Account
	/** Emitted when an existing account is updated */
	onAccountUpdated: Account
	/** Emitted when an existing account is deleted */
	onAccountDeleted: Account
}
