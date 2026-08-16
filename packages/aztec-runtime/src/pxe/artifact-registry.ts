import { memoizeAsync } from "./async-memo"
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact } from "@aztec/stdlib/abi"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import type { ILogger } from "@nulo/wallet-core/logger"
import { LogLevel } from "@nulo/wallet-core/logger"
import { type ArtifactClassIdVerifier, type ClassIdVerifyLogger, DefaultArtifactClassIdVerifier } from "./artifact-class-id"
import type { KnownArtifacts, KnownArtifactsLoader } from "./known-artifacts"

/**
 * Minimal structural shape for the network-info argument; declared inline
 * so this file stays decoupled from the extension types.
 */
export interface ArtifactNetworkContext {
	/** CAIP-like chain identifier; kept on the API for future per-chain
	 *  policy hooks even though the current resolver doesn't read it. */
	chainId: number
}

export type ArtifactSource = "pxe-local" | "known"

/** Resolution policy. Callers get the sensible default via
 *  `defaultPolicy()`. Pinning goes via `byClassId`. */
export type ArtifactPolicy = {
	/** Resolution order. Default: `["pxe-local", "known"]`. */
	order: ArtifactSource[]
	/** Per-class pin. If `byClassId[classId]` is set, resolution SKIPS
	 *  all sources except the named one. Use "known" to force the
	 *  compiled-in version for a protocol contract. */
	byClassId?: Record<string, ArtifactSource>
}

export function defaultPolicy(): ArtifactPolicy {
	return { order: ["pxe-local", "known"] }
}

/**
 * Artifact resolution with explicit policy + pinning.
 *
 * Holds the compiled-in "known" artifacts + the SponsoredFPC instance,
 * loaded lazily via the injected `KnownArtifactsLoader`. Resolution
 * walks the policy order; a `byClassId` pin overrides the order for a
 * specific class.
 *
 * Resolution sources are bounded to what the wallet ships with or has
 * already registered for this profile — `pxe-local` (already in this
 * PXE) and `known` (compiled-in standards bundle). The HTTP artifact
 * registry was removed; dApps must pass artifacts for non-bundled
 * contracts via `aztec_registerContract({ artifact })`.
 */
export class ArtifactRegistry {
	private known: KnownArtifacts | null = null
	// `known` stays the synchronous resolved-value store (read directly by
	// getKnownInstance and friends); the memo only guards the one-shot load.
	// Pre-existing and unchanged: an old still-in-flight loader that SUCCEEDS
	// after a concurrent clear() repopulates `known` — the memo's identity
	// guard covers rejections only.
	private readonly knownMemo = memoizeAsync<void>(() =>
		this.loader().then((known) => {
			this.known = known
		}),
	)
	private policy: ArtifactPolicy
	/**
	 * Cache of class-ids whose artifact has been recomputed and verified
	 * at least once during the current registry lifetime. Skips the
	 * ~10–50ms Poseidon recompute for repeat resolves of the same
	 * artifact. `clear()` empties this cache too.
	 *
	 * Cache key: `Fr.toString()` of the verified class-id.
	 */
	private readonly verifiedClassIds: Set<string> = new Set()

	private readonly verifier: ArtifactClassIdVerifier
	private readonly logger?: ILogger
	private readonly logSource: string

	public constructor(
		private readonly loader: KnownArtifactsLoader,
		opts?: {
			logger?: ILogger
			logSource?: string
			/** DI seam for class-id verification. Tests pass a fake that
			 *  bypasses Poseidon recompute (faster + works with fixture
			 *  artifacts that lack the structure upstream
			 *  `getContractClassFromArtifact` requires). */
			verifier?: ArtifactClassIdVerifier
		},
	) {
		this.policy = defaultPolicy()
		this.verifier = opts?.verifier ?? new DefaultArtifactClassIdVerifier()
		this.logger = opts?.logger
		this.logSource = opts?.logSource ?? "artifact-registry"
	}

	/** Apply a new policy. Callers should only use this for per-class
	 *  pinning or custom orders. */
	public setPolicy(policy: ArtifactPolicy): void {
		this.policy = policy
	}

	public getPolicy(): ArtifactPolicy {
		return this.policy
	}

	/** Lazy-load the compiled-in known artifacts + instances. First
	 *  caller pays the cost; subsequent calls are no-ops. Safe across
	 *  concurrent calls (shared promise). */
	public async ensureKnown(): Promise<void> {
		if (this.known) return
		await this.knownMemo.get()
	}

	public getKnownInstance(address: string): ContractInstanceWithAddress | undefined {
		return this.known?.instances.get(address)
	}

	/** True if `classId` is in the compiled-in `known` bundle. Loads the
	 *  bundle lazily on first call. Used by callers that need to decide
	 *  whether the wallet can resolve an artifact without help (e.g.
	 *  `aztec_registerContract` smart-tighten check). */
	public async hasKnownClassId(classId: Fr): Promise<boolean> {
		await this.ensureKnown()
		return this.known?.artifacts.has(classId.toString()) ?? false
	}

	/** Drop everything loaded. Called during onProfileDeleted so a
	 *  stale class-id set doesn't linger if contracts change
	 *  between profiles. */
	public clear(): void {
		this.known = null
		this.knownMemo.reset()
		this.verifiedClassIds.clear()
	}

	/** Resolve an artifact by class id using the policy order. The
	 *  `pxeLookup` callback is invoked exactly once if "pxe-local"
	 *  appears in the order — callers pass the chain's PXE so the
	 *  registry stays PXE-agnostic.
	 *
	 *  ## Trust enforcement
	 *
	 *  Every artifact returned to the caller has its class id
	 *  recomputed and compared to `classId`. Mismatches cause the
	 *  source to be skipped (resolution falls through to the next).
	 *
	 *  - **"pxe-local"** branch: PXE database is trusted-to-degree
	 *    (chain-data store) but a misconfigured PXE could feed a
	 *    wrong artifact. Always recomputes; cached.
	 *  - **"known"** branch: SKIPS recompute. The compiled-in
	 *    `KnownArtifacts.artifacts` map is keyed by class-id-from-load-
	 *    time computation (see `loadProductionKnownArtifacts` in
	 *    `known-artifacts.ts`); the `Map.get(classId.toString())`
	 *    lookup is by definition a class-id match. Recomputing would
	 *    be the same Poseidon hash twice.
	 *
	 *  Cache: `verifiedClassIds: Set<string>` skips repeat recomputes
	 *  for the same `(classId, artifact)` pair. Cleared by `clear()`. */
	public async resolve(
		classId: Fr,
		pxeLookup: (id: Fr) => Promise<ContractArtifact | undefined>,
		_network: ArtifactNetworkContext,
		opts?: { pxeOnly?: boolean },
	): Promise<ContractArtifact | undefined> {
		const pin = this.policy.byClassId?.[classId.toString()]
		const order = pin ? [pin] : this.policy.order
		const pxeOnly = opts?.pxeOnly === true

		for (const source of order) {
			if (pxeOnly && source !== "pxe-local") continue
			switch (source) {
				case "pxe-local": {
					const found = await pxeLookup(classId)
					if (found) {
						const verified = await this.verifyAndCache(classId, found)
						if (verified) return verified
					}
					break
				}
				case "known": {
					await this.ensureKnown()
					const found = this.known?.artifacts.get(classId.toString())
					// "known" branch is keyed by load-time-computed class-id;
					// `Map.get(classId.toString())` is itself the class-id
					// equality check. Skip recompute.
					if (found) return found
					break
				}
			}
		}
		return undefined
	}

	/**
	 * Verify class id, then cache `classId.toString()` in
	 * `verifiedClassIds` so repeat resolves skip the recompute.
	 *
	 * Returns the artifact on match, undefined on mismatch.
	 */
	private async verifyAndCache(classId: Fr, artifact: ContractArtifact): Promise<ContractArtifact | undefined> {
		const key = classId.toString()
		if (this.verifiedClassIds.has(key)) return artifact

		const verifyLogger: ClassIdVerifyLogger | undefined = this.logger
			? (level, msg, ...rest) => this.logger?.log(this.logSource, level === "warn" ? LogLevel.Warn : LogLevel.Debug, msg, ...rest)
			: undefined
		const verified = await this.verifier.verify(artifact, classId, verifyLogger)
		if (verified) {
			this.verifiedClassIds.add(key)
		}
		return verified
	}
}
