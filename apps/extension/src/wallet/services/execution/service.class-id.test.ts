/**
 * Both contract registrations recompute the artifact's class id and refuse a mismatch before
 * anything is registered. The recompute is real Poseidon (bb.js), so it is mocked at the module
 * boundary, as in `register-contract-void-conformance.test.ts`; the ids are `toString`-only fakes,
 * which also pins that the comparison is by string.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"

const stdlib = vi.hoisted(() => ({
	recompute: vi.fn(async (_artifact: unknown): Promise<unknown> => ({ id: { toString: () => "0xclass" } })),
	computeAddress: vi.fn(async (_instance: unknown): Promise<unknown> => undefined),
}))

vi.mock("@aztec-labs/stdlib/contract", async (importOriginal) => {
	const original = await importOriginal<Record<string, unknown>>()
	return {
		...original,
		ContractInstanceWithAddressSchema: {
			parseAsync: async (x: unknown) => x,
			optional: () => ({ parseAsync: async (x: unknown) => x }),
		},
		getContractClassFromArtifact: stdlib.recompute,
		computeContractAddressFromInstance: stdlib.computeAddress,
		computePartialAddress: async () => ({ toString: () => "0xpartial" }),
	}
})

import { ExecutionService } from "./service"

const ADDRESS = `0x${"0".repeat(60)}1234`
const NETWORK = { id: "net1", profileId: "p1", chainId: 1, primaryEndpointId: "ep1", endpoints: [{ id: "ep1", rpcUrl: "http://fake" }] }
const MISMATCH = "Contract artifact doesn't match instance's current class id"
const ARTIFACT = { name: "Looked-up" }

const instance = () => ({
	address: { toBigInt: () => 0x1234n, toString: () => ADDRESS },
	currentContractClassId: { toString: () => "0xclass" },
})

function makeService() {
	const pxe = {
		registerContract: vi.fn(async () => {}),
		registerAccount: vi.fn(async () => {}),
		// No artifact is passed in, so both paths take the looked-up one, and recompute it.
		getContractArtifact: vi.fn(async () => ARTIFACT),
		getContractInstance: vi.fn(async () => instance()),
	}
	const service = new ExecutionService(new LoggerStore(new ConfigStore()))
	const internals = service as unknown as {
		networkService: unknown
		pxeService: unknown
		executeRegisterContract(op: unknown): Promise<unknown>
		executeAztecRegisterContract(op: unknown): Promise<unknown>
	}
	internals.networkService = { getNetwork: async () => NETWORK }
	internals.pxeService = pxe
	return { internals, pxe }
}

// The smallest artifact the real `ContractArtifactSchema` accepts.
const SUPPLIED = {
	name: "Fixture",
	functions: [],
	nonDispatchPublicFunctions: [],
	outputs: { structs: {}, globals: {} },
	storageLayout: {},
	fileMap: {},
}

const SITES = [
	{
		site: "registerContract (C1)",
		accountsRegistered: 0,
		run: (s: ReturnType<typeof makeService>["internals"], artifact?: unknown) =>
			s.executeRegisterContract({
				kind: "register_contract",
				networkId: NETWORK.id,
				address: ADDRESS,
				instance: instance(),
				artifact,
			}),
	},
	{
		site: "aztec_registerContract (C2)",
		accountsRegistered: 1,
		run: (s: ReturnType<typeof makeService>["internals"], artifact?: unknown) =>
			s.executeAztecRegisterContract({
				kind: "aztec_registerContract",
				networkId: NETWORK.id,
				instance: instance(),
				artifact,
				secretKey: "0x05",
			}),
	},
]

async function rejectionOf(run: Promise<unknown>): Promise<unknown> {
	try {
		await run
	} catch (error) {
		return error
	}
	throw new Error("expected a rejection")
}

beforeEach(() => {
	stdlib.recompute.mockReset()
	stdlib.recompute.mockImplementation(async () => ({ id: { toString: () => "0xclass" } }))
	stdlib.computeAddress.mockReset()
	stdlib.computeAddress.mockImplementation(async () => ({ toString: () => ADDRESS }))
})

describe.each(SITES)("$site: the artifact must hash to the instance's class id", ({ run, accountsRegistered }) => {
	test("a distinct id object with the same string matches: the looked-up artifact is recomputed, then registered once", async () => {
		const { internals, pxe } = makeService()
		await run(internals)
		expect(stdlib.recompute).toHaveBeenCalledWith(ARTIFACT)
		expect(pxe.registerContract).toHaveBeenCalledTimes(1)
		expect(pxe.registerAccount).toHaveBeenCalledTimes(accountsRegistered)
	})

	test("a mismatch is refused with the plain Error and its exact text, before anything is registered", async () => {
		stdlib.recompute.mockImplementation(async () => ({ id: { toString: () => "0xother" } }))
		const { internals, pxe } = makeService()
		const refused = (await rejectionOf(run(internals))) as Error
		expect(refused.constructor).toBe(Error)
		expect(refused.message).toBe(MISMATCH)
		expect(pxe.registerContract).not.toHaveBeenCalled()
		expect(pxe.registerAccount).not.toHaveBeenCalled()
		expect(stdlib.computeAddress).not.toHaveBeenCalled()
	})

	test("a supplied artifact that mismatches is refused without a lookup, before anything is registered", async () => {
		stdlib.recompute.mockImplementation(async () => ({ id: { toString: () => "0xother" } }))
		const { internals, pxe } = makeService()
		const refused = (await rejectionOf(run(internals, SUPPLIED))) as Error
		expect(refused.message).toBe(MISMATCH)
		expect(stdlib.recompute).toHaveBeenCalledWith(expect.objectContaining({ name: "Fixture" }))
		expect(pxe.getContractArtifact).not.toHaveBeenCalled()
		expect(pxe.registerContract).not.toHaveBeenCalled()
		expect(pxe.registerAccount).not.toHaveBeenCalled()
	})

	test("a recompute failure propagates as the same error, never as a mismatch, and registers nothing", async () => {
		const failure = new Error("artifact cannot be hashed")
		stdlib.recompute.mockImplementation(async () => {
			throw failure
		})
		const { internals, pxe } = makeService()
		expect(await rejectionOf(run(internals))).toBe(failure)
		expect(pxe.registerContract).not.toHaveBeenCalled()
		expect(pxe.registerAccount).not.toHaveBeenCalled()
	})
})
