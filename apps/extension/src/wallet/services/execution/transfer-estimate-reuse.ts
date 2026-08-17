/**
 * Transfer estimate-reuse cache — the one-shot "estimate on the Send
 * popup, reuse the built TxRequest on Confirm" subsystem.
 *
 * Extracted verbatim from the execution facade. The validation ladder in
 * `tryConsume` is the contract: ANY drift between estimate time and
 * confirm time (inputs, profile, endpoint, base fee, pending set, TTL)
 * rejects reuse and the caller falls back to a full rebuild. Rejection
 * order and the byte-stable fingerprint formats are pinned by the
 * colocated tests — both are load-bearing (entries store fingerprints
 * computed at estimate time and compare against freshly-derived ones).
 *
 * Dependencies are injected as lazy lookups so the rejection ladder
 * keeps its laziness: branches that reject early never touch the later
 * dependencies (profile lookup happens only after input checks pass,
 * node lookup only after endpoint checks pass, etc.).
 */

import { GasFees } from "@aztec/stdlib/gas"
import type { TxExecutionRequest } from "@aztec/stdlib/tx"
import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { type MinFeeNode, predictedWorstMinFees } from "@nulo/bridge-core/fee-juice"
import { PRIORITY_MULTIPLIERS } from "@nulo/wallet-bridge"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { TransferType } from "@/wallet/services/transaction/spec"
import type { Network } from "@/wallet/services/network/service"
import { DEFAULT_FEE_MULTIPLIER } from "./fee/fee-strategy"
import { pendingHashesChanged, SingleShotTtlCache } from "./estimate-reuse-shared"
import type { TransferRequest } from "./operation-planner"
import type { FeeSettings } from "./spec"

// 120 s, owner-set (plan decision #16): the retention bound on signed tx
// requests held in SW memory. Staleness itself is guarded by the consume
// ladder, not this TTL — past ~2 min entries mostly miss on base-fee drift
// anyway, so the shorter window costs almost no hit rate.
export const ESTIMATE_REUSE_TTL_MS = 120_000

/** Stable fingerprint for a fee basis so we can compare the snapshot
 *  taken at estimate time against the value at confirm.
 *  FORMAT IS BYTE-STABLE — cached entries depend on it. */
export function fingerprintBaseFee(min: { feePerDaGas: bigint; feePerL2Gas: bigint }): string {
	return `${min.feePerDaGas.toString()}:${min.feePerL2Gas.toString()}`
}

/** Stable fingerprint for fee settings. Explicit per-variant — the
 *  previous JSON.stringify-with-key-array form silently dropped nested
 *  paymentMethod fields (the keys array is read as a recursive filter,
 *  so nested keys not in `Object.keys(fs)` got stripped). That made
 *  `{kind: "fj"}` and `{kind: "fpc", fpcId}` collide and could allow
 *  reuse to serve a TxRequest built for a different payment method.
 *  Codex audit BLOCKING #1. */
export function fingerprintFeeSettings(fs: FeeSettings): string {
	const pm = fs.paymentMethod
	let pmHash: string
	switch (pm.kind) {
		case "fj":
			pmHash = "fj"
			break
		case "fjwc":
			pmHash = `fjwc:${pm.claimAmount}:${pm.claimSecret}:${pm.messageLeafIndex}`
			break
		case "fpc":
			pmHash = `fpc:${pm.fpcId}`
			break
		case "embedded":
			pmHash = "embedded"
			break
	}
	return `${pmHash}|${fs.priorityLevel ?? "default"}`
}

/** Snapshot of the SW state at estimate time. Used by `executeTransfer` to
 *  validate that nothing relevant has drifted between estimate and confirm
 *  before reusing the prebuilt TxRequest. Each field is something the
 *  rebuilt request would have differed on. */
export type TransferEstimateReuseEntry = {
	/** Inputs identifying the transfer (rebuilt for cache-hit verification). */
	readonly networkId: string
	readonly accountAddress: string
	readonly tokenId: number
	readonly transferType: TransferType
	readonly recipientAddress: string
	readonly amount: bigint
	readonly feeSettingsHash: string
	/** Profile id at estimate time. Used for cleaner reject diagnostics
	 *  (codex audit NICE-TO-HAVE #2) — drift already fails closed via
	 *  `getNetwork` / `getAccountContract` profile-scoping, but rejecting
	 *  early avoids confusing errors deeper in the reuse path. */
	readonly profileId: string
	/** Validation snapshot — what was true at estimate time. */
	readonly baseFeeFingerprint: string
	readonly primaryEndpointId: string
	readonly primaryEndpointUrl: string
	/** Pending-tx snapshot for the active account. If new pending txs
	 *  appear between estimate and confirm, the reused TxRequest may
	 *  conflict on private notes (private transfers select notes at
	 *  build time; concurrent in-flight txs can consume them). Reject
	 *  reuse in that case (codex audit SHOULD-FIX #2 partial). */
	readonly pendingHashes: readonly string[]
	/** Built downstream state — reused on confirm. */
	readonly txRequest: TxExecutionRequest
	readonly nonce: { toString(): string }
	readonly feePaymentMethod: AccountFeePaymentMethodOptions
	/** Inputs for the activity-feed record. We persist a transfer-only
	 *  call shape (no FPC fee payload) so the card title stays the token
	 *  symbol regardless of payment method. */
	readonly token: { contract: string; name: string; symbol: string; decimals: number }
	readonly fnName: string
	readonly args: readonly unknown[]
	/** Cache lifecycle. */
	readonly builtAt: number
}

/** Lazy dependency lookups — injected so the rejection ladder's laziness
 *  survives extraction (early rejects never touch later deps). */
export interface TransferEstimateReuseDeps {
	getActiveProfile(): Promise<{ id: string } | undefined>
	getNetwork(networkId: string): Promise<Network>
	getNode(chainId: number): Promise<MinFeeNode>
	getPendingForAccount(account: string): { hash: string }[]
	logDebug(msg: string): void
}

export class TransferEstimateReuse {
	private readonly cache = new SingleShotTtlCache<TransferEstimateReuseEntry>(ESTIMATE_REUSE_TTL_MS)

	public constructor(private readonly deps: TransferEstimateReuseDeps) {}

	/** Store an entry under a fresh id (the store sweeps expired entries so the
	 *  map doesn't grow when the popup re-estimates without ever consuming). */
	public stash(estimateId: string, entry: TransferEstimateReuseEntry): void {
		this.cache.stash(estimateId, entry)
	}

	/** Drop a stashed entry (cancelled estimate, rejected interaction).
	 *  Idempotent; unknown ids are a no-op. */
	public evict(estimateId: string): void {
		this.cache.evict(estimateId)
	}

	/** Pop a cached estimate if (a) the id exists, (b) inputs match
	 *  byte-for-byte, (c) the SW's current view of base fee + primary
	 *  endpoint matches the snapshot, and (d) the entry is fresh (TTL).
	 *  Any mismatch ⇒ delete + return undefined; caller falls back to a
	 *  full rebuild. Single-shot: the entry is consumed on first lookup. */
	public async tryConsume(estimateId: string, inputs: TransferRequest): Promise<TransferEstimateReuseEntry | undefined> {
		const entry = this.cache.consume(estimateId) // single-shot
		if (!entry) return undefined

		// TTL gate
		if (Date.now() - entry.builtAt > ESTIMATE_REUSE_TTL_MS) {
			this.deps.logDebug(`tryConsumeTransferEstimate ${estimateId}: stale (TTL)`)
			return undefined
		}

		// Input byte-for-byte match
		if (
			entry.networkId !== inputs.networkId ||
			entry.accountAddress !== inputs.accountAddress ||
			entry.tokenId !== inputs.tokenId ||
			entry.transferType !== inputs.transferType ||
			entry.recipientAddress !== inputs.recipientAddress ||
			entry.amount !== inputs.amount ||
			entry.feeSettingsHash !== fingerprintFeeSettings(inputs.feeSettings)
		) {
			this.deps.logDebug(`tryConsumeTransferEstimate ${estimateId}: input drift`)
			return undefined
		}

		// Active-profile drift. `getNetwork` and `getAccountContract` already
		// fail closed for cross-profile leakage, but rejecting reuse here
		// avoids confusing downstream errors when the user swapped profiles
		// between estimate and confirm. (codex audit NICE-TO-HAVE #2)
		const profile = await this.deps.getActiveProfile()
		if (!profile || profile.id !== entry.profileId) {
			this.deps.logDebug(`tryConsumeTransferEstimate ${estimateId}: profile drift`)
			return undefined
		}

		// Endpoint identity (codex audit gap — primary can change at runtime)
		const network = await this.deps.getNetwork(inputs.networkId)
		const primary = network.endpoints.find((e) => e.id === network.primaryEndpointId)
		if (!primary) {
			this.deps.logDebug(`tryConsumeTransferEstimate ${estimateId}: no primary endpoint`)
			return undefined
		}
		if (primary.id !== entry.primaryEndpointId || primary.rpcUrl !== entry.primaryEndpointUrl) {
			this.deps.logDebug(`tryConsumeTransferEstimate ${estimateId}: primary endpoint changed`)
			return undefined
		}

		// Base fee snapshot. Compare the cached entry's fingerprint
		// (derived from the txRequest's actual `maxFeesPerGas`) against
		// `predictedWorstMinFees * multiplier` — that's what a fresh build
		// would have finalized (same basis + same GasFees.mul as
		// `finalizeGasLimits`). If the basis hasn't drifted, they match.
		// (codex audit SHOULD-FIX #3)
		const node = await this.deps.getNode(network.chainId)
		try {
			const basis = await predictedWorstMinFees(node)
			const multiplier = inputs.feeSettings.priorityLevel
				? PRIORITY_MULTIPLIERS[inputs.feeSettings.priorityLevel]
				: DEFAULT_FEE_MULTIPLIER
			// Re-wrap before multiplying: the basis components may arrive as a bare
			// `{feePerDaGas, feePerL2Gas}` from a minimal node, and the fingerprint
			// must reproduce the exact `GasFees.mul` product the build finalized.
			const expectedFingerprint = fingerprintBaseFee(new GasFees(basis.feePerDaGas, basis.feePerL2Gas).mul(multiplier))
			if (expectedFingerprint !== entry.baseFeeFingerprint) {
				this.deps.logDebug(`tryConsumeTransferEstimate ${estimateId}: base fee changed`)
				return undefined
			}
		} catch (error) {
			// Conservative: if we can't verify, don't reuse.
			this.deps.logDebug(`tryConsumeTransferEstimate ${estimateId}: base fee fetch failed: ${getErrorMessage(error)}`)
			return undefined
		}

		// Pending-tx drift. New same-account pending txs since estimate
		// can consume notes the cached private-transfer TxRequest selected.
		// Rebuild rather than risk a note-exhaustion failure mid-flight.
		// (codex audit SHOULD-FIX #2 partial — PXE rebuild detection
		// remains deferred; conservative TTL bounds that risk.)
		const currentHashes = this.deps.getPendingForAccount(inputs.accountAddress).map((tx) => tx.hash)
		if (pendingHashesChanged(currentHashes, entry.pendingHashes)) {
			this.deps.logDebug(`tryConsumeTransferEstimate ${estimateId}: pending tx set changed`)
			return undefined
		}

		return entry
	}
}
