/**
 * What the two estimate-reuse caches (`transfer-estimate-reuse`,
 * `operation-estimate-reuse`) share: the cache mechanics, the snapshot vocabulary
 * and the pure comparisons. Each cache keeps its own validation ladder (order,
 * base-fee handling, and its operation-specific gates are load-bearing and pinned
 * by colocated tests).
 */

import type { AccountFeePaymentMethodOptions } from "@aztec-labs/entrypoints/account"
import type { TxExecutionRequest } from "@aztec-labs/stdlib/tx"
import { PRIORITY_MULTIPLIERS, type PriorityLevel } from "@nulo/wallet-bridge"
import type { NetworkEndpoint } from "@/wallet/services/network/spec"
import { DEFAULT_FEE_MULTIPLIER } from "./fee/fee-strategy"

// 120 s, owner-set: the retention bound on signed tx requests held in SW memory.
// Staleness itself is guarded by the consume ladder, not this TTL — past ~2 min
// entries mostly miss on base-fee drift anyway, so the shorter window costs
// almost no hit rate.
export const ESTIMATE_REUSE_TTL_MS = 120_000

/** Stable fingerprint for a fee basis so we can compare the snapshot
 *  taken at estimate time against the value at confirm.
 *  FORMAT IS BYTE-STABLE — cached entries depend on it. */
export function fingerprintBaseFee(min: { feePerDaGas: bigint; feePerL2Gas: bigint }): string {
	return `${min.feePerDaGas.toString()}:${min.feePerL2Gas.toString()}`
}

/** The snapshot fields both entry types carry: what was true at estimate time, and the build reused on confirm. */
export type ReuseEntryBase = {
	/** Profile id at estimate time; consume refuses any other fence. */
	readonly profileId: string
	readonly baseFeeFingerprint: string
	readonly primaryEndpointId: string
	readonly primaryEndpointUrl: string
	/** Pending-tx snapshot for the active account. If new pending txs
	 *  appear between estimate and confirm, the reused TxRequest may
	 *  conflict on private notes (private transfers select notes at
	 *  build time; concurrent in-flight txs can consume them). Reject
	 *  reuse in that case. */
	readonly pendingHashes: readonly string[]
	/** Built downstream state — reused on confirm. Live handles excluded. */
	readonly txRequest: TxExecutionRequest
	/** Provenance travels WITH the cached request: the entry retains the
	 *  exact build, so the confirm leg classifies an existing-nullifier
	 *  rejection with the same fidelity as a fresh build. */
	readonly initializesAccount: boolean
	readonly nonce: { toString(): string }
	readonly feePaymentMethod: AccountFeePaymentMethodOptions
	readonly builtAt: number
}

/** True when the live primary endpoint is missing or is not the one the snapshot was built against. */
export function primaryEndpointMoved(
	primary: NetworkEndpoint | undefined,
	snap: Pick<ReuseEntryBase, "primaryEndpointId" | "primaryEndpointUrl">,
): boolean {
	return !primary || primary.id !== snap.primaryEndpointId || primary.rpcUrl !== snap.primaryEndpointUrl
}

/** The fee multiplier for a known or absent priority. The lookup stays unvalidated, so an unknown
 *  priority keeps its existing failure. */
export function reuseFeeMultiplier(priority: PriorityLevel | undefined): number {
	return priority ? PRIORITY_MULTIPLIERS[priority] : DEFAULT_FEE_MULTIPLIER
}

/**
 * A single-shot, TTL-bounded id→entry store. `stash` records an entry and
 * opportunistically sweeps expired ones (so the map can't grow unboundedly
 * when the popup re-estimates without consuming), plus a per-entry timer that
 * physically drops the entry AT the TTL. `consume` pops an entry on first read
 * (single-shot). Staleness is by `builtAt`; the caller still runs its own TTL
 * gate in the consume ladder (with its own diagnostics) — this store owns only
 * the background eviction.
 */
export class SingleShotTtlCache<E extends { builtAt: number }> {
	private readonly cache = new Map<string, E>()

	public constructor(private readonly ttlMs: number) {}

	/** Store an entry under a fresh id, then sweep expired entries. */
	public stash(id: string, entry: E): void {
		this.cache.set(id, entry)
		this.evictStale()
		// Per-entry timer so the entry is physically dropped AT the TTL
		// (idempotent vs consume/evict; dies with the SW, as does the map).
		setTimeout(() => this.cache.delete(id), this.ttlMs + 1)
	}

	/** Pop an entry, removing it (single-shot). Unknown id ⇒ undefined. */
	public consume(id: string): E | undefined {
		const entry = this.cache.get(id)
		this.cache.delete(id)
		return entry
	}

	/** Drop a stashed entry. Idempotent; unknown ids are a no-op. */
	public evict(id: string): void {
		this.cache.delete(id)
	}

	private evictStale(): void {
		const now = Date.now()
		for (const [id, entry] of this.cache) {
			if (now - entry.builtAt > this.ttlMs) {
				this.cache.delete(id)
			}
		}
	}
}

/**
 * True when the pending-tx-hash set changed between estimate and confirm
 * (order-insensitive set equality). Unifies the two prior implementations
 * (a `Set` size+membership compare and a sorted positional compare), which
 * agree for the unique tx-hash inputs both receive.
 */
export function pendingHashesChanged(current: readonly string[], cached: readonly string[]): boolean {
	const currentSet = new Set(current)
	const cachedSet = new Set(cached)
	return currentSet.size !== cachedSet.size || [...currentSet].some((h) => !cachedSet.has(h))
}
