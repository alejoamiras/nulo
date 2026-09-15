// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("./known-artifacts", () => ({
	loadProductionKnownArtifacts: async () => ({ artifacts: new Map(), instances: new Map() }),
}))
vi.mock("./note-schemas", () => ({
	loadProductionNoteSchemas: async () => new Map<string, unknown>(),
}))

import { Fr } from "@aztec/foundation/curves/bn254"
import { jsonStringify } from "@aztec/foundation/json-rpc"
import type { PXE } from "@aztec/pxe/client/bundle"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import type { ILogger } from "@nulo/wallet-core/logger"
import { FrozenSchnorrAccountArtifact } from "../account/frozen-artifact"
import { NuloAccount } from "../account/nulo-account"
import { ChainRuntime, type NetworkInfo, type PxeFactory } from "./chain-runtime"
import { type IProfileReader, PxeService } from "./service"

const noopLogger: ILogger = { log: () => {} }
const noopProfiles: IProfileReader = {
	connect: async () => {},
	getProfiles: async () => [],
	onProfileDeleted: { add: () => {} },
	onActiveProfileChanged: { add: () => {} },
}
const network: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://localhost:8080" }
const seed = Fr.fromHexString("0x0000000000000000000000000000000000000000000000000000000000000002")

function makeHarness() {
	const writes: string[] = []
	const factory: PxeFactory = {
		createChainRuntime: async (n) => {
			const pxe = {
				registerContractClass: async () => {
					writes.push("registerContractClass")
				},
				registerContract: async (instance: ContractInstanceWithAddress) => {
					writes.push("registerContract")
					return instance.address
				},
			} as unknown as PXE
			return new ChainRuntime(n.chainId, {} as never, pxe, n.rpcUrl)
		},
	}
	const service = new PxeService(noopProfiles, noopLogger, factory)
	;(service as unknown as { initialized: boolean }).initialized = true
	return { service, writes }
}

/** The service parses the RPC wire form (hex strings), so serialize the real instance first. */
async function genuineInstance(): Promise<Record<string, unknown>> {
	const account = await NuloAccount.new(seed, noopLogger)
	const instance = (account as unknown as { instance: ContractInstanceWithAddress }).instance
	return JSON.parse(jsonStringify(instance))
}
/** Same wire-form requirement for the artifact. */
const WIRE_ARTIFACT = JSON.parse(jsonStringify(FrozenSchnorrAccountArtifact))
const OTHER_ADDRESS = "0x000000000000000000000000000000000000000000000000000000000000ab12"

describe("PxeService.registerContract derives the address before writing", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", { runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} } })
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test("a genuine preimage/address pair registers the class, then the instance", async () => {
		const { service, writes } = makeHarness()
		await service.registerContract(network, { instance: (await genuineInstance()) as never, artifact: WIRE_ARTIFACT })
		expect(writes).toEqual(["registerContractClass", "registerContract"])
	})

	test("an address that does not derive from the preimage is rejected with NO write", async () => {
		const { service, writes } = makeHarness()
		const instance = await genuineInstance()
		const tampered = { ...instance, address: OTHER_ADDRESS }
		await expect(service.registerContract(network, { instance: tampered as never, artifact: WIRE_ARTIFACT })).rejects.toThrow(
			/registerContract address mismatch/,
		)
		expect(writes).toEqual([])
	})

	test("a tampered preimage field under the genuine address is rejected with NO write", async () => {
		const { service, writes } = makeHarness()
		const instance = await genuineInstance()
		const tampered = { ...instance, salt: new Fr(7n).toString() }
		await expect(service.registerContract(network, { instance: tampered as never })).rejects.toThrow(
			/registerContract address mismatch/,
		)
		expect(writes).toEqual([])
	})
})
