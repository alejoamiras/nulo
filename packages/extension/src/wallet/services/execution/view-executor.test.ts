/**
 * `ViewExecutor` — facade-parity pins for the transplanted read-only
 * dApp RPC family. Fast-path internals are pinned in `fast-path.test.ts`
 * and resolver behavior in `contract-resolver.test.ts`; these tests pin
 * the executor's routing and the security-relevant call shapes:
 *
 *   - the stub-account msgSender pin on the standard simulate path
 *     (real signing keys never enter PXE during dApp simulateTx)
 *   - the chain-identity rebind on getChainInfo (V-01)
 *   - fast-path → standard fallback routing (split null / result null)
 *   - the PXE-local-vs-best-effort metadata ladder
 */

import { describe, expect, test, vi } from "vitest"
import { ContractInitializationStatus } from "@aztec/aztec.js/wallet"
import { ViewExecutor, type ViewExecutorDeps } from "./view-executor"

const assertLiveChainIdentityMock = vi.hoisted(() => vi.fn())
vi.mock("@nulo/aztec-runtime/utils", async (importOriginal) => ({
	...(await importOriginal<object>()),
	assertLiveChainIdentity: assertLiveChainIdentityMock,
}))

const fastPathMocks = vi.hoisted(() => ({
	rehydrateOptimizablePrefix: vi.fn(),
	runFastPath: vi.fn(),
}))
vi.mock("./fast-path", () => fastPathMocks)

// Gas shaping is pinned by the structural fee fixtures; no-op here so
// plain-object txRequest fakes survive.
vi.mock("./fee/fee-strategy", async (importOriginal) => ({
	...(await importOriginal<object>()),
	suggestGasLimits: vi.fn(),
}))
vi.mock("./fee/embedded-fpc-cap", () => ({ applyEmbeddedFpcGasCap: vi.fn(async () => {}) }))

function addr(hex: string) {
	return { toString: () => hex } as never
}

function makeHarness(overrides: Partial<ViewExecutorDeps> = {}) {
	const network = {
		id: "net-1",
		profileId: "p1",
		chainId: 7,
		endpoints: [{ id: "e1", rpcUrl: "http://primary" }],
		primaryEndpointId: "e1",
	} as never
	const node = { getNodeInfo: vi.fn(async () => ({ l1ChainId: 1, rollupVersion: 2 })) }
	const account = {
		address: addr("0xacct"),
		ensureRegistered: vi.fn(async () => {}),
		requiresInitialization: vi.fn(async () => false),
	}
	const pxe = {
		simulateTx: vi.fn(async () => ({
			gasUsed: { totalGas: 1n },
			getPrivateReturnValues: () => "priv",
			getPublicReturnValues: () => "pub",
		})),
		executeUtility: vi.fn(async () => ({ result: [] })),
		getContracts: vi.fn(async () => []),
		registerContract: vi.fn(async () => {}),
		profileTx: vi.fn(async () => ({ kind: "profile" })),
	}
	const deps: ViewExecutorDeps = {
		planner: { processAztecJsPayload: vi.fn(async () => [[], 0, {}]) } as never,
		resolver: {} as never,
		txBuilder: { buildStandard: vi.fn(async () => ({ txRequest: { kind: "txr" }, node, pxe, account, network })) } as never,
		pxeService: {
			getPXE: vi.fn(() => pxe),
			getContractArtifact: vi.fn(async () => undefined),
			getContractInstance: vi.fn(async () => undefined),
			getPrivateEvents: vi.fn(async () => []),
		} as never,
		profileService: { getActiveProfile: vi.fn(async () => ({ id: "p1" })) } as never,
		networkService: { getNetwork: vi.fn(async () => network), getNode: vi.fn(async () => node) } as never,
		accountService: { getAccountContract: vi.fn(async () => account) } as never,
		contactService: { getContacts: vi.fn(async () => []) } as never,
		logDebug: vi.fn(),
		logError: vi.fn(),
		...overrides,
	}
	return { deps, network, node, account, pxe, executor: new ViewExecutor(deps) }
}

// The fast-path arm wraps accountAddress via the REAL AztecAddress.fromString.
const VALID_ADDR = `0x${"22".repeat(32)}`

function makeSimOp(overrides: Record<string, unknown> = {}) {
	return {
		kind: "aztec_simulateTx",
		networkId: "net-1",
		accountAddress: VALID_ADDR,
		exec: { calls: [] },
		opts: { from: addr(VALID_ADDR), additionalScopes: [] },
		...overrides,
	} as never
}

describe("ViewExecutor.executeSimulateTransaction", () => {
	test("scopes=[account.address], fee enforcement skipped, projected result shape", async () => {
		const { executor, pxe, account } = makeHarness()
		const result = await executor.executeSimulateTransaction({
			kind: "simulate_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			actions: [],
		} as never)

		const simArgs = pxe.simulateTx.mock.calls[0] as unknown[]
		expect(simArgs[1]).toEqual({ simulatePublic: false, skipFeeEnforcement: true, scopes: [account.address] })
		expect(result).toEqual({ gasUsed: { totalGas: 1n }, privateReturn: "priv", publicReturn: "pub" })
	})
})

describe("ViewExecutor.executeAztecSimulateTx", () => {
	test("opts.from mismatch rejected with the frozen message", async () => {
		const { executor } = makeHarness()
		const op = makeSimOp({ opts: { from: addr("0xother") } })
		await expect(executor.executeAztecSimulateTx(op)).rejects.toThrow("Invalid `opts.from`")
	})

	test("split=null routes to the standard path: stub-account msgSender + scopes pin", async () => {
		fastPathMocks.rehydrateOptimizablePrefix.mockReturnValue(null)
		const extra = addr("0xextra")
		const { executor, pxe, account } = makeHarness()
		await executor.executeAztecSimulateTx(makeSimOp({ opts: { from: addr(VALID_ADDR), additionalScopes: [extra] } }))

		expect(fastPathMocks.runFastPath).not.toHaveBeenCalled()
		const simArgs = pxe.simulateTx.mock.calls[0] as unknown[]
		// Scopes: account first, then dApp additionalScopes.
		expect((simArgs[1] as { scopes: unknown[] }).scopes).toEqual([account.address, extra])
		// THE PIN (defense-in-depth): third arg = stubAccountAddresses — the
		// simulated account is the stubbed pass-through; real signing keys
		// never enter PXE during a dApp simulateTx.
		expect(simArgs[2]).toEqual(["0xacct"])
	})

	test("fast path result=null falls back to the standard path", async () => {
		fastPathMocks.rehydrateOptimizablePrefix.mockReturnValue({ optimizableCalls: [], remainingRaw: [] })
		fastPathMocks.runFastPath.mockResolvedValue(null)
		const { executor, pxe } = makeHarness()
		await executor.executeAztecSimulateTx(makeSimOp())

		expect(fastPathMocks.runFastPath).toHaveBeenCalledTimes(1)
		expect(pxe.simulateTx).toHaveBeenCalledTimes(1)
	})

	test("fast path result returned verbatim when non-null", async () => {
		fastPathMocks.rehydrateOptimizablePrefix.mockReturnValue({ optimizableCalls: [{}], remainingRaw: [] })
		const fastResult = { kind: "fast" }
		fastPathMocks.runFastPath.mockResolvedValue(fastResult)
		const { executor, pxe } = makeHarness()
		const result = await executor.executeAztecSimulateTx(makeSimOp())

		expect(result).toBe(fastResult)
		expect(pxe.simulateTx).not.toHaveBeenCalled()
	})
})

describe("ViewExecutor.executeAztecGetChainInfo", () => {
	test("chain identity asserted against live nodeInfo (V-01) before returning", async () => {
		assertLiveChainIdentityMock.mockClear()
		const { executor, network } = makeHarness()
		const info = await executor.executeAztecGetChainInfo({ kind: "aztec_getChainInfo", networkId: "net-1" } as never)

		expect(assertLiveChainIdentityMock).toHaveBeenCalledWith(network, { l1ChainId: 1, rollupVersion: 2 })
		expect(info.chainId.toBigInt()).toBe(1n)
		expect(info.version.toBigInt()).toBe(2n)
	})
})

describe("ViewExecutor.executeAztecGetContractMetadata", () => {
	test("PXE-local instance + artifact → INITIALIZED with instance attached", async () => {
		const instance = { currentContractClassId: addr("0xclass") }
		const { executor } = makeHarness({
			pxeService: {
				getContractInstance: vi.fn(async () => instance),
				getContractArtifact: vi.fn(async () => ({ kind: "artifact" })),
			} as never,
		})
		const meta = await executor.executeAztecGetContractMetadata({
			kind: "aztec_getContractMetadata",
			networkId: "net-1",
			address: "0xcontract",
		} as never)

		expect(meta.instance).toBe(instance)
		expect(meta.initializationStatus).toBe(ContractInitializationStatus.INITIALIZED)
		expect(meta.isContractPublished).toBe(true)
	})

	test("not local: best-effort node lookup drives isContractPublished, instance stays undefined", async () => {
		const getContractInstance = vi
			.fn()
			.mockResolvedValueOnce(undefined) // pxeOnly probe
			.mockResolvedValueOnce({ found: true }) // nodeBestEffort probe
		const { executor } = makeHarness({
			pxeService: { getContractInstance, getContractArtifact: vi.fn(async () => undefined) } as never,
		})
		const meta = await executor.executeAztecGetContractMetadata({
			kind: "aztec_getContractMetadata",
			networkId: "net-1",
			address: "0xcontract",
		} as never)

		expect(meta.instance).toBeUndefined()
		expect(meta.initializationStatus).toBe(ContractInitializationStatus.UNKNOWN)
		expect(meta.isContractPublished).toBe(true)
		expect((getContractInstance.mock.calls[1] as unknown[])[2]).toEqual({ nodeBestEffort: true })
	})
})

describe("ViewExecutor.executeSimulateUtility / executeAztecExecuteUtility", () => {
	test("wallet locked → frozen error before any network access", async () => {
		const { executor, deps } = makeHarness({ profileService: { getActiveProfile: vi.fn(async () => undefined) } as never })
		await expect(executor.executeSimulateUtility({ kind: "simulate_utility", networkId: "net-1" } as never)).rejects.toThrow(
			"Wallet locked",
		)
		await expect(executor.executeAztecExecuteUtility({ kind: "aztec_executeUtility", networkId: "net-1" } as never)).rejects.toThrow(
			"Wallet locked",
		)
		expect(deps.networkService.getNetwork).not.toHaveBeenCalled()
	})
})

describe("ViewExecutor.executeAztecProfileTx", () => {
	test("opts.from mismatch rejected; happy path scopes = [accountAddress, ...additionalScopes]", async () => {
		const { executor } = makeHarness()
		await expect(
			executor.executeAztecProfileTx(makeSimOp({ kind: "aztec_profileTx", opts: { from: addr("0xother") } })),
		).rejects.toThrow("Invalid `opts.from`")

		// profileTx wraps accountAddress via the REAL AztecAddress.fromString,
		// so this fixture needs a full-length address.
		const validAddr = `0x${"11".repeat(32)}`
		const happy = makeHarness()
		await happy.executor.executeAztecProfileTx(
			makeSimOp({
				kind: "aztec_profileTx",
				accountAddress: validAddr,
				opts: { from: addr(validAddr), additionalScopes: [], profileMode: "gates" },
			}),
		)
		const profArgs = happy.pxe.profileTx.mock.calls[0] as unknown[]
		const scopes = (profArgs[1] as { scopes: Array<{ toString(): string }> }).scopes
		expect(scopes.map((s) => s.toString())).toEqual([validAddr])
	})
})
