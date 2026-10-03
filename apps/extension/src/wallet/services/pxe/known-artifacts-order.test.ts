/**
 * Pins the compiled-in artifact catalog's resolution order and which artifact each key loads,
 * through the real aztec-runtime modules (only this tree resolves the vite-only artifact
 * aliases). The class-id hasher and the instance derivation are mocked: real bb.js faults under
 * repeated unit-test calls.
 */
import { beforeEach, expect, test, vi } from "vitest"

const seen = vi.hoisted(() => ({ hashed: [] as unknown[], instanceFrom: [] as unknown[] }))
vi.mock("@aztec-labs/stdlib/contract", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getContractClassFromArtifact: async (artifact: unknown) => {
		seen.hashed.push(artifact)
		return { id: { toString: () => `0xclass:${seen.hashed.length}` } }
	},
	getContractInstanceFromInstantiationParams: async (artifact: unknown) => {
		seen.instanceFrom.push(artifact)
		return { address: { toString: () => "0xsponsored" } }
	},
}))

import { loadContractArtifact } from "@aztec-labs/stdlib/abi"
import { AuthRegistryArtifact } from "@aztec-labs/standard-contracts/auth-registry"
import { MultiCallEntrypointArtifact } from "@aztec-labs/standard-contracts/multi-call-entrypoint"
import { PublicChecksArtifact } from "@aztec-labs/standard-contracts/public-checks"
import { ContractClassRegistryArtifact } from "@aztec-labs/protocol-contracts/class-registry"
import { FeeJuiceArtifact } from "@aztec-labs/protocol-contracts/fee-juice"
import { ContractInstanceRegistryArtifact } from "@aztec-labs/protocol-contracts/instance-registry"
import { FPCContractArtifact } from "@aztec-labs/noir-contracts.js/FPC"
import { NFTContractArtifact } from "@aztec-labs/noir-contracts.js/NFT"
import { SponsoredFPCContractArtifact } from "@aztec-labs/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@aztec-labs/noir-contracts.js/Token"
// @ts-expect-error — vite alias
import WonderlandTokenJson from "@wonderland-token-artifact"
// @ts-expect-error — vite alias
import PrivateFPCJson from "@private-fpc-artifact"
import { _resetNoteSchemasForTests, loadProductionKnownArtifacts } from "@nulo/aztec-runtime/pxe"

beforeEach(() => {
	_resetNoteSchemasForTests()
	seen.hashed.length = 0
	seen.instanceFrom.length = 0
})

test("the twelve keys resolve in catalog order, each to its own artifact, and SponsoredFPC derives the instance", async () => {
	const { artifacts, instances } = await loadProductionKnownArtifacts()

	const imported = [
		AuthRegistryArtifact,
		ContractClassRegistryArtifact,
		FeeJuiceArtifact,
		ContractInstanceRegistryArtifact,
		MultiCallEntrypointArtifact,
		PublicChecksArtifact,
		FPCContractArtifact,
		NFTContractArtifact,
		SponsoredFPCContractArtifact,
		TokenContractArtifact,
	]
	expect(seen.hashed).toHaveLength(12)
	for (const [i, artifact] of imported.entries()) expect(seen.hashed[i]).toBe(artifact)
	// Freshly parsed per load, so compared by what identifies them, not by object identity.
	const identify = (a: unknown) => {
		const { name, functions } = a as { name: string; functions: { name: string }[] }
		return { name, functions: functions.map((f) => f.name) }
	}
	expect(identify(seen.hashed[10])).toEqual(identify(loadContractArtifact(WonderlandTokenJson)))
	expect(identify(seen.hashed[11])).toEqual(identify(loadContractArtifact(PrivateFPCJson)))
	expect(identify(seen.hashed[10])).not.toEqual(identify(seen.hashed[11]))

	expect([...artifacts.keys()]).toEqual(Array.from({ length: 12 }, (_, i) => `0xclass:${i + 1}`))
	for (const [i, artifact] of [...artifacts.values()].entries()) expect(artifact).toBe(seen.hashed[i])

	expect(seen.instanceFrom).toHaveLength(1)
	expect(seen.instanceFrom[0]).toBe(SponsoredFPCContractArtifact)
	expect([...instances.keys()]).toEqual(["0xsponsored"])
}, 60_000)
