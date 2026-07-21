import type { Fr } from "@aztec/foundation/curves/bn254"
import { toRestoreError } from "@/utils/restore-error"
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon"
import { LogLevel, type ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { NetworkService } from "@/wallet/services/network/service"
import { purgeRows } from "@/wallet/services/purge-rows"
import { EntityStorage } from "@/wallet/storage"
import { array_max, hasIntersectionByKeys, Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { NuloAccount, V5_REGIME, type IAccountContract } from "@nulo/aztec-runtime/account"
import { AccountAddressInconsistencyError } from "@nulo/extension-messaging/errors"
import type { StorageArea } from "@nulo/wallet-core/ports"
import { AccountIntegrityBlockedRepository } from "../account-integrity/blocked-repository"
import type { AccountIntegrityBlocked } from "../account-integrity/types"
import { ACCOUNT_SERVICE_NAME, ACCOUNT_STORAGE_ROOT, AccountSchema, AccountType, type Account, type Events, type Methods } from "./spec"

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
	// address can't BOTH pass the intersection check and BOTH write the global
	// address-keyed row (last-writer-wins ownership flip — audit H4).
	private readonly restoreLock = new Lock()

	private profileService: ProfileService = null!

	/** Owned so the durable mismatch block is written delegate-independently (fail-closed even
	 *  during the startup window). */
	private readonly integrityBlocked: AccountIntegrityBlockedRepository

	public constructor(logger: ILogger, browserApi: BrowserApi) {
		super(ACCOUNT_SERVICE_NAME, logger)
		this.storage = new EntityStorage<Account>(ACCOUNT_STORAGE_ROOT, browserApi.storage.local, (raw) => AccountSchema.parse(raw))
		this.integrityBlocked = new AccountIntegrityBlockedRepository(browserApi.storage.local as StorageArea)
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
		const accounts = (await this.storage.getValues()).filter((x) => x.profileId === profileId && x.chainId === chainId)
		await purgeRows(
			accounts,
			(account) => this.storage.delete(account.address),
			(account) => this.emit("onAccountDeleted", account),
		)
	}

	public async getAccounts(profileId: string, chainId: number, all?: boolean): Promise<Account[]> {
		await this.ensureInitialized()
		return (await this.storage.getValues()).filter((x) => x.profileId === profileId && x.chainId === chainId && (all || x.visible))
	}

	public async getAccount(profileId: string, chainId: number, address: string): Promise<Account | undefined> {
		await this.ensureInitialized()
		const account = await this.storage.get(address)
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
			const existing = (await this.storage.getValues()).filter((x) => x.profileId === profileId && x.chainId === chainId)
			if (existing.length > 0) {
				return existing.sort((a, b) => a.index - b.index)[0]!
			}
			return this.createAccountInternal(profileId, chainId, type, name)
		})
	}

	private async createAccountInternal(profileId: string, chainId: number, type: AccountType, name: string): Promise<Account> {
		const accounts = (await this.storage.getValues()).filter((x) => x.profileId === profileId && x.chainId === chainId)
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
		await this.storage.set(address, account)
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
	private readonly tupleLocks = new Map<string, Promise<unknown>>()
	private serializePerTuple<T>(profileId: string, chainId: number, type: AccountType, op: () => Promise<T>): Promise<T> {
		const key = `${profileId}:${chainId}:${type}`
		const previous = this.tupleLocks.get(key) ?? Promise.resolve()
		const next = previous.then(op, op)
		// Don't propagate failures into the chain; swallow at the lock boundary
		// (the caller still receives the rejected next).
		this.tupleLocks.set(
			key,
			next.catch(() => {}),
		)
		void next.finally(() => {
			if (this.tupleLocks.get(key)?.then === undefined) return
			// Cleanup the slot only if no later callers chained onto it.
			// (We never know for sure without ref counting, but as a
			// best-effort the map entry stays harmlessly resolved.)
		})
		return next
	}

	public async changeAccountName(profileId: string, chainId: number, address: string, name: string): Promise<Account | undefined> {
		const account = await this.storage.get(address)
		if (account?.profileId !== profileId || account.chainId !== chainId) {
			return undefined
		}
		if (account.name !== name) {
			account.name = name
			await this.storage.set(address, account)
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
		const account = await this.storage.get(address)
		if (account?.profileId !== profileId || account.chainId !== chainId) {
			return undefined
		}
		if (account.visible !== visible) {
			account.visible = visible
			await this.storage.set(address, account)
			this.emit("onAccountUpdated", account)
		}
		return account
	}

	public async getAccountContract(profileId: string, chainId: number, address: string): Promise<IAccountContract> {
		await this.ensureInitialized()
		const account = await this.storage.get(address)
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
		try {
			await this.integrityBlocked.set(record)
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

	/** Lock-free, profileId-parameterized account read — for the deletion
	 *  coordinator's snapshot (safe under the facade lock: no requireActiveProfile). */
	public async getAccountsRaw(profileId: string): Promise<Account[]> {
		await this.ensureInitialized()
		return (await this.storage.getValues()).filter((x) => x.profileId === profileId)
	}

	/** Awaited profile-scoped account purge, called by the deletion coordinator.
	 *  (Relocated from the removed fire-and-forget `onProfileDeleted` subscriber so
	 *  deletion is awaited end-to-end — finding D.) Idempotent: delete-of-gone is a
	 *  no-op, so a resumed/re-run coordinator converges. */
	public async purgeForProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		this.logDebug(`purgeForProfile ${profileId}: remove related accounts`)
		const accounts = (await this.storage.getValues()).filter((x) => x.profileId === profileId)
		// SILENT: the deletion coordinator awaits every dependent purge DIRECTLY
		// (txs/auth via purgeForAccounts, balances via purgeForTokens, incoming via
		// clearProfile), so re-emitting onAccountDeleted here is redundant — and its
		// fire-and-forget consumers (auth/tx/incoming) run async AFTER the coordinator
		// releases the id, clobbering a successor that reuses this deterministic
		// address (audit H3). The standalone deleteNetwork/deleteAccount paths keep
		// their emit; only the profile-wide purge goes silent.
		await purgeRows(
			accounts,
			(account) => this.storage.delete(account.address),
			() => {},
		)
	}

	public async backup(): Promise<Account[]> {
		const profile = await requireActiveProfile(this.profileService)

		return (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
	}

	public async restore(accounts: Account[]): Promise<Restored<Account>[]> {
		await this.ensureInitialized()

		// Serialise the whole restore: the intersection check + the writes must be
		// atomic w.r.t. a concurrent restore, or two imports of the same address
		// both pass the check then both write (last-writer-wins ownership — H4).
		try {
			await this.restoreLock.enter()

			const result: Restored<Account>[] = []

			const hasIntersectionByAddress = hasIntersectionByKeys(await this.storage.getValues(), accounts, ["address"])
			if (hasIntersectionByAddress) throw new Error("Duplicate address")

			const seen = new Set<string>()
			for (const account of accounts) {
				try {
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
					if (seen.has(parsed.address)) throw new Error("duplicate account address in batch")
					seen.add(parsed.address)
					await this.storage.set(parsed.address, parsed)
					result.push(parsed)
				} catch (err) {
					result.push({
						...account,
						restoreError: toRestoreError(err),
					})
				}
			}

			return result
		} finally {
			this.restoreLock.leave()
		}
	}
}
