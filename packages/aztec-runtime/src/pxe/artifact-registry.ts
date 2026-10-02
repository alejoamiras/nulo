import { memoizeAsync } from "./async-memo"
import type { Fr } from "@aztec-labs/foundation/curves/bn254"
import type { ContractArtifact } from "@aztec-labs/stdlib/abi"
import type { ContractInstanceWithAddress } from "@aztec-labs/stdlib/contract"
import type { ILogger } from "@nulo/wallet-core/logger"
import { LogLevel } from "@nulo/wallet-core/logger"
import { type ArtifactClassIdVerifier, type ClassIdVerifyLogger, DefaultArtifactClassIdVerifier } from "./artifact-class-id"
import type { KnownArtifacts, KnownArtifactsLoader } from "./known-artifacts"

export type ArtifactSource = "pxe-local" | "known"

const RESOLUTION_ORDER: readonly ArtifactSource[] = ["pxe-local", "known"]

/**
 * Artifact resolution: this PXE first, then the compiled-in bundle.
 *
 * Holds the compiled-in "known" artifacts + the SponsoredFPC instance,
 * loaded lazily via the injected `KnownArtifactsLoader`.
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
	private readonly knownMemo = memoizeAsync<void>(() =>
		this.loader().then((known) => {
			this.known = known
		}),
	)
	/**
	 * Cache of class-ids whose artifact has been recomputed and verified
	 * at least once during the current registry lifetime. Skips the
	 * ~10–50ms Poseidon recompute for repeat resolves of the same
	 * artifact.
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
		this.verifier = opts?.verifier ?? new DefaultArtifactClassIdVerifier()
		this.logger = opts?.logger
		this.logSource = opts?.logSource ?? "artifact-registry"
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

	/** Resolve an artifact by class id: "pxe-local", then "known" unless
	 *  `pxeOnly`. The `pxeLookup` callback is invoked exactly once —
	 *  callers pass the chain's PXE so the registry stays PXE-agnostic.
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
	 *  Cache: `verifiedClassIds: Set<string>` skips the recompute for a
	 *  class id already verified once, keyed by class id alone. */
	public async resolve(
		classId: Fr,
		pxeLookup: (id: Fr) => Promise<ContractArtifact | undefined>,
		opts?: { pxeOnly?: boolean },
	): Promise<ContractArtifact | undefined> {
		const pxeOnly = opts?.pxeOnly === true

		for (const source of RESOLUTION_ORDER) {
			if (pxeOnly && source !== "pxe-local") continue
			const found = await this.resolveFromSource(source, classId, pxeLookup)
			if (found) return found
		}
		return undefined
	}

	private async resolveFromSource(
		source: ArtifactSource,
		classId: Fr,
		pxeLookup: (id: Fr) => Promise<ContractArtifact | undefined>,
	): Promise<ContractArtifact | undefined> {
		switch (source) {
			case "pxe-local": {
				const found = await pxeLookup(classId)
				return found ? await this.verifyAndCache(classId, found) : undefined
			}
			case "known": {
				await this.ensureKnown()
				// "known" branch is keyed by load-time-computed class-id;
				// `Map.get(classId.toString())` is itself the class-id
				// equality check. Skip recompute.
				return this.known?.artifacts.get(classId.toString())
			}
		}
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
