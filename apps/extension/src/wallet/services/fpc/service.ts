import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ILogger } from "@/wallet/logger"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { ProfileService } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { NetworkService, networkInfoFrom } from "@/wallet/services/network/service"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { purgeMalformedRows, purgeRows } from "@/wallet/services/purge-rows"
import { assertRestoreEpoch, captureRestoreEpochs } from "@/wallet/services/restore-fence"
import { restoreRows } from "@/wallet/services/restore-rows"
import { nextRandomId, preferOrReallocId } from "@/wallet/services/id-allocators"
import { requireOwnedRow } from "@/wallet/services/require-owned-row"
import { ensureRegistered } from "@/wallet/services/execution/contract-resolver"
import { EntityStorage } from "@/wallet/storage"
import { Lock } from "@/wallet/utils"
import { resolveNetworkByChainId } from "@/wallet/utils/caip"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { Fpc } from "./fpc"
import { getFpcHandler } from "./handlers"
import { type Events, FPC_SERVICE_NAME, FPC_STORAGE_ROOT, type FpcInfo, FpcType, type Methods, StoredFpcSchema } from "./spec"
import { getContractInstanceFromInstantiationParams, type ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import { loadContractArtifact, type ContractArtifact } from "@aztec/stdlib/abi"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
// @ts-expect-error — raw JSON import via vite alias, bypasses @aztec/aztec.js (which references document/window)
import PrivateFPCJson from "@private-fpc-artifact"
import { Fr } from "@aztec/foundation/curves/bn254"

const PrivateFPCContractArtifact = loadContractArtifact(PrivateFPCJson)

export * from "./fpc"
export * from "./spec"

/** The instantiation params for each protocol FPC — the SINGLE source both the canonical-address
 * derivation and the PXE-discovery registration read, so the two can never derive different
 * addresses. The PrivateFPC canonical salt is a FIXED project constant from 5.0.0 onward (the
 * fee-payment package's canonical-deployment contract; rc-era used salt 0). It must equal
 * bridge-core's PRIVATE_FPC_SALT / private-fpc-canonical.json — the derivation from
 * (artifact, salt, deployer) is machine-asserted there (layering bars the import here). Depositing
 * to a wrong PrivateFPC address is an UNRECOVERABLE loss, so a salt drift between the two sites was
 * a fund-loss hazard, not just a re-discovery bug. */
const SPONSORED_FPC_PARAMS = () => ({ constructorArgs: [], salt: Fr.zero() })
const PRIVATE_FPC_PARAMS = () => ({ constructorArgs: [], salt: new Fr(1n), deployer: AztecAddress.ZERO })

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

	private readonly storage: EntityStorage<StoredFpc>
	private readonly lock = new Lock("fpc", this.logger)

	/** Per-chain cache of deterministic protocol addresses. Populated lazily
	 * inside `getFpcs(chainId)` so we don't pay the derivation cost in the
	 * service constructor. Used to recompute `isProtocol` at read time. */
	private readonly protocolAddresses = new Map<number, ProtocolAddresses>()

	private pxeService: PxeServiceClient = null!
	private profileService: ProfileService = null!
	private networkService: NetworkService = null!

	public constructor(logger: ILogger, browserApi: BrowserApi) {
		super(FPC_SERVICE_NAME, logger)
		this.storage = new EntityStorage<StoredFpc>(FPC_STORAGE_ROOT, browserApi.storage.local, (raw) => StoredFpcSchema.parse(raw))
	}

	protected async init(services: ServiceCollection) {
		this.pxeService = new PxeServiceClient(this.logger)
		this.profileService = services.get(ProfileService.name)
		this.networkService = services.get(NetworkService.name)
		// Profile-delete cleanup is now the coordinator's awaited `purgeForProfile` (D).
		this.networkService.registerChainPurgeSubscriber(async (profileId, chainId) => this.clearChainState(profileId, chainId))
	}

	/**
	 * Wipe FPC entries for `(profileId, chainId)`. Emits `onFpcDeleted` per
	 * fpc. Called by `NetworkService.purgeChain`.
	 */
	public async clearChainState(profileId: string, chainId: number): Promise<void> {
		await this.ensureInitialized()
		// Under the same lock the create/discovery writers commit with, so the
		// sweep and a create are atomic — a create either lands before the
		// snapshot (and is purged) or runs after and fails its in-lock asserts.
		await this.lock.withLock(async () => {
			const fpcs = (await this.storage.getValues()).filter((f) => f.profileId === profileId && f.chainId === chainId)
			await purgeRows(
				fpcs,
				(fpc) => this.storage.delete(fpc.id),
				(fpc) => this.emit("onFpcDeleted", this.decorate(fpc, this.protocolAddresses.get(chainId))),
			)
			// Drop the cached addresses for this chain so a later re-add re-derives.
			this.protocolAddresses.delete(chainId)
		})
	}

	private async getOrComputeProtocolAddresses(chainId: number): Promise<ProtocolAddresses> {
		const cached = this.protocolAddresses.get(chainId)
		if (cached) return cached

		const sponsoredInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, SPONSORED_FPC_PARAMS())
		const privateInstance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, PRIVATE_FPC_PARAMS())
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
		// Atomic read+capture: this read path DISCOVERS (writes protocol rows), so
		// its writes need the same deletion fence as addFpc.
		const fence = await this.profileService.captureExecutionFence()
		const deletion = this.profileService.getDeletionState()
		const profile = { id: fence.profileId }
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
		// Sentinel shape: the concurrent-holder early return maps UNDER the lock
		// (as today), while the tail mapping below stays after release. `undefined`
		// is the no-early-return sentinel — the mapped value is always an array.
		const early = await this.lock.withLock(async () => {
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
			const toDiscover = await this.collectMissingProtocolInstances(hasSponsoredFpc, hasPrivateFpc)

			for (const item of toDiscover) {
				try {
					result.push(await this.registerAndStoreProtocolFpc(item, pxe, chainId as number, network, fence, deletion))
				} catch (err) {
					this.logWarn(`getFpcs: Failed to discover FPC ${item.instance.address.toString()}:`, err)
					this.logError(`Failed to discover FPC ${item.instance.address.toString()}`, err)
				}
			}
			return undefined
		})
		if (early) return early
		return result.map((f) => this.decorate(f, protocols))
	}

	/** Derive the instance for each protocol FPC the profile is missing. Same
	 *  params as getOrComputeProtocolAddresses — the shared consts are what
	 *  guarantee the discovered/registered instances equal `protocols.*`; a
	 *  divergence would register/store a DIFFERENT FPC than the derived address,
	 *  so the has-checks never match (endless re-discovery) and the private-fuel
	 *  path keys off the wrong address (unrecoverable-deposit hazard — see this
	 *  file's header). */
	private async collectMissingProtocolInstances(
		hasSponsoredFpc: boolean,
		hasPrivateFpc: boolean,
	): Promise<{ instance: ContractInstanceWithAddress; artifact: ContractArtifact }[]> {
		const toDiscover: { instance: ContractInstanceWithAddress; artifact: ContractArtifact }[] = []
		if (!hasSponsoredFpc) {
			const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, SPONSORED_FPC_PARAMS())
			this.logDebug(`getFpcs: SponsoredFPC instance address=${instance.address.toString()}`)
			toDiscover.push({ instance, artifact: SponsoredFPCContractArtifact })
		}
		if (!hasPrivateFpc) {
			const instance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, PRIVATE_FPC_PARAMS())
			this.logDebug(`getFpcs: PrivateFPC instance address=${instance.address.toString()}`)
			toDiscover.push({ instance, artifact: PrivateFPCContractArtifact })
		}
		return toDiscover
	}

	/** One protocol FPC's register + store, called only UNDER the discovery
	 *  lock. Discovery is best-effort per item (the caller's catch keeps
	 *  failures soft), but its WRITES carry the same obligations as addFpc:
	 *  never land for a deleted profile or a mid-purge chain — the deletion
	 *  fence sequence (assert → network-live check → write → re-check →
	 *  compensating delete) is one contiguous span here. Throws propagate to
	 *  the caller's per-item catch. */
	private async registerAndStoreProtocolFpc(
		item: { instance: ContractInstanceWithAddress; artifact: ContractArtifact },
		pxe: ReturnType<PxeServiceClient["getPXE"]>,
		chainId: number,
		network: { id: string },
		fence: { profileId: string; epoch: number },
		deletion: ReturnType<ProfileService["getDeletionState"]>,
	): Promise<StoredFpc> {
		const { instance: contractInstance, artifact: contractArtifact } = item
		await pxe.registerContract({ instance: contractInstance, artifact: contractArtifact })
		this.logInfo(`Registered protocol FPC: ${contractInstance.address.toString()}`)

		const type = this.detectFpcType(contractArtifact)
		const fpcHandler = getFpcHandler(type)
		fpcHandler.validateArtifact(contractArtifact)

		const id = await nextRandomId(this.storage)
		const fpc: StoredFpc = {
			id,
			profileId: fence.profileId,
			chainId,
			type,
			address: contractInstance.address.toString(),
			name: type === FpcType.PrivateFpc ? PRIVATE_FPC_DEFAULT_NAME : SPONSORED_FPC_DEFAULT_NAME,
		}
		deletion.assertCurrent(fence.profileId, fence.epoch)
		if (!(await this.networkService.isNetworkLive(network.id))) {
			throw new Error("network deleted")
		}
		await this.storage.set(id, fpc)
		if (!deletion.isCurrent(fence.profileId, fence.epoch)) {
			await this.storage.delete(id)
			throw new Error(`profile ${fence.profileId} deleted`)
		}
		return fpc
	}

	public async getFpc(id: string): Promise<FpcInfo> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		const fpcInfo = requireOwnedRow(await this.storage.get(id), profile.id)
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
		// Atomic read+capture at the authorizing entry: the PXE fetches below can
		// span the profile's deletion or the chain's purge — the commit asserts
		// both flush against the write.
		const fence = await this.profileService.captureExecutionFence()
		const deletion = this.profileService.getDeletionState()
		const network = await this.networkService.getNetwork(networkId)
		const pxe = this.pxeService.getPXE(networkInfoFrom(network))

		const fpcInstance = await pxe.getContractInstance(AztecAddress.fromStringUnsafe(address))
		if (!fpcInstance) {
			throw new Error("Contract instance not found")
		}

		const fpcArtifact = await pxe.getContractArtifact(fpcInstance.currentContractClassId)
		if (!fpcArtifact) {
			throw new Error("Contract artifact not found")
		}

		await ensureRegistered(pxe, address, fpcInstance, fpcArtifact)

		const fpcHandler = getFpcHandler(type)
		fpcHandler.validateArtifact(fpcArtifact)

		const protocols = await this.getOrComputeProtocolAddresses(network.chainId)

		return await this.lock.withLock(async () => {
			const id = await nextRandomId(this.storage)
			const fpc: StoredFpc = {
				id,
				profileId: fence.profileId,
				chainId: network.chainId,
				type,
				address,
				name,
			}
			deletion.assertCurrent(fence.profileId, fence.epoch)
			if (!(await this.networkService.isNetworkLive(networkId))) {
				throw new Error("network deleted")
			}
			await this.storage.set(id, fpc)
			// The set awaits — compensate before the row becomes observable.
			if (!deletion.isCurrent(fence.profileId, fence.epoch)) {
				await this.storage.delete(id)
				throw new Error(`profile ${fence.profileId} deleted`)
			}
			const decorated = this.decorate(fpc, protocols)
			this.emit("onFpcAdded", decorated)
			return decorated
		})
	}

	public async updateFpc(id: string, name: string): Promise<FpcInfo> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return await this.lock.withLock(async () => {
			const fpc = requireOwnedRow(await this.storage.get(id), profile.id)
			const protocols = await this.getOrComputeProtocolAddresses(fpc.chainId)
			if (this.decorate(fpc, protocols).isProtocol) {
				throw new Error("Cannot rename protocol FPC")
			}
			fpc.name = name
			await this.storage.set(id, fpc)
			const decorated = this.decorate(fpc, protocols)
			this.emit("onFpcUpdated", decorated)
			return decorated
		})
	}

	public async updateFpcAddress(id: string, address: string): Promise<FpcInfo> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		// Snapshot the row first so we know which network's PXE to query.
		const existing = requireOwnedRow(await this.storage.get(id), profile.id)
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

		const fpcInstance = await pxe.getContractInstance(AztecAddress.fromStringUnsafe(address))
		if (!fpcInstance) {
			throw new Error("No contract found at this address. Make sure it's deployed and is a Sponsored FPC.")
		}
		const fpcArtifact = await pxe.getContractArtifact(fpcInstance.currentContractClassId)
		if (!fpcArtifact) {
			throw new Error("Couldn't load the contract artifact. This address is not a Sponsored FPC.")
		}
		await ensureRegistered(pxe, address, fpcInstance, fpcArtifact)

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

		return await this.lock.withLock(async () => {
			const next: StoredFpc = { ...existing, address }
			await this.storage.set(id, next)
			const decorated = this.decorate(next, protocols)
			this.emit("onFpcUpdated", decorated)
			return decorated
		})
	}

	public async deleteFpc(id: string): Promise<FpcInfo> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return await this.lock.withLock(async () => {
			const fpc = requireOwnedRow(await this.storage.get(id), profile.id)
			const protocols = await this.getOrComputeProtocolAddresses(fpc.chainId)
			const decorated = this.decorate(fpc, protocols)
			if (decorated.isProtocol) {
				throw new Error("Cannot delete protocol FPC")
			}
			await this.storage.delete(id)
			this.emit("onFpcDeleted", decorated)
			return decorated
		})
	}

	public async getFpcImpl(id: string): Promise<Fpc> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		const fpcInfo = requireOwnedRow(await this.storage.get(id), profile.id)
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

	/** Awaited profile-scoped purge, called by the deletion coordinator (relocated
	 *  from the removed fire-and-forget `onProfileDeleted` sub — finding D). */
	public async purgeForProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		this.logDebug(`purgeForProfile ${profileId}: remove related FPCs`)
		await this.lock.withLock(async () => {
			const fpcs = (await this.storage.getValues()).filter((fpc) => fpc.profileId === profileId)
			await purgeRows(
				fpcs,
				(fpc) => {
					this.logDebug(`Remove fpc #${fpc.id}`)
					return this.storage.delete(fpc.id)
				},
				(fpc) => this.emit("onFpcDeleted", this.decorate(fpc, this.protocolAddresses.get(fpc.chainId))),
			)
			// F-B23: raw second pass — a validation-failed row this profile owns is
			// invisible to getValues() and would otherwise survive the purge forever.
			await purgeMalformedRows(
				this.storage,
				(raw) => raw.profileId === profileId,
				(id) => this.logDebug(`purged malformed fpc row ${id}`),
			)
		})
	}

	public async backup(): Promise<FpcInfo[]> {
		// Strip in-memory `isProtocol` (and any leftover legacy fields) so
		// exports don't carry trust signals across wallet boundaries.
		const fpcs = await this.getFpcs()
		return fpcs.map(({ isProtocol: _isProtocol, ...rest }) => rest)
	}

	public async restore(fpcs: FpcInfo[]): Promise<Restored<FpcInfo>[]> {
		await this.ensureInitialized()
		// Deletion fence captured at entry (see restore-fence.ts): rows written
		// after a mid-restore deleteProfile must reject, not orphan.
		const deletion = this.profileService.getDeletionState()
		const epochs = captureRestoreEpochs(
			deletion,
			fpcs.map((f) => (f as { profileId?: unknown } | null)?.profileId),
		)

		return await this.lock.withLock(async () => {
			return await restoreRows(fpcs, async (fpc) => {
				// Reject legacy DefaultFpc (Token FPC) entries explicitly —
				// post-deprecation they have no handler and would crash the
				// wallet on next read. Also reject any unknown numeric type. The
				// throw is caught by restoreRows into the same `restoreError` row.
				if (fpc.type !== FpcType.DefaultSponsoredFpc && fpc.type !== FpcType.PrivateFpc) {
					throw new Error("Token FPC deprecated and no longer supported")
				}

				const id = await preferOrReallocId(this.storage, fpc.id)

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
				// Parse the persisted shape so a malformed backup fpc is recorded as
				// restoreError, not silently written + codec-hidden on read.
				StoredFpcSchema.parse(stored)
				assertRestoreEpoch(deletion, epochs, stored.profileId)
				await this.storage.set(id, stored)
				return { ...stored, isProtocol: false }
			})
		})
	}
}
