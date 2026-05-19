/**
 * Class-id verification helper.
 *
 * Recomputes the class id of a `ContractArtifact` and compares to the
 * caller's expected `Fr`. Returns the artifact on match, undefined on
 * mismatch (with an optional logger callback for observability).
 *
 * Why returning `undefined` rather than throwing: callers walk a
 * resolution policy ("registry" → "known" → "pxe-local"); a single
 * source mismatch should fall through to the next source, not abort
 * the whole lookup. Throws are reserved for system-level failures
 * (which the wrapping try/catch catches generically).
 *
 * Pure: no chrome.*, no network, no storage. Just a Poseidon-heavy
 * compute via upstream `getContractClassFromArtifact`. Tests inject
 * fixture artifacts directly.
 */

import type { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact } from "@aztec/stdlib/abi"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"

export type ClassIdVerifyLogger = (level: "warn" | "debug", msg: string, ...rest: unknown[]) => void

/**
 * DI port for class-id verification. Production uses
 * `DefaultArtifactClassIdVerifier`. Tests inject fakes that bypass
 * Poseidon recompute (faster + works with fixture artifacts that
 * lack the structure needed by upstream `getContractClassFromArtifact`).
 */
export interface ArtifactClassIdVerifier {
	verify(artifact: ContractArtifact, expected: Fr, log?: ClassIdVerifyLogger): Promise<ContractArtifact | undefined>
}

/** Production implementation: delegates to the pure `verifyArtifactClassId` helper. */
export class DefaultArtifactClassIdVerifier implements ArtifactClassIdVerifier {
	public verify(artifact: ContractArtifact, expected: Fr, log?: ClassIdVerifyLogger): Promise<ContractArtifact | undefined> {
		return verifyArtifactClassId(artifact, expected, log)
	}
}

/**
 * Recompute artifact's class id and compare to `expected`. Returns
 * the artifact on match; returns `undefined` (with logging) on
 * mismatch or recompute failure.
 *
 * Computation cost: ~10-50ms per artifact (Poseidon hashing). For hot
 * paths, callers should pair this with a `Set<string>` cache keyed by
 * `expected.toString()` so a once-verified class-id isn't recomputed
 * on every lookup.
 */
export async function verifyArtifactClassId(
	artifact: ContractArtifact,
	expected: Fr,
	log?: ClassIdVerifyLogger,
): Promise<ContractArtifact | undefined> {
	try {
		const computed = await getContractClassFromArtifact(artifact)
		if (!computed.id.equals(expected)) {
			log?.("warn", "Artifact class id mismatch", {
				expected: expected.toString(),
				computed: computed.id.toString(),
			})
			return undefined
		}
		return artifact
	} catch (err) {
		log?.("warn", "Artifact class id recompute failed", err)
		return undefined
	}
}
