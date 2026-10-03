/**
 * dApp operation estimate-reuse cache — the estimate-on-approval-window,
 * consume-on-confirm sibling of `TransferEstimateReuse`, closing the
 * "dApp paths carve out" from the original reuse rollout.
 *
 * Same one-shot/TTL/fail-closed philosophy as the transfer cache; the
 * differences:
 *
 * - **Input identity** is the canonical operation fingerprint
 *   (`fingerprintOperation` — post-planner/pre-discovery/pre-payload actions,
 *   full FeeOptions, executionMode, opts.from, wallet FeeSettings). A
 *   non-fingerprintable op is never stashed in the first place.
 * - **Chain identity is re-asserted at consume** (the reused request skips
 *   `buildStandard`'s live-chain assert, so the ladder must supply it): the
 *   injected `getLiveChainIdentity` throws on drifted endpoints ⇒ miss.
 * - **Resolved FPC identity is bound**: for `fpc`-kind settings the entry
 *   snapshots `{id, type, address, chainId, isProtocol}`; an in-place row
 *   edit between estimate and confirm ⇒ miss, never a signed call to the
 *   stale address.
 * - **Post-send bookkeeping rides the entry**: `txCalls` AND
 *   `pendingPublicAuthwits` — a reuse-hit tx that grants a public authwit
 *   must still produce its auth-registry row.
 * - **Live handles are NEVER cached** (`pxe`/`node`/`account`/`network`) —
 *   the consumer re-resolves all four; cross-profile fail-closed depends on
 *   that.
 */

import type { GasFees } from "@aztec-labs/stdlib/gas"
import { type MinFeeNode, predictedWorstMinFees } from "@nulo/aztec-runtime/fee-juice"
import { SessionEndedError } from "@nulo/extension-messaging/errors"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { Network } from "@/wallet/services/network/service"
import { findPrimaryEndpoint } from "@/wallet/services/network/spec"
import type { ExecutionFence } from "@/wallet/services/profile/profile-deletion-state"
import type { FpcInfo } from "@/wallet/services/fpc/spec"
import {
	ESTIMATE_REUSE_TTL_MS,
	fingerprintBaseFee,
	pendingHashesChanged,
	primaryEndpointMoved,
	type ReuseEntryBase,
	reuseFeeMultiplier,
	SingleShotTtlCache,
} from "./estimate-reuse-shared"
import { fingerprintOperation, type OperationFingerprintInput } from "./operation-fingerprint"
import type { BuiltStandardTx } from "./tx-request-builder"
import type { FeeSettings } from "./spec"

/** Snapshot of the resolved FPC row at estimate time. An FPC row can be
 * edited in place; a request signed against the old address must never
 * consume after such an edit. */
export type FpcIdentitySnapshot = {
	readonly id: string
	readonly type: FpcInfo["type"]
	readonly address: string
	readonly chainId: number
	readonly isProtocol: boolean
}

export type OperationEstimateReuseEntry = ReuseEntryBase & {
	/** Canonical operation identity (input-match gate). */
	readonly fingerprint: string
	readonly accountAddress: string
	readonly networkId: string
	readonly feeSettings: FeeSettings
	/** EXACT live chain identity at estimate time. The network row's stored
	 *  chainId is an XOR composite — `(1,4)` and `(2,7)` collide — so consume
	 *  must compare the raw pair, not the composite. */
	readonly chainIdentity: { readonly l1ChainId: number; readonly rollupVersion: number }
	readonly fpcIdentity?: FpcIdentitySnapshot
	readonly txCalls: BuiltStandardTx["txCalls"]
	readonly pendingPublicAuthwits: BuiltStandardTx["pendingPublicAuthwits"]
	/** Message hashes of the private authwits discovery signed into `txRequest` —
	 *  what a reuse hit would sign, checked against the preview at confirm. */
	readonly discoveredHashes: readonly string[]
}

export interface OperationEstimateReuseDeps {
	getNetwork(networkId: string): Promise<Network>
	getNode(chainId: number): Promise<MinFeeNode>
	/** Live-chain re-assert for the reused request: runs the composite
	 *  assertion (throws on drift vs the network row) AND returns the raw
	 *  pair for exact comparison against the entry's snapshot. */
	getLiveChainIdentity(network: Network): Promise<{ l1ChainId: number; rollupVersion: number }>
	/** Fresh resolved-FPC lookup for identity revalidation. */
	getFpcInfo(fpcId: string): Promise<FpcInfo>
	getPendingForAccount(account: string): { hash: string }[]
	logDebug(msg: string): void
}

export class OperationEstimateReuse {
	private readonly cache = new SingleShotTtlCache<OperationEstimateReuseEntry>(ESTIMATE_REUSE_TTL_MS)

	public constructor(private readonly deps: OperationEstimateReuseDeps) {}

	public stash(estimateId: string, entry: OperationEstimateReuseEntry): void {
		this.cache.stash(estimateId, entry)
	}

	/** Drop a stashed entry (cancelled estimate, rejected interaction).
	 *  Idempotent; unknown ids are a no-op. */
	public evict(estimateId: string): void {
		this.cache.evict(estimateId)
	}

	/**
	 * Pop a cached estimate when every ladder step passes. Single-shot: the
	 * entry is deleted up front (ids are SW-minted UUIDs — unguessable), so a
	 * failed validation still consumes the slot and the caller rebuilds. An
	 * entry stashed under another profile than `fence`'s throws
	 * {@link SessionEndedError} instead: that caller must not rebuild.
	 */
	public async tryConsume(
		estimateId: string,
		input: OperationFingerprintInput,
		fence: ExecutionFence,
	): Promise<OperationEstimateReuseEntry | undefined> {
		const entry = this.cache.consume(estimateId) // single-shot
		if (!entry) return undefined

		if (Date.now() - entry.builtAt > ESTIMATE_REUSE_TTL_MS) {
			return this.reject("entry expired")
		}
		const fingerprint = fingerprintOperation(input)
		if (fingerprint === null || fingerprint !== entry.fingerprint) {
			return this.reject("operation fingerprint drift")
		}
		if (entry.profileId !== fence.profileId) throw new SessionEndedError()
		const network = await this.deps.getNetwork(entry.networkId)
		const primary = findPrimaryEndpoint(network)
		if (primaryEndpointMoved(primary, entry)) {
			return this.reject("primary endpoint changed")
		}
		const pendingNow = this.deps.getPendingForAccount(entry.accountAddress).map((tx) => tx.hash)
		if (pendingHashesChanged(pendingNow, entry.pendingHashes)) {
			return this.reject("pending tx set changed")
		}
		try {
			const live = await this.deps.getLiveChainIdentity(network)
			if (live.l1ChainId !== entry.chainIdentity.l1ChainId || live.rollupVersion !== entry.chainIdentity.rollupVersion) {
				return this.reject("chain identity drift (exact pair mismatch)")
			}
		} catch (error) {
			return this.reject(`chain identity drift: ${getErrorMessage(error)}`)
		}
		const fpcDrift = entry.fpcIdentity ? await this.fpcIdentityDrift(entry.fpcIdentity) : undefined
		if (fpcDrift) return this.reject(fpcDrift)
		const node = await this.deps.getNode(network.chainId)
		const multiplier = reuseFeeMultiplier(entry.feeSettings.priorityLevel)
		let current: GasFees
		try {
			current = (await predictedWorstMinFees(node)).mul(multiplier)
		} catch (error) {
			return this.feeReadFailed(error, multiplier)
		}
		if (fingerprintBaseFee(current) !== entry.baseFeeFingerprint) {
			return this.reject("base fee drift")
		}
		return entry
	}

	/** Why the FPC row no longer matches the snapshot the estimate was built against, if it does not. */
	private async fpcIdentityDrift(snap: FpcIdentitySnapshot): Promise<string | undefined> {
		let fresh: FpcInfo
		try {
			fresh = await this.deps.getFpcInfo(snap.id)
		} catch (error) {
			return `fpc row unavailable: ${getErrorMessage(error)}`
		}
		const drifted =
			fresh.type !== snap.type ||
			fresh.address !== snap.address ||
			fresh.chainId !== snap.chainId ||
			(fresh.isProtocol ?? false) !== snap.isProtocol
		return drifted ? "fpc identity drift" : undefined
	}

	/** The priority lookup is unvalidated; a non-number multiplier is an unknown priority and must keep throwing. */
	private feeReadFailed(error: unknown, multiplier: unknown): undefined {
		if (typeof multiplier !== "number") throw error
		// A fixed category: the node's message never reaches the log.
		return this.reject("base fee fetch failed")
	}

	private reject(reason: string): undefined {
		this.deps.logDebug(`operation estimate reuse rejected: ${reason}`)
		return undefined
	}
}
