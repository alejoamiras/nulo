/**
 * Pins 5.0.1 wallet-sdk conformance of `aztec_registerContract`: upstream
 * `WalletSchema` declares `registerContract(): Promise<void>` and the dApp-side
 * proxy validates the response with `z.void()`, so the wallet MUST resolve
 * `undefined`. Returning the registered instance (the pre-5.0.1 shape) makes
 * every wallet-sdk dApp call reject with a ZodError AFTER a successful
 * wallet-side registration — caught live on the faucet connect flow, where
 * `registerAllContracts` failed the whole capability handshake.
 *
 * The unit layer is bb-free, so the stdlib schema/class-id computations (which
 * hit real Poseidon via bb.js) are mocked at the module boundary; the full
 * real-schema path is pinned end-to-end by
 * `tests/e2e/network/contracts-register.test.ts` (strict "ok" through the real
 * wallet-sdk client). Service construction uses the private-field-injection
 * pattern from the characterization suite.
 */
import { describe, expect, test, vi } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"

vi.mock("@aztec/stdlib/contract", async (importOriginal) => {
	const original = await importOriginal<Record<string, unknown>>()
	return {
		...original,
		ContractInstanceWithAddressSchema: {
			parseAsync: async (x: unknown) => x,
			optional: () => ({ parseAsync: async (x: unknown) => x }),
		},
		getContractClassFromArtifact: async () => ({ id: { toString: () => "0xclass" } }),
		computePartialAddress: async () => ({ toString: () => "0xpartial" }),
	}
})

import { ExecutionService } from "./service"

const NETWORK = {
	id: "net1",
	chainId: 1,
	primaryEndpointId: "ep1",
	endpoints: [{ id: "ep1", rpcUrl: "http://fake" }],
}

function fakeInstance(addressBigInt: bigint) {
	return {
		address: { toBigInt: () => addressBigInt },
		currentContractClassId: { toString: () => "0xclass" },
	}
}

function makeService(pxe: Record<string, unknown>) {
	const service = new ExecutionService(new LoggerStore(new ConfigStore()))
	const internals = service as unknown as {
		networkService: unknown
		pxeService: unknown
		executeAztecRegisterContract(op: unknown): Promise<unknown>
	}
	internals.networkService = { getNetwork: async () => NETWORK }
	internals.pxeService = pxe
	return internals
}

describe("aztec_registerContract resolves void (5.0.1 WalletSchema conformance)", () => {
	test("protocol-address instance short-circuits AND resolves undefined", async () => {
		const registerContract = vi.fn(async () => {})
		const service = makeService({ registerContract })

		const result = await service.executeAztecRegisterContract({
			kind: "aztec_registerContract",
			networkId: NETWORK.id,
			instance: fakeInstance(3n),
		})

		expect(result).toBeUndefined()
		expect(registerContract).not.toHaveBeenCalled()
	})

	test("full registration path registers with PXE AND resolves undefined", async () => {
		const registerContract = vi.fn(async () => {})
		// The fake artifact fails the real ContractArtifactSchema parse (by design —
		// that schema is not mocked), so the path exercises the PXE artifact-lookup
		// fallback; what matters here is the resolved value at the RPC boundary.
		const getContractArtifact = vi.fn(async () => ({ name: "Fake" }))
		const service = makeService({ registerContract, getContractArtifact })

		const result = await service.executeAztecRegisterContract({
			kind: "aztec_registerContract",
			networkId: NETWORK.id,
			instance: fakeInstance(0x1234n),
			artifact: { name: "Fake" },
		})

		expect(result).toBeUndefined()
		expect(registerContract).toHaveBeenCalledTimes(1)
	})
})
