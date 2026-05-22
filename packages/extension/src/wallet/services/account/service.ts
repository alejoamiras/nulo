import type { Fr } from "@aztec/foundation/curves/bn254"
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon"
import type { ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { NetworkService } from "@/wallet/services/network/service"
import { EntityStorage } from "@/wallet/storage"
import { array_max, hasIntersectionByKeys } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { NuloAccount, type IAccountContract } from "@nulo/aztec-runtime/account"
import { ACCOUNT_SERVICE_NAME, AccountType, type Account, type Events, type Methods } from "./spec"

export * from "./spec"

export class AccountService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	public static name = ACCOUNT_SERVICE_NAME

	public readonly onAccountAdded = new EventHandler<Account>()
	public readonly onAccountUpdated = new EventHandler<Account>()
	public readonly onAccountDeleted = new EventHandler<Account>()

	private readonly storage = new EntityStorage<Account>("nulo:core:accounts", chrome.storage.local)

	private profileService: ProfileService = null!

	public constructor(logger: ILogger) {
		super(ACCOUNT_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection): Promise<void> {
		this.profileService = services.get(ProfileService.name)
		this.profileService.onProfileDeleted.add(this.onProfileDeleted)
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
		for (const account of accounts) {
			await this.storage.delete(account.address)
			this.emit("onAccountDeleted", account)
		}
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
			throw new Error("account address inconsistency")
		}
		return accountContract
	}

	private async deriveAccountSecret(profileId: string, chainId: number, type: number, index: number): Promise<Fr> {
		const master = await this.profileService.getProfileSecret(profileId)
		if (!master) {
			throw new Error("unauthorized")
		}
		return poseidon2Hash([master, chainId, type, index])
	}

	private readonly onProfileDeleted = async (profile: ProfileInfo) => {
		this.logDebug(`profile ${profile.id} deleted, remove related accounts`)
		const accounts = (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
		for (const account of accounts) {
			this.logDebug(`remove account ${account.address}`)
			await this.storage.delete(account.address)
			this.emit("onAccountDeleted", account)
		}
	}

	public async backup(): Promise<Account[]> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		return (await this.storage.getValues()).filter((x) => x.profileId === profile.id)
	}

	public async restore(accounts: Account[]): Promise<Restored<Account>[]> {
		await this.ensureInitialized()

		const result: Restored<Account>[] = []

		const hasIntersectionByAddress = hasIntersectionByKeys(await this.storage.getValues(), accounts, ["address"])
		if (hasIntersectionByAddress) throw new Error("Duplicate address")

		for (const account of accounts) {
			try {
				await this.storage.set(account.address, account)
				result.push(account)
			} catch (err) {
				result.push({
					...account,
					restoreError: err instanceof Error ? err.message : err,
				})
			}
		}

		return result
	}
}
