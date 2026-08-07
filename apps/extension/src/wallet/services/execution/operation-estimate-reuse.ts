/**
 * dApp operation estimate-reuse cache — the estimate-on-approval-window,
 * consume-on-confirm sibling of `TransferEstimateReuse`, closing the
 * "dApp paths carve out" from the original reuse rollout.
 *
 * Same one-shot/TTL/fail-closed philosophy as the transfer cache; the
 * differences are exactly the audit-pinned ones (plan architecture §2):
 *
 * - **Input identity** is the canonical operation fingerprint
 *   (`fingerprintOperation` — post-planner/pre-discovery/pre-payload actions,
 *   full FeeOptions, executionMode, opts.from, wallet FeeSettings). A
 *   non-fingerprintable op is never stashed in the first place.
 * - **Chain identity is re-asserted at consume** (the reused request skips
 *   `buildStandard`'s live-chain assert, so the ladder must supply it): the
 *   injected `assertChainIdentity` throws on drifted endpoints ⇒ miss.
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

import type { TxExecutionRequest } from "@aztec/stdlib/tx"
import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { type MinFeeNode, predictedWorstMinFees } from "@nulo/bridge-core/fee-juice"
import { PRIORITY_MULTIPLIERS } from "@nulo/wallet-bridge"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { Network } from "@/wallet/services/network/service"
import type { FpcInfo } from "@/wallet/services/fpc/spec"
import { DEFAULT_FEE_MULTIPLIER } from "./fee/fee-strategy"
import { ESTIMATE_REUSE_TTL_MS, fingerprintBaseFee } from "./transfer-estimate-reuse"
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

export type OperationEstimateReuseEntry = {
	/** Canonical operation identity (input-match gate). */
	readonly fingerprint: string
	readonly accountAddress: string
	readonly networkId: string
	readonly feeSettings: FeeSettings
	/** Validation snapshot — what was true at estimate time. */
	readonly profileId: string
	readonly baseFeeFingerprint: string
	readonly primaryEndpointId: string
	readonly primaryEndpointUrl: string
	readonly pendingHashes: readonly string[]
	/** EXACT live chain identity at estimate time. The network row's stored
	 *  chainId is an XOR composite — `(1,4)` and `(2,7)` collide — so consume
	 *  must compare the raw pair, not the composite. */
	readonly chainIdentity: { readonly l1ChainId: number; readonly rollupVersion: number }
	readonly fpcIdentity?: FpcIdentitySnapshot
	/** Built downstream state — reused on confirm. Live handles excluded. */
	readonly txRequest: TxExecutionRequest
	readonly nonce: { toString(): string }
	readonly feePaymentMethod: AccountFeePaymentMethodOptions
	readonly txCalls: BuiltStandardTx["txCalls"]
	readonly pendingPublicAuthwits: BuiltStandardTx["pendingPublicAuthwits"]
	/** Cache lifecycle. */
	readonly builtAt: number
}

export interface OperationEstimateReuseDeps {
	getActiveProfile(): Promise<{ id: string } | undefined>
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
	private cache = new Map<string, OperationEstimateReuseEntry>()

	public constructor(private readonly deps: OperationEstimateReuseDeps) {}

	public stash(estimateId: string, entry: OperationEstimateReuseEntry): void {
		this.cache.set(estimateId, entry)
		this.evictStale()
		// Per-entry timer so the signed request is physically dropped AT the
		// TTL (idempotent vs consume/evict; dies with the SW, as does the map).
		setTimeout(() => this.cache.delete(estimateId), ESTIMATE_REUSE_TTL_MS + 1)
	}

	/** Drop a stashed entry (cancelled estimate, rejected interaction).
	 *  Idempotent; unknown ids are a no-op. */
	public evict(estimateId: string): void {
		this.cache.delete(estimateId)
	}

	/**
	 * Pop a cached estimate when every ladder step passes. Single-shot: the
	 * entry is deleted up front (ids are SW-minted UUIDs — unguessable), so a
	 * failed validation still consumes the slot and the caller rebuilds.
	 */
	public async tryConsume(estimateId: string, input: OperationFingerprintInput): Promise<OperationEstimateReuseEntry | undefined> {
		const entry = this.cache.get(estimateId)
		if (!entry) return undefined
		this.cache.delete(estimateId)

		if (Date.now() - entry.builtAt > ESTIMATE_REUSE_TTL_MS) {
			return this.reject("entry expired")
		}
		const fingerprint = fingerprintOperation(input)
		if (fingerprint === null || fingerprint !== entry.fingerprint) {
			return this.reject("operation fingerprint drift")
		}
		const profile = await this.deps.getActiveProfile()
		if (!profile || profile.id !== entry.profileId) {
			return this.reject("active profile changed")
		}
		const network = await this.deps.getNetwork(entry.networkId)
		const primary = network.endpoints.find((e) => e.id === network.primaryEndpointId)
		if (!primary || primary.id !== entry.primaryEndpointId || primary.rpcUrl !== entry.primaryEndpointUrl) {
			return this.reject("primary endpoint changed")
		}
		const pendingNow = this.deps
			.getPendingForAccount(entry.accountAddress)
			.map((tx) => tx.hash)
			.sort()
		const pendingThen = [...entry.pendingHashes].sort()
		if (pendingNow.length !== pendingThen.length || pendingNow.some((h, i) => h !== pendingThen[i])) {
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
		if (entry.fpcIdentity) {
			let fresh: FpcInfo
			try {
				fresh = await this.deps.getFpcInfo(entry.fpcIdentity.id)
			} catch (error) {
				return this.reject(`fpc row unavailable: ${getErrorMessage(error)}`)
			}
			const snap = entry.fpcIdentity
			if (
				fresh.type !== snap.type ||
				fresh.address !== snap.address ||
				fresh.chainId !== snap.chainId ||
				(fresh.isProtocol ?? false) !== snap.isProtocol
			) {
				return this.reject("fpc identity drift")
			}
		}
		const node = await this.deps.getNode(network.chainId)
		const multiplier = entry.feeSettings.priorityLevel ? PRIORITY_MULTIPLIERS[entry.feeSettings.priorityLevel] : DEFAULT_FEE_MULTIPLIER
		const current = (await predictedWorstMinFees(node)).mul(multiplier)
		if (fingerprintBaseFee(current) !== entry.baseFeeFingerprint) {
			return this.reject("base fee drift")
		}
		return entry
	}

	private reject(reason: string): undefined {
		this.deps.logDebug(`operation estimate reuse rejected: ${reason}`)
		return undefined
	}

	private evictStale(): void {
		const now = Date.now()
		for (const [id, entry] of this.cache) {
			if (now - entry.builtAt > ESTIMATE_REUSE_TTL_MS) this.cache.delete(id)
		}
	}
}
