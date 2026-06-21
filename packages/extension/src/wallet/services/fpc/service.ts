import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { toRestoreError } from "@/utils/restore-error"
import type { ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { NetworkService, networkInfoFrom } from "@/wallet/services/network/service"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { purgeRows } from "@/wallet/services/purge-rows"
import { EntityStorage } from "@/wallet/storage"
import { getRandomHex, Lock } from "@/wallet/utils"
import { resolveNetworkByChainId } from "@/wallet/utils/caip"
import { EventHandler } from "@nulo/wallet-core/utils"
import { Fpc } from "./fpc"
import { getFpcHandler } from "./handlers"
import { type Events, FPC_SERVICE_NAME, type FpcInfo, FpcType, type Methods } from "./spec"
import { getContractInstanceFromInstantiationParams, type ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import { loadContractArtifact, type ContractArtifact } from "@aztec/stdlib/abi"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
// @ts-expect-error — raw JSON import via vite alias, bypasses @aztec/aztec.js (which references document/window)
import PrivateFPCJson from "@private-fpc-artifact"
import { Fr } from "@aztec/foundation/curves/bn254"

const PrivateFPCContractArtifact = loadContractArtifact(PrivateFPCJson)

export * from "./fpc"
export * from "./spec"

/** Names seeded onto auto-discovered protocol FPCs. */
const SPONSORED_FPC_DEFAULT_NAME = "Sponsored Fee Juice"
const PRIVATE_FPC_DEFAULT_NAME = "Private Fee Juice"

type ProtocolAddresses = { sponsored: string; private: string }

/** Stored shape strips the in-memory `isProtocol` decoration. */
type StoredFpc = Omit<FpcInfo, "isProtocol">

export class FpcService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()("getFpcs", "getFpc", "addFpc", "updateFpc", "updateFpcAddress", "deleteFpc")
	public static name = FPC_SERVICE_NAME

	public readonly onFpcAdded = new EventHandler<FpcInfo>()
	public readonly onFpcUpdated = new EventHandler<FpcInfo>()
	public readonly onFpcDeleted = new EventHandler<FpcInfo>()

	private readonly storage = new EntityStorage<StoredFpc>("nulo:core:fpcs", chrome.storage.local)
	private readonly lock = new Lock("fpc", this.logger)

	/** Per-chain cache of deterministic protocol addresses. Populated lazily
	 * inside `getFpcs(chainId)` so we don't pay the derivation cost in the
	 * service constructor. Used to recompute `isProtocol` at read time. */
	private readonly protocolAddresses = new Map<number, ProtocolAddresses>()

	private pxeService: PxeServiceClient = null!
	private profileService: ProfileService = null!
	private networkService: NetworkService = null!

	public constructor(logger: ILogger) {
		super(FPC_SERVICE_NAME, logger)
	}

	protected async init(services: ServiceCollection) {
		this.pxeService = new PxeServiceClient(this.logger)
		this.profileService = services.get(ProfileService.name)
		this.networkService = services.get(NetworkService.name)
		this.profileService.onProfileDeleted.add(this.onProfileDeleted)
		this.networkService.registerChainPurgeSubscriber(async (profileId, chainId) => this.clearChainState(profileId, chainId))
	}

	/**
	 * Wipe FPC entries for `(profileId, chainId)`. Emits `onFpcDeleted` per
	 * fpc. Called by `NetworkService.purgeChain`.
	 */
	public async clearChainState(profileId: string, chainId: number): Promise<void> {
		await this.ensureInitialized()
		const fpcs = (await this.storage.getValues()).filter((f) => f.profileId === profileId && f.chainId === chainId)
		await purgeRows(
			fpcs,
			(fpc) => this.storage.delete(fpc.id),
			(fpc) => this.emit("onFpcDeleted", this.decorate(fpc, this.protocolAddresses.get(chainId))),
		)
		// Drop the cached addresses for this chain so a later re-add re-derives.
		this.protocolAddresses.delete(chainId)
	}

	private async getOrComputeProtocolAddresses(chainId: number): Promise<ProtocolAddresses> {
		const cached = this.protocolAddresses.get(chainId)
		if (cached) return cached

		const sponsoredInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
			constructorArgs: [],
			salt: Fr.zero(),
		})
		const privateInstance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, {
			constructorArgs: [],
			salt: Fr.zero(),
			deployer: AztecAddress.ZERO,
		})
		const addresses: ProtocolAddresses = {
			sponsored: sponsoredInstance.address.toString(),
			private: privateInstance.address.toString(),
		}
		this.protocolAddresses.set(chainId, addresses)
		return addresses
	}

	/** Decorate the on-disk shape with `isProtocol` based on whether the
	 * address matches a deterministic protocol address for the row's chain.
	 * `protocols` may be undefined when we haven't yet derived for that chain. */
	private decorate(fpc: StoredFpc, protocols: ProtocolAddresses | undefined): FpcInfo {
		const isProtocol =
			!!protocols &&
			((fpc.type === FpcType.DefaultSponsoredFpc && fpc.address === protocols.sponsored) ||
				(fpc.type === FpcType.PrivateFpc && fpc.address === protocols.private))
		return { ...fpc, isProtocol }
	}

	public async getFpcs(chainId?: number): Promise<FpcInfo[]> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		const allFpcs = await this.storage.getValues()
		let result = allFpcs.filter((fpc) => fpc.profileId === profile.id && (chainId === undefined || fpc.chainId === chainId))
		this.logDebug(
			`getFpcs: chainId=${chainId}, allFpcs=${allFpcs.length}, filtered=${result.length}, types=${result.map((f) => `${f.type}:${f.name}`).join(", ")}`,
		)
		if (chainId === undefined) {
			// No chain context → return without isProtocol decoration; callers
			// asking across chains shouldn't reason about protocol-row
			// permissions. backup() uses this branch.
			return result.map((f) => ({ ...f, isProtocol: false }))
		}

		const protocols = await this.getOrComputeProtocolAddresses(chainId)

		// Auto-discover missing protocol FPCs (SponsoredFPC, PrivateFPC)
		const missingBeforeLock =
			!result.some((f) => f.type === FpcType.DefaultSponsoredFpc && f.address === protocols.sponsored) ||
			!result.some((f) => f.type === FpcType.PrivateFpc && f.address === protocols.private)
		if (!missingBeforeLock) return result.map((f) => this.decorate(f, protocols))

		this.logInfo("Discovering missing protocol FPCs...")
		try {
			await this.lock.enter()

			// Re-read storage now that we hold the lock. A prior holder in the
			// queue may have just completed discovery — if so, skip the PXE
			// work entirely. Without this, every queued caller independently
			// re-runs the full registration chain against stale state, and
			// one wedged PXE call pins ALL of them for up to Lock.MAX_HOLD_MS.
			const freshAllFpcs = await this.storage.getValues()
			result = freshAllFpcs.filter((fpc) => fpc.profileId === profile.id && fpc.chainId === chainId)
			const hasSponsoredFpc = result.some((f) => f.type === FpcType.DefaultSponsoredFpc && f.address === protocols.sponsored)
			const hasPrivateFpc = result.some((f) => f.type === FpcType.PrivateFpc && f.address === protocols.private)
			this.logDebug(`getFpcs (under lock): hasSponsoredFpc=${hasSponsoredFpc}, hasPrivateFpc=${hasPrivateFpc}`)
			if (hasSponsoredFpc && hasPrivateFpc) {
				this.logDebug("Discovery skipped — already completed by concurrent holder")
				return result.map((f) => this.decorate(f, protocols))
			}

			const network = await resolveNetworkByChainId(this.networkService, chainId)
			const pxe = this.pxeService.getPXE(networkInfoFrom(network))

			const toDiscover: { instance: ContractInstanceWithAddress; artifact: ContractArtifact }[] = []

			if (!hasSponsoredFpc) {
				const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
					constructorArgs: [],
					salt: Fr.zero(),
				})
				this.logDebug(`getFpcs: SponsoredFPC instance address=${instance.address.toString()}`)
				toDiscover.push({ instance, artifact: SponsoredFPCContractArtifact })
			}
			if (!hasPrivateFpc) {
				const instance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, {
					constructorArgs: [],
					salt: Fr.zero(),
					deployer: AztecAddress.ZERO,
				})
				this.logDebug(`getFpcs: PrivateFPC instance address=${instance.address.toString()}`)
				toDiscover.push({ instance, artifact: PrivateFPCContractArtifact })
			}

			for (const { instance: contractInstance, artifact: contractArtifact } of toDiscover) {
				try {
					await pxe.registerContract({ instance: contractInstance, artifact: contractArtifact })
					this.logInfo(`Registered protocol FPC: ${contractInstance.address.toString()}`)

					const type = this.detectFpcType(contractArtifact)
					const fpcHandler = getFpcHandler(type)
					fpcHandler.validateArtifact(contractArtifact)

					let id: string
					do {
						id = getRandomHex(8)
					} while (await this.storage.contains(id))
					const fpc: StoredFpc = {
						id,
						profileId: profile.id,
						chainId,
						type,
						address: contractInstance.address.toString(),
						name: type === FpcType.PrivateFpc ? PRIVATE_FPC_DEFAULT_NAME : SPONSORED_FPC_DEFAULT_NAME,
					}
					await this.storage.set(id, fpc)
					result.push(fpc)
				} catch (err) {
					this.logWarn(`getFpcs: Failed to discover FPC ${contractInstance.address.toString()}:`, err)
					this.logError(`Failed to discover FPC ${contractInstance.address.toString()}`, err)
				}
			}
		} finally {
			this.lock.leave()
		}
		return result.map((f) => this.decorate(f, protocols))
	}

	public async getFpc(id: string): Promise<FpcInfo> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		const fpcInfo = await this.storage.get(id)
		if (fpcInfo?.profileId !== profile.id) {
			throw new Error("Invalid id")
		}
		const protocols = this.protocolAddresses.get(fpcInfo.chainId)
		return this.decorate(fpcInfo, protocols)
	}

	public async addFpc(networkId: string, type: FpcType, address: string, name?: string): Promise<FpcInfo> {
		await this.ensureInitialized()
		// Defense in depth: stale popups posting `type: 0` (the deprecated
		// DefaultFpc / Token FPC slot) hit the handler-switch default and
		// throw "Invalid FPC type". We surface a clearer error here.
		if (type !== FpcType.DefaultSponsoredFpc && type !== FpcType.PrivateFpc) {
			throw new Error("Unsupported FPC type")
		}
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		const network = await this.networkService.getNetwork(networkId)
		const pxe = this.pxeService.getPXE(networkInfoFrom(network))

		const fpcInstance = await pxe.getContractInstance(AztecAddress.fromString(address))
		if (!fpcInstance) {
			throw new Error("Contract instance not found")
		}

		const fpcArtifact = await pxe.getContractArtifact(fpcInstance.currentContractClassId)
		if (!fpcArtifact) {
			throw new Error("Contract artifact not found")
		}

		const registeredContracts = await pxe.getContracts()
		if (!registeredContracts.find((x) => x.toString() === address)) {
			await pxe.registerContract({
				instance: fpcInstance,
				artifact: fpcArtifact,
			})
		}

		const fpcHandler = getFpcHandler(type)
		fpcHandler.validateArtifact(fpcArtifact)

		const protocols = await this.getOrComputeProtocolAddresses(network.chainId)

		try {
			await this.lock.enter()
			let id: string
			do {
				id = getRandomHex(8)
			} while (await this.storage.contains(id))
			const fpc: StoredFpc = {
				id,
				profileId: profile.id,
				chainId: network.chainId,
				type,
				address,
				name,
			}
			await this.storage.set(id, fpc)
			const decorated = this.decorate(fpc, protocols)
			this.emit("onFpcAdded", decorated)
			return decorated
		} finally {
			this.lock.leave()
		}
	}

	public async updateFpc(id: string, name: string): Promise<FpcInfo> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		try {
			await this.lock.enter()
			const fpc = await this.storage.get(id)
			if (fpc?.profileId !== profile.id) {
				throw new Error("Invalid id")
			}
			const protocols = await this.getOrComputeProtocolAddresses(fpc.chainId)
			if (this.decorate(fpc, protocols).isProtocol) {
				throw new Error("Cannot rename protocol FPC")
			}
			fpc.name = name
			await this.storage.set(id, fpc)
			const decorated = this.decorate(fpc, protocols)
			this.emit("onFpcUpdated", decorated)
			return decorated
		} finally {
			this.lock.leave()
		}
	}

	public async updateFpcAddress(id: string, address: string): Promise<FpcInfo> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		// Snapshot the row first so we know which network's PXE to query.
		const existing = await this.storage.get(id)
		if (existing?.profileId !== profile.id) {
			throw new Error("Invalid id")
		}
		if (existing.address === address) {
			// No-op. Preserve the existing entry without going to PXE.
			const protocols = await this.getOrComputeProtocolAddresses(existing.chainId)
			return this.decorate(existing, protocols)
		}
		// PrivateFPC address-edit is permanently disallowed. Custom-salt
		// PrivateFPC instances aren't publicly deployed and the wallet
		// bundles a single artifact version, so we cannot validate an
		// arbitrary address as a PrivateFPC. The UI hides the affordance;
		// this is the service-layer backstop.
		if (existing.type === FpcType.PrivateFpc) {
			throw new Error("Private Fee Juice FPC address cannot be changed.")
		}

		// Type-narrowed: existing.type === FpcType.DefaultSponsoredFpc here
		// (the PrivateFPC early-return above eliminated the other variant).
		const network = await resolveNetworkByChainId(this.networkService, existing.chainId)
		const pxe = this.pxeService.getPXE(networkInfoFrom(network))

		const fpcInstance = await pxe.getContractInstance(AztecAddress.fromString(address))
		if (!fpcInstance) {
			throw new Error("No contract found at this address. Make sure it's deployed and is a Sponsored FPC.")
		}
		const fpcArtifact = await pxe.getContractArtifact(fpcInstance.currentContractClassId)
		if (!fpcArtifact) {
			throw new Error("Couldn't load the contract artifact. This address is not a Sponsored FPC.")
		}
		const registered = await pxe.getContracts()
		if (!registered.find((x) => x.toString() === address)) {
			await pxe.registerContract({ instance: fpcInstance, artifact: fpcArtifact })
		}

		// Hard-validate that the new address still implements the same FPC type.
		const handler = getFpcHandler(existing.type)
		try {
			handler.validateArtifact(fpcArtifact)
		} catch {
			throw new Error("This address is not a Sponsored FPC.")
		}

		const protocols = await this.getOrComputeProtocolAddresses(existing.chainId)
		// Reject promoting a user row to the deterministic Sponsored protocol
		// slot. The auto-discovery path is the canonical way to acquire that row.
		if (!this.decorate(existing, protocols).isProtocol && address === protocols.sponsored) {
			throw new Error("Cannot promote user FPC to protocol slot")
		}

		try {
			await this.lock.enter()
			const next: StoredFpc = { ...existing, address }
			await this.storage.set(id, next)
			const decorated = this.decorate(next, protocols)
			this.emit("onFpcUpdated", decorated)
			return decorated
		} finally {
			this.lock.leave()
		}
	}

	public async deleteFpc(id: string): Promise<FpcInfo> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		try {
			await this.lock.enter()
			const fpc = await this.storage.get(id)
			if (fpc?.profileId !== profile.id) {
				throw new Error("Invalid id")
			}
			const protocols = await this.getOrComputeProtocolAddresses(fpc.chainId)
			const decorated = this.decorate(fpc, protocols)
			if (decorated.isProtocol) {
				throw new Error("Cannot delete protocol FPC")
			}
			await this.storage.delete(id)
			this.emit("onFpcDeleted", decorated)
			return decorated
		} finally {
			this.lock.leave()
		}
	}

	public async getFpcImpl(id: string): Promise<Fpc> {
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Profile locked")
		}
		const fpcInfo = await this.storage.get(id)
		if (fpcInfo?.profileId !== profile.id) {
			throw new Error("Invalid id")
		}
		const fpcHandler = getFpcHandler(fpcInfo.type)
		const protocols = this.protocolAddresses.get(fpcInfo.chainId)
		return new Fpc(this.decorate(fpcInfo, protocols), fpcHandler)
	}

	/**
	 * Detect FPC type from contract artifact by inspecting function signatures.
	 * - `sponsor_unconditionally` → DefaultSponsoredFpc
	 * - `pay_fee` + `balance_of` → PrivateFpc
	 */
	private detectFpcType(artifact: { name: string; functions: { name: string }[] }): FpcType {
		const hasSponsorUnconditionally = artifact.functions.some((f) => f.name === "sponsor_unconditionally")
		if (hasSponsorUnconditionally) {
			return FpcType.DefaultSponsoredFpc
		}

		const hasPayFee = artifact.functions.some((f) => f.name === "pay_fee")
		const hasBalanceOf = artifact.functions.some((f) => f.name === "balance_of")
		if (hasPayFee && hasBalanceOf) {
			return FpcType.PrivateFpc
		}

		throw new Error("Unsupported FPC artifact")
	}

	private readonly onProfileDeleted = async (profile: ProfileInfo) => {
		this.logDebug(`Profile ${profile.id} deleted, remove related FPCs`)
		try {
			await this.lock.enter()
			const fpcs = (await this.storage.getValues()).filter((fpc) => fpc.profileId === profile.id)
			await purgeRows(
				fpcs,
				(fpc) => {
					this.logDebug(`Remove fpc #${fpc.id}`)
					return this.storage.delete(fpc.id)
				},
				(fpc) => this.emit("onFpcDeleted", this.decorate(fpc, this.protocolAddresses.get(fpc.chainId))),
			)
		} finally {
			this.lock.leave()
		}
	}

	public async backup(): Promise<FpcInfo[]> {
		// Strip in-memory `isProtocol` (and any leftover legacy fields) so
		// exports don't carry trust signals across wallet boundaries.
		const fpcs = await this.getFpcs()
		return fpcs.map(({ isProtocol: _isProtocol, ...rest }) => rest)
	}

	public async restore(fpcs: FpcInfo[]): Promise<Restored<FpcInfo>[]> {
		await this.ensureInitialized()

		const result: Restored<FpcInfo>[] = []
		try {
			await this.lock.enter()

			for (const fpc of fpcs) {
				try {
					// Reject legacy DefaultFpc (Token FPC) entries explicitly —
					// post-deprecation they have no handler and would crash the
					// wallet on next read. Also reject any unknown numeric type.
					if (fpc.type !== FpcType.DefaultSponsoredFpc && fpc.type !== FpcType.PrivateFpc) {
						result.push({
							...fpc,
							restoreError: "Token FPC deprecated and no longer supported",
						})
						continue
					}

					let id = fpc.id
					while (await this.storage.contains(id)) {
						id = getRandomHex(8)
					}

					// Strip `isProtocol` (recomputed at read time) and any
					// legacy decoration fields a v3 backup might carry.
					const { isProtocol: _isProtocol, ...rest } = fpc as FpcInfo & { [k: string]: unknown }
					const stored: StoredFpc = {
						id,
						profileId: rest.profileId,
						chainId: rest.chainId,
						type: rest.type,
						address: rest.address,
						name: rest.name,
					}
					await this.storage.set(id, stored)
					result.push({ ...stored, isProtocol: false })
				} catch (err) {
					result.push({
						...fpc,
						restoreError: toRestoreError(err),
					})
				}
			}

			return result
		} finally {
			this.lock.leave()
		}
	}
}
