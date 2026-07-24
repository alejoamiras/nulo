import { createHash } from "node:crypto"
import { Fr } from "@aztec/foundation/curves/bn254"
import { encodeArguments } from "@aztec/stdlib/abi"
import { FunctionSelector } from "@aztec/stdlib/abi"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import { computeInitializationHashFromEncodedArgs } from "@aztec/stdlib/contract"
import type { ILogger } from "@nulo/wallet-core/logger"
import { describe, expect, test } from "vitest"
import { FrozenSchnorrAccountArtifact } from "./frozen-artifact"
import {
	FROZEN_DESCRIPTOR_DIGEST,
	FROZEN_INSTANTIATION_DESCRIPTOR,
	buildFrozenConstructorCall,
	canonicalDescriptorContent,
	frozenConstructorArgs,
} from "./instantiation-descriptor"
import { NuloAccount } from "./nulo-account"

const nullLogger: ILogger = { log: () => {} }
const seed = Fr.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000001")

/** The account's private instance, read for consistency assertions only. */
function instanceOf(account: NuloAccount): ContractInstanceWithAddress {
	return (account as unknown as { instance: ContractInstanceWithAddress }).instance
}

describe("frozen instantiation descriptor", () => {
	test("descriptor content digest matches FROZEN_DESCRIPTOR_DIGEST", () => {
		const digest = createHash("sha256").update(canonicalDescriptorContent()).digest("hex")
		expect(digest).toBe(FROZEN_DESCRIPTOR_DIGEST)
	})

	test("descriptor pins the exact frozen values", () => {
		expect(FROZEN_INSTANTIATION_DESCRIPTOR.version).toBe(1)
		expect(FROZEN_INSTANTIATION_DESCRIPTOR.constructorName).toBe("constructor")
		expect(FROZEN_INSTANTIATION_DESCRIPTOR.salt.isZero()).toBe(true)
		expect(FROZEN_INSTANTIATION_DESCRIPTOR.immutablesHash.isZero()).toBe(true)
		expect(FROZEN_INSTANTIATION_DESCRIPTOR.deployer.isZero()).toBe(true)
	})

	test("derived instance carries every fixed descriptor field", async () => {
		const account = await NuloAccount.new(seed, nullLogger)
		const instance = instanceOf(account)
		expect(instance.salt.equals(FROZEN_INSTANTIATION_DESCRIPTOR.salt)).toBe(true)
		expect(instance.deployer.equals(FROZEN_INSTANTIATION_DESCRIPTOR.deployer)).toBe(true)
		expect(instance.immutablesHash.equals(FROZEN_INSTANTIATION_DESCRIPTOR.immutablesHash)).toBe(true)
	})

	test("emitted ctor call reproduces the initialization hash the address derivation used", async () => {
		const account = await NuloAccount.new(seed, nullLogger)
		const instance = instanceOf(account)
		const { signingKey } = await import("@nulo/wallet-crypto").then((m) => m.deriveNuloAccountKeys(seed))
		const { Schnorr } = await import("@aztec/foundation/crypto/schnorr")
		const signingPublicKey = await new Schnorr().computePublicKey(signingKey)

		const ctorCall = await buildFrozenConstructorCall(FrozenSchnorrAccountArtifact, account.address, signingPublicKey)

		// The executed call uses the descriptor's frozen name + arg marshalling.
		expect(ctorCall.name).toBe(FROZEN_INSTANTIATION_DESCRIPTOR.constructorName)
		expect(ctorCall.to.equals(account.address)).toBe(true)
		expect(ctorCall.args).toEqual(frozenConstructorArgs(signingPublicKey))

		// Its selector matches the frozen artifact's ABI entry for that name.
		const ctorFn = FrozenSchnorrAccountArtifact.functions.find((f) => f.name === FROZEN_INSTANTIATION_DESCRIPTOR.constructorName)
		expect(ctorFn).toBeDefined()
		if (!ctorFn) throw new Error("unreachable")
		const expectedSelector = await FunctionSelector.fromNameAndParameters(ctorFn.name, ctorFn.parameters)
		expect(ctorCall.selector.equals(expectedSelector)).toBe(true)

		// Selector + args of the EMITTED call hash to the instance's initializationHash — the
		// executed constructor and the address commitment are the same initialization.
		const encodedArgs = encodeArguments(ctorFn, ctorCall.args)
		const initHash = await computeInitializationHashFromEncodedArgs(ctorCall.selector, encodedArgs)
		expect(initHash.equals(instance.initializationHash)).toBe(true)
	})

	test("frozen constructor name missing from the artifact is a hard error, no fuzzy fallback", async () => {
		const gutted = {
			...FrozenSchnorrAccountArtifact,
			functions: FrozenSchnorrAccountArtifact.functions.filter((f) => f.name !== "constructor"),
		}
		const account = await NuloAccount.new(seed, nullLogger)
		const { Schnorr } = await import("@aztec/foundation/crypto/schnorr")
		const { signingKey } = await import("@nulo/wallet-crypto").then((m) => m.deriveNuloAccountKeys(seed))
		const signingPublicKey = await new Schnorr().computePublicKey(signingKey)
		await expect(buildFrozenConstructorCall(gutted, account.address, signingPublicKey)).rejects.toThrow(
			/frozen constructor "constructor" not found/,
		)
	})
})
