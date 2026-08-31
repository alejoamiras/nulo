import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { toRestoreError } from "@/utils/restore-error"
import { assertRestoreEpoch, captureRestoreEpochs } from "@/wallet/services/restore-fence"
import type { Restored, ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import { validateParams } from "@nulo/extension-messaging/zod"
import { AztecNodeFactoryAdapter } from "@nulo/aztec-runtime/adapters"
import type { NodeFactory } from "@nulo/aztec-runtime/ports"
import type { ILogger } from "@/wallet/logger"
import { ProfileService } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import { requireOwnedRow } from "@/wallet/services/require-owned-row"
import { nextRandomId, preferOrReallocId } from "@/wallet/services/id-allocators"
import { purgeMalformedRows } from "@/wallet/services/purge-rows"
import { PxeServiceClient } from "@/wallet/services/pxe/client"
import { EntityStorage } from "@/wallet/storage"
import { getRandomHex, Lock } from "@/wallet/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import { CHAIN_IDS, LOCAL_L1_CHAIN_ID, MAINNET_L1_CHAIN_ID, TESTNET_L1_CHAIN_ID } from "@/utils/chain-ids"
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
	NETWORK_STORAGE_ROOT,
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

/** Immutable L1 identities for the seeded kinds — the trust root `getL1ChainIdStored` validates
 *  seeded rows against (a row is mutable storage; these constants ship in code). Custom/devnet
 *  kinds have no constant and are probe-verified at account creation instead. */
const SEED_L1_BY_KIND: Partial<Record<ChainKind, number>> = {
	mainnet: MAINNET_L1_CHAIN_ID,
	testnet: TESTNET_L1_CHAIN_ID,
	local: LOCAL_L1_CHAIN_ID,
}

interface DefaultSeed {
	name: string
	rpcUrl: string
	chainId: number
	/** Hardcoded L1 identity — NEVER probed at seed time (seeding is offline-safe and
	 *  load-bearing for fresh profiles with the node down). Key derivation consumes it. */
	l1ChainId: number
	kind: ChainKind
	isPrimaryActive: boolean
	/** Provider label stamped on the seeded endpoint (Settings shows it instead of the raw URL). */
	endpointLabel?: string
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

// E2E-ONLY default-active override: CI smoke has NO local chain and its runners cannot reliably
// reach the public Alpha mainnet RPC (requests blackhole → every chain-adjacent flow eats the node
// client's full 60s-abort×retry envelope, blowing any test budget). Smoke builds pin the seeded
// ACTIVE network to Testnet (reachable from CI, the pre-Alpha test envelope); prod builds omit the
// env, so real installs keep Alpha. Same never-ships pattern as the migration-fixture stamp
// (_build-extension.yml greps release bundles).
const E2E_DEFAULT_ACTIVE_TESTNET: boolean = (import.meta.env.VITE_NULO_E2E_DEFAULT_NET as string | undefined) === "testnet"

const DEFAULT_SEEDS: DefaultSeed[] = [
	{
		name: "Alpha V5",
		rpcUrl: "https://lb.drpc.live/aztec-mainnet/Ak_eT5HA2kbyqamqGTF702cdsdWqLTIR8YdadmahlY6k",
		chainId: CHAIN_IDS.MAINNET, // (MAINNET_L1_CHAIN_ID ^ MAINNET_ROLLUP_VERSION) >>> 0 — single-sourced in @/utils/chain-ids
		l1ChainId: MAINNET_L1_CHAIN_ID,
		kind: "mainnet",
		isPrimaryActive: !E2E_DEFAULT_ACTIVE_TESTNET,
		endpointLabel: "dRPC",
	},
	{
		name: "Testnet",
		rpcUrl: "https://lb.drpc.live/aztec-testnet/Ak_eT5HA2kbyqamqGTF702cdsdWqLTIR8YdadmahlY6k",
		chainId: CHAIN_IDS.TESTNET,
		l1ChainId: TESTNET_L1_CHAIN_ID,
		kind: "testnet",
		isPrimaryActive: E2E_DEFAULT_ACTIVE_TESTNET,
		endpointLabel: "dRPC",
	},
	{
		name: "Local Network",
		rpcUrl: LOCAL_NETWORK_RPC_URL,
		chainId: 0,
		l1ChainId: LOCAL_L1_CHAIN_ID,
		kind: "local",
		isPrimaryActive: false,
	},
]

/** The one seed marked `isPrimaryActive` (Alpha in prod, Testnet under the e2e flag). Single source
 *  for the primary/default network — consumed by `getOrInitNetworks` (fresh seed) AND
 *  `getPrimaryNetwork` (the import/bootstrap fallback), so the two can't disagree. */
const PRIMARY_SEED = DEFAULT_SEEDS.find((s) => s.isPrimaryActive)

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
		"getPrimaryNetwork",
		"setActiveForProfile",
		"addEndpoint",
		"updateEndpoint",
		"deleteEndpoint",
		"setPrimaryEndpoint",
		"getNodeStatus",
		"probeNodeStatus",
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
		this.storage = new EntityStorage<Network>(NETWORK_STORAGE_ROOT, browserApi.storage.local, (raw) => NetworkRowSchema.parse(raw))
		// Watchdog DISABLED: deleteNetwork legitimately holds this lock across
		// purgeChain → clearChainState, which rides the 30-minute prove-tx
		// envelope (it drains behind an in-flight proof). A force-release would
		// admit a concurrent network mutator into the middle of that cascade;
		// queueing behind it is the correct semantic.
		this.lock = new Lock("network", logger, null)
		this.nodeFactory = nodeFactory ?? new AztecNodeFactoryAdapter()
	}

	protected async init(services: ServiceCollection) {
		this.profileService = services.get(ProfileService.name)
		this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)
		// Profile-delete cleanup is now the coordinator's awaited `purgeForProfile` (D).
		this.pxeServiceClient = new PxeServiceClient(this.logger)
	}

	// ── Read paths ───────────────────────────────────────────────────────

	public async getOrInitNetworks(): Promise<Network[]> {
		await this.ensureInitialized()
		// Atomic read+capture: the lock wait + per-seed id allocation below can
		// span the profile's deletion; seeding rows (and the active pointer) for
		// a deleted profile creates orphans the cascade's snapshot predates.
		const fence = await this.profileService.captureExecutionFence()
		const deletion = this.profileService.getDeletionState()
		const profile = { id: fence.profileId }
		return await this.lock.withLock(async () => {
			const existing = (await this.storage.getValues()).filter((n) => n.profileId === profile.id)
			if (existing.length) return existing

			const seeded: Network[] = []
			let activeId: string | undefined
			for (const seed of DEFAULT_SEEDS) {
				try {
					const network = await this._buildNetwork(
						profile.id,
						seed.name,
						seed.rpcUrl,
						seed.chainId,
						seed.l1ChainId,
						seed.kind,
						seed.endpointLabel,
					)
					deletion.assertCurrent(fence.profileId, fence.epoch)
					await this.storage.set(network.id, network)
					if (!deletion.isCurrent(fence.profileId, fence.epoch)) {
						await this.storage.delete(network.id)
						throw new Error(`profile ${fence.profileId} deleted`)
					}
					seeded.push(network)
					if (seed.isPrimaryActive) activeId = network.id
				} catch (error) {
					this.logError(`Failed to seed default '${seed.name}'`, getErrorMessage(error))
				}
			}
			// The per-seed catch above (soft-fail is right for one bad seed) also
			// swallows the deletion compensate's throw — without this re-assert the
			// call would return [] as a SUCCESS for a deleted profile.
			deletion.assertCurrent(fence.profileId, fence.epoch)
			if (!activeId && seeded.length) activeId = seeded[0]!.id
			if (activeId) {
				deletion.assertCurrent(fence.profileId, fence.epoch)
				await this._writeActive(profile.id, activeId)
				const active = seeded.find((n) => n.id === activeId)!
				const primaryEndpoint = active.endpoints.find((e) => e.id === active.primaryEndpointId)!
				this.nodes.set(active.chainId, this.nodeFactory.createNode(primaryEndpoint.rpcUrl))
			}
			return seeded
		})
	}

	public async getNetworks(chainId?: number): Promise<Network[]> {
		validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return (await this.storage.getValues()).filter(
			(n) => n.profileId === profile.id && (chainId === undefined || n.chainId === chainId),
		)
	}

	/**
	 * Lock-free, profileId-parameterized network read. Does NOT go through
	 * `requireActiveProfile`, so it's safe to call under the profile facade lock
	 * (the deletion coordinator's snapshot) AND from profile-scoped cleanup
	 * consumers (e.g. `IncomingTransfer.onTokenDeleted`) that must scope to the
	 * DELETED token's profile, never the active one (finding C).
	 */
	public async getNetworksRaw(profileId: string, chainId?: number): Promise<Network[]> {
		await this.ensureInitialized()
		return (await this.storage.getValues()).filter((n) => n.profileId === profileId && (chainId === undefined || n.chainId === chainId))
	}

	/**
	 * The stored, seeded-constant-validated `l1ChainId` for `(profileId, chainId)` — the
	 * key-derivation chain input. NO network probe (safe for restore-time cross-checks and
	 * offline reads). For seeded kinds the row value must equal the immutable in-code constant:
	 * `DEFAULT_SEEDS` only INITIALIZES a mutable row, so a tampered seeded row must fail here
	 * rather than mint a self-consistent poisoned account. Lock-free, no requireActiveProfile.
	 */
	public async getL1ChainIdStored(profileId: string, chainId: number): Promise<number> {
		await this.ensureInitialized()
		const network = (await this.storage.getValues()).find((n) => n.profileId === profileId && n.chainId === chainId)
		if (!network) throw new Error(`No network for chain ${chainId} in this profile`)
		return NetworkService.assertCanonicalStoredL1(network)
	}

	/** Seeded-constant + canonical-range validation of a row's `l1ChainId` (sync — see
	 *  `getL1ChainIdStored` for why the seeded row value must equal the in-code constant). */
	private static assertCanonicalStoredL1(network: Network): number {
		const seeded = SEED_L1_BY_KIND[network.kind ?? "custom"]
		if (seeded !== undefined && network.l1ChainId !== seeded) {
			throw new Error(`Seeded network L1 identity mismatch: stored ${network.l1ChainId}, expected ${seeded}`)
		}
		if (!Number.isSafeInteger(network.l1ChainId) || network.l1ChainId < 0 || network.l1ChainId > 0xffffffff) {
			throw new Error(`Non-canonical stored l1ChainId: ${network.l1ChainId}`)
		}
		return network.l1ChainId
	}

	/**
	 * `getL1ChainIdStored` plus, for NON-seeded kinds (custom/devnet), a live-probe confirmation
	 * that the node still reports the stored L1 identity — required at ACCOUNT CREATION so a
	 * poisoned custom-network row cannot mint a wrong-chain account. Seeded kinds are already
	 * bound to in-code constants and stay offline-creatable; custom networks are online-configured
	 * by nature, so an unreachable node fails creation with a clear error.
	 *
	 * ONE row read: the probe target and the returned l1ChainId must come from the same
	 * snapshot — two independent reads could validate one row and return another's value.
	 */
	public async resolveVerifiedL1ChainId(profileId: string, chainId: number): Promise<number> {
		await this.ensureInitialized()
		const network = (await this.storage.getValues()).find((n) => n.profileId === profileId && n.chainId === chainId)
		if (!network) throw new Error(`No network for chain ${chainId} in this profile`)
		const stored = NetworkService.assertCanonicalStoredL1(network)
		const kind = network.kind ?? "custom"
		if (SEED_L1_BY_KIND[kind] === undefined) {
			const primary = network.endpoints.find((e) => e.id === network.primaryEndpointId) ?? network.endpoints[0]
			if (!primary) throw new Error("Network has no endpoint to verify its L1 identity against")
			const probed = await this._probeChainIdentity(primary.rpcUrl, kind)
			if (probed.l1ChainId !== stored) {
				throw new Error(`Custom network L1 identity mismatch: stored ${stored}, node reports ${probed.l1ChainId}`)
			}
		}
		return stored
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

	public async getPrimaryNetwork(): Promise<Network | null> {
		validateParams(NetworkMethodSchemas.getPrimaryNetwork.params, [], "getPrimaryNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		if (!PRIMARY_SEED) return null
		const rows = (await this.storage.getValues()).filter((n) => n.profileId === profile.id)
		return rows.find((n) => n.chainId === PRIMARY_SEED.chainId) ?? null
	}

	public async setActiveForProfile(profileId: string, networkId: string): Promise<string> {
		validateParams(NetworkMethodSchemas.setActiveForProfile.params, [profileId, networkId], "setActiveForProfile")
		await this.ensureInitialized()
		return await this.lock.withLock(async () => {
			// `requireOwnedRow` rejects a networkId that isn't a row of THIS profile — the id comes from
			// an attacker-controlled backup, so it must resolve only within the profile's restored rows.
			requireOwnedRow(await this.storage.get(networkId), profileId)
			await this._writeActive(profileId, networkId)
			return networkId
		})
	}

	// ── Network mutations ────────────────────────────────────────────────

	public async addNetwork(name: string, rpcUrl: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.addNetwork.params, [name, rpcUrl], "addNetwork")
		await this.ensureInitialized()
		// Atomic read+capture: the RPC probe below can span the profile's
		// deletion — the commit asserts flush against the write.
		const fence = await this.profileService.captureExecutionFence()
		const deletion = this.profileService.getDeletionState()
		const { chainId, l1ChainId } = await this._probeChainIdentity(rpcUrl)
		return await this.lock.withLock(async () => {
			const existingForProfile = (await this.storage.getValues()).filter((n) => n.profileId === fence.profileId)
			const sameChain = existingForProfile.find((n) => n.chainId === chainId)
			if (sameChain) {
				throw new Error(`${ERR_DUPLICATE_CHAIN}: A network for chain ${chainId} already exists in this profile.`)
			}
			if (existingForProfile.some((n) => n.name === name)) {
				throw new Error(`Name '${name}' already in use.`)
			}
			const network = await this._buildNetwork(fence.profileId, name, rpcUrl, chainId, l1ChainId, "custom")
			deletion.assertCurrent(fence.profileId, fence.epoch)
			await this.storage.set(network.id, network)
			// The set awaits — compensate before the row becomes observable.
			if (!deletion.isCurrent(fence.profileId, fence.epoch)) {
				await this.storage.delete(network.id)
				throw new Error(`profile ${fence.profileId} deleted`)
			}
			this.emit("onNetworkAdded", network)
			return network
		})
	}

	public async renameNetwork(id: string, name: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.renameNetwork.params, [id, name], "renameNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return await this.lock.withLock(async () => {
			const network = requireOwnedRow(await this.storage.get(id), profile.id)
			if (network.name === name) return network
			const collision = (await this.storage.getValues()).find((n) => n.profileId === profile.id && n.id !== id && n.name === name)
			if (collision) throw new Error(`Name '${name}' already in use.`)
			network.name = name
			await this.storage.set(id, network)
			this.emit("onNetworkUpdated", network)
			return network
		})
	}

	public async deleteNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.deleteNetwork.params, [id], "deleteNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return await this.lock.withLock(async () => {
			const network = requireOwnedRow(await this.storage.get(id), profile.id)
			const activeId = await this._readActive(profile.id)
			if (activeId === id) {
				throw new Error(`${ERR_ACTIVE_NETWORK}: Cannot delete the active network. Switch to another chain first.`)
			}
			// Reserve BEFORE the cascade: the network row deliberately survives
			// until the cascade finishes, so "row exists" alone would admit a
			// journal create landing between its sweep and the row delete. The
			// reservation makes `isNetworkLive` refuse for the whole window.
			this.deletingNetworks.add(id)
			try {
				// Purge chain-scoped state via the awaited coordinator
				await this.purgeChain(profile.id, network.chainId, network.id)
				await this.storage.delete(id)
			} finally {
				this.deletingNetworks.delete(id)
			}
			this.nodes.delete(network.chainId)
			this.emit("onNetworkDeleted", network)
			return network
		})
	}

	/** Network ids whose delete cascade is in progress — see `isNetworkLive`. */
	private readonly deletingNetworks = new Set<string>()

	/**
	 * Whether a network row exists AND is not mid-deletion. In-memory only:
	 * a SW restart kills both the flag and any stale creator closure that
	 * captured the network, so cross-restart staleness cannot occur.
	 */
	public async isNetworkLive(networkId: string): Promise<boolean> {
		await this.ensureInitialized()
		if (this.deletingNetworks.has(networkId)) return false
		return (await this.storage.get(networkId)) !== undefined
	}

	public async setActiveNetwork(id: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.setActiveNetwork.params, [id], "setActiveNetwork")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return await this.lock.withLock(async () => {
			const network = requireOwnedRow(await this.storage.get(id), profile.id)
			await this._writeActive(profile.id, id)
			const primaryEndpoint = network.endpoints.find((e) => e.id === network.primaryEndpointId)
			if (primaryEndpoint) {
				this.nodes.set(network.chainId, this.nodeFactory.createNode(primaryEndpoint.rpcUrl))
			}
			this.emit("onActiveNetworkChanged", network)
			return network
		})
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
		const probed = await this._probeChainIdentity(rpcUrl, peek.kind)
		return await this.lock.withLock(async () => {
			const network = requireOwnedRow(await this.storage.get(networkId), profile.id)
			if (probed.chainId !== network.chainId) {
				throw new Error(
					`${ERR_ENDPOINT_CHAIN_MISMATCH}: This RPC reports chainId ${probed.chainId}, but this network is chain ${network.chainId}.`,
				)
			}
			// The XOR composite alone is collision-prone: a different (l1ChainId, rollupVersion)
			// pair can XOR to the same value, and l1ChainId feeds key derivation — so endpoint
			// mutations require EXACT L1 equality, not just composite equality.
			if (probed.l1ChainId !== network.l1ChainId) {
				throw new Error(
					`${ERR_ENDPOINT_CHAIN_MISMATCH}: This RPC reports L1 chain ${probed.l1ChainId}, but this network is L1 chain ${network.l1ChainId}.`,
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
		})
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
		// We probe regardless to keep semantics simple — chainId could have shifted on the same URL.
		const probed = await this._probeChainIdentity(rpcUrl, peek.kind)
		return await this.lock.withLock(async () => {
			const network = requireOwnedRow(await this.storage.get(networkId), profile.id)
			if (probed.chainId !== network.chainId) {
				throw new Error(
					`${ERR_ENDPOINT_CHAIN_MISMATCH}: This RPC reports chainId ${probed.chainId}, but this network is chain ${network.chainId}.`,
				)
			}
			// Exact L1 equality — see addEndpoint: the composite is XOR-collision-prone and
			// l1ChainId feeds key derivation.
			if (probed.l1ChainId !== network.l1ChainId) {
				throw new Error(
					`${ERR_ENDPOINT_CHAIN_MISMATCH}: This RPC reports L1 chain ${probed.l1ChainId}, but this network is L1 chain ${network.l1ChainId}.`,
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
		})
	}

	public async deleteEndpoint(networkId: string, endpointId: string): Promise<NetworkEndpoint> {
		validateParams(NetworkMethodSchemas.deleteEndpoint.params, [networkId, endpointId], "deleteEndpoint")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return await this.lock.withLock(async () => {
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
		})
	}

	public async setPrimaryEndpoint(networkId: string, endpointId: string): Promise<Network> {
		validateParams(NetworkMethodSchemas.setPrimaryEndpoint.params, [networkId, endpointId], "setPrimaryEndpoint")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		return await this.lock.withLock(async () => {
			const network = requireOwnedRow(await this.storage.get(networkId), profile.id)
			if (!network.endpoints.some((e) => e.id === endpointId)) throw new Error("Invalid endpoint id")
			if (network.primaryEndpointId === endpointId) return network
			network.primaryEndpointId = endpointId
			await this.storage.set(network.id, network)
			this.nodes.delete(network.chainId)
			this.emit("onPrimaryEndpointChanged", { networkId: network.id, endpointId })
			this.emit("onNetworkUpdated", network)
			return network
		})
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

	public async probeNodeStatus(networkId: string, timeoutMs: number): Promise<NodeStatus> {
		validateParams(NetworkMethodSchemas.probeNodeStatus.params, [networkId, timeoutMs], "probeNodeStatus")
		await this.ensureInitialized()
		const profile = await requireActiveProfile(this.profileService)
		const network = requireOwnedRow(await this.storage.get(networkId), profile.id)
		const primary = network.endpoints.find((e) => e.id === network.primaryEndpointId)
		if (!primary) return NodeStatus.Inactive
		try {
			const probed = await this.nodeFactory.probeChainId(primary.rpcUrl, timeoutMs)
			// Local-network chain ids are conventionally 0 — mirror `_getChainId`'s
			// carve-outs so a local endpoint can't misreport as InvalidChain.
			const effective = network.kind === "local" || sameLocalNetworkUrl(primary.rpcUrl, LOCAL_NETWORK_RPC_URL) ? 0 : probed
			if (effective !== network.chainId) return NodeStatus.InvalidChain
			return NodeStatus.Active
		} catch {
			return NodeStatus.Inactive
		}
	}

	public async getNode(chainId: number): Promise<AztecNode> {
		await this.ensureInitialized()
		return await this.lock.withLock(async () => {
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
		})
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
		// FAIL-FAST (finding D, codex blocker): run every step best-effort so a
		// single failure doesn't strand the others, but PROPAGATE if ANY failed —
		// the deletion coordinator must keep the tombstone + retry (idempotent), not
		// treat a swallowed subscriber/PXE failure as "chain erased".
		const errors: unknown[] = []
		for (const subscriber of this.chainPurgeSubscribers) {
			try {
				await subscriber(profileId, chainId, networkId)
			} catch (error) {
				this.logError(`purgeChain subscriber failed for (${profileId}, ${chainId})`, getErrorMessage(error))
				errors.push(error)
			}
		}
		try {
			await this.pxeServiceClient.clearChainState(profileId, chainId)
		} catch (error) {
			this.logError(`PxeServiceClient.clearChainState failed`, getErrorMessage(error))
			errors.push(error)
		}
		this.emit("onChainPurged", { profileId, chainId })
		if (errors.length) {
			throw new Error(`purgeChain failed for (${profileId}, ${chainId}): ${errors.map(getErrorMessage).join("; ")}`)
		}
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
		// Deletion fence captured at entry (see restore-fence.ts): rows written
		// after a mid-restore deleteProfile must reject, not orphan.
		const deletion = this.profileService.getDeletionState()
		const epochs = captureRestoreEpochs(
			deletion,
			networks.map((n) => (n as { profileId?: unknown } | null)?.profileId),
		)
		const result: Restored<Network>[] = []
		return await this.lock.withLock(async () => {
			const existing = await this.storage.getValues()
			// A collision re-roll must avoid every SOURCE id in this batch too, not
			// just stored ids — a fresh id equal to a LATER source id would alias that
			// network's remapped child rows (finding E; belt-and-suspenders with the
			// composable's single-pass map).
			const sourceIds = new Set<string>()
			for (const n of networks) {
				const nid = (n as { id?: unknown } | null)?.id
				if (typeof nid === "string") sourceIds.add(nid)
			}
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
					const id = await preferOrReallocId(this.storage, candidate.id, sourceIds)
					const stored: Network = { ...candidate, id }
					assertRestoreEpoch(deletion, epochs, stored.profileId)
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
		})
	}

	// ── Profile lifecycle ────────────────────────────────────────────────

	private readonly onActiveProfileChanged = async () => {
		await this.lock.withLock(async () => {
			this.nodes.clear()
			this.transientNodes.clear()
		})
	}

	/** Awaited profile-scoped network purge, called by the deletion coordinator
	 *  (relocated from the removed fire-and-forget `onProfileDeleted` sub — D).
	 *  FAIL-FAST: a `purgeChain`/PXE failure now PROPAGATES (was log-and-continue)
	 *  so the coordinator keeps the tombstone + retries rather than reporting a
	 *  false "deleted". */
	public async purgeForProfile(profileId: string): Promise<void> {
		await this.ensureInitialized()
		this.logDebug(`purgeForProfile ${profileId}: purge chains + remove networks`)
		await this.lock.withLock(async () => {
			this.nodes.clear()
			this.transientNodes.clear()
			const networks = (await this.storage.getValues()).filter((n) => n.profileId === profileId)
			for (const network of networks) {
				await this.purgeChain(profileId, network.chainId, network.id)
				await this.storage.delete(network.id)
				this.emit("onNetworkDeleted", network)
			}
			// F-B23: raw second pass — a validation-failed row this profile owns is
			// invisible to getValues() and would otherwise survive the purge forever.
			await purgeMalformedRows(
				this.storage,
				(raw) => raw.profileId === profileId,
				(id) => this.logDebug(`purged malformed network row ${id}`),
			)
			await this.browserApi.storage.local.remove(activeKey(profileId))
		})
	}

	// ── Internals ────────────────────────────────────────────────────────

	private async _buildNetwork(
		profileId: string,
		name: string,
		rpcUrl: string,
		chainId: number,
		l1ChainId: number,
		kind: ChainKind,
		endpointLabel?: string,
	): Promise<Network> {
		const networkId = await this._freshStored8()
		const endpointId = `${networkId}-ep0`
		const endpoint: NetworkEndpoint = {
			id: endpointId,
			rpcUrl: normalizeRpcUrl(rpcUrl),
			label: endpointLabel?.trim() || undefined,
		}
		return {
			id: networkId,
			profileId,
			chainId,
			l1ChainId,
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
		return (await this._probeChainIdentity(rpcUrl, kindHint)).chainId
	}

	/** One probe, both identities: the XOR composite (storage scoping) AND the exact `l1ChainId`
	 *  (key derivation). The local carve-outs zero only the COMPOSITE — the probed l1ChainId is
	 *  reported as-is, because derivation must never receive a synthetic 0. */
	private async _probeChainIdentity(rpcUrl: string, kindHint?: ChainKind): Promise<{ chainId: number; l1ChainId: number }> {
		try {
			const rpc = this.nodeFactory.createNode(rpcUrl)
			const info = await rpc.getNodeInfo()
			const l1ChainId = info.l1ChainId
			if (kindHint === "local") return { chainId: 0, l1ChainId }
			if (sameLocalNetworkUrl(rpcUrl, LOCAL_NETWORK_RPC_URL)) return { chainId: 0, l1ChainId }
			return { chainId: (info.l1ChainId ^ info.rollupVersion) >>> 0, l1ChainId }
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
		typeof v.l1ChainId === "number" &&
		Number.isSafeInteger(v.l1ChainId) &&
		v.l1ChainId >= 0 &&
		v.l1ChainId <= 0xffffffff &&
		typeof v.name === "string" &&
		typeof v.primaryEndpointId === "string" &&
		Array.isArray(v.endpoints) &&
		v.endpoints.length > 0
	)
}
