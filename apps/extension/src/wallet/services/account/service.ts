import type { Fr } from "@aztec/foundation/curves/bn254"
import { restoreRows } from "@/wallet/services/restore-rows"
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon"
import { LogLevel, type ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { NetworkService } from "@/wallet/services/network/service"
import { purgeMalformedRows, purgeRows } from "@/wallet/services/purge-rows"
import { EntityStorage } from "@/wallet/storage"
import { array_max, hasIntersectionByKeys, KeyedLock, Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { NuloAccount, V5_REGIME, type IAccountContract } from "@nulo/aztec-runtime/account"
import { AccountAddressInconsistencyError } from "@nulo/extension-messaging/errors"
import type { AccountIntegrityBlocked } from "../account-integrity/types"
import {
	ACCOUNT_SERVICE_NAME,
	ACCOUNT_STORAGE_ROOT,
	AccountSchema,
	AccountType,
	accountRowId,
	accountRowIdOf,
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
	)
	public static name = ACCOUNT_SERVICE_NAME

	public readonly onAccountAdded = new EventHandler<Account>()
	public readonly onAccountUpdated = new EventHandler<Account>()
	public readonly onAccountDeleted = new EventHandler<Account>()

	private readonly storage: EntityStorage<Account>
	// Serialises restore() so two concurrent full-backup imports of the same
	// account can't BOTH pass the intersection check and BOTH write the same row
	// (last-writer-wins ownership flip — audit H4).
	private readonly restoreLock = new Lock()

	private profileService: ProfileService = null!

	public constructor(logger: ILogger, browserApi: BrowserApi) {
		super(ACCOUNT_SERVICE_NAME, logger)
		this.storage = new EntityStorage<Account>(ACCOUNT_STORAGE_ROOT, browserApi.storage.local, (raw) => AccountSchema.parse(raw))
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
		const networkService = services.get(NetworkService.name) as NetworkService
		networkService.registerChainPurgeSubscriber(async (profileId, chainId) => this.clearChainState(profileId, chainId))
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
			(account) => this.storage.delete(accountRowIdOf(account)),
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
			const existing = (await this.liveRows()).filter((x) => x.profileId === profileId && x.chainId === chainId)
			if (existing.length > 0) {
				return existing.sort((a, b) => a.index - b.index)[0]!
			}
			return this.createAccountInternal(profileId, chainId, type, name)
		})
	}

	private async createAccountInternal(profileId: string, chainId: number, type: AccountType, name: string): Promise<Account> {
		const accounts = (await this.liveRows()).filter((x) => x.profileId === profileId && x.chainId === chainId)
		const index = accounts.length > 0 ? array_max(accounts.filter((x) => x.type === type).map((x) => +x.index)) + 1 : 0
		const secret = await this.deriveAccountSecret(profileId, chainId, type, index)
		if (type !== AccountType.Nulo_v1) {
			throw new Error("unsupported account type")
		}
		const address = (await NuloAccount.new(secret, this.logger)).address.toString()
		const account: Account = {
			profileId,
			chainId,
			address,
			index,
			type,
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
		if (account.type !== AccountType.Nulo_v1) {
			throw new Error("unknown account type")
		}
		const secret = await this.deriveAccountSecret(profileId, chainId, account.type, account.index)
		const accountContract: IAccountContract = await NuloAccount.new(secret, this.logger)
		if (accountContract.address.toString() !== address) {
			await this.raiseRuntimeMismatch(profileId, chainId, account.index, address, accountContract.address.toString())
		}
		return accountContract
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

	private async deriveAccountSecret(profileId: string, chainId: number, type: number, index: number): Promise<Fr> {
		const master = await this.profileService.getProfileSecret(profileId)
		if (!master) {
			throw new Error("unauthorized")
		}
		return poseidon2Hash([master, chainId, type, index])
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
	 *  tx/authwit/balance rows still cascade. Read-only; unreadable fields skipped. */
	public async rawAddressesForProfile(profileId: string): Promise<string[]> {
		const out = new Set<string>()
		for (const [, raw] of await this.storage.rawEntries()) {
			if (typeof raw !== "object" || raw === null) continue
			const r = raw as Record<string, unknown>
			if (r.profileId !== profileId) continue
			if (typeof r.address === "string" && r.address.length > 0) out.add(r.address)
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
		// F-B23: raw second pass — a validation-failed row this profile owns is
		// invisible to liveRows() and would otherwise survive the purge forever.
		// Under the restoreLock: a concurrent restore() is the writer that can
		// legitimately land a DIFFERENT profile's valid row on a key this pass
		// snapshotted (aliased key), and the helper's compare-and-delete re-read
		// is only race-free against it while that writer is excluded.
		await this.restoreLock.withLock(() =>
			purgeMalformedRows(
				this.storage,
				(raw) => raw.profileId === profileId,
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
}
