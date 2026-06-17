import type { ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import { maybeRethrowAsRpcCancel } from "@/wallet/services/execution/rpc-cancel"
import { ExecutionService, type FeeSettings, type AuthwitContent } from "@/wallet/services/execution/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import type { WrappedTask } from "@/wallet/services/task/wrapped-task"
import { TaskService, RevokeAuthwitsContent, StepContent } from "@/wallet/services/task/service"
import { TransactionService, OriginType } from "@/wallet/services/transaction/service"
import { EntityStorage } from "@/wallet/storage"
import { array_max, Lock, sleep } from "@/wallet/utils"
import { getAuthRegistryAddress, isAuthRegistryEnabled, isAuthwitConsumable } from "@/wallet/utils/auth-registry"
import { EventHandler } from "@nulo/wallet-core/utils"
import { AUTH_REGISTRY_SERVICE_NAME, type Authwit, type Events, MAX_REVOKES_PER_TX, type Methods } from "./spec"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"

export * from "./spec"

export class AuthRegistryService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	public static name = AUTH_REGISTRY_SERVICE_NAME

	public readonly onAuthwitAdded = new EventHandler<Authwit>()
	public readonly onAuthwitDeleted = new EventHandler<Authwit>()
	public readonly onRegistryEnabled = new EventHandler<string>()
	public readonly onRegistryDisabled = new EventHandler<string>()

	private readonly authwits = new EntityStorage<Authwit>("nulo:core:auth-registry", chrome.storage.local)
	private readonly statuses = new EntityStorage<boolean>("nulo:core:auth-registry-enabled", chrome.storage.local)
	private readonly lock = new Lock()

	private profileService: ProfileService = null!
	private networkService: NetworkService = null!
	private accountService: AccountService = null!
	private executionService: ExecutionService = null!
	private transactionService: TransactionService = null!
	private taskService: TaskService = null!

	public constructor(logger: ILogger) {
		super(AUTH_REGISTRY_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.networkService = services.get(NetworkService.name)
		this.accountService = services.get(AccountService.name)
		this.executionService = services.get(ExecutionService.name)
		this.transactionService = services.get(TransactionService.name)
		this.taskService = services.get(TaskService.name)

		// Authwits + registry-enabled flags are keyed per-account. When an
		// account is deleted (e.g. as part of a chain purge), wipe its
		// records here so we don't leak stale state. Fire-and-forget against
		// the EventHandler — best-effort cleanup.
		this.accountService.onAccountDeleted.add(async (account) => {
			try {
				await this.lock.enter()
				const authwits = (await this.authwits.getValues()).filter((a) => a.account === account.address)
				for (const authwit of authwits) {
					await this.authwits.delete(`${authwit.id}`)
					this.emit("onAuthwitDeleted", authwit)
				}
				if (await this.statuses.contains(account.address)) {
					await this.statuses.delete(account.address)
				}
			} finally {
				this.lock.leave()
			}
		})
	}

	public async trackAuthwit(account: string, hash: string, content: AuthwitContent) {
		try {
			await this.lock.enter()
			const authwits = await this.authwits.getValues()
			if (authwits.some((x) => x.account === account && x.hash === hash)) {
				return
			}
			const nextId = array_max(authwits.map((x) => x.id)) + 1
			const authwit: Authwit = { id: nextId, account, hash, content }
			await this.authwits.set(`${authwit.id}`, authwit)
			this.emit("onAuthwitAdded", authwit)
		} finally {
			this.lock.leave()
		}
	}

	public async getAuthwits(account: string): Promise<Authwit[]> {
		return (await this.authwits.getValues()).filter((x) => x.account === account)
	}

	public async revokeAuthwits(networkId: string, account: string, ids: number[], feeSettings: FeeSettings): Promise<void> {
		await this.ensureInitialized()
		if (ids.length > MAX_REVOKES_PER_TX) {
			throw new Error(`Cannot revoke more than ${MAX_REVOKES_PER_TX} authwits per single tx`)
		}

		const authwits: Authwit[] = []
		for (const id of ids) {
			const authwit = await this.authwits.get(`${id}`)
			if (!authwit) {
				throw new Error(`Authwit #${id} doesn't exist`)
			}
			authwits.push(authwit)
		}

		const task = this.taskService.startNewTask(new RevokeAuthwitsContent(ids))
		try {
			const registryAddress = getAuthRegistryAddress().toString()
			const txHash = await this.executionService.executeSendTransaction(
				{
					kind: "send_transaction",
					networkId,
					accountAddress: account,
					feeSettings,
					actions: authwits.map((x) => ({
						kind: "call",
						contract: registryAddress,
						method: "set_authorized",
						args: [x.hash, false],
					})),
				},
				{ type: OriginType.UI },
				task,
			)

			await this.transactionService.waitForTx(txHash, task)

			const network = await this.networkService.getNetwork(networkId)
			const node = await this.networkService.getNode(network.chainId)
			// `waitForTx` only confirms the tx left the pending queue (submitted),
			// not that its PUBLIC effect is mined + visible. Poll the on-chain state
			// so a fast (proverless) follow-up consume can't race a not-yet-mined
			// revoke. See waitForOnChainState.
			await this.waitForOnChainState(
				async () => (await Promise.all(authwits.map((a) => isAuthwitConsumable(node, a.account, a.hash)))).every((c) => !c),
				"revoke: authwits no longer consumable",
			)
			await this.syncAuthwits(node, account, task, authwits)

			task.complete()
		} catch (error) {
			// Convert the internal sentinel to the structured RPC-boundary
			// error so the popup's `classifyCancellableRejection` works.
			// Same conversion done by `executeTransfer`.
			maybeRethrowAsRpcCancel(error, task)
			task.fail(error)
			throw error
		}
	}

	public async getRegistryEnabled(account: string): Promise<boolean> {
		return (await this.statuses.get(account)) ?? true
	}

	public async setRegistryEnabled(networkId: string, account: string, enabled: boolean, feeSettings: FeeSettings): Promise<void> {
		await this.ensureInitialized()
		const task = this.taskService.startNewTask(new StepContent(`${enabled ? "Enable" : "Disable"} auth registry`))
		try {
			const txHash = await this.executionService.executeSendTransaction(
				{
					kind: "send_transaction",
					networkId,
					accountAddress: account,
					feeSettings,
					actions: [
						{
							kind: "call",
							contract: getAuthRegistryAddress().toString(),
							method: "set_reject_all",
							args: [!enabled],
						},
					],
				},
				{ type: OriginType.UI },
				task,
			)

			await this.transactionService.waitForTx(txHash, task)

			const network = await this.networkService.getNetwork(networkId)
			const node = await this.networkService.getNode(network.chainId)
			// Ensure the registry toggle is mined + visible before returning, so a
			// fast follow-up consume reads the new state (see waitForOnChainState).
			await this.waitForOnChainState(
				async () => (await isAuthRegistryEnabled(node, account)) === enabled,
				`registry enabled=${enabled}`,
			)
			await this.syncStatus(node, account, task)

			task.complete()
		} catch (error) {
			// Convert the internal sentinel to the structured RPC-boundary
			// error so the popup's `classifyCancellableRejection` works.
			// Same conversion done by `executeTransfer`.
			maybeRethrowAsRpcCancel(error, task)
			task.fail(error)
			throw error
		}
	}

	public async syncRegistry(networkId: string, account: string): Promise<void> {
		await this.ensureInitialized()
		const task = this.taskService.startNewTask(new StepContent("Sync auth registry"))
		try {
			const network = await this.networkService.getNetwork(networkId)
			const node = await this.networkService.getNode(network.chainId)
			await Promise.all([this.syncAuthwits(node, account, task), this.syncStatus(node, account, task)])
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	/** Poll an on-chain predicate until it holds (the just-submitted settings
	 *  tx's public effect is mined + visible) or the timeout elapses.
	 *
	 *  `transactionService.waitForTx` only blocks while the tx is in the local
	 *  `pending` queue (i.e. until it's submitted), NOT until its public state
	 *  is mined — so a one-shot read right after it can observe stale state. The
	 *  gap is masked under real proving (the prove duration absorbs it) but
	 *  exposed under proverless e2e, where a follow-up `consume` would race the
	 *  registry. Polling the actual on-chain predicate closes the race for both.
	 *  On timeout we proceed (the caller's sync reads whatever is current) rather
	 *  than fail the settings op. */
	private async waitForOnChainState(check: () => Promise<boolean>, label: string, timeoutMs = 120_000): Promise<void> {
		const start = Date.now()
		while (Date.now() - start < timeoutMs) {
			if (await check()) return
			await sleep(500)
		}
		// Throw — never treat an unverifiable security mutation (revoke / registry
		// toggle) as success. Silently proceeding let a not-yet-effected revoke
		// report "done", so a fast follow-up consume could still spend a grant the
		// user believes is revoked.
		throw new Error(`waitForOnChainState timed out (${label}); on-chain effect not confirmed`)
	}

	private async syncAuthwits(node: AztecNode, account: string, parentTask: WrappedTask, authwits?: Authwit[]) {
		const task = parentTask.startSubtask(new StepContent("Sync authwits"))
		try {
			const _authwits = authwits ?? (await this.getAuthwits(account))
			await Promise.all(_authwits.map((authwit) => this.syncAuthwit(node, authwit, task)))
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private async syncAuthwit(node: AztecNode, authwit: Authwit, parentTask: WrappedTask) {
		const task = parentTask.startSubtask(new StepContent(`Sync authwit #${authwit.id}`))
		try {
			const isConsumable = await isAuthwitConsumable(node, authwit.account, authwit.hash)
			if (isConsumable) return
			try {
				await this.lock.enter()
				if (await this.authwits.get(`${authwit.id}`)) {
					await this.authwits.delete(`${authwit.id}`)
					this.emit("onAuthwitDeleted", authwit)
				}
			} finally {
				this.lock.leave()
			}
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private async syncStatus(node: AztecNode, account: string, parentTask: WrappedTask): Promise<void> {
		const task = parentTask.startSubtask(new StepContent("Sync status"))
		try {
			const isEnabled = await isAuthRegistryEnabled(node, account)
			try {
				await this.lock.enter()
				const enabled = await this.statuses.get(account)
				if (enabled !== isEnabled) {
					if (isEnabled) {
						await this.statuses.delete(account)
						this.emit("onRegistryEnabled", account)
					} else {
						await this.statuses.set(account, isEnabled)
						this.emit("onRegistryDisabled", account)
					}
				}
			} finally {
				this.lock.leave()
			}
			task.complete()
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	public async backup(): Promise<Authwit[] | undefined> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}

		const networks = await this.networkService.getNetworks()
		if (!networks.length) {
			return undefined
		}

		const authwits: Authwit[] = []

		for (const n of networks) {
			const accounts = await this.accountService.getAccounts(profile.id, n.chainId)
			for (const acc of accounts) {
				authwits.push(...(await this.getAuthwits(acc.address)))
			}
		}

		return authwits
	}

	public async restore(authwits: Authwit[]): Promise<Restored<Authwit>[]> {
		await this.ensureInitialized()

		const result: Restored<Authwit>[] = []

		try {
			await this.lock.enter()

			let id = array_max((await this.authwits.getValues()).map((x) => x.id)) + 1
			for (const authwit of authwits) {
				try {
					await this.authwits.set(`${id}`, { ...authwit, id })
					result.push({ ...authwit, id })
					id++
				} catch (err) {
					result.push({
						...authwit,
						restoreError: err instanceof Error ? err.message : err,
					})
				}
			}

			return result
		} finally {
			this.lock.leave()
		}
	}
}
