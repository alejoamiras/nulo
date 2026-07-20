import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { toRestoreError } from "@/utils/restore-error"
import type { ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { NetworkService } from "@/wallet/services/network/service"
import type { Network } from "@/wallet/services/network/spec"
import { networkInfoFrom, NodeStatus } from "@/wallet/services/network/spec"
import { EventHandler } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import {
	ACCOUNT_STATE_SERVICE_NAME,
	type BackupAccountState,
	type BackupContract,
	type BackupSender,
	type Events,
	type Methods,
} from "./spec"

export * from "./spec"

export class AccountStateService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getAccounts",
		"getSenders",
		"getSendersAcrossActiveNetworks",
		"addSender",
		"deleteSender",
		"getContracts",
	)
	public static name = ACCOUNT_STATE_SERVICE_NAME

	public readonly onSenderAdded = new EventHandler<string>()
	public readonly onSenderDeleted = new EventHandler<string>()

	private pxeService: PxeServiceClient = null!
	private networkService: NetworkService = null!

	public constructor(logger: ILogger) {
		super(ACCOUNT_STATE_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection) {
		this.pxeService = new PxeServiceClient(this.logger)
		this.networkService = services.get(NetworkService.name)
	}

	public async getAccounts(networkId: string): Promise<string[]> {
		await this.ensureInitialized()
		const network = await this.networkService.getNetwork(networkId)
		try {
			const accounts = await this.pxeService.getRegisteredAccounts(networkInfoFrom(network))
			return accounts.map((x) => x.address.toString())
		} catch (error) {
			this.logError("Failed to fetch registered accounts", getErrorMessage(error))
			throw new Error("PXE request failed")
		}
	}

	public async getSenders(networkId: string): Promise<string[]> {
		await this.ensureInitialized()
		const network = await this.networkService.getNetwork(networkId)
		try {
			const senders = await this.pxeService.getSenders(networkInfoFrom(network))
			return senders.map((x) => x.toString())
		} catch (error) {
			this.logError("Failed to fetch registered senders", getErrorMessage(error))
			throw new Error("PXE request failed")
		}
	}

	/** Union of registered sender addresses across every network in the
	 *  active profile that reports `Active` node status. Networks whose
	 *  status check or `getSenders` call fails are silently skipped —
	 *  same precedent as `backup()` so we don't block export on a
	 *  partially-degraded multi-chain setup. Used by the contacts export
	 *  to mark which contacts are senders without per-network attribution
	 *  (the import side resolves against the active network only). */
	public async getSendersAcrossActiveNetworks(): Promise<string[]> {
		await this.ensureInitialized()
		const networks = await this.networkService.getNetworks()
		if (!networks.length) return []

		const seenChainIds = new Set<number>()
		const uniqueNetworks = networks.filter((n) => {
			if (seenChainIds.has(n.chainId)) return false
			seenChainIds.add(n.chainId)
			return true
		})

		const union = new Set<string>()
		for (const n of uniqueNetworks) {
			try {
				if ((await this.networkService.getNodeStatus(n.id)) !== NodeStatus.Active) continue
				const senders = await this.getSenders(n.id)
				for (const addr of senders) union.add(addr)
			} catch (error) {
				this.logError(`Failed to read senders on network ${n.id}`, getErrorMessage(error))
				// Skip this network — don't block the export.
			}
		}
		return [...union]
	}

	public async addSender(networkId: string, address: string): Promise<string> {
		await this.ensureInitialized()
		const network = await this.networkService.getNetwork(networkId)
		const info = networkInfoFrom(network)
		try {
			const sender = (await this.pxeService.registerSender(info, AztecAddress.fromStringUnsafe(address))).toString()
			this.emit("onSenderAdded", sender)
			return sender
		} catch (error) {
			this.logError("Failed to register sender", getErrorMessage(error))
			throw new Error("PXE request failed")
		}
	}

	public async deleteSender(networkId: string, address: string): Promise<string> {
		await this.ensureInitialized()
		const network = await this.networkService.getNetwork(networkId)
		try {
			await this.pxeService.removeSender(networkInfoFrom(network), AztecAddress.fromStringUnsafe(address))
			this.emit("onSenderDeleted", address)
			return address
		} catch (error) {
			this.logError("Failed to remove sender", getErrorMessage(error))
			throw new Error("PXE request failed")
		}
	}

	public async getContracts(networkId: string): Promise<string[]> {
		await this.ensureInitialized()
		const network = await this.networkService.getNetwork(networkId)
		try {
			const contracts = await this.pxeService.getContracts(networkInfoFrom(network))
			return contracts.map((x) => x.toString())
		} catch (error) {
			this.logError("Failed to fetch registered contracts", getErrorMessage(error))
			throw new Error("PXE request failed")
		}
	}

	public async backup(): Promise<BackupAccountState[] | undefined> {
		const networks = await this.networkService.getNetworks()
		if (!networks.length) {
			return undefined
		}

		const result: BackupAccountState[] = []

		const seenChainIds = new Set<number>()
		const uniqueNetworks = networks.filter((n) => {
			if (seenChainIds.has(n.chainId)) return false
			seenChainIds.add(n.chainId)
			return true
		})
		for (const n of uniqueNetworks) {
			if ((await this.networkService.getNodeStatus(n.id)) !== NodeStatus.Active) {
				// A backup captures PXE recovery material (contracts/senders) ONLY for networks
				// whose node is reachable at export time. A down endpoint silently drops a
				// network's custom-contract artifacts from an otherwise-successful backup, so a
				// later fresh restore can't rediscover those private notes (codex audit MED).
				// Surface the omission rather than dropping it silently.
				this.logWarn(
					`backup: network ${n.id} (chain ${n.chainId}) is not Active — its contract/sender state is OMITTED from this backup`,
				)
				continue
			}
			const senders = await this.getSenders(n.id)
			const contracts = await this.getContracts(n.id)
			const contractsFull: BackupContract[] = []
			const nInfo = networkInfoFrom(n)
			let skipped = 0
			for (const c of contracts) {
				const instance = await this.pxeService.getContractInstance(nInfo, AztecAddress.fromStringUnsafe(c))
				if (!instance || !instance.currentContractClassId) {
					skipped++
					continue
				}

				const artifact = await this.pxeService.getContractArtifact(nInfo, instance.currentContractClassId)
				if (!artifact) {
					skipped++
					continue
				}

				contractsFull.push({
					address: c,
					instance,
					artifact,
				})
			}
			if (skipped > 0) {
				this.logWarn(
					`backup: network ${n.id} — ${skipped} contract(s) OMITTED (no resolvable instance/artifact); their notes may not survive a fresh restore`,
				)
			}

			result.push({
				networkId: n.id,
				senders: senders.map((address) => ({ address })),
				contracts: contractsFull,
			})
		}

		return result
	}

	public async restore(backupAccountState: BackupAccountState[], networks: Network[]): Promise<Restored<BackupAccountState>[]> {
		await this.ensureInitialized()

		const result: Restored<BackupAccountState>[] = []

		for (const item of backupAccountState) {
			const senders: Restored<BackupSender>[] = []
			const contracts: Restored<BackupContract>[] = []
			// A checksum-valid but shape-malformed slice (e.g. `senders: null`) must NOT throw
			// an uncaught TypeError mid-iteration — this runs AFTER finalizeRestore, where rollback
			// is suppressed, so an uncaught throw leaves a post-commit partial restore (codex audit
			// MED). Coerce non-array senders/contracts to empty + record a per-item error so it
			// surfaces (and blocks auto-completion) without stranding the loop.
			const itemSenders = Array.isArray(item.senders) ? item.senders : []
			const itemContracts = Array.isArray(item.contracts) ? item.contracts : []
			const network = networks.find((n) => n.id === item.networkId)
			if (!Array.isArray(item.senders) || !Array.isArray(item.contracts)) {
				result.push({
					...item,
					senders,
					contracts,
					restoreError: toRestoreError(new Error("malformed account-state item (senders/contracts not arrays)")),
				})
				continue
			}
			for (const sender of itemSenders) {
				try {
					if (!network) throw new Error("Network not found")

					await this.pxeService.registerSender(networkInfoFrom(network), AztecAddress.fromStringUnsafe(sender.address))
					senders.push(sender)
				} catch (err) {
					senders.push({
						...sender,
						restoreError: toRestoreError(err),
					})
				}
			}

			for (const contract of itemContracts) {
				try {
					if (!network) throw new Error("Network not found")

					const addressNum = AztecAddress.fromStringUnsafe(contract.address).toBigInt()
					if (addressNum >= 0 && addressNum <= 6) {
						// ignore protocol contracts registration,
						// because we cannot validate it due to hardcoded addresses
						continue
					}

					await this.pxeService.registerContract(networkInfoFrom(network), {
						instance: contract.instance,
						artifact: contract.artifact,
					})
					contracts.push(contract)
				} catch (err) {
					contracts.push({
						...contract,
						restoreError: toRestoreError(err),
					})
				}
			}

			result.push({
				networkId: item.networkId,
				senders,
				contracts,
			})
		}

		return result
	}
}
