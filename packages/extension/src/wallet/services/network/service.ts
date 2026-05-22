import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service } from "@nulo/extension-messaging/background"
import { validateParams } from "@nulo/extension-messaging/zod"
import { AztecNodeFactoryAdapter } from "@nulo/aztec-runtime/adapters"
import type { NodeFactory } from "@nulo/aztec-runtime/ports"
import type { ILogger } from "@/wallet/logger"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { EntityStorage } from "@/wallet/storage"
import { getRandomHex, Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { classifyEndpointError } from "./error-classifier"
import {
	clearCooldowns,
	type EndpointHealthSnapshot,
	isAvailable,
	markCooldown,
	type NetworkRouteState,
	newRouteState,
	pickFailoverCandidates,
	quarantineInvalidChain,
	recordFailure,
	recordSuccess,
	snapshotRouteState,
} from "./route-state"
import {
	type ChainKind,
	ERR_ACTIVE_NETWORK,
	ERR_BACKUP_TOO_OLD,
	ERR_DUPLICATE_CHAIN,
	ERR_DUPLICATE_ENDPOINT,
	ERR_ENDPOINT_CHAIN_MISMATCH,
	ERR_LAST_ENDPOINT,
	type Events,
	type Methods,
	type Network,
	type NetworkEndpoint,
	type NetworkInfo,
	NETWORK_SERVICE_NAME,
	NetworkMethodSchemas,
	NodeStatus,
	type PrimaryEndpointChangeSource,
} from "./spec"

export * from "./spec"

/**
 * Caller-facing accessor returned by `acquireBinding(chainId)`. Captures the
 * full routing context for one logical op so the caller's subsequent reads
 * stay pinned to the same endpoint even if a parallel op triggers failover.
 *
 * `withBinding(chainId, fn)` is the sanctioned consumer — it wraps `fn` in
 * the try/catch that calls `reportEndpointFailure(endpoint.rpcUrl, err)` on
 * the catch path. Manual binding acquisition without the wrapper bypasses
 * failure-tracking and is a code-review block.
 */
export type NetworkBinding = {
	network: Network
	endpoint: NetworkEndpoint
	info: NetworkInfo
	node: AztecNode
}

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
		rpcUrl: "https://rpc.testnet.aztec-labs.com",
		chainId: 4138294185, // (11155111 ^ 4127419662) >>> 0
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
	public static name = NETWORK_SERVICE_NAME

	public readonly onNetworkAdded = new EventHandler<Network>()
	public readonly onNetworkUpdated = new EventHandler<Network>()
	public readonly onNetworkDeleted = new EventHandler<Network>()
	public readonly onActiveNetworkChanged = new EventHandler<Network>()
	public readonly onPrimaryEndpointChanged = new EventHandler<{
		networkId: string
		fromEndpointId: string | undefined
		toEndpointId: string
		source: PrimaryEndpointChangeSource
	}>()
	public readonly onPrimaryEndpointDegraded = new EventHandler<{ networkId: string; exhausted: boolean }>()
	public readonly onChainPurged = new EventHandler<{ profileId: string; chainId: number }>()

	private readonly storage = new EntityStorage<Network>("nulo:core:networks", chrome.storage.local)
	/**
	 * Per-chain live node cache. The entry carries endpoint identity so
	 * failover / snapback can detect when the cached node is for a stale
	 * endpoint and rebuild. The map is wiped on profile switch / delete.
	 */
	private readonly nodes = new Map<number, { node: AztecNode; endpointId: string; rpcUrl: string }>()
	/**
	 * Per-network in-memory routing state. Tracks the currently-active
	 * endpoint, failure counters, cooldowns, and the invalidChain quarantine
	 * set. Created lazily on first traffic call to `_resolveBinding`.
	 * Wiped on profile switch / delete + on `deleteNetwork`.
	 */
	private readonly routeState = new Map<string, NetworkRouteState>()
	/** URL-keyed transient cache for pending-tx polling pin. */
	private readonly transientNodes = new Map<string, { node: AztecNode; failures: number }>()
	private readonly lock: Lock
	private readonly nodeFactory: NodeFactory

	private profileService: ProfileService = null!
	private pxeServiceClient: PxeServiceClient = null!

	public constructor(logger: ILogger, nodeFactory?: NodeFactory) {
		super(NETWORK_SERVICE_NAME, logger)
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
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
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
				const preferred = active.endpoints[0]!
				this.nodes.set(active.chainId, {
					node: this.nodeFactory.createNode(preferred.rpcUrl),
					endpointId: preferred.id,
					rpcUrl: preferred.rpcUrl,
				})
				this.routeState.set(active.id, newRouteState(preferred.id))
			}
			return seeded
		} finally {
			this.lock.leave()
		}
	}

	public async getNetworks(chainId?: number): Promise<Network[]> {
		validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		return (await this.storage.getValues()).filter(
			(n) => n.profileId === profile.id && (chainId === undefined || n.chainId === chainId),
		)
	}

	public async getNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.getNetwork.params, [id], "getNetwork")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		const network = await this.storage.get(id)
		if (network?.profileId !== profile.id) throw new Error("Invalid id")
		return network
	}

	public async getActiveNetwork(): Promise<Network | null> {
		validateParams(NetworkMethodSchemas.getActiveNetwork.params, [], "getActiveNetwork")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
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
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
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
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		try {
			await this.lock.enter()
			const network = await this.storage.get(id)
			if (network?.profileId !== profile.id) throw new Error("Invalid id")
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
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		try {
			await this.lock.enter()
			const network = await this.storage.get(id)
			if (network?.profileId !== profile.id) throw new Error("Invalid id")
			const activeId = await this._readActive(profile.id)
			if (activeId === id) {
				throw new Error(`${ERR_ACTIVE_NETWORK}: Cannot delete the active network. Switch to another chain first.`)
			}
			// Purge chain-scoped state via the awaited coordinator
			await this.purgeChain(profile.id, network.chainId, network.id)
			await this.storage.delete(id)
			this.nodes.delete(network.chainId)
			this.routeState.delete(network.id)
			this.emit("onNetworkDeleted", network)
			return network
		} finally {
			this.lock.leave()
		}
	}

	public async setActiveNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.setActiveNetwork.params, [id], "setActiveNetwork")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		try {
			await this.lock.enter()
			const network = await this.storage.get(id)
			if (network?.profileId !== profile.id) throw new Error("Invalid id")
			await this._writeActive(profile.id, id)
			const preferred = network.endpoints[0]
			if (preferred) {
				this.nodes.set(network.chainId, {
					node: this.nodeFactory.createNode(preferred.rpcUrl),
					endpointId: preferred.id,
					rpcUrl: preferred.rpcUrl,
				})
				// Reset routeState for the newly-active network — switching chains
				// is a fresh routing context; stale cooldowns from a prior session
				// shouldn't carry over.
				this.routeState.set(network.id, newRouteState(preferred.id))
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
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		// Peek the network's kind unlocked so the chainId probe can short-circuit
		// for `kind === "local"` regardless of how the URL was edited. The lock-
		// guarded re-read below handles the (rare) deletion race.
		const peek = await this.storage.get(networkId)
		if (peek?.profileId !== profile.id) throw new Error("Invalid id")
		const probedChainId = await this._getChainId(rpcUrl, peek.kind)
		try {
			await this.lock.enter()
			const network = await this.storage.get(networkId)
			if (network?.profileId !== profile.id) throw new Error("Invalid id")
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
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		const normalized = normalizeRpcUrl(rpcUrl)
		// Peek the network's kind so the chainId probe can short-circuit for
		// `kind === "local"` regardless of how the URL was edited.
		const peek = await this.storage.get(networkId)
		if (peek?.profileId !== profile.id) throw new Error("Invalid id")
		// Probe outside the lock when URL changes (network call).
		let probedChainId: number | undefined
		// We probe regardless to keep semantics simple — chainId could have shifted on the same URL.
		probedChainId = await this._getChainId(rpcUrl, peek.kind)
		try {
			await this.lock.enter()
			const network = await this.storage.get(networkId)
			if (network?.profileId !== profile.id) throw new Error("Invalid id")
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
			// Evict transient cache for the OLD URL. Editing the URL is also a
			// trust-reset for the endpoint: forget any failure counters /
			// cooldowns / invalidChain entry — the user just supplied a
			// (presumably fixed) URL, which we already re-probed for chainId
			// above so it's safe to drop the old quarantine.
			this.transientNodes.delete(oldUrl)
			const state = this.routeState.get(network.id)
			if (state) {
				state.failures.delete(endpointId)
				state.cooldownUntil.delete(endpointId)
				state.invalidChain.delete(endpointId)
			}
			// If this endpoint is the live active route OR sits at the head of
			// `endpoints[]`, evict the cached node so the next `_resolveBinding`
			// re-creates against the new URL.
			const cached = this.nodes.get(network.chainId)
			if (network.endpoints[0]?.id === endpointId || cached?.endpointId === endpointId) {
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
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		try {
			await this.lock.enter()
			const network = await this.storage.get(networkId)
			if (network?.profileId !== profile.id) throw new Error("Invalid id")
			const idx = network.endpoints.findIndex((e) => e.id === endpointId)
			if (idx < 0) throw new Error("Invalid endpoint id")
			if (network.endpoints.length === 1) {
				throw new Error(`${ERR_LAST_ENDPOINT}: Cannot delete the last endpoint. Delete the network instead.`)
			}
			// Deleting the preferred endpoint (`endpoints[0]`) is now allowed —
			// the slice shifts `endpoints[1]` into position 0 which becomes the
			// new preferred. Evict the cached node if we just deleted the live
			// one so the next `getNode` re-resolves.
			const wasPreferred = network.endpoints[0]?.id === endpointId
			const removed = network.endpoints.splice(idx, 1)[0]!
			await this.storage.set(network.id, network)
			this.transientNodes.delete(removed.rpcUrl)
			// Forget the deleted endpoint's routing state (counters, cooldown,
			// invalidChain). If it was the live active route, also evict the
			// node cache and re-point active to endpoints[0] so the next
			// `_resolveBinding` call resolves fresh.
			const state = this.routeState.get(network.id)
			if (state) {
				state.failures.delete(endpointId)
				state.cooldownUntil.delete(endpointId)
				state.invalidChain.delete(endpointId)
				if (state.activeEndpointId === endpointId) {
					const fallback = network.endpoints[0]
					if (fallback) state.activeEndpointId = fallback.id
				}
			}
			const cached = this.nodes.get(network.chainId)
			if (wasPreferred || cached?.endpointId === endpointId) {
				this.nodes.delete(network.chainId)
			}
			this.emit("onNetworkUpdated", network)
			return removed
		} finally {
			this.lock.leave()
		}
	}

	/**
	 * Splice an endpoint to `endpoints[0]` (the user-preferred / snap-back
	 * target). Clears the promoted endpoint's cooldown + invalidChain entry
	 * (user expressed trust). Updates `activeEndpointId` to the promoted
	 * endpoint so subsequent traffic flows through it; the existing cached
	 * node is evicted so the next `_resolveBinding` resolves against the new
	 * URL. Emits `onPrimaryEndpointChanged` with `source: "manual"`.
	 *
	 * If the promoted endpoint is unhealthy, the first traffic call will
	 * fail and the classifier-driven failover engages — no special probe-
	 * before-flip dance here.
	 */
	public async promoteEndpoint(networkId: string, endpointId: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.promoteEndpoint.params, [networkId, endpointId], "promoteEndpoint")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		try {
			await this.lock.enter()
			const network = await this.storage.get(networkId)
			if (network?.profileId !== profile.id) throw new Error("Invalid id")
			const idx = network.endpoints.findIndex((e) => e.id === endpointId)
			if (idx < 0) throw new Error("Invalid endpoint id")
			const fromEndpointId = network.endpoints[0]?.id
			if (idx === 0) return network
			const [moved] = network.endpoints.splice(idx, 1)
			network.endpoints.unshift(moved!)
			await this.storage.set(network.id, network)
			// Reset routing state for the promoted endpoint (user trust signal)
			// and flip the active route to it.
			let state = this.routeState.get(network.id)
			if (!state) {
				state = newRouteState(endpointId)
				this.routeState.set(network.id, state)
			} else {
				state.failures.delete(endpointId)
				state.cooldownUntil.delete(endpointId)
				state.invalidChain.delete(endpointId)
				state.exhaustedAt = undefined
				state.activeEndpointId = endpointId
			}
			this.nodes.delete(network.chainId)
			this.emit("onPrimaryEndpointChanged", {
				networkId: network.id,
				fromEndpointId,
				toEndpointId: endpointId,
				source: "manual",
			})
			this.emit("onNetworkUpdated", network)
			return network
		} finally {
			this.lock.leave()
		}
	}

	/**
	 * "Retry preferred" recovery — user-driven. Wipes every endpoint's
	 * cooldown + invalidChain entry on the network. Does NOT flip
	 * `activeEndpointId` directly; the next `_resolveBinding` call will see
	 * `endpoints[0]` as available and run the snapback probe, which is the
	 * only sanctioned path back to active.
	 */
	public async clearEndpointCooldowns(networkId: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.clearEndpointCooldowns.params, [networkId], "clearEndpointCooldowns")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		try {
			await this.lock.enter()
			const network = await this.storage.get(networkId)
			if (network?.profileId !== profile.id) throw new Error("Invalid id")
			const state = this.routeState.get(network.id)
			if (state) clearCooldowns(state)
			this.emit("onNetworkUpdated", network)
			return network
		} finally {
			this.lock.leave()
		}
	}

	/**
	 * Serializable read of the network's `NetworkRouteState`. If no state
	 * has been initialized yet (chain never traffic'd this session), returns
	 * a default snapshot pointing at `endpoints[0]`. Throws on unknown
	 * `networkId`.
	 */
	public async getEndpointHealth(networkId: string): Promise<EndpointHealthSnapshot> {
		validateParams(NetworkMethodSchemas.getEndpointHealth.params, [networkId], "getEndpointHealth")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		const network = await this.storage.get(networkId)
		if (network?.profileId !== profile.id) throw new Error("Invalid id")
		const state = this.routeState.get(network.id)
		if (state) return snapshotRouteState(state)
		const preferred = network.endpoints[0]
		return {
			activeEndpointId: preferred?.id ?? "",
			failures: {},
			cooldownUntil: {},
			invalidChain: [],
		}
	}

	// ── Status / node accessors ──────────────────────────────────────────

	/**
	 * Probes the currently-active endpoint (which may differ from
	 * `endpoints[0]` during a failover episode) and returns its health
	 * state. The header / settings UX combines this with
	 * `activeEndpointId !== endpoints[0].id` to decide between green /
	 * amber / red.
	 */
	public async getNodeStatus(networkId: string): Promise<NodeStatus> {
		validateParams(NetworkMethodSchemas.getNodeStatus.params, [networkId], "getNodeStatus")
		await this.ensureInitialized()
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		const network = await this.storage.get(networkId)
		if (network?.profileId !== profile.id) throw new Error("Invalid id")
		const state = this.routeState.get(network.id)
		const activeId = state?.activeEndpointId ?? network.endpoints[0]?.id
		const active = network.endpoints.find((e) => e.id === activeId) ?? network.endpoints[0]
		if (!active) return NodeStatus.Inactive
		try {
			const probedChainId = await this._getChainId(active.rpcUrl, network.kind)
			if (probedChainId !== network.chainId) return NodeStatus.InvalidChain
			return NodeStatus.Active
		} catch {
			return NodeStatus.Inactive
		}
	}

	/**
	 * Legacy accessor — returns just the live `AztecNode` for the chain.
	 * New callers should prefer `acquireBinding(chainId)` (or the safer
	 * `withBinding(chainId, fn)` wrapper) so the captured endpoint identity
	 * is available for failure-reporting and per-op pinning.
	 */
	public async getNode(chainId: number): Promise<AztecNode> {
		const binding = await this.acquireBinding(chainId)
		return binding.node
	}

	/**
	 * Resolves the live `NetworkBinding` for a chain. Lazily initializes
	 * routing state, runs the snapback probe when the live route is off
	 * `endpoints[0]` and preferred is available, and triggers failover when
	 * the cached active is unavailable (cooldown / invalidChain set by a
	 * prior `reportEndpointFailure` strike).
	 *
	 * The returned binding captures `(network, endpoint, info, node)` at
	 * resolution time — callers should pass it through their op and treat
	 * later state changes as out-of-band (the next op acquires a fresh
	 * binding). Use `withBinding(chainId, fn)` instead of acquiring + calling
	 * by hand; the wrapper enforces the try/catch that reports failures.
	 */
	public async acquireBinding(chainId: number): Promise<NetworkBinding> {
		await this.ensureInitialized()
		try {
			await this.lock.enter()
			return await this._resolveBindingLocked(chainId)
		} finally {
			this.lock.leave()
		}
	}

	/**
	 * Sanctioned consumer of `acquireBinding`. Wraps the caller's op in a
	 * try/catch that reports every failure to `reportEndpointFailure`, which
	 * is what drives the failure-counter classifier into failover. Manual
	 * acquisition + raw `.method()` calls skip this and are a code-review
	 * block.
	 */
	public async withBinding<T>(chainId: number, fn: (binding: NetworkBinding) => Promise<T>): Promise<T> {
		const binding = await this.acquireBinding(chainId)
		try {
			return await fn(binding)
		} catch (err) {
			this.reportEndpointFailure(binding.endpoint.rpcUrl, err)
			throw err
		}
	}

	/**
	 * Returns a transient AztecNode bound to the given URL — used by
	 * pending-tx polling so receipt fetches stay on the originally-submitted
	 * endpoint even after the user swaps the primary. Falls back to the
	 * chain's current primary if the URL is no longer a known endpoint.
	 *
	 * Failures are reported via `reportEndpointFailure(url)`; after 3
	 * consecutive failures the cache entry is evicted and the next call
	 * falls back.
	 */
	public async getNodeForUrl(url: string, fallbackChainId: number): Promise<AztecNode> {
		await this.ensureInitialized()
		const entry = this.transientNodes.get(url)
		if (entry) return entry.node
		const known = await this._isKnownEndpointUrl(url)
		if (!known) return this.getNode(fallbackChainId)
		const created = this.nodeFactory.createNode(url)
		this.transientNodes.set(url, { node: created, failures: 0 })
		return created
	}

	/**
	 * Reports an endpoint-level failure. The lookup + counter mutation runs
	 * fire-and-forget so the caller (typically a try/catch wrapper or
	 * tx-poll background worker) doesn't block.
	 *
	 * Two paths:
	 *   1. RouteState path — URL matches a known endpoint of the active
	 *      profile. Classifier buckets the error (hard/soft/evict/ignore)
	 *      and updates the route state. Failover engages on the next
	 *      `_resolveBinding` call when the active endpoint becomes
	 *      unavailable.
	 *   2. Transient-cache path — URL is not a known endpoint (e.g. a
	 *      stale tx-poll URL whose endpoint was deleted). Falls back to the
	 *      legacy 3-strike eviction so the dangling cache entry doesn't
	 *      keep serving a dead URL.
	 */
	public reportEndpointFailure(url: string, error?: unknown): void {
		// Sync transient-cache path (M4.10 tx-poll pin). Same behavior as
		// before: 3 strikes evicts the cache entry so the next
		// `getNodeForUrl` falls through to the chain's current primary.
		const entry = this.transientNodes.get(url)
		if (entry) {
			entry.failures += 1
			if (entry.failures >= 3) this.transientNodes.delete(url)
		}
		// Async routeState path (new). Classifier buckets the error;
		// failover engages on the next `_resolveBinding` call when the
		// active endpoint becomes unavailable.
		void this._reportEndpointFailureAsync(url, error)
	}

	private async _reportEndpointFailureAsync(url: string, error: unknown): Promise<void> {
		try {
			const lookup = await this._findEndpointByUrl(url)
			if (!lookup) return
			this._countFailure(lookup.networkId, lookup.endpointId, error)
		} catch (err) {
			this.logError("reportEndpointFailure async path failed", getErrorMessage(err))
		}
	}

	private _countFailure(networkId: string, endpointId: string, error: unknown): void {
		const state = this.routeState.get(networkId)
		if (!state) return
		const cls = classifyEndpointError(error)
		switch (cls.kind) {
			case "ignore":
				return
			case "evict":
				quarantineInvalidChain(state, endpointId)
				return
			case "hard":
			case "soft": {
				const result = recordFailure(state, endpointId, cls.kind)
				if (result.tripped && state.activeEndpointId === endpointId) {
					// Demote the active endpoint immediately — the next
					// `_resolveBinding` call sees `isAvailable(active) === false`
					// and runs the failover loop.
					markCooldown(state, endpointId)
				}
				return
			}
		}
	}

	/** Looks up the `{ networkId, endpointId }` for an active-profile
	 *  endpoint whose URL matches `url`. Returns undefined if no match. */
	private async _findEndpointByUrl(url: string): Promise<{ networkId: string; endpointId: string } | undefined> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return undefined
		const networks = (await this.storage.getValues()).filter((n) => n.profileId === profile.id)
		for (const network of networks) {
			for (const ep of network.endpoints) {
				if (ep.rpcUrl === url) return { networkId: network.id, endpointId: ep.id }
			}
		}
		return undefined
	}

	/**
	 * Synthesizes the legacy NetworkInfo struct from a Network's primary
	 * endpoint. PXE-facing callers (account-state, execution, etc.) consume
	 * this without knowing about endpoints.
	 */
	public async getNetworkInfo(networkId: string): Promise<NetworkInfo> {
		await this.ensureInitialized()
		const network = await this.getNetwork(networkId)
		const preferred = network.endpoints[0]
		if (!preferred) throw new Error(`Network ${network.id} has no endpoints`)
		return { profileId: network.profileId, chainId: network.chainId, rpcUrl: preferred.rpcUrl }
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
					const candidate = raw as Network
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
						restoreError: err instanceof Error ? err.message : err,
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
			this.routeState.clear()
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
			this.routeState.clear()
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
			await chrome.storage.local.remove(activeKey(profile.id))
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
			endpoints: [endpoint],
			kind,
		}
	}

	private async _freshStored8(): Promise<string> {
		let id: string
		do {
			id = getRandomHex(8)
		} while (await this.storage.contains(id))
		return id
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
		const r = await chrome.storage.local.get(activeKey(profileId))
		const raw = r[activeKey(profileId)]
		return typeof raw === "string" ? raw : undefined
	}

	private async _writeActive(profileId: string, networkId: string): Promise<void> {
		await chrome.storage.local.set({ [activeKey(profileId)]: networkId })
	}

	/**
	 * Lock-held core of `acquireBinding`. Resolves the live endpoint for
	 * `chainId`, possibly running snapback or failover as a side effect.
	 *
	 *   1. Look up the Network for `chainId` (active profile only).
	 *   2. Lazily initialize `routeState` if absent (active = endpoints[0]).
	 *   3. If active is unavailable (cooldown/invalidChain set by a prior
	 *      `reportEndpointFailure` strike): run `_tryFailover` — picks the
	 *      next viable candidate, probes chainId, swaps active on success.
	 *      Sets `exhaustedAt` if every candidate fails.
	 *   4. Else if active != endpoints[0] AND endpoints[0] is available:
	 *      run `_trySnapback` — probes preferred; on success snaps back.
	 *   5. Recreate the `nodes[chainId]` entry if it's stale (different
	 *      endpointId or rpcUrl from the resolved active).
	 *
	 * Both probes (`_tryFailover`, `_trySnapback`) are pure side-effect:
	 * they mutate `state.activeEndpointId` + `nodes[chainId]` and emit the
	 * appropriate events. The final `nodes[chainId]` entry IS the binding
	 * we return.
	 */
	private async _resolveBindingLocked(chainId: number): Promise<NetworkBinding> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) throw new Error("Profile locked")
		const network = (await this.storage.getValues()).find((n) => n.profileId === profile.id && n.chainId === chainId)
		if (!network) throw new Error(`No network configured for chainId ${chainId}`)
		const preferred = network.endpoints[0]
		if (!preferred) throw new Error(`Network ${network.id} has no endpoints`)

		let state = this.routeState.get(network.id)
		if (!state) {
			state = newRouteState(preferred.id)
			this.routeState.set(network.id, state)
		}

		// If the active endpoint id no longer exists in `endpoints[]` (was
		// deleted concurrently), snap back to preferred — the deletion path
		// already updated `activeEndpointId`, but defensively reconfirm here.
		if (!network.endpoints.some((e) => e.id === state.activeEndpointId)) {
			state.activeEndpointId = preferred.id
		}

		// Failover / snapback decision tree.
		if (!isAvailable(state, state.activeEndpointId)) {
			await this._tryFailover(network, state)
		} else if (state.activeEndpointId !== preferred.id && isAvailable(state, preferred.id)) {
			await this._trySnapback(network, state, preferred)
		}

		const activeEp = network.endpoints.find((e) => e.id === state.activeEndpointId) ?? preferred
		const cached = this.nodes.get(chainId)
		let entry = cached
		if (!entry || entry.endpointId !== activeEp.id || entry.rpcUrl !== activeEp.rpcUrl) {
			entry = {
				node: this.nodeFactory.createNode(activeEp.rpcUrl),
				endpointId: activeEp.id,
				rpcUrl: activeEp.rpcUrl,
			}
			this.nodes.set(chainId, entry)
		}

		// Reset counters opportunistically: a successful binding-acquire
		// implies the caller is about to use the active endpoint; reporting
		// success happens via `_countSuccess` on the next traffic call.
		// We don't pre-reset here — that's the caller's job via the
		// post-call success path (not yet wired; counters reset lazily via
		// the 60s decay window in `recordFailure`).

		return {
			network,
			endpoint: activeEp,
			info: { profileId: network.profileId, chainId: network.chainId, rpcUrl: activeEp.rpcUrl },
			node: entry.node,
		}
	}

	/**
	 * Cycle through `pickFailoverCandidates`, probing each candidate's
	 * chainId. First match wins: mark the previous active for cooldown,
	 * flip `activeEndpointId`, emit `onPrimaryEndpointChanged({ source:
	 * "failover" })`. If every candidate fails its probe (chainId mismatch
	 * → invalidChain; transport error → cooldown), set `exhaustedAt` and
	 * emit `onPrimaryEndpointDegraded({ exhausted: true })`. The caller
	 * sees no error — the binding still resolves (to a stale active), and
	 * the next traffic call against the stale endpoint will fail and
	 * propagate to the caller.
	 */
	private async _tryFailover(network: Network, state: NetworkRouteState): Promise<void> {
		const previousActiveId = state.activeEndpointId
		const candidateIds = pickFailoverCandidates(
			state,
			network.endpoints.map((e) => e.id),
		)
		for (const candidateId of candidateIds) {
			const candidate = network.endpoints.find((e) => e.id === candidateId)
			if (!candidate) continue
			try {
				const probedChainId = await this._getChainId(candidate.rpcUrl, network.kind)
				if (probedChainId !== network.chainId) {
					quarantineInvalidChain(state, candidateId)
					continue
				}
				state.activeEndpointId = candidateId
				state.exhaustedAt = undefined
				recordSuccess(state, candidateId)
				this.nodes.set(network.chainId, {
					node: this.nodeFactory.createNode(candidate.rpcUrl),
					endpointId: candidateId,
					rpcUrl: candidate.rpcUrl,
				})
				this.emit("onPrimaryEndpointChanged", {
					networkId: network.id,
					fromEndpointId: previousActiveId,
					toEndpointId: candidateId,
					source: "failover",
				})
				return
			} catch (err) {
				const cls = classifyEndpointError(err)
				if (cls.kind === "evict") quarantineInvalidChain(state, candidateId)
				else markCooldown(state, candidateId)
			}
		}
		// Exhausted: every candidate failed. Emit degraded event so UI can
		// show the persistent banner. The binding still resolves (stale
		// active); next call against the stale node will throw.
		state.exhaustedAt = Date.now()
		this.emit("onPrimaryEndpointDegraded", { networkId: network.id, exhausted: true })
	}

	/**
	 * Opportunistic recovery: when the active is healthy but isn't on
	 * `endpoints[0]`, probe preferred. On success, snap back. On failure,
	 * mark preferred's cooldown (or quarantine on chain mismatch) — the
	 * snapback won't retry until cooldown elapses (~5min) or the user
	 * clears it.
	 */
	private async _trySnapback(network: Network, state: NetworkRouteState, preferred: NetworkEndpoint): Promise<void> {
		const previousActiveId = state.activeEndpointId
		try {
			const probedChainId = await this._getChainId(preferred.rpcUrl, network.kind)
			if (probedChainId !== network.chainId) {
				quarantineInvalidChain(state, preferred.id)
				return
			}
			state.activeEndpointId = preferred.id
			state.exhaustedAt = undefined
			recordSuccess(state, preferred.id)
			this.nodes.set(network.chainId, {
				node: this.nodeFactory.createNode(preferred.rpcUrl),
				endpointId: preferred.id,
				rpcUrl: preferred.rpcUrl,
			})
			this.emit("onPrimaryEndpointChanged", {
				networkId: network.id,
				fromEndpointId: previousActiveId,
				toEndpointId: preferred.id,
				source: "snapback",
			})
		} catch (err) {
			const cls = classifyEndpointError(err)
			if (cls.kind === "evict") quarantineInvalidChain(state, preferred.id)
			else markCooldown(state, preferred.id)
		}
	}

	private async _isKnownEndpointUrl(url: string): Promise<boolean> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) return false
		const networks = (await this.storage.getValues()).filter((n) => n.profileId === profile.id)
		return networks.some((n) => n.endpoints.some((e) => e.rpcUrl === url))
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
		Array.isArray(v.endpoints) &&
		v.endpoints.length > 0
	)
}
