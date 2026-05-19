import { describe, test, expect, vi } from "vitest"
import { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact } from "@aztec/stdlib/abi"
import type { NetworkInfo } from "@nulo/aztec-runtime/pxe"
import { ArtifactRegistry, defaultPolicy } from "@nulo/aztec-runtime/pxe"
import type { ArtifactClassIdVerifier, KnownArtifactsLoader } from "@nulo/aztec-runtime/pxe"

const emptyLoader: KnownArtifactsLoader = async () => ({ artifacts: new Map(), instances: new Map() })

const makeArtifact = (name: string): ContractArtifact => ({ name }) as unknown as ContractArtifact

/**
 * Pass-through verifier for tests using fake artifacts that don't have
 * the structure needed by upstream `getContractClassFromArtifact`.
 * Treats any artifact as valid for any class id.
 *
 * Tests that exercise the verification path itself use
 * `makeMismatchVerifier()` or `makeRecordingVerifier()` below.
 */
const passthroughVerifier: ArtifactClassIdVerifier = {
	verify: async (artifact, _expected) => artifact,
}

/** Verifier that returns undefined for `mismatchClassIds` (simulating
 *  a class-id mismatch) and passes through otherwise. */
const makeMismatchVerifier = (mismatchClassIds: ReadonlySet<string>): ArtifactClassIdVerifier => ({
	verify: async (artifact: ContractArtifact, expected: Fr) => (mismatchClassIds.has(expected.toString()) ? undefined : artifact),
})

/** Verifier that records every (artifact, expected) call, then
 *  delegates to passthrough. Used to assert recompute + cache behavior. */
const makeRecordingVerifier = () => {
	const calls: Array<{ artifact: ContractArtifact; expected: string }> = []
	const verifier: ArtifactClassIdVerifier = {
		verify: async (artifact, expected) => {
			calls.push({ artifact, expected: expected.toString() })
			return artifact
		},
	}
	return { verifier, calls }
}

const makeNetwork = (chainId: number): NetworkInfo => ({ profileId: "p1", chainId, rpcUrl: "https://rpc" })

describe("ArtifactRegistry.resolve", () => {
	test("default order: pxe-local → known, first hit wins", async () => {
		const reg = new ArtifactRegistry(emptyLoader, { verifier: passthroughVerifier })
		const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-hit"))
		const classId = new Fr(42)
		const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))
		expect((got as { name: string }).name).toBe("pxe-hit")
		expect(pxeLookup).toHaveBeenCalledTimes(1)
	})

	test("pxeOnly=true skips known", async () => {
		const knownArtifact = makeArtifact("known-hit")
		const loader: KnownArtifactsLoader = async () => ({
			artifacts: new Map([[new Fr(1).toString(), knownArtifact]]),
			instances: new Map(),
		})
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		const pxeLookup = vi.fn().mockResolvedValue(undefined)
		const got = await reg.resolve(new Fr(1), pxeLookup, makeNetwork(1), { pxeOnly: true })
		// known has it, but pxeOnly forced the registry to skip the known branch.
		expect(got).toBeUndefined()
		expect(pxeLookup).toHaveBeenCalledTimes(1)
	})

	test("smart-tighten precondition: unknown class-id and pxe-miss → undefined", async () => {
		// This is the case `aztec_registerContract` relies on: when a
		// dApp doesn't pass an artifact and we can't resolve via PXE
		// or the bundled `known` set, resolution returns undefined and
		// the caller throws a tightening error.
		const reg = new ArtifactRegistry(emptyLoader, { verifier: passthroughVerifier })
		const pxeLookup = vi.fn().mockResolvedValue(undefined)
		const got = await reg.resolve(new Fr(99), pxeLookup, makeNetwork(1))
		expect(got).toBeUndefined()
		expect(pxeLookup).toHaveBeenCalledTimes(1)
	})

	test("known hit when pxe misses (bundled-standards bypass)", async () => {
		// Smart-tighten counterpart: bundled standards still resolve
		// without the dApp passing an artifact.
		const classId = new Fr(11)
		const knownArtifact = makeArtifact("known-hit")
		const loader: KnownArtifactsLoader = async () => ({
			artifacts: new Map([[classId.toString(), knownArtifact]]),
			instances: new Map(),
		})
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		const pxeLookup = vi.fn().mockResolvedValue(undefined)
		const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))
		expect(got).toBe(knownArtifact)
	})

	test("byClassId pin bypasses order", async () => {
		const classId = new Fr(7)
		const knownArtifact = makeArtifact("known-hit")
		const loader: KnownArtifactsLoader = async () => ({
			artifacts: new Map([[classId.toString(), knownArtifact]]),
			instances: new Map(),
		})
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		reg.setPolicy({
			...defaultPolicy(),
			byClassId: { [classId.toString()]: "known" },
		})
		const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-hit"))
		const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))
		// pxe-local would win normally, but pin forces known
		expect(got).toBe(knownArtifact)
		expect(pxeLookup).not.toHaveBeenCalled()
	})

	test("custom order is respected", async () => {
		const classId = new Fr(1)
		const knownArtifact = makeArtifact("from-known")
		const loader: KnownArtifactsLoader = async () => ({
			artifacts: new Map([[classId.toString(), knownArtifact]]),
			instances: new Map(),
		})
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		reg.setPolicy({ order: ["known", "pxe-local"] })
		const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("from-pxe"))
		const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))
		expect(got).toBe(knownArtifact)
		expect(pxeLookup).not.toHaveBeenCalled()
	})

	test("clear() resets known-init state so ensureKnown reloads", async () => {
		let loadCount = 0
		const loader = async () => {
			loadCount++
			return { artifacts: new Map(), instances: new Map() }
		}
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		await reg.ensureKnown()
		expect(loadCount).toBe(1)
		reg.clear()
		await reg.ensureKnown()
		expect(loadCount).toBe(2)
	})

	test("ensureKnown dedupes concurrent calls", async () => {
		let loadCount = 0
		const loader = async () => {
			loadCount++
			await new Promise((r) => setTimeout(r, 0))
			return { artifacts: new Map(), instances: new Map() }
		}
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		await Promise.all([reg.ensureKnown(), reg.ensureKnown(), reg.ensureKnown()])
		expect(loadCount).toBe(1)
	})

	test("getKnownInstance returns undefined until ensureKnown; populated after", async () => {
		const instance = { address: { toString: () => "0xabc" } } as unknown as import("@aztec/stdlib/contract").ContractInstanceWithAddress
		const loader = async () => ({
			artifacts: new Map(),
			instances: new Map([["0xabc", instance]]),
		})
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		expect(reg.getKnownInstance("0xabc")).toBeUndefined()
		await reg.ensureKnown()
		expect(reg.getKnownInstance("0xabc")).toBe(instance)
	})
})

describe("ArtifactRegistry.hasKnownClassId — smart-tighten support", () => {
	test("returns true for class-id in the bundle", async () => {
		const classId = new Fr(1234)
		const loader: KnownArtifactsLoader = async () => ({
			artifacts: new Map([[classId.toString(), makeArtifact("bundled")]]),
			instances: new Map(),
		})
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		expect(await reg.hasKnownClassId(classId)).toBe(true)
	})

	test("returns false for class-id not in the bundle", async () => {
		const known = new Fr(1)
		const unknown = new Fr(2)
		const loader: KnownArtifactsLoader = async () => ({
			artifacts: new Map([[known.toString(), makeArtifact("only-this")]]),
			instances: new Map(),
		})
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		expect(await reg.hasKnownClassId(unknown)).toBe(false)
		expect(await reg.hasKnownClassId(known)).toBe(true)
	})

	test("returns false on empty bundle", async () => {
		const reg = new ArtifactRegistry(emptyLoader, { verifier: passthroughVerifier })
		expect(await reg.hasKnownClassId(new Fr(99))).toBe(false)
	})

	test("triggers lazy load of the bundle on first call", async () => {
		let loadCount = 0
		const classId = new Fr(7)
		const loader: KnownArtifactsLoader = async () => {
			loadCount++
			return { artifacts: new Map([[classId.toString(), makeArtifact("v")]]), instances: new Map() }
		}
		const reg = new ArtifactRegistry(loader, { verifier: passthroughVerifier })
		expect(loadCount).toBe(0)
		expect(await reg.hasKnownClassId(classId)).toBe(true)
		expect(loadCount).toBe(1)
		// second call uses the cached bundle
		expect(await reg.hasKnownClassId(classId)).toBe(true)
		expect(loadCount).toBe(1)
	})
})

/**
 * Trust-enforcement contract: every artifact returned to the caller
 * has had its class id verified. Mismatches fall through to the next
 * source (or return undefined if no source matched).
 */
describe("ArtifactRegistry.resolve — class-id trust enforcement", () => {
	test("pxe-local mismatch → falls through to known (or undefined)", async () => {
		const classId = new Fr(99)
		const verifier = makeMismatchVerifier(new Set([classId.toString()]))
		const reg = new ArtifactRegistry(emptyLoader, { verifier })
		// pxe-local returns a tampered artifact; verifier rejects.
		const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-tampered"))

		const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))

		// pxe-local mismatch → fall through to known (no entry) → undefined.
		expect(got).toBeUndefined()
	})

	test("pxeOnly + mismatched pxe-local → undefined (no fall-through)", async () => {
		const classId = new Fr(7)
		const verifier = makeMismatchVerifier(new Set([classId.toString()]))
		const reg = new ArtifactRegistry(emptyLoader, { verifier })
		const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-tampered"))

		const got = await reg.resolve(classId, pxeLookup, makeNetwork(1), { pxeOnly: true })

		expect(got).toBeUndefined()
	})

	test("verifier cache: repeat resolve of same classId does NOT recompute", async () => {
		const classId = new Fr(123)
		const { verifier, calls } = makeRecordingVerifier()
		const reg = new ArtifactRegistry(emptyLoader, { verifier })
		const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-hit"))

		const first = await reg.resolve(classId, pxeLookup, makeNetwork(1))
		const second = await reg.resolve(classId, pxeLookup, makeNetwork(1))

		expect((first as { name: string }).name).toBe("pxe-hit")
		expect((second as { name: string }).name).toBe("pxe-hit")
		// Verifier called exactly once — second resolve hit the
		// `verifiedClassIds` cache.
		expect(calls).toHaveLength(1)
		expect(calls[0].expected).toBe(classId.toString())
	})

	test("clear() empties verifiedClassIds cache", async () => {
		const classId = new Fr(45)
		const { verifier, calls } = makeRecordingVerifier()
		const reg = new ArtifactRegistry(emptyLoader, { verifier })
		const pxeLookup = vi.fn().mockResolvedValue(makeArtifact("pxe-hit"))

		await reg.resolve(classId, pxeLookup, makeNetwork(1))
		expect(calls).toHaveLength(1)

		reg.clear()
		await reg.resolve(classId, pxeLookup, makeNetwork(1))
		// Cache cleared → verifier called again.
		expect(calls).toHaveLength(2)
	})

	test("known branch does NOT recompute (already keyed by load-time class id)", async () => {
		const classId = new Fr(11)
		const knownArtifact = makeArtifact("known-hit")
		const loader: KnownArtifactsLoader = async () => ({
			artifacts: new Map([[classId.toString(), knownArtifact]]),
			instances: new Map(),
		})
		const { verifier, calls } = makeRecordingVerifier()
		const reg = new ArtifactRegistry(loader, { verifier })
		const pxeLookup = vi.fn().mockResolvedValue(undefined)

		const got = await reg.resolve(classId, pxeLookup, makeNetwork(1))

		expect(got).toBe(knownArtifact)
		// Known branch returned the artifact WITHOUT calling the
		// verifier — the load-time `loadProductionKnownArtifacts` step
		// already keyed by class-id-from-Poseidon, so the
		// `Map.get(classId.toString())` lookup is itself the equality
		// check. Recomputing would be hash twice.
		expect(calls).toHaveLength(0)
	})
})
