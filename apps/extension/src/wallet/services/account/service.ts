import { Fr } from "@aztec/foundation/curves/bn254"
import { restoreRows } from "@/wallet/services/restore-rows"
import { deriveAccountSeed, deriveSigningKeyFromSeed } from "@nulo/wallet-crypto"
import { LogLevel, type ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { ProfileService } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { NetworkService } from "@/wallet/services/network/service"
import { purgeMalformedRows, purgeRows } from "@/wallet/services/purge-rows"
import { EntityStorage } from "@/wallet/storage"
import { array_max, hasIntersectionByKeys, KeyedLock, Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import {
	buildAccountExport,
	decryptAccountExport,
	encryptAccountExport,
	NuloAccount,
	parseAccountExport,
	serializeAccountExport,
	V5_REGIME,
	type IAccountContract,
} from "@nulo/aztec-runtime/account"
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin"
import { type ImportedKeysDek, sealImportedSigningKeyV2, unsealImportedSigningKeyV2, zeroize } from "@nulo/wallet-crypto"
import { AccountAddressInconsistencyError } from "@nulo/extension-messaging/errors"
import { ImportedKeysRepository } from "./imported-keys-repository"
import type { AccountIntegrityBlocked } from "../account-integrity/types"
import {
	ACCOUNT_SERVICE_NAME,
	ACCOUNT_STORAGE_ROOT,
	AccountSchema,
	AccountType,
	ImportedAccountKeySchema,
	ImportedAccountUnusableError,
	type ImportedAccountKey,
	accountRowId,
	accountRowIdOf,
	parseAccountRowId,
	type Account,
	type Events,
	type Methods,
} from "./spec"

export * from "./spec"

export class AccountService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getAccounts",
		"getAccount",
		"createAccount",
		"ensureDefaultAccount",
		"changeAccountName",
		"changeAccountVisibility",
		"exportAccount",
		"importAccount",
		"previewImportAccount",
		"backupImportedKeys",
		"restoreImportedKeys",
		"reconcileImportedAccounts",
	)
	public static name = ACCOUNT_SERVICE_NAME

	public readonly onAccountAdded = new EventHandler<Account>()
	public readonly onAccountUpdated = new EventHandler<Account>()
	public readonly onAccountDeleted = new EventHandler<Account>()

	private readonly storage: EntityStorage<Account>
	private readonly importedKeys: ImportedKeysRepository
	// Serialises restore() so two concurrent full-backup imports of the same
	// account can't BOTH pass the intersection check and BOTH write the same row
	// (last-writer-wins ownership flip — audit H4).
	private readonly restoreLock = new Lock()

	private profileService: ProfileService = null!
	private networkService: NetworkService = null!

	public constructor(logger: ILogger, browserApi: BrowserApi) {
		super(ACCOUNT_SERVICE_NAME, logger)
		this.storage = new EntityStorage<Account>(ACCOUNT_STORAGE_ROOT, browserApi.storage.local, (raw) => AccountSchema.parse(raw))
		this.importedKeys = new ImportedKeysRepository(browserApi.storage.local)
	}

	/**
	 * Every account row stored under its canonical composite key.
	 *
	 * Rows written before the key included the profile are ignored rather than
	 * half-honored: the field scans below would otherwise find them while
	 * `getAccount` / `getAccountContract` (which look up by composite key) would
	 * not, leaving an account that renders but cannot sign. Ignoring them
	 * uniformly lets `ensureDefaultAccount` recreate a canonical row instead.
	 *
	 * This is deliberately not a migration: the repo is pre-production, where a
	 * shape change redefines the baseline and a stale install is reinstalled.
	 */
	private async liveRows(): Promise<Account[]> {
		const rows: Account[] = []
		for (const [key, row] of await this.storage.getAll()) {
			if (key === accountRowIdOf(row)) rows.push(row)
		}
		return rows
	}

	protected async init(services: ServiceCollection): Promise<void> {
		this.profileService = services.get(ProfileService.name)
		// Profile-delete cleanup is now the coordinator's awaited `purgeForProfile`,
		// NOT a fire-and-forget `onProfileDeleted` subscriber (finding D).
		this.networkService = services.get(NetworkService.name) as NetworkService
		this.networkService.registerChainPurgeSubscriber(async (profileId, chainId) => this.clearChainState(profileId, chainId))
		// Orphan sweep: an imported-key row with no matching Account row is dead weight (a torn
		// import that wrote the key but crashed before the Account row). Remove it so the store
		// stays 1:1. Best-effort — a failure here must never wedge service start.
		void this.sweepOrphanImportedKeys().catch((err) =>
			this.logger.log(ACCOUNT_SERVICE_NAME, LogLevel.Error, "imported-key orphan sweep failed", String(err)),
		)
	}

	/** Delete imported-key rows whose Account row is gone. */
	private async sweepOrphanImportedKeys(): Promise<void> {
		const accountKeys = new Set((await this.liveRows()).map((a) => accountRowIdOf(a)))
		for (const id of await this.importedKeys.allRowIds()) {
			if (!accountKeys.has(accountRowId(id.profileId, id.chainId, id.address))) {
				await this.importedKeys.delete(id.profileId, id.chainId, id.address)
			}
		}
	}

	/**
	 * Wipe all accounts for `(profileId, chainId)` and emit
	 * `onAccountDeleted` per-account so downstream listeners (AuthRegistry,
	 * etc.) cascade. Called by `NetworkService.purgeChain`.
	 */
	public async clearChainState(profileId: string, chainId: number): Promise<void> {
		await this.ensureInitialized()
		const accounts = (await this.liveRows()).filter((x) => x.profileId === profileId && x.chainId === chainId)
		await purgeRows(
			accounts,
			async (account) => {
				await this.storage.delete(accountRowIdOf(account))
				// An imported account's key row shares the account's chain scope — purge it too.
				if (account.type === AccountType.Imported) await this.importedKeys.delete(profileId, chainId, account.address)
			},
			(account) => this.emit("onAccountDeleted", account),
		)
	}

	public async getAccounts(profileId: string, chainId: number, all?: boolean): Promise<Account[]> {
		await this.ensureInitialized()
		// Index-sorted, not storage order: `getValues()` returns rows in insertion order, which after a
		// full-backup restore is NOT index order — so the default active account (accounts[0]) and the
		// account list would otherwise be arbitrary. Every consumer only iterates/filters, so sorting here
		// is the single source that keeps the first account deterministic across fresh and imported profiles.
		return (
			(await this.liveRows())
				.filter((x) => x.profileId === profileId && x.chainId === chainId && (all || x.visible))
				// Address is the tie-breaker so ordering is TOTAL even if a hostile backup restored duplicate
				// indices (legitimate per-type indices are unique) — no reliance on insertion order anywhere.
				.sort((a, b) => a.index - b.index || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
		)
	}

	public async getAccount(profileId: string, chainId: number, address: string): Promise<Account | undefined> {
		await this.ensureInitialized()
		const account = await this.storage.get(accountRowId(profileId, chainId, address))
		return account?.profileId === profileId && account.chainId === chainId ? account : undefined
	}

	public async createAccount(profileId: string, chainId: number, type: AccountType, name: string): Promise<Account> {
		await this.ensureInitialized()
		return this.serializePerTuple(profileId, chainId, type, () => this.createAccountInternal(profileId, chainId, type, name))
	}

	/**
	 * Idempotent default-account provisioning. If a visible-or-hidden account
	 * already exists for the `(profileId, chainId)` tuple, returns the
	 * lowest-index one. Otherwise creates the index-0 account and returns it.
	 *
	 * The whole sequence runs under the same per-tuple serialization as
	 * `createAccount`, so concurrent callers (e.g. `app.vue`'s `initAccount`
	 * fired by both `onActiveProfileChanged` and `loadProfile` re-entry on
	 * `isBackgroundConnected` flip) don't race-create duplicates.
	 */
	public async ensureDefaultAccount(profileId: string, chainId: number, type: AccountType, name: string): Promise<Account> {
		await this.ensureInitialized()
		return this.serializePerTuple(profileId, chainId, type, async () => {
			// Imported accounts are excluded from the default-account candidate pool: a foreign key
			// must never become the profile's auto-selected default (owner decision, recon §3.10).
			const existing = (await this.liveRows()).filter(
				(x) => x.profileId === profileId && x.chainId === chainId && x.type !== AccountType.Imported,
			)
			if (existing.length > 0) {
				return existing.sort((a, b) => a.index - b.index)[0]!
			}
			return this.createAccountInternal(profileId, chainId, type, name)
		})
	}

	private async createAccountInternal(profileId: string, chainId: number, type: AccountType, name: string): Promise<Account> {
		if (type !== AccountType.Nulo_v1) {
			throw new Error("unsupported account type")
		}
		// Auth gate FIRST — an unauthorized caller must never trigger the custom-network probe
		// inside resolveVerifiedL1ChainId below.
		const master = await this.profileService.getProfileSecret(profileId)
		if (!master) {
			throw new Error("unauthorized")
		}
		const accounts = (await this.liveRows()).filter((x) => x.profileId === profileId && x.chainId === chainId)
		// Next index over the SAME-TYPE rows only: the guard must sit on the filtered list, or the
		// first account of a new type starts at 1 (`array_max([]) + 1` — the cross-type guard bug).
		const sameType = accounts.filter((x) => x.type === type)
		const index = sameType.length > 0 ? array_max(sameType.map((x) => +x.index)) + 1 : 0
		// The derivation chain input is the verified EXACT L1 id, never the composite: seeded rows
		// are checked against in-code constants, custom rows against a live probe (fail-closed).
		const l1ChainId = await this.networkService.resolveVerifiedL1ChainId(profileId, chainId)
		const secret = await deriveAccountSeed(master, l1ChainId, type, index)
		const address = (await NuloAccount.new(secret, this.logger)).address.toString()
		const account: Account = {
			profileId,
			chainId,
			address,
			index,
			type,
			l1ChainId,
			name,
			visible: true,
		}
		await this.storage.set(accountRowIdOf(account), account)
		this.emit("onAccountAdded", account)
		return account
	}

	/**
	 * Per-(profileId, chainId, type) async serialization. Wraps an operation
	 * so concurrent calls with the same key run sequentially. Without this,
	 * concurrent `createAccount` / `ensureDefaultAccount` calls can race
	 * inside their `getValues → compute index → set` sequence, producing
	 * duplicate accounts at indices 0 and 1.
	 */
	// maxHoldMs: null — the prior hand-rolled promise chain had no watchdog; keep
	// it that way so this stays byte-for-byte equivalent (Q-08 audit).
	private readonly tupleLocks = new KeyedLock({ maxHoldMs: null })
	private serializePerTuple<T>(profileId: string, chainId: number, type: AccountType, op: () => Promise<T>): Promise<T> {
		return this.tupleLocks.withLock(`${profileId}:${chainId}:${type}`, op)
	}

	public async changeAccountName(profileId: string, chainId: number, address: string, name: string): Promise<Account | undefined> {
		const account = await this.storage.get(accountRowId(profileId, chainId, address))
		if (account?.profileId !== profileId || account.chainId !== chainId) {
			return undefined
		}
		if (account.name !== name) {
			account.name = name
			await this.storage.set(accountRowIdOf(account), account)
			this.emit("onAccountUpdated", account)
		}
		return account
	}

	public async changeAccountVisibility(
		profileId: string,
		chainId: number,
		address: string,
		visible: boolean,
	): Promise<Account | undefined> {
		const account = await this.storage.get(accountRowId(profileId, chainId, address))
		if (account?.profileId !== profileId || account.chainId !== chainId) {
			return undefined
		}
		if (account.visible !== visible) {
			account.visible = visible
			await this.storage.set(accountRowIdOf(account), account)
			this.emit("onAccountUpdated", account)
		}
		return account
	}

	public async getAccountContract(profileId: string, chainId: number, address: string): Promise<IAccountContract> {
		await this.ensureInitialized()
		const account = await this.storage.get(accountRowId(profileId, chainId, address))
		if (account?.profileId !== profileId || account.chainId !== chainId) {
			throw new Error("unknown account address")
		}
		if (account.type === AccountType.Imported) {
			return this.loadImportedAccountContract(profileId, account)
		}
		if (account.type !== AccountType.Nulo_v1) {
			throw new Error("unknown account type")
		}
		// Re-derivation reads the ROW-CARRIED l1ChainId (self-contained; a tampered value derives
		// a different address and fails closed below). `deriveAccountSeed` rejects non-canonical
		// values — never a silent default.
		const secret = await this.deriveAccountSecret(profileId, account.l1ChainId, account.type, account.index)
		const accountContract: IAccountContract = await NuloAccount.new(secret, this.logger)
		if (accountContract.address.toString() !== address) {
			await this.raiseRuntimeMismatch(profileId, chainId, account.index, address, accountContract.address.toString())
		}
		return accountContract
	}

	/**
	 * Load an IMPORTED account for signing: decrypt its stored signing key, rebuild via
	 * `fromSigningKey`, and assert the constructed address equals the stored row's — fail closed
	 * on ANY problem (missing key, decrypt/AAD failure, non-canonical scalar, address mismatch).
	 *
	 * Blast radius is deliberately the SINGLE account (owner decision A4): a tampered imported key
	 * is external material, so it must not profile-wide-block the derived accounts. The typed
	 * error names the account; the UI offers delete + re-import as the repair. No profile block,
	 * no `raiseRuntimeMismatch`.
	 */
	private async loadImportedAccountContract(profileId: string, account: Account): Promise<IAccountContract> {
		const keyRow = await this.importedKeys.get(profileId, account.chainId, account.address)
		if (!keyRow) throw new ImportedAccountUnusableError(account.address, "signing key missing")
		// The imported-key root is the CREDENTIAL-sealed per-profile DEK, never the master (a
		// shared recovery phrase means a shared master — the DEK is the isolation boundary).
		// A DEGRADED session (dek undefined — the slot failed at unlock) quarantines per-account.
		const dek = await this.profileService.getProfileDek(profileId)
		if (!dek) throw new ImportedAccountUnusableError(account.address, "imported keys unavailable — unlock again")
		let skBytes: Uint8Array<ArrayBuffer> | undefined
		let skCopy: Buffer | undefined
		try {
			skBytes = await unsealImportedSigningKeyV2(dek, account.chainId, account.address, keyRow.encryptedSigningKey)
			// `fromBuffer` copies, so wipe the intermediate too — an anonymous `Buffer.from(skBytes)`
			// leaves a second plaintext signing key alive until GC even though `skBytes` is wiped.
			skCopy = Buffer.from(skBytes)
			const signingKey = GrumpkinScalar.fromBuffer(skCopy)
			const contract = await NuloAccount.fromSigningKey(signingKey, this.logger)
			if (contract.address.toString() !== account.address) {
				throw new ImportedAccountUnusableError(account.address, "address mismatch")
			}
			return contract
		} catch (err) {
			if (err instanceof ImportedAccountUnusableError) throw err
			throw new ImportedAccountUnusableError(account.address, "signing key could not be recovered")
		} finally {
			zeroize(dek)
			if (skBytes) zeroize(skBytes)
			if (skCopy) zeroize(skCopy)
		}
	}

	/**
	 * Export one account as a NULO-ACCOUNT-EXPORT file body. Service-side auth: the profile
	 * password must unseal the master (a compromised popup can't bypass it). The exported secret
	 * is the account's Schnorr signing key — for a DERIVED account we re-derive it; for an
	 * IMPORTED account we decrypt the stored one. `secretKey` is never exported (derivable).
	 */
	public async exportAccount(profileId: string, chainId: number, address: string, password: string, encrypt: boolean): Promise<string> {
		await this.ensureInitialized()
		const account = await this.storage.get(accountRowId(profileId, chainId, address))
		if (account?.profileId !== profileId || account.chainId !== chainId) {
			throw new Error("unknown account address")
		}
		// Service-side authentication: unseal via the profile password (throws on wrong password).
		// exportMnemonic-style — the master returned by getProfileSecret is session-gated, so we
		// additionally require the password here to gate the SECRET export behind a fresh check.
		const master = await this.profileService.exportPlain(profileId, password)
		if (typeof master !== "string" || master.length === 0) throw new Error("unauthorized")

		let signingKey: GrumpkinScalar
		if (account.type === AccountType.Imported) {
			const keyRow = await this.importedKeys.get(profileId, chainId, address)
			if (!keyRow) throw new ImportedAccountUnusableError(address, "signing key missing")
			// Fresh-auth posture preserved (audit LOW-2): the DEK unseals under the SUPPLIED
			// password directly — session-independent, deletion-guarded — never via SessionManager.
			const dek = await this.profileService.exportImportedKeysDek(profileId, password)
			let skBytes: Uint8Array<ArrayBuffer> | undefined
			let skCopy: Buffer | undefined
			try {
				skBytes = await unsealImportedSigningKeyV2(dek, chainId, address, keyRow.encryptedSigningKey)
				// See loadImportedAccountContract: `fromBuffer` copies, so the intermediate is a
				// second plaintext signing key and needs its own wipe.
				skCopy = Buffer.from(skBytes)
				signingKey = GrumpkinScalar.fromBuffer(skCopy)
			} finally {
				if (skBytes) zeroize(skBytes)
				if (skCopy) zeroize(skCopy)
				zeroize(dek)
			}
		} else if (account.type === AccountType.Nulo_v1) {
			const masterCopy = Buffer.from(master, "base64")
			const masterFr = Fr.fromBuffer(masterCopy)
			zeroize(masterCopy)
			const seed = await deriveAccountSeed(masterFr, account.l1ChainId, account.type, account.index)
			signingKey = deriveSigningKeyFromSeed(seed)
		} else {
			throw new Error("unknown account type")
		}
		const envelope = buildAccountExport(signingKey, account.l1ChainId, address)
		return encrypt ? encryptAccountExport(envelope, password) : serializeAccountExport(envelope)
	}

	/**
	 * Import an account from a file body into `(profileId, chainId)`. Validates the envelope,
	 * recomputes the address from the signing key and requires it to equal `expectedAddress` (the
	 * address the UI showed the user — the checksum authenticates nothing), rejects a duplicate,
	 * then writes KEY-ROW-FIRST with compensation so a crash never leaves an Account row that
	 * cannot sign.
	 */
	public async importAccount(
		profileId: string,
		chainId: number,
		fileBody: string,
		expectedAddress: string,
		password: string,
		name?: string,
	): Promise<Account> {
		await this.ensureInitialized()
		// Session-gated DEK for sealing the key at rest (the credential-rooted isolation boundary
		// — never the master). A degraded session cannot ACCEPT new imported material: fail loud.
		const dek = await this.profileService.getProfileDek(profileId)
		if (!dek) throw new Error("Imported keys unavailable — unlock again")
		try {
			const { signingKey, address: recomputed } = await this.decodeAccountExport(fileBody, password)
			// The user CONFIRMED this exact address in the UI (the checksum authenticates nothing —
			// a self-consistent hostile file is caught here).
			if (recomputed !== expectedAddress) throw new Error("Imported account address does not match the confirmed address")

			return await this.serializePerTuple(profileId, chainId, AccountType.Imported, async () => {
				const rows = (await this.liveRows()).filter((x) => x.profileId === profileId && x.chainId === chainId)
				if (rows.some((x) => x.address === recomputed)) throw new Error("This account is already in your wallet")
				const sameType = rows.filter((x) => x.type === AccountType.Imported)
				const index = sameType.length > 0 ? array_max(sameType.map((x) => +x.index)) + 1 : 0

				// Imported accounts bind to the ACTIVE network's L1 identity (they don't derive from it,
				// but the row must carry a coherent value for the Account↔Network cross-check). Resolve
				// it BEFORE the key row is written — a throw here would otherwise orphan a sealed key row
				// (the compensation below only covers the Account row).
				const l1ChainId = await this.networkService.getL1ChainIdStored(profileId, chainId)

				let skBytes: Uint8Array<ArrayBuffer> | undefined
				let sealed: string
				try {
					skBytes = signingKey.toBuffer() as Uint8Array<ArrayBuffer>
					sealed = await sealImportedSigningKeyV2(dek, chainId, recomputed, skBytes)
				} finally {
					if (skBytes) zeroize(skBytes)
				}
				// KEY ROW FIRST, then the Account row — with compensation. A crash between the two
				// leaves an orphan key (swept on init) rather than an Account that cannot sign.
				await this.importedKeys.set({ profileId, chainId, address: recomputed, encryptedSigningKey: sealed })
				const account: Account = {
					profileId,
					chainId,
					address: recomputed,
					index,
					type: AccountType.Imported,
					l1ChainId,
					// User-chosen display name; the export envelope deliberately carries none (the v1
					// file format is frozen), so the UI asks at import time.
					name: (typeof name === "string" && name.trim().slice(0, 40)) || "Imported account",
					visible: true,
				}
				try {
					await this.storage.set(accountRowIdOf(account), account)
				} catch (rowErr) {
					await this.importedKeys.delete(profileId, chainId, recomputed).catch(() => {})
					throw rowErr
				}
				this.emit("onAccountAdded", account)
				return account
			})
		} finally {
			// Outer ownership: the dek copy dies on EVERY path (decode failure, duplicate
			// rejection, l1 lookup throw, seal throw, success).
			zeroize(dek)
		}
	}

	/**
	 * Mid-session escape hatch: an extension update can rehydrate a live session under new
	 * derivation code without passing the pre-open verifier. Everything here is
	 * DELEGATE-INDEPENDENT and fail-closed so a mismatch during the startup window (before the
	 * coordinator starts) is still handled: `profileService` is a phase-0 dependency (always
	 * present) and `integrityBlocked` is our own repo. Both the durable block (drives the barrier +
	 * the next-boot gate) and the session close are AWAITED before the error propagates, so an MV3
	 * termination right after the throw cannot lose either; a failure in one is logged but never
	 * masks the typed error.
	 */
	private async raiseRuntimeMismatch(
		profileId: string,
		chainId: number,
		accountIndex: number,
		storedAddress: string,
		derivedAddress: string,
	): Promise<never> {
		const record: AccountIntegrityBlocked = {
			profileId,
			chainId,
			accountIndex,
			storedAddress,
			derivedAddress,
			regimeId: V5_REGIME.id,
			walletVersion: typeof __VERSION__ === "undefined" ? "unknown" : __VERSION__,
			detectedAt: Date.now(),
		}
		// Persist through ProfileService's locked, still-exists-guarded writer: this runs OFF the
		// facade lock (getAccountContract isn't inside a profile op), so a concurrent delete must not
		// leave an orphan block for a just-deleted profile.
		try {
			await this.profileService.persistIntegrityBlockIfLive(record)
		} catch (writeError) {
			this.logger.log(ACCOUNT_SERVICE_NAME, LogLevel.Error, "integrity block persist failed", String(writeError))
		}
		try {
			await this.profileService.lockProfileIfActive(profileId)
		} catch (closeError) {
			this.logger.log(ACCOUNT_SERVICE_NAME, LogLevel.Error, "integrity session close failed", String(closeError))
		}
		throw new AccountAddressInconsistencyError(undefined, { profileId, chainId, accountIndex })
	}

	private async deriveAccountSecret(profileId: string, l1ChainId: number, type: number, index: number): Promise<Fr> {
		const master = await this.profileService.getProfileSecret(profileId)
		if (!master) {
			throw new Error("unauthorized")
		}
		// The ONE shared formula (NULO-ACCOUNT-KDF v2) — also consumed by the integrity
		// coordinator; a second implementation is the drift class that bricks at unlock.
		return deriveAccountSeed(master, l1ChainId, type, index)
	}

	/**
	 * Every account row holding `address`, across all profiles.
	 *
	 * The address is no longer a unique row identity: two profiles built from one
	 * mnemonic derive the same one. Callers that must decide whether an
	 * address-keyed record is unambiguously a given profile's use this.
	 */
	public async getAccountsByAddress(address: string): Promise<Account[]> {
		await this.ensureInitialized()
		return (await this.liveRows()).filter((x) => x.address === address)
	}

	/** Lock-free, profileId-parameterized account read — for the deletion
	 *  coordinator's snapshot (safe under the facade lock: no requireActiveProfile). */
	public async getAccountsRaw(profileId: string): Promise<Account[]> {
		await this.ensureInitialized()
		return (await this.liveRows()).filter((x) => x.profileId === profileId)
	}

	/** F-B23: addresses harvested from RAW rows (codec-hidden included) owned by
	 *  `profileId` — feeds the deletion snapshot so a malformed parent's dependent
	 *  tx/authwit/balance rows still cascade. Identity comes ONLY from the
	 *  canonical storage key, never from the value: malformed bytes at another
	 *  profile's key can claim any profileId/address, and harvesting that claim
	 *  would cascade-delete the OTHER profile's address-keyed rows (codex audit).
	 *  Keys-only also covers syntax-broken values. Read-only. */
	public async rawAddressesForProfile(profileId: string): Promise<string[]> {
		const out = new Set<string>()
		for (const [id] of await this.storage.rawStringEntries()) {
			const key = parseAccountRowId(id)
			if (key !== undefined && key.profileId === profileId && key.address.length > 0) out.add(key.address)
		}
		return [...out]
	}

	/** Awaited profile-scoped account purge, called by the deletion coordinator.
	 *  (Relocated from the removed fire-and-forget `onProfileDeleted` subscriber so
	 *  deletion is awaited end-to-end — finding D.) Idempotent: delete-of-gone is a
	 *  no-op, so a resumed/re-run coordinator converges. */
	public async purgeForProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		this.logDebug(`purgeForProfile ${profileId}: remove related accounts`)
		const accounts = (await this.liveRows()).filter((x) => x.profileId === profileId)
		// SILENT: the deletion coordinator awaits every dependent purge DIRECTLY
		// (txs/auth via purgeForAccounts, balances via purgeForTokens, incoming via
		// clearProfile), so re-emitting onAccountDeleted here is redundant — and its
		// fire-and-forget consumers (auth/tx/incoming) run async AFTER the coordinator
		// releases the id, clobbering a successor that reuses this deterministic
		// address (audit H3). The standalone deleteNetwork/deleteAccount paths keep
		// their emit; only the profile-wide purge goes silent.
		await purgeRows(
			accounts,
			(account) => this.storage.delete(accountRowIdOf(account)),
			() => {},
		)
		// Purge this profile's imported-account signing keys alongside its account rows.
		for (const keyRow of await this.importedKeys.forProfile(profileId)) {
			await this.importedKeys.delete(keyRow.profileId, keyRow.chainId, keyRow.address)
		}
		// F-B23: raw second pass — a validation-failed row this profile owns is
		// invisible to liveRows() and would otherwise survive the purge forever.
		// KEY ownership beats the value's claim: a row at another profile's
		// canonical key is NEVER deleted here whatever its bytes claim (it is that
		// profile's junk, erased when THAT profile is deleted) — so no live writer
		// (another profile's restore/create) can legitimately target a key this
		// pass deletes, and the delete races nobody. Rows at non-canonical keys
		// (legacy shapes, which no writer ever produces) fall back to the value's
		// profileId claim. The restoreLock hold additionally excludes concurrent
		// restores outright while the pass runs.
		await this.restoreLock.withLock(() =>
			purgeMalformedRows(
				this.storage,
				(raw, id) => {
					const key = parseAccountRowId(id)
					if (key !== undefined) return key.profileId === profileId
					return raw.profileId === profileId
				},
				(id) => this.logDebug(`purged malformed account row ${id}`),
			),
		)
	}

	public async backup(): Promise<Account[]> {
		const profile = await requireActiveProfile(this.profileService)

		return (await this.liveRows()).filter((x) => x.profileId === profile.id)
	}

	public async restore(accounts: Account[]): Promise<Restored<Account>[]> {
		await this.ensureInitialized()

		// Serialise the whole restore: the intersection check + the writes must be
		// atomic w.r.t. a concurrent restore, or two imports of the same address
		// both pass the check then both write (last-writer-wins ownership — H4).
		return await this.restoreLock.withLock(async () => {
			// Identity is the full row id, not the address alone: two profiles restored
			// from the same mnemonic legitimately derive the same address, and each owns
			// its own row. This whole-batch collision check stays OUTSIDE restoreRows —
			// it aborts the entire restore, not a single row.
			const collides = hasIntersectionByKeys(await this.liveRows(), accounts, ["profileId", "chainId", "address"])
			if (collides) throw new Error("Duplicate account")

			const seen = new Set<string>()
			return await restoreRows(accounts, async (account) => {
				// H: validate + canonicalize the persisted shape (mirror the read codec).
				const parsed = AccountSchema.parse(account)
				// Account↔Network chain-identity cross-check: the backup checksum is integrity-not-
				// auth, so a doctored blob can carry a self-consistent (chainId, l1ChainId) pair.
				// Networks restore BEFORE accounts in the full-backup order, so the stored
				// (seeded-constant-validated) row is the reference; mismatch rejects the row.
				const expectedL1 = await this.networkService.getL1ChainIdStored(parsed.profileId, parsed.chainId)
				if (parsed.l1ChainId !== expectedL1) {
					throw new Error(`account/network chain identity mismatch: ${parsed.l1ChainId} vs ${expectedL1}`)
				}
				// F: reject an empty/whitespace address. "Successfully restored" must NOT
				// mean "set() didn't throw" for a blank address — a blank-account row
				// would otherwise join the imported-account allow-set and let a tx/authwit
				// referencing "" through. (Full AztecAddress canonicalization is a stronger
				// follow-up; a legit backup's addresses are already canonical, so the
				// composable's address-match stays exact for real data.)
				if (parsed.address.trim().length === 0) throw new Error("empty account address")
				// Dedupe within the batch — the storage-intersection check above only
				// covers pre-existing rows, so two identical addresses in one restore
				// would otherwise both "succeed" (last write wins).
				const rowId = accountRowIdOf(parsed)
				if (seen.has(rowId)) throw new Error("duplicate account address in batch")
				seen.add(rowId)
				await this.storage.set(rowId, parsed)
				return parsed
			})
		})
	}

	/** Decode + validate an account-export file body → its signing key + recomputed address.
	 *  Shared by `previewImportAccount` (show the address) and `importAccount` (write). */
	private async decodeAccountExport(fileBody: string, password: string): Promise<{ signingKey: GrumpkinScalar; address: string }> {
		if (fileBody.length > 64 * 1024) throw new Error("Account export file is too large")
		// Encrypted variant is base64 (not JSON); plaintext starts with `{`.
		const trimmed = fileBody.trim()
		const json = trimmed.startsWith("{") ? trimmed : await decryptAccountExport(trimmed, password)
		const { signingKey, claimedAddress } = parseAccountExport(json)
		// The address is a pure function of the signing key — recompute and require it to match the
		// file's self-claim (catches a plaintext file whose address was edited without the key).
		const address = (await NuloAccount.fromSigningKey(signingKey, this.logger)).address.toString()
		if (address !== claimedAddress) throw new Error("Account export address does not match its signing key")
		return { signingKey, address }
	}

	public async previewImportAccount(fileBody: string, password: string): Promise<string> {
		await this.ensureInitialized()
		return (await this.decodeAccountExport(fileBody, password)).address
	}

	/** Backup this profile's imported-account key rows (the dedicated `imported-account-keys`
	 *  slice). Ciphertext only — the plaintext keys never leave the encrypted envelope. */
	public async backupImportedKeys(): Promise<ImportedAccountKey[]> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return this.importedKeys.backup(profile.id)
	}

	/** Restore imported-account key rows via the SOURCE→DESTINATION rewrap (clone divergence —
	 *  final-audit blocker): backup rows are sealed under the SOURCE profile's DEK; the restored
	 *  row minted a FRESH one. `ProfileService.restore()` stashed both in a TTL-bound context;
	 *  this consumes it atomically, re-seals every row under the destination DEK, and zeroizes
	 *  the source immediately. A missing/expired context with rows present fails those rows into
	 *  the existing orphan taxonomy (`reconcileImportedAccounts` then drops the keyless type-1
	 *  Account rows) — never silently-kept undecryptable rows. Runs BEFORE the reconcile. */
	public async restoreImportedKeys(rows: ImportedAccountKey[]): Promise<Restored<ImportedAccountKey>[]> {
		await this.ensureInitialized()
		return await this.restoreLock.withLock(async () => {
			// One context per restore (normalizeAllIds remapped every row to the new profile id).
			const profileIds = [...new Set(rows.map((r) => (typeof r?.profileId === "string" ? r.profileId : "")))].filter(Boolean)
			const contexts = new Map<string, { sourceDek: ImportedKeysDek; destinationDek: ImportedKeysDek }>()
			try {
				for (const pid of profileIds) {
					const ctx = await this.profileService.consumeDekRewrapContext(pid)
					if (ctx) contexts.set(pid, ctx)
				}
				return await restoreRows(rows, async (row) => {
					const parsed = ImportedAccountKeySchema.parse(row)
					if (parsed.address.trim().length === 0) throw new Error("empty imported-key address")
					const ctx = contexts.get(parsed.profileId)
					if (!ctx) throw new Error("no rewrap context for imported key — dropped to the orphan taxonomy")
					let skBytes: Uint8Array<ArrayBuffer> | undefined
					try {
						skBytes = await unsealImportedSigningKeyV2(
							ctx.sourceDek,
							parsed.chainId,
							parsed.address,
							parsed.encryptedSigningKey,
						)
						const resealed = await sealImportedSigningKeyV2(ctx.destinationDek, parsed.chainId, parsed.address, skBytes)
						const rewrapped = { ...parsed, encryptedSigningKey: resealed }
						await this.importedKeys.set(rewrapped)
						return rewrapped
					} finally {
						if (skBytes) zeroize(skBytes)
					}
				})
			} finally {
				for (const ctx of contexts.values()) {
					zeroize(ctx.sourceDek)
					zeroize(ctx.destinationDek)
				}
			}
		})
	}

	/**
	 * After a full-backup restore, drop any IMPORTED Account row that has no matching key row —
	 * a hostile epoch-4 backup can carry a type-1 row with the key slice omitted, which would
	 * otherwise restore as a zombie that fails only at signing. Runs at restore FINALIZE, after
	 * both the account rows and the key rows have landed.
	 */
	public async reconcileImportedAccounts(profileId: string): Promise<string[]> {
		await this.ensureInitialized()
		const dropped: string[] = []
		const imported = (await this.liveRows()).filter((a) => a.profileId === profileId && a.type === AccountType.Imported)
		for (const account of imported) {
			if (!(await this.importedKeys.get(profileId, account.chainId, account.address))) {
				await this.storage.delete(accountRowIdOf(account))
				this.emit("onAccountDeleted", account)
				dropped.push(account.address)
			}
		}
		return dropped
	}
}
