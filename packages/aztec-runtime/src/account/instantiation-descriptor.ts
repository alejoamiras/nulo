/**
 * Frozen instantiation descriptor for the Nulo account.
 *
 * Everything Nulo contributes to address derivation besides the artifact and the key material —
 * constructor name, constructor-args marshalling, salt, immutablesHash, deployer — lives here as
 * explicit frozen VALUES, consumed by BOTH call sites: `NuloAccount.new`'s
 * `getContractInstanceFromInstantiationParams` input and the first-tx constructor call built in
 * `buildWithInitialization`. One source kills the address/execution split-brain, and no upstream
 * default (ctor name + args from class code, `immutablesHash` via undefined→`Fr.ZERO`, `deployer`
 * via a hidden `AztecAddress.ZERO`) can silently rotate derived addresses on a bump.
 *
 * Values only, no algorithms: selector/hash computation and all crypto stay upstream
 * (KAT-tripwired by `derivation-vectors.test.ts`).
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import type { Point } from "@aztec/foundation/curves/grumpkin"
import { FunctionCall, FunctionSelector, type ContractArtifact } from "@aztec/stdlib/abi"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import { AztecAddress as AztecAddressClass } from "@aztec/stdlib/aztec-address"

export const NULO_DESCRIPTOR_VERSION = 1

export const FROZEN_INSTANTIATION_DESCRIPTOR = {
	version: NULO_DESCRIPTOR_VERSION,
	constructorName: "constructor",
	salt: Fr.ZERO,
	immutablesHash: Fr.ZERO,
	deployer: AztecAddressClass.ZERO,
} as const

/** Constructor args for the frozen initializer: the Schnorr signing public key coordinates. */
export function frozenConstructorArgs(signingPublicKey: Point): Fr[] {
	return [signingPublicKey.x, signingPublicKey.y]
}

/**
 * Canonical serialization the descriptor digest pins (the args builder is represented by the
 * symbolic shape of what it marshals). Feeds the regime record; recomputed by the paired test.
 *
 * IMPORTANT: this digest is SYMBOLIC w.r.t. constructor-arg MARSHALLING — it hashes the string
 * `["signingPublicKey.x", "signingPublicKey.y"]`, not the `frozenConstructorArgs` implementation.
 * A tamper swapping the order to `[y, x]` would keep this digest (and the class-id + artifact
 * digests) green while rotating every derived address. The actual arg-marshalling pin is the
 * external-reference KAT (`derivation-vectors.test.ts`), whose addresses come from upstream's own
 * oracle and run in CI via `test:all` — NEVER skip/remove it. The paired
 * `instantiation-descriptor.test.ts` init-hash check does NOT catch an args tamper (both sides use
 * the same tampered builder), so the KAT is the load-bearing control here.
 */
export function canonicalDescriptorContent(): string {
	return JSON.stringify({
		version: FROZEN_INSTANTIATION_DESCRIPTOR.version,
		constructorName: FROZEN_INSTANTIATION_DESCRIPTOR.constructorName,
		constructorArgs: ["signingPublicKey.x", "signingPublicKey.y"],
		salt: FROZEN_INSTANTIATION_DESCRIPTOR.salt.toString(),
		immutablesHash: FROZEN_INSTANTIATION_DESCRIPTOR.immutablesHash.toString(),
		deployer: FROZEN_INSTANTIATION_DESCRIPTOR.deployer.toString(),
	})
}

/** sha256 hex of `canonicalDescriptorContent()`; pinned in `instantiation-descriptor.test.ts`. */
export const FROZEN_DESCRIPTOR_DIGEST = "3883065f0d6603d1be25db42348ec25b7a9dc29746d85b925b09efbd2a460605"

/**
 * The first-tx constructor call, built exclusively from the descriptor + the frozen artifact's
 * ABI entry for the descriptor's constructor name (no fuzzy fallback: the frozen name must exist).
 */
export async function buildFrozenConstructorCall(
	artifact: ContractArtifact,
	address: AztecAddress,
	signingPublicKey: Point,
): Promise<FunctionCall> {
	const ctorFn = artifact.functions.find((f) => f.name === FROZEN_INSTANTIATION_DESCRIPTOR.constructorName)
	if (!ctorFn) {
		throw new Error(`frozen constructor "${FROZEN_INSTANTIATION_DESCRIPTOR.constructorName}" not found in account artifact`)
	}
	const selector = await FunctionSelector.fromNameAndParameters(ctorFn.name, ctorFn.parameters)
	return new FunctionCall(
		ctorFn.name,
		address,
		selector,
		ctorFn.functionType,
		false,
		ctorFn.isStatic,
		frozenConstructorArgs(signingPublicKey),
		ctorFn.returnTypes,
	)
}
