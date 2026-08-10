/**
 * Pin for the stub-account override mechanics of `PxeService.simulateTx`.
 *
 * The override map must reach upstream PXE under the `contracts` key of a
 * `SimulationOverrides`, with each entry keeping the account's REAL instance
 * and only `currentContractClassId` swapped to the registered stub class —
 * the upstream simulator resolves function artifacts from the CLASS STORE by
 * that id and serves the instance verbatim (`AnchoredContractData`). The
 * historical shape (entries spread at the constructor's top level, random-salt
 * stub instance, artifact field upstream ignores) silently produced
 * `overrides.contracts === undefined`, so discovery ran unstubbed — proven
 * live against testnet on an authwit-requiring op (single-sim-estimates B1).
 */

import { beforeEach, afterEach, describe, expect, test, vi } from "vitest"

vi.mock("./known-artifacts", () => ({
	loadProductionKnownArtifacts: async () => ({ artifacts: new Map(), instances: new Map() }),
}))
vi.mock("./note-schemas", () => ({
	loadProductionNoteSchemas: async () => new Map<string, unknown>(),
}))

import { StubSchnorrAccountContractArtifact } from "@aztec/accounts/schnorr/stub"
import { jsonStringify } from "@aztec/foundation/json-rpc"
import type { PXE } from "@aztec/pxe/client/bundle"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import { TxExecutionRequest } from "@aztec/stdlib/tx"
import type { ILogger } from "@nulo/wallet-core/logger"
import { ChainRuntime, type NetworkInfo, type PxeFactory } from "./chain-runtime"
import { PxeService, type IProfileReader } from "./service"

const noopLogger: ILogger = { log: () => {} }
const noopProfiles: IProfileReader = {
	connect: async () => {},
	getProfiles: async () => [],
	onProfileDeleted: { add: () => {} },
	onActiveProfileChanged: { add: () => {} },
}
const network: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://localhost:8080" }

const accountHex = "0x000000000000000000000000000000000000000000000000000000000000ab12"

// A minimal instance shape as upstream `getContractInstance` returns it. The
// service must pass every field through untouched except the class id.
const realInstance = {
	version: 1,
	salt: "0x01",
	deployer: "0x02",
	currentContractClassId: { toString: () => "0xoriginal" },
	originalContractClassId: { toString: () => "0xoriginal" },
	initializationHash: "0x03",
	publicKeys: "0x04",
	address: accountHex,
}

function makeHarness(opts?: { instanceMissing?: boolean }) {
	const registered: unknown[] = []
	const simulateCalls: { opts: Record<string, unknown> }[] = []
	const factory: PxeFactory = {
		createChainRuntime: async (n) => {
			const pxe = {
				registerContractClass: async (artifact: unknown) => {
					registered.push(artifact)
				},
				getContractInstance: async () => (opts?.instanceMissing ? undefined : realInstance),
				simulateTx: async (_req: unknown, simOpts: Record<string, unknown>) => {
					simulateCalls.push({ opts: simOpts })
					return { marker: "sim-result" }
				},
			} as unknown as PXE
			return new ChainRuntime(n.chainId, {} as never, pxe, n.rpcUrl)
		},
	}
	const service = new PxeService(noopProfiles, noopLogger, factory)
	;(service as unknown as { initialized: boolean }).initialized = true
	return { service, registered, simulateCalls }
}

describe("PxeService.simulateTx stub-account overrides", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", {
			runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {} },
		})
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test("registers the stub class and swaps ONLY currentContractClassId on the real instance, under the contracts key", async () => {
		const { service, registered, simulateCalls } = makeHarness()
		const txRequest = JSON.parse(jsonStringify(await TxExecutionRequest.random()))

		await service.simulateTx(
			network,
			txRequest,
			{ simulatePublic: true, skipTxValidation: true, skipFeeEnforcement: true, scopes: [accountHex] },
			[accountHex],
		)

		expect(registered).toEqual([StubSchnorrAccountContractArtifact])
		expect(simulateCalls).toHaveLength(1)
		const simOpts = simulateCalls[0]!.opts

		// The map must be under `contracts` — the top-level-spread shape made
		// upstream see no overrides at all.
		const overrides = simOpts.overrides as { contracts?: Record<string, { instance: Record<string, unknown> }> }
		expect(overrides?.contracts).toBeDefined()
		const entry = overrides.contracts?.[accountHex]
		expect(entry).toBeDefined()

		const { id: stubClassId } = await getContractClassFromArtifact(StubSchnorrAccountContractArtifact)
		expect(String(entry?.instance.currentContractClassId)).toBe(stubClassId.toString())
		// Every other field of the REAL instance rides through untouched.
		expect(entry?.instance.address).toBe(realInstance.address)
		expect(entry?.instance.initializationHash).toBe(realInstance.initializationHash)
		expect(entry?.instance.originalContractClassId).toBe(realInstance.originalContractClassId)
		expect(entry?.instance.salt).toBe(realInstance.salt)

		// Overrides force kernelless simulation explicitly.
		expect(simOpts.skipKernels).toBe(true)
		expect(simOpts.skipTxValidation).toBe(true)
	})

	test("no stub addresses: no registration, no overrides, no skipKernels", async () => {
		const { service, registered, simulateCalls } = makeHarness()
		const txRequest = JSON.parse(jsonStringify(await TxExecutionRequest.random()))

		await service.simulateTx(network, txRequest, { simulatePublic: true, skipFeeEnforcement: true, scopes: [accountHex] })

		expect(registered).toEqual([])
		expect(simulateCalls[0]!.opts.overrides).toBeUndefined()
		expect(simulateCalls[0]!.opts.skipKernels).toBeUndefined()
	})

	test("unknown account instance fails loudly instead of simulating unstubbed", async () => {
		const { service, simulateCalls } = makeHarness({ instanceMissing: true })
		const txRequest = JSON.parse(jsonStringify(await TxExecutionRequest.random()))

		await expect(
			service.simulateTx(network, txRequest, { simulatePublic: true, skipFeeEnforcement: true, scopes: [accountHex] }, [accountHex]),
		).rejects.toThrow(/no contract instance registered/)
		expect(simulateCalls).toHaveLength(0)
	})
})
