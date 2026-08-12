import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { toRestoreError } from "@/utils/restore-error"
import type { ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { NetworkService } from "@/wallet/services/network/service"
import type { Network } from "@/wallet/services/network/spec"
import { networkInfoFrom, NetworkSchema, NodeStatus } from "@/wallet/services/network/spec"
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
import {
	ACCOUNT_STATE_SKIP_DEADLINE,
	ACCOUNT_STATE_SKIP_UNREACHABLE,
	isConnectivityErrorMessage,
	normalizeAccountStateSlice,
	truncateErrorMessage,
} from "./normalize"

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
				if (!instance?.currentContractClassId) {
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

	/**
	 * Restore PXE registrations from a backup slice. The slice is
	 * attacker-controlled and NOT registry-schema'd, so it passes through the
	 * shared normalizer first (caps, duplicate-network merge, malformed-entry
	 * collapse) — malformed content becomes bounded top-level records, never a
	 * mid-loop throw (this runs AFTER finalizeRestore, where rollback is
	 * suppressed, so an uncaught throw would leave a post-commit partial
	 * restore).
	 *
	 * `deadlineMs` (clamped to 0…30_000) is an absolute budget computed at
	 * entry and checked immediately before EVERY registration launch — one
	 * network can hold ~96 registrations across the two loops, and each
	 * launch carries the offscreen transport's own 90s envelope, so a
	 * per-item-only check could traverse minutes of work after a
	 * slow-but-successful call crossed the line. A connectivity-class failure
	 * fails the REST of that network fast (the payload can't register against
	 * an endpoint that isn't answering).
	 */
	public async restore(
		backupAccountState: BackupAccountState[],
		networks: Network[],
		deadlineMs?: number,
	): Promise<Restored<BackupAccountState>[]> {
		// The absolute deadline starts at ENTRY — init wait time counts against
		// it, never extends it (the caller's clock started at dispatch).
		const clamped =
			typeof deadlineMs === "number" && Number.isFinite(deadlineMs) ? Math.min(Math.max(deadlineMs, 0), 30_000) : undefined
		const deadlineAt = clamped !== undefined ? Date.now() + clamped : undefined
		await this.ensureInitialized()
		const expired = () => deadlineAt !== undefined && Date.now() >= deadlineAt

		const { items, violations } = normalizeAccountStateSlice(backupAccountState)
		const result: Restored<BackupAccountState>[] = [...violations]

		// The networks argument crosses the same trust boundary as the slice:
		// require an array, cap the scan, keep only schema-valid rows — an
		// invalid entry behaves as an absent network ("Network not found").
		const safeNetworks = (Array.isArray(networks) ? networks : []).slice(0, 64).filter((n) => NetworkSchema.safeParse(n).success)

		for (const item of items) {
			const senders: Restored<BackupSender>[] = []
			const contracts: Restored<BackupContract>[] = []
			const network = safeNetworks.find((n) => n.id === item.networkId)
			let unreachable = false
			let skippedByDeadline = 0

			const classify = (err: unknown): string => {
				const message = truncateErrorMessage(toRestoreError(err))
				if (isConnectivityErrorMessage(message)) unreachable = true
				return message
			}

			for (const sender of item.senders) {
				if (unreachable) {
					senders.push({ ...sender, restoreError: ACCOUNT_STATE_SKIP_UNREACHABLE })
					continue
				}
				if (expired()) {
					skippedByDeadline++
					continue
				}
				try {
					if (!network) throw new Error("Network not found")
					await this.pxeService.registerSender(networkInfoFrom(network), AztecAddress.fromStringUnsafe(sender.address))
					senders.push(sender)
				} catch (err) {
					senders.push({ ...sender, restoreError: classify(err) })
				}
			}

			for (const contract of item.contracts) {
				if (unreachable) {
					contracts.push({
						address: contract.address,
						instance: contract.instance,
						artifact: contract.artifact,
						restoreError: ACCOUNT_STATE_SKIP_UNREACHABLE,
					})
					continue
				}
				// Network-first error precedence (pre-existing contract): a missing
				// network reports "Network not found", not the address-parse error.
				let addressNum: bigint
				try {
					if (!network) throw new Error("Network not found")
					addressNum = AztecAddress.fromStringUnsafe(contract.address).toBigInt()
				} catch (err) {
					contracts.push({
						address: contract.address,
						instance: contract.instance,
						artifact: contract.artifact,
						restoreError: truncateErrorMessage(toRestoreError(err)),
					})
					continue
				}
				if (addressNum >= 0 && addressNum <= 6) {
					// ignore protocol contracts registration,
					// because we cannot validate it due to hardcoded addresses
					continue
				}
				if (expired()) {
					skippedByDeadline++
					continue
				}
				try {
					if (!network) throw new Error("Network not found")
					await this.pxeService.registerContract(networkInfoFrom(network), {
						instance: contract.instance,
						artifact: contract.artifact,
					})
					contracts.push(contract)
				} catch (err) {
					contracts.push({
						address: contract.address,
						instance: contract.instance,
						artifact: contract.artifact,
						restoreError: classify(err),
					})
				}
			}

			result.push({
				networkId: item.networkId,
				senders,
				contracts,
				...(skippedByDeadline > 0
					? { restoreError: `${ACCOUNT_STATE_SKIP_DEADLINE} (${skippedByDeadline} registration(s) not attempted)` }
					: {}),
			})
		}

		return result
	}
}
