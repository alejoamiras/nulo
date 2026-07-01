import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { toRestoreError } from "@/utils/restore-error"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { validateParams } from "@nulo/extension-messaging/zod"
import { AztecNodeFactoryAdapter } from "@nulo/aztec-runtime/adapters"
import type { NodeFactory } from "@nulo/aztec-runtime/ports"
import type { ILogger } from "@/wallet/logger"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { requireOwnedRow } from "@/wallet/services/require-owned-row"
import { nextRandomId } from "@/wallet/services/id-allocators"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { EntityStorage } from "@/wallet/storage"
import { getRandomHex, Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import {
	type ChainKind,
	ERR_ACTIVE_NETWORK,
	ERR_BACKUP_TOO_OLD,
	ERR_DUPLICATE_CHAIN,
	ERR_DUPLICATE_ENDPOINT,
	ERR_ENDPOINT_CHAIN_MISMATCH,
	ERR_LAST_ENDPOINT,
	ERR_PRIMARY_ENDPOINT,
	type Events,
	type Methods,
	type Network,
	type NetworkEndpoint,
	type NetworkInfo,
	NETWORK_SERVICE_NAME,
	NetworkMethodSchemas,
	NetworkSchema,
	NodeStatus,
	NetworkRowSchema,
} from "./spec"

export * from "./spec"

/**
 * Per-profile active-network pointer. The service owns this state (vs. v0
 * which left it to UI / chrome.storage.local). UI reads via
 * `getActiveNetwork()`. Stored as a single value per profile.
 */
const ACTIVE_KEY_PREFIX = "nulo:core:active-network@"
const activeKey = (profileId: string) => `${ACTIVE_KEY_PREFIX}${profileId}`

interface DefaultSeed {
	name: string
	rpcUrl: string
	chainId: number
	kind: ChainKind
	isPrimaryActive: boolean
}

/**
 * RPC URL stamped into the "Local Network" preset at build time. Defaults
 * to `http://localhost:8080`; e2e runs override via `VITE_LOCAL_NETWORK_RPC_URL`
 * so each parallel agent's wallet build talks to its own aztec sandbox.
 *
 * The chainId-zero check below also normalizes against this value so that
 * if a user (or test fixture) edits the seed's endpoint URL via the
 * settings UI, the chainId resolution still recognizes it as Local Network.
 * For the structural path, callers that already know they're touching a
 * `kind === "local"` network pass `kindHint` to `_getChainId` and bypass
 * the URL comparison entirely.
 */
export const LOCAL_NETWORK_RPC_URL: string = (import.meta.env.VITE_LOCAL_NETWORK_RPC_URL as string | undefined) ?? "http://localhost:8080"

const DEFAULT_SEEDS: DefaultSeed[] = [
	{
		name: "Alpha Mainnet",
		rpcUrl: "https://aztec-mainnet.drpc.org",
		chainId: 2934756904, // (1 ^ 2934756905) >>> 0
		kind: "mainnet",
		isPrimaryActive: false,
	},
	{
		name: "Testnet",
		rpcUrl: "https://v5.testnet.rpc.aztec-labs.com",
		chainId: 4229590296, // (11155111 ^ 4239416255) >>> 0 — V5 testnet rollup version
		kind: "testnet",
		isPrimaryActive: true,
	},
	{
		name: "Devnet",
		rpcUrl: "https://v4-devnet-3.aztec-labs.com/",
		chainId: 896946031, // (11155111 ^ 903641544) >>> 0
		kind: "devnet",
		isPrimaryActive: false,
	},
	{
		name: "Local Network",
		rpcUrl: LOCAL_NETWORK_RPC_URL,
		chainId: 0,
		kind: "local",
		isPrimaryActive: false,
	},
]

/**
 * Strict RPC-URL equality that tolerates trailing-slash and casing differences
 * on the seed-vs-user-input comparison only. Used by the chainId-zero check
 * for the "Local Network" preset; the shared `normalizeRpcUrl` deliberately
 * preserves what the user typed (path/query/fragment verbatim), so we need a
 * more aggressive comparison here.
 */
function sameLocalNetworkUrl(a: string, b: string): boolean {
	try {
		const ua = new URL(a)
		const ub = new URL(b)
		const pa = ua.pathname.replace(/\/+$/, "")
		const pb = ub.pathname.replace(/\/+$/, "")
		return ua.protocol === ub.protocol && ua.host === ub.host && pa === pb && ua.search === ub.search && ua.hash === ub.hash
	} catch {
		return a === b
	}
}

/** Lowercase host + protocol; preserve path/query/fragment verbatim. Falls
 *  back to the raw string if `URL` rejects it (validation runs elsewhere). */
function normalizeRpcUrl(raw: string): string {
	try {
		const u = new URL(raw)
		u.protocol = u.protocol.toLowerCase()
		u.hostname = u.hostname.toLowerCase()
		let s = u.toString()
		if (!raw.endsWith("/") && s.endsWith("/") && u.pathname === "/") {
			s = s.slice(0, -1)
		}
		return s
	} catch {
		return raw
	}
}

export class NetworkService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getOrInitNetworks",
		"getNetworks",
		"getNetwork",
		"addNetwork",
		"renameNetwork",
		"deleteNetwork",
		"setActiveNetwork",
		"getActiveNetwork",
		"addEndpoint",
		"updateEndpoint",
		"deleteEndpoint",
		"setPrimaryEndpoint",
		"getNodeStatus",
	)
	public static name = NETWORK_SERVICE_NAME

	public readonly onNetworkAdded = new EventHandler<Network>()
	public readonly onNetworkUpdated = new EventHandler<Network>()
	public readonly onNetworkDeleted = new EventHandler<Network>()
	public readonly onActiveNetworkChanged = new EventHandler<Network>()
	public readonly onPrimaryEndpointChanged = new EventHandler<{ networkId: string; endpointId: string }>()
	public readonly onChainPurged = new EventHandler<{ profileId: string; chainId: number }>()

	private readonly storage: EntityStorage<Network>
	private readonly nodes = new Map<number, AztecNode>()
	/** URL-keyed transient cache for pending-tx polling pin. */
	private readonly transientNodes = new Map<string, { node: AztecNode; failures: number }>()
	private readonly lock: Lock
	private readonly nodeFactory: NodeFactory

	private profileService: ProfileService = null!
	private pxeServiceClient: PxeServiceClient = null!

	public constructor(
		logger: ILogger,
		private readonly browserApi: BrowserApi,
		nodeFactory?: NodeFactory,
	) {
		super(NETWORK_SERVICE_NAME, logger)
		this.storage = new EntityStorage<Network>("nulo:core:networks", browserApi.storage.local, (raw) => NetworkRowSchema.parse(raw))
		this.lock = new Lock("network", logger)
		this.nodeFactory = nodeFactory ?? new AztecNodeFactoryAdapter()
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
		this.profileService.onProfileDeleted.add(this.onProfileDeleted)
		this.pxeServiceClient = new PxeServiceClient(this.logger)
	}

	// ── Read paths ───────────────────────────────────────────────────────

	public async getOrInitNetworks(): Promise<Network[]> {
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		try {
			await this.lock.enter()
			const existing = (await this.storage.getValues()).filter((n) => n.profileId === profile.id)
			if (existing.length) return existing

			const seeded: Network[] = []
			let activeId: string | undefined
			for (const seed of DEFAULT_SEEDS) {
				try {
					const network = await this._buildNetwork(profile.id, seed.name, seed.rpcUrl, seed.chainId, seed.kind)
					await this.storage.set(network.id, network)
					seeded.push(network)
					if (seed.isPrimaryActive) activeId = network.id
				} catch (error) {
					this.logError(`Failed to seed default '${seed.name}'`, getErrorMessage(error))
				}
			}
			if (!activeId && seeded.length) activeId = seeded[0]!.id
			if (activeId) {
				await this._writeActive(profile.id, activeId)
				const active = seeded.find((n) => n.id === activeId)!
				const primaryEndpoint = active.endpoints.find((e) => e.id === active.primaryEndpointId)!
				this.nodes.set(active.chainId, this.nodeFactory.createNode(primaryEndpoint.rpcUrl))
			}
			return seeded
		} finally {
			this.lock.leave()
		}
	}

	public async getNetworks(chainId?: number): Promise<Network[]> {
		validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return (await this.storage.getValues()).filter(
			(n) => n.profileId === profile.id && (chainId === undefined || n.chainId === chainId),
		)
	}

	public async getNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.getNetwork.params, [id], "getNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		const network = requireOwnedRow(await this.storage.get(id), profile.id)
		return network
	}

	public async getActiveNetwork(): Promise<Network | null> {
		validateParams(NetworkMethodSchemas.getActiveNetwork.params, [], "getActiveNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		const id = await this._readActive(profile.id)
		if (!id) return null
		const network = await this.storage.get(id)
		if (network?.profileId !== profile.id) return null
		return network
	}

	// ── Network mutations ────────────────────────────────────────────────

	public async addNetwork(name: string, rpcUrl: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.addNetwork.params, [name, rpcUrl], "addNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		const chainId = await this._getChainId(rpcUrl)
		try {
			await this.lock.enter()
			const existingForProfile = (await this.storage.getValues()).filter((n) => n.profileId === profile.id)
			const sameChain = existingForProfile.find((n) => n.chainId === chainId)
			if (sameChain) {
				throw new Error(`${ERR_DUPLICATE_CHAIN}: A network for chain ${chainId} already exists in this profile.`)
			}
			if (existingForProfile.some((n) => n.name === name)) {
				throw new Error(`Name '${name}' already in use.`)
			}
			const network = await this._buildNetwork(profile.id, name, rpcUrl, chainId, "custom")
			await this.storage.set(network.id, network)
			this.emit("onNetworkAdded", network)
			return network
		} finally {
			this.lock.leave()
		}
	}

	public async renameNetwork(id: string, name: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.renameNetwork.params, [id, name], "renameNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		try {
			await this.lock.enter()
			const network = requireOwnedRow(await this.storage.get(id), profile.id)
			if (network.name === name) return network
			const collision = (await this.storage.getValues()).find((n) => n.profileId === profile.id && n.id !== id && n.name === name)
			if (collision) throw new Error(`Name '${name}' already in use.`)
			network.name = name
			await this.storage.set(id, network)
			this.emit("onNetworkUpdated", network)
			return network
		} finally {
			this.lock.leave()
		}
	}

	public async deleteNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.deleteNetwork.params, [id], "deleteNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		try {
			await this.lock.enter()
			const network = requireOwnedRow(await this.storage.get(id), profile.id)
			const activeId = await this._readActive(profile.id)
			if (activeId === id) {
				throw new Error(`${ERR_ACTIVE_NETWORK}: Cannot delete the active network. Switch to another chain first.`)
			}
			// Purge chain-scoped state via the awaited coordinator
			await this.purgeChain(profile.id, network.chainId, network.id)
			await this.storage.delete(id)
			this.nodes.delete(network.chainId)
			this.emit("onNetworkDeleted", network)
			return network
		} finally {
			this.lock.leave()
		}
	}

	public async setActiveNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.setActiveNetwork.params, [id], "setActiveNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		try {
			await this.lock.enter()
			const network = requireOwnedRow(await this.storage.get(id), profile.id)
			await this._writeActive(profile.id, id)
			const primaryEndpoint = network.endpoints.find((e) => e.id === network.primaryEndpointId)
			if (primaryEndpoint) {
				this.nodes.set(network.chainId, this.nodeFactory.createNode(primaryEndpoint.rpcUrl))
			}
			this.emit("onActiveNetworkChanged", network)
			return network
		} finally {
			this.lock.leave()
		}
	}

	// ── Endpoint mutations ───────────────────────────────────────────────

	public async addEndpoint(networkId: string, label: string | undefined, rpcUrl: string): Promise<NetworkEndpoint> {
		validateParams(NetworkMethodSchemas.addEndpoint.params, [networkId, label, rpcUrl], "addEndpoint")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		// Peek the network's kind unlocked so the chainId probe can short-circuit
		// for `kind === "local"` regardless of how the URL was edited. The lock-
		// guarded re-read below handles the (rare) deletion race.
		const peek = requireOwnedRow(await this.storage.get(networkId), profile.id)
		const probedChainId = await this._getChainId(rpcUrl, peek.kind)
		try {
			await this.lock.enter()
			const network = requireOwnedRow(await this.storage.get(networkId), profile.id)
			if (probedChainId !== network.chainId) {
				throw new Error(
					`${ERR_ENDPOINT_CHAIN_MISMATCH}: This RPC reports chainId ${probedChainId}, but this network is chain ${network.chainId}.`,
				)
			}
			const normalized = normalizeRpcUrl(rpcUrl)
			if (network.endpoints.some((e) => e.rpcUrl === normalized)) {
				throw new Error(`${ERR_DUPLICATE_ENDPOINT}: This URL is already an endpoint of this network.`)
			}
			const endpoint: NetworkEndpoint = {
				id: this._fresh8(network.endpoints.map((e) => e.id)),
				rpcUrl: normalized,
				label: label?.trim() || undefined,
			}
			network.endpoints.push(endpoint)
			await this.storage.set(network.id, network)
			this.emit("onNetworkUpdated", network)
			return endpoint
		} finally {
			this.lock.leave()
		}
	}

	public async updateEndpoint(
		networkId: string,
		endpointId: string,
		label: string | undefined,
		rpcUrl: string,
	): Promise<NetworkEndpoint> {
		validateParams(NetworkMethodSchemas.updateEndpoint.params, [networkId, endpointId, label, rpcUrl], "updateEndpoint")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		const normalized = normalizeRpcUrl(rpcUrl)
		// Peek the network's kind so the chainId probe can short-circuit for
		// `kind === "local"` regardless of how the URL was edited.
		const peek = requireOwnedRow(await this.storage.get(networkId), profile.id)
		// Probe outside the lock when URL changes (network call).
		let probedChainId: number | undefined
		// We probe regardless to keep semantics simple — chainId could have shifted on the same URL.
		probedChainId = await this._getChainId(rpcUrl, peek.kind)
		try {
			await this.lock.enter()
			const network = requireOwnedRow(await this.storage.get(networkId), profile.id)
			if (probedChainId !== undefined && probedChainId !== network.chainId) {
				throw new Error(
					`${ERR_ENDPOINT_CHAIN_MISMATCH}: This RPC reports chainId ${probedChainId}, but this network is chain ${network.chainId}.`,
				)
			}
			const idx = network.endpoints.findIndex((e) => e.id === endpointId)
			if (idx < 0) throw new Error("Invalid endpoint id")
			const collision = network.endpoints.find((e, i) => i !== idx && e.rpcUrl === normalized)
			if (collision) throw new Error(`${ERR_DUPLICATE_ENDPOINT}: Another endpoint of this network uses that URL.`)
			const oldUrl = network.endpoints[idx]!.rpcUrl
			const updated: NetworkEndpoint = {
				id: endpointId,
				rpcUrl: normalized,
				label: label?.trim() || undefined,
			}
			network.endpoints[idx] = updated
			await this.storage.set(network.id, network)
			// Evict transient cache for the OLD URL, plus the chain's primary node
			// cache if this endpoint is the primary.
			this.transientNodes.delete(oldUrl)
			if (network.primaryEndpointId === endpointId) {
				this.nodes.delete(network.chainId)
			}
			this.emit("onNetworkUpdated", network)
			return updated
		} finally {
			this.lock.leave()
		}
	}

	public async deleteEndpoint(networkId: string, endpointId: string): Promise<NetworkEndpoint> {
		validateParams(NetworkMethodSchemas.deleteEndpoint.params, [networkId, endpointId], "deleteEndpoint")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		try {
			await this.lock.enter()
			const network = requireOwnedRow(await this.storage.get(networkId), profile.id)
			const idx = network.endpoints.findIndex((e) => e.id === endpointId)
			if (idx < 0) throw new Error("Invalid endpoint id")
			if (network.endpoints.length === 1) {
				throw new Error(`${ERR_LAST_ENDPOINT}: Cannot delete the last endpoint. Delete the network instead.`)
			}
			if (network.primaryEndpointId === endpointId) {
				throw new Error(`${ERR_PRIMARY_ENDPOINT}: Cannot delete the primary endpoint. Make another endpoint primary first.`)
			}
			const removed = network.endpoints.splice(idx, 1)[0]!
			await this.storage.set(network.id, network)
			this.transientNodes.delete(removed.rpcUrl)
			this.emit("onNetworkUpdated", network)
			return removed
		} finally {
			this.lock.leave()
		}
	}

	public async setPrimaryEndpoint(networkId: string, endpointId: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.setPrimaryEndpoint.params, [networkId, endpointId], "setPrimaryEndpoint")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		try {
			await this.lock.enter()
			const network = requireOwnedRow(await this.storage.get(networkId), profile.id)
			if (!network.endpoints.some((e) => e.id === endpointId)) throw new Error("Invalid endpoint id")
			if (network.primaryEndpointId === endpointId) return network
			network.primaryEndpointId = endpointId
			await this.storage.set(network.id, network)
			this.nodes.delete(network.chainId)
			this.emit("onPrimaryEndpointChanged", { networkId: network.id, endpointId })
			this.emit("onNetworkUpdated", network)
			return network
		} finally {
			this.lock.leave()
		}
	}

	// ── Status / node accessors ──────────────────────────────────────────

	public async getNodeStatus(networkId: string): Promise<NodeStatus> {
		validateParams(NetworkMethodSchemas.getNodeStatus.params, [networkId], "getNodeStatus")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		const network = requireOwnedRow(await this.storage.get(networkId), profile.id)
		const primary = network.endpoints.find((e) => e.id === network.primaryEndpointId)
		if (!primary) return NodeStatus.Inactive
		try {
			const probedChainId = await this._getChainId(primary.rpcUrl)
			if (probedChainId !== network.chainId) return NodeStatus.InvalidChain
			return NodeStatus.Active
		} catch {
			return NodeStatus.Inactive
		}
	}

	public async getNode(chainId: number): Promise<AztecNode> {
		await this.ensureInitialized()
		try {
			await this.lock.enter()
			let node = this.nodes.get(chainId)
			if (!node) {
				const profile = await requireActiveProfile(this.profileService)
				const network = (await this.storage.getValues()).find((n) => n.profileId === profile.id && n.chainId === chainId)
				if (!network) throw new Error(`No network configured for chainId ${chainId}`)
				const primary = network.endpoints.find((e) => e.id === network.primaryEndpointId)
				if (!primary) throw new Error(`Network ${network.id} has no primary endpoint`)
				node = this.nodeFactory.createNode(primary.rpcUrl)
				this.nodes.set(chainId, node)
			}
			return node
		} finally {
			this.lock.leave()
		}
	}

	/**
	 * Returns a transient AztecNode bound to `url` — used by pending-tx
	 * polling so receipt fetches ALWAYS stay on the endpoint the tx was
	 * submitted to, even after the user swaps the primary OR switches profiles
	 * while the tx is still pending.
	 *
	 * Polling is pinned to the submitted URL and NEVER falls back to the active
	 * profile's node. The previous fallback routed one profile's tx hash to
	 * another profile's RPC provider (a cross-profile isolation leak) whenever
	 * the submitted endpoint wasn't the active profile's — on a profile switch,
	 * or after the submitting endpoint was edited/deleted. `url` is internal:
	 * captured at submit time from a configured (allowlist-validated) endpoint
	 * and reused verbatim, so dialing it without consulting the active profile
	 * is the correct ownership model for a pending tx. (The only trust this
	 * places is in the persisted `submittedEndpointUrl`, a wallet-written
	 * field; the active-profile fallback survives only for the legacy
	 * no-recorded-endpoint path in `TransactionService.updateTx`, where there
	 * is no URL to pin to.)
	 *
	 * Failures are reported via `reportEndpointFailure(url)`; after 3
	 * consecutive failures the cache entry is evicted and the next poll
	 * rebuilds the same URL.
	 */
	public async getNodeForUrl(url: string): Promise<AztecNode> {
		await this.ensureInitialized()
		const entry = this.transientNodes.get(url)
		if (entry) return entry.node
		const created = this.nodeFactory.createNode(url)
		this.transientNodes.set(url, { node: created, failures: 0 })
		return created
	}

	public reportEndpointFailure(url: string): void {
		const entry = this.transientNodes.get(url)
		if (!entry) return
		entry.failures += 1
		if (entry.failures >= 3) this.transientNodes.delete(url)
	}

	/**
	 * Synthesizes the legacy NetworkInfo struct from a Network's primary
	 * endpoint. PXE-facing callers (account-state, execution, etc.) consume
	 * this without knowing about endpoints.
	 */
	public async getNetworkInfo(networkId: string): Promise<NetworkInfo> {
		await this.ensureInitialized()
		const network = await this.getNetwork(networkId)
		const primary = network.endpoints.find((e) => e.id === network.primaryEndpointId)
		if (!primary) throw new Error(`Network ${network.id} has no primary endpoint`)
		return { profileId: network.profileId, chainId: network.chainId, rpcUrl: primary.rpcUrl }
	}

	// ── Cascade coordinator ──────────────────────────────────────────────

	/**
	 * Awaited purge of all chain-scoped state for `(profileId, chainId)`.
	 * Called by `deleteNetwork` and `onProfileDeleted`.
	 *
	 * Pipeline:
	 *  1. SW-side subscribers (registered via `registerChainPurgeSubscriber`
	 *     from each chain-keyed peer service's `init`). Run in registration
	 *     order. Expected peers + dependency order:
	 *       - TransactionService (stops polling first; no stale reads)
	 *       - TokenService (emits onTokenDeleted → TokenBalance reacts)
	 *       - FpcService
	 *       - AccountService (emits onAccountDeleted → AuthRegistry reacts)
	 *       - OperationJournalService (wipes journal by networkId)
	 *  2. Offscreen PXE clear via PxeServiceClient — ALWAYS last, hardcoded
	 *     here (not a subscriber) because peer-state must be wiped before
	 *     PXE resets, otherwise SW services could read against a fresh
	 *     empty IDB and get inconsistent state.
	 *
	 * Subscriber failures are logged but don't abort the cascade — chain
	 * cleanup is best-effort across boundaries. PXE clear is similarly
	 * best-effort. The Network row is deleted by the caller (`deleteNetwork`)
	 * only after this method resolves.
	 */
	public async purgeChain(profileId: string, chainId: number, networkId: string): Promise<void> {
		for (const subscriber of this.chainPurgeSubscribers) {
			try {
				await subscriber(profileId, chainId, networkId)
			} catch (error) {
				this.logError(`purgeChain subscriber failed for (${profileId}, ${chainId})`, getErrorMessage(error))
			}
		}
		try {
			await this.pxeServiceClient.clearChainState(profileId, chainId)
		} catch (error) {
			this.logError(`PxeServiceClient.clearChainState failed`, getErrorMessage(error))
		}
		this.emit("onChainPurged", { profileId, chainId })
	}

	private readonly chainPurgeSubscribers: Array<(profileId: string, chainId: number, networkId: string) => Promise<void>> = []

	/**
	 * Register an awaited cleanup for chain-purge events. Peer services call
	 * this from their `init()`. Order matters — register in dependency order.
	 */
	public registerChainPurgeSubscriber(fn: (profileId: string, chainId: number, networkId: string) => Promise<void>): void {
		this.chainPurgeSubscribers.push(fn)
	}

	// ── Backup / restore ─────────────────────────────────────────────────

	public async backup(): Promise<Network[]> {
		return await this.getNetworks()
	}

	/**
	 * Restore networks from a backup. Rejects entries lacking the new-shape
	 * `endpoints[]` field with `BACKUP_TOO_OLD`. Rejects collisions with
	 * existing `(profileId, chainId)` rows so a partial-merge can't accidentally
	 * promote a stale RPC.
	 */
	public async restore(networks: unknown[]): Promise<Restored<Network>[]> {
		await this.ensureInitialized()
		const result: Restored<Network>[] = []
		try {
			await this.lock.enter()
			const existing = await this.storage.getValues()
			for (const raw of networks) {
				try {
					if (!isNewShapeNetwork(raw)) {
						throw new Error(`${ERR_BACKUP_TOO_OLD}: This backup was created with an older version of Nulo.`)
					}
					// F-011 / A-04: enforce the RPC URL allowlist on every endpoint
					// during restore. Pre-fix, restore went directly to storage
					// after a shape check, so a malicious backup could re-introduce
					// `javascript:`, `data:`, non-loopback `http:`, or userinfo
					// URLs that the runtime adapter would later reject. Validate
					// at the persistence boundary AND at the adapter (defense in
					// depth).
					const parsed = NetworkSchema.safeParse(raw)
					if (!parsed.success) {
						throw new Error(`Backup rejected: ${parsed.error.issues.map((i) => i.message).join("; ")}`)
					}
					const candidate = parsed.data
					if (existing.some((n) => n.profileId === candidate.profileId && n.chainId === candidate.chainId)) {
						throw new Error(`A network for chain ${candidate.chainId} already exists in profile ${candidate.profileId}.`)
					}
					let id = candidate.id
					while (await this.storage.contains(id)) id = getRandomHex(8)
					const stored: Network = { ...candidate, id }
					await this.storage.set(id, stored)
					existing.push(stored)
					result.push(stored)
				} catch (err) {
					result.push({
						...(raw && typeof raw === "object" ? (raw as Partial<Network>) : {}),
						restoreError: toRestoreError(err),
					} as Restored<Network>)
				}
			}
			return result
		} finally {
			this.lock.leave()
		}
	}

	// ── Profile lifecycle ────────────────────────────────────────────────

	private readonly onActiveProfileChanged = async () => {
		try {
			await this.lock.enter()
			this.nodes.clear()
			this.transientNodes.clear()
		} finally {
			this.lock.leave()
		}
	}

	private readonly onProfileDeleted = async (profile: ProfileInfo) => {
		this.logDebug(`Profile ${profile.id} deleted, purging chains + removing networks`)
		try {
			await this.lock.enter()
			this.nodes.clear()
			this.transientNodes.clear()
			const networks = (await this.storage.getValues()).filter((n) => n.profileId === profile.id)
			for (const network of networks) {
				try {
					await this.purgeChain(profile.id, network.chainId, network.id)
				} catch (error) {
					this.logError(`purgeChain failed during onProfileDeleted`, getErrorMessage(error))
				}
				await this.storage.delete(network.id)
				this.emit("onNetworkDeleted", network)
			}
			await this.browserApi.storage.local.remove(activeKey(profile.id))
		} finally {
			this.lock.leave()
		}
	}

	// ── Internals ────────────────────────────────────────────────────────

	private async _buildNetwork(profileId: string, name: string, rpcUrl: string, chainId: number, kind: ChainKind): Promise<Network> {
		const networkId = await this._freshStored8()
		const endpointId = `${networkId}-ep0`
		const endpoint: NetworkEndpoint = {
			id: endpointId,
			rpcUrl: normalizeRpcUrl(rpcUrl),
		}
		return {
			id: networkId,
			profileId,
			chainId,
			name,
			primaryEndpointId: endpointId,
			endpoints: [endpoint],
			kind,
		}
	}

	private async _freshStored8(): Promise<string> {
		return nextRandomId(this.storage)
	}

	private _fresh8(taken: string[]): string {
		const seen = new Set(taken)
		let id: string
		do {
			id = getRandomHex(8)
		} while (seen.has(id))
		return id
	}

	/**
	 * `kindHint` lets callers that already know the target network's kind
	 * (i.e. `addEndpoint` / `updateEndpoint`) bypass the URL comparison
	 * entirely. This is the structural fix for the bug where editing
	 * Local Network's endpoint URL away from the seed literal yielded
	 * `ERR_ENDPOINT_CHAIN_MISMATCH` even though the user's intent was
	 * obviously the local chain.
	 */
	private async _getChainId(rpcUrl: string, kindHint?: ChainKind): Promise<number> {
		try {
			const rpc = this.nodeFactory.createNode(rpcUrl)
			const info = await rpc.getNodeInfo()
			if (kindHint === "local") return 0
			if (sameLocalNetworkUrl(rpcUrl, LOCAL_NETWORK_RPC_URL)) return 0
			return (info.l1ChainId ^ info.rollupVersion) >>> 0
		} catch (error) {
			this.logError("Failed to fetch node info", getErrorMessage(error))
			throw new Error("Failed to fetch node info")
		}
	}

	private async _readActive(profileId: string): Promise<string | undefined> {
		const r = await this.browserApi.storage.local.get(activeKey(profileId))
		const raw = r[activeKey(profileId)]
		return typeof raw === "string" ? raw : undefined
	}

	private async _writeActive(profileId: string, networkId: string): Promise<void> {
		await this.browserApi.storage.local.set({ [activeKey(profileId)]: networkId })
	}
}

function isNewShapeNetwork(value: unknown): value is Network {
	if (!value || typeof value !== "object") return false
	const v = value as Partial<Network>
	return (
		typeof v.id === "string" &&
		typeof v.profileId === "string" &&
		typeof v.chainId === "number" &&
		typeof v.name === "string" &&
		typeof v.primaryEndpointId === "string" &&
		Array.isArray(v.endpoints) &&
		v.endpoints.length > 0
	)
}
