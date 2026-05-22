import { z } from "zod"

export const NETWORK_SERVICE_NAME = "network"

export enum NodeStatus {
	Active,
	Inactive,
	InvalidChain,
}

export type ChainKind = "mainnet" | "testnet" | "devnet" | "local" | "custom"

export type NetworkEndpoint = {
	/** Stable id (random hex). */
	id: string
	/** RPC URL (host lowercased on add; path/query preserved verbatim). */
	rpcUrl: string
	/** Optional human-readable label. Empty/undefined → render the host. */
	label?: string
}

export type Network = {
	/** Stable id (random hex). Used as `networkId` in operations + bridge. */
	id: string
	/** Profile scoping — Networks are per-profile. */
	profileId: string
	/** Logical chain identity (XOR of l1ChainId + rollupVersion, or 0 for localhost). */
	chainId: number
	/** User-customizable display name. */
	name: string
	/**
	 * Endpoints owned by this Network. Always ≥1. ORDER IS AUTHORITATIVE:
	 * `endpoints[0]` is the user-preferred endpoint (the snap-back target);
	 * the rest are the failover priority list. The runtime tracks which
	 * endpoint is currently routing (the "active" one) in an in-memory
	 * `NetworkRouteState` that may differ from `endpoints[0]` during a
	 * failover episode. Persisted state encodes preference; in-memory state
	 * encodes the operational reality. (No separate `primaryEndpointId`
	 * pointer — codex final-pass §1 confirmed the simpler shape.)
	 */
	endpoints: NetworkEndpoint[]
	/** Optional chain-type metadata. Set at seed time; "custom" otherwise. */
	kind?: ChainKind
}

/**
 * Synthesized at lookup-time from `(Network, endpoints[0].rpcUrl)`. Kept
 * structurally identical to the prior shape on the PXE-facing boundary so
 * `chain-runtime.ts` keeps working unchanged.
 */
export type NetworkInfo = {
	profileId: string
	chainId: number
	rpcUrl: string
}

/**
 * Helper: project a Network down to the legacy `NetworkInfo` shape using
 * its preferred endpoint's URL (`endpoints[0]`). Throws if the network has
 * no endpoints — guarded by the `.min(1)` zod constraint on the schema, so
 * this should be unreachable.
 */
export function networkInfoFrom(network: Network): NetworkInfo {
	const preferred = network.endpoints[0]
	if (!preferred) throw new Error(`Network ${network.id} has no endpoints`)
	return { profileId: network.profileId, chainId: network.chainId, rpcUrl: preferred.rpcUrl }
}

// ── Service-thrown error message prefixes ────────────────────────────
// Errors cross the SW↔popup wire as plain Error.message strings (custom
// classes don't survive serialization). Callers match on prefixes.

export const ERR_DUPLICATE_CHAIN = "DUPLICATE_CHAIN"
export const ERR_DUPLICATE_ENDPOINT = "DUPLICATE_ENDPOINT"
export const ERR_ENDPOINT_CHAIN_MISMATCH = "ENDPOINT_CHAIN_MISMATCH"
export const ERR_LAST_ENDPOINT = "LAST_ENDPOINT"
export const ERR_ACTIVE_NETWORK = "ACTIVE_NETWORK"
export const ERR_BACKUP_TOO_OLD = "BACKUP_TOO_OLD"
// ERR_PRIMARY_ENDPOINT removed in the multi-rpc-failover work: with the
// `endpoints[]`-order-is-priority schema, every endpoint is deletable
// (subject to ERR_LAST_ENDPOINT). Deleting endpoints[0] just promotes
// endpoints[1] to preferred.

// ── Zod schemas for the RPC boundary ─────────────────────────────────

export const ChainKindSchema: z.ZodType<ChainKind> = z.enum(["mainnet", "testnet", "devnet", "local", "custom"])

export const NetworkEndpointSchema: z.ZodType<NetworkEndpoint> = z.object({
	id: z.string(),
	rpcUrl: z.string(),
	label: z.string().optional(),
})

export const NetworkSchema: z.ZodType<Network> = z.object({
	id: z.string(),
	profileId: z.string(),
	chainId: z.number(),
	name: z.string(),
	endpoints: z.array(NetworkEndpointSchema).min(1),
	kind: ChainKindSchema.optional(),
})

export const NodeStatusSchema: z.ZodType<NodeStatus> = z.nativeEnum(NodeStatus)

/** `getNetworkInfo` synthesized struct — opaque to the wire validator,
 *  but carrying the same fields the PXE adapter expects. */
export const NetworkInfoSchema: z.ZodType<NetworkInfo> = z.object({
	profileId: z.string(),
	chainId: z.number(),
	rpcUrl: z.string(),
})

/**
 * Per-method schemas. Tuples preserve positional-param ordering (our wire
 * format sends params as a positional list).
 */
export const NetworkMethodSchemas = {
	getOrInitNetworks: {
		params: z.tuple([]),
		result: z.array(NetworkSchema),
	},
	getNetworks: {
		params: z.tuple([z.number().int().nonnegative().optional()]),
		result: z.array(NetworkSchema),
	},
	getNetwork: {
		params: z.tuple([z.string().min(1)]),
		result: NetworkSchema,
	},
	addNetwork: {
		params: z.tuple([z.string().min(1), z.string().url()]),
		result: NetworkSchema,
	},
	renameNetwork: {
		params: z.tuple([z.string().min(1), z.string().min(1)]),
		result: NetworkSchema,
	},
	deleteNetwork: {
		params: z.tuple([z.string().min(1)]),
		result: NetworkSchema,
	},
	setActiveNetwork: {
		params: z.tuple([z.string().min(1)]),
		result: NetworkSchema,
	},
	getActiveNetwork: {
		params: z.tuple([]),
		result: NetworkSchema.nullable(),
	},
	addEndpoint: {
		params: z.tuple([z.string().min(1), z.string().optional(), z.string().url()]),
		result: NetworkEndpointSchema,
	},
	updateEndpoint: {
		params: z.tuple([z.string().min(1), z.string().min(1), z.string().optional(), z.string().url()]),
		result: NetworkEndpointSchema,
	},
	deleteEndpoint: {
		params: z.tuple([z.string().min(1), z.string().min(1)]),
		result: NetworkEndpointSchema,
	},
	promoteEndpoint: {
		params: z.tuple([z.string().min(1), z.string().min(1)]),
		result: NetworkSchema,
	},
	getNodeStatus: {
		params: z.tuple([z.string().min(1)]),
		result: NodeStatusSchema,
	},
} as const

export type Methods = {
	/** Returns existing networks if any, or seeds + returns the 4 defaults. */
	getOrInitNetworks(): Network[]
	/** Returns all networks for the active profile, or filtered by chainId. */
	getNetworks(chainId?: number): Network[]
	/** Returns a network by id. */
	getNetwork(id: string): Network
	/**
	 * Creates a new Network with one initial endpoint.
	 * Throws `DUPLICATE_CHAIN: ...` if a network with the probed chainId
	 * already exists in this profile (caller should `addEndpoint` instead).
	 * @param name Display name for the chain.
	 * @param rpcUrl Initial endpoint URL.
	 */
	addNetwork(name: string, rpcUrl: string): Network
	/** Renames a network. Does NOT touch endpoints. */
	renameNetwork(id: string, name: string): Network
	/**
	 * Deletes a network and PURGES all chain-scoped state for that
	 * (profileId, chainId) — accounts, txs, balances, tokens, fpcs,
	 * authwits, journal, PXE. Rejects if the network is currently active.
	 */
	deleteNetwork(id: string): Network
	/**
	 * Switches the active chain pointer. Primes the AztecNode cache. Does
	 * NOT mutate `endpoints[]` order (that's a separate user choice via
	 * `promoteEndpoint`).
	 */
	setActiveNetwork(id: string): Network
	/** Returns the currently active network, or null if none. */
	getActiveNetwork(): Network | null
	/**
	 * Adds an endpoint to an existing network. Probes the RPC; rejects
	 * `ENDPOINT_CHAIN_MISMATCH` if the URL's chainId doesn't match.
	 */
	addEndpoint(networkId: string, label: string | undefined, rpcUrl: string): NetworkEndpoint
	/** Updates an endpoint's label and/or rpcUrl. Re-probes on URL change. */
	updateEndpoint(networkId: string, endpointId: string, label: string | undefined, rpcUrl: string): NetworkEndpoint
	/**
	 * Deletes an endpoint. Rejects `LAST_ENDPOINT` if it's the only one on
	 * the network. The previously-preferred endpoint (`endpoints[0]`) can be
	 * deleted; deletion shifts `endpoints[1]` into preferred position.
	 */
	deleteEndpoint(networkId: string, endpointId: string): NetworkEndpoint
	/**
	 * Promotes an endpoint to `endpoints[0]` (the user-preferred position).
	 * Splices the endpoint out and unshifts it to the head. Evicts the
	 * cached node so the next `getNode` call re-resolves the route. Emits
	 * `onPrimaryEndpointChanged` with `source: "manual"`.
	 */
	promoteEndpoint(networkId: string, endpointId: string): Network
	/**
	 * Probes the network's currently-active endpoint and returns
	 * Active / Inactive / InvalidChain. (Active = "alive at the right
	 * chainId.") Header UX combines this with `endpoints[0] != activeEndpointId`
	 * to render the amber Degraded dot.
	 */
	getNodeStatus(networkId: string): NodeStatus
}

/**
 * Discriminator on `onPrimaryEndpointChanged` payload: what caused the live
 * route to change?
 *  - "manual": user called `promoteEndpoint` or reordered endpoints.
 *  - "failover": automatic failover after threshold tripped on the previous
 *    active endpoint.
 *  - "snapback": opportunistic recovery when a previously-failed preferred
 *    endpoint passed its post-cooldown probe.
 */
export type PrimaryEndpointChangeSource = "manual" | "failover" | "snapback"

export type Events = {
	/** Emitted when a new network is added. */
	onNetworkAdded: Network
	/** Emitted when an existing network is updated (rename or endpoint mutation). */
	onNetworkUpdated: Network
	/** Emitted when a network is deleted (after purge completes). */
	onNetworkDeleted: Network
	/** Emitted when the active chain changes. */
	onActiveNetworkChanged: Network
	/**
	 * Emitted when a network's active routing endpoint changes. Carries the
	 * source discriminator so the UI can distinguish manual user actions
	 * (no toast) from automatic failover events (toast + amber dot).
	 */
	onPrimaryEndpointChanged: {
		networkId: string
		fromEndpointId: string | undefined
		toEndpointId: string
		source: PrimaryEndpointChangeSource
	}
	/**
	 * Emitted when failover exhausted all configured endpoints for a chain.
	 * UI surfaces a persistent banner with a "Retry preferred" button.
	 */
	onPrimaryEndpointDegraded: { networkId: string; exhausted: boolean }
	/**
	 * Emitted after `purgeChain` finishes wiping chain-scoped state. UI uses
	 * this to refresh views (account list, tx list, etc.).
	 */
	onChainPurged: { profileId: string; chainId: number }
}
