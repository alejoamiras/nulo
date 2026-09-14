// @vitest-environment node
// Selector derivation walks BB WASM, which the jsdom default environment cannot run.

/**
 * Unit tests for the fast path (mixed-payload edition).
 *
 * Two layers:
 *   - `rehydrateOptimizablePrefix` — pure data, no mocks (tests 1-13).
 *   - `runFastPath` — orchestration; mocks `simulateViaNode` +
 *     `buildMergedSimulationResult` from `@aztec/wallet-sdk/base-wallet`
 *     and a minimal `AztecNode` / `IPXE` stub (tests 14-23).
 *
 * `vi.mock` runs before the imports so the mocks replace the real symbols
 * across both the test file and the module under test.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { FunctionCall, FunctionSelector, FunctionType, type AbiType } from "@aztec/stdlib/abi"
import { GasFees, GasSettings } from "@aztec/stdlib/gas"
import { SimulationError } from "@aztec/stdlib/errors"
import type { BlockHeader, TxSimulationResult } from "@aztec/stdlib/tx"
import { TxSimulationResultWithAppOffset } from "@aztec/aztec.js/wallet"

vi.mock("@aztec/wallet-sdk/base-wallet", () => ({
	simulateViaNode: vi.fn(),
	buildMergedSimulationResult: vi.fn(),
}))

import { buildMergedSimulationResult, simulateViaNode } from "@aztec/wallet-sdk/base-wallet"
import { bindOptimizableCalls, rehydrateOptimizablePrefix, runFastPath, wrapStandardArmForMixedMerge } from "./fast-path"

const simulateViaNodeMock = simulateViaNode as unknown as ReturnType<typeof vi.fn>
const buildMergedMock = buildMergedSimulationResult as unknown as ReturnType<typeof vi.fn>

/** The ABI the fake resolver serves: two public-static views and one private mutator, so a
 *  wire call can lie about its name, its selector, or its flags independently. */
const FIELD_PARAM = { name: "owner", type: { kind: "field" }, visibility: "public" } as never
const ABI_BALANCE_OF_PUBLIC = {
	name: "balance_of_public",
	parameters: [FIELD_PARAM],
	functionType: FunctionType.PUBLIC,
	isStatic: true,
	returnTypes: [],
}
const ABI_TOTAL_SUPPLY = { name: "total_supply", parameters: [], functionType: FunctionType.PUBLIC, isStatic: true, returnTypes: [] }
const ABI_TRANSFER = { name: "transfer", parameters: [FIELD_PARAM], functionType: FunctionType.PRIVATE, isStatic: false, returnTypes: [] }
const FAKE_ARTIFACT = { functions: [ABI_BALANCE_OF_PUBLIC, ABI_TOTAL_SUPPLY, ABI_TRANSFER], nonDispatchPublicFunctions: [] }
const selectorOf = (fn: { name: string; parameters: unknown[] }) => FunctionSelector.fromNameAndParameters(fn.name, fn.parameters as never)

/** Minimal fake ContractResolver: every address resolves to FAKE_ARTIFACT's class. */
function fakeResolver(opts: { instanceMissing?: boolean } = {}) {
	return {
		resolveInstance: vi.fn(async (_pxe: unknown, contract: string) => {
			if (opts.instanceMissing) throw new Error("Contract instance not found")
			return [contract, { currentContractClassId: { toString: () => "0xfakeclass" } }]
		}),
		resolveArtifact: vi.fn(async () => ["0xfakeclass", FAKE_ARTIFACT]),
	}
}

/** Build an RPC-shaped public-static call (hex-string fields, no prototypes). The selector
 *  is ABI-derived so the default call binds cleanly against FAKE_ARTIFACT. */
function rpcShapedPublicStaticCall(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		name: "balance_of_public",
		to: AztecAddress.ZERO.toString(),
		selector: BALANCE_OF_PUBLIC_SELECTOR,
		type: FunctionType.PUBLIC,
		isStatic: true,
		hideMsgSender: false,
		args: [new Fr(1n).toString()],
		returnTypes: [] as AbiType[],
		...overrides,
	}
}
let BALANCE_OF_PUBLIC_SELECTOR = ""
let TOTAL_SUPPLY_SELECTOR = ""
beforeAll(async () => {
	BALANCE_OF_PUBLIC_SELECTOR = (await selectorOf(ABI_BALANCE_OF_PUBLIC)).toString()
	TOTAL_SUPPLY_SELECTOR = (await selectorOf(ABI_TOTAL_SUPPLY)).toString()
})

/** Minimal fake AztecNode covering only the methods runFastPath calls. */
function fakeNode(
	opts: {
		blockHeader?: BlockHeader | undefined
		nodeInfo?: { l1ChainId: number; rollupVersion: number }
		minFees?: GasFees
		getNodeInfoThrows?: boolean
	} = {},
) {
	const blockHeader = "blockHeader" in opts ? opts.blockHeader : ({} as BlockHeader)
	return {
		getBlock: vi.fn(async () => ({ header: blockHeader })),
		getNodeInfo: vi.fn(async () => {
			if (opts.getNodeInfoThrows) throw new Error("nodeInfo boom")
			return opts.nodeInfo ?? { l1ChainId: 11155111, rollupVersion: 4127419662 }
		}),
		getCurrentMinFees: vi.fn(async () => opts.minFees ?? new GasFees(100n, 200n)),
	}
}

/** Minimal fake IPXE covering only `getSyncedBlockHeader`. */
function fakePxe(opts: { syncedHeader?: BlockHeader | undefined; throws?: boolean } = {}) {
	return {
		getSyncedBlockHeader: vi.fn(async () => {
			if (opts.throws) throw new Error("pxe synced header boom")
			return "syncedHeader" in opts ? (opts.syncedHeader as BlockHeader) : ({ id: "pxe-synced" } as unknown as BlockHeader)
		}),
	}
}

/** Build a canned upstream `TxSimulationResult`-shaped object. */
function fakeSimResult(publicReturnValues: unknown[] = [{ values: [new Fr(42n)] }]): TxSimulationResult {
	return {
		privateExecutionResult: { id: "fake-private" } as never,
		publicInputs: { id: "fake-publicInputs" } as never,
		publicOutput: {
			revertReason: undefined,
			globalVariables: {} as never,
			txEffect: {} as never,
			publicReturnValues,
			gasUsed: {} as never,
		},
		stats: undefined,
	} as unknown as TxSimulationResult
}

// ---------- rehydrateOptimizablePrefix ----------

describe("rehydrateOptimizablePrefix", () => {
	test("1. undefined input → null", () => {
		expect(rehydrateOptimizablePrefix(undefined)).toBeNull()
	})

	test("2. null input → null", () => {
		// biome-ignore lint/suspicious/noExplicitAny: hammering the boundary contract
		expect(rehydrateOptimizablePrefix(null as any)).toBeNull()
	})

	test("3. non-array input → null", () => {
		// biome-ignore lint/suspicious/noExplicitAny: hammering the boundary contract
		expect(rehydrateOptimizablePrefix("not-an-array" as any)).toBeNull()
	})

	test("4. empty array → null", () => {
		expect(rehydrateOptimizablePrefix([])).toBeNull()
	})

	test("5. pure-private payload → null (no optimizable prefix)", () => {
		const result = rehydrateOptimizablePrefix([rpcShapedPublicStaticCall({ type: FunctionType.PRIVATE })])
		expect(result).toBeNull()
	})

	test("6. public-but-non-static at index 0 → null (no optimizable prefix)", () => {
		const result = rehydrateOptimizablePrefix([rpcShapedPublicStaticCall({ isStatic: false })])
		expect(result).toBeNull()
	})

	test("7. pure public-static payload → all rehydrated, no remainder", () => {
		const result = rehydrateOptimizablePrefix([rpcShapedPublicStaticCall(), rpcShapedPublicStaticCall()])
		expect(result).not.toBeNull()
		expect(result?.optimizableCalls).toHaveLength(2)
		expect(result?.remainingRaw).toHaveLength(0)
		expect(result?.optimizableCalls[0]).toBeInstanceOf(FunctionCall)
		expect(result?.optimizableCalls[0].isPublicStatic()).toBe(true)
	})

	test("8. mixed: [public-static, private] → prefix=[1], remainder=[1]", () => {
		const priv = rpcShapedPublicStaticCall({ type: FunctionType.PRIVATE })
		const result = rehydrateOptimizablePrefix([rpcShapedPublicStaticCall(), priv])
		expect(result).not.toBeNull()
		expect(result?.optimizableCalls).toHaveLength(1)
		expect(result?.remainingRaw).toHaveLength(1)
		expect(result?.remainingRaw[0]).toBe(priv)
	})

	test("9. mixed: [public-static, public-non-static] → prefix=[1], remainder=[1]", () => {
		const nonStatic = rpcShapedPublicStaticCall({ isStatic: false })
		const result = rehydrateOptimizablePrefix([rpcShapedPublicStaticCall(), nonStatic])
		expect(result).not.toBeNull()
		expect(result?.optimizableCalls).toHaveLength(1)
		expect(result?.remainingRaw).toHaveLength(1)
		expect(result?.remainingRaw[0]).toBe(nonStatic)
	})

	test("10. mixed: [s, s, s, private] → prefix=[3], remainder=[1]", () => {
		const priv = rpcShapedPublicStaticCall({ type: FunctionType.PRIVATE })
		const result = rehydrateOptimizablePrefix([
			rpcShapedPublicStaticCall(),
			rpcShapedPublicStaticCall(),
			rpcShapedPublicStaticCall(),
			priv,
		])
		expect(result?.optimizableCalls).toHaveLength(3)
		expect(result?.remainingRaw).toEqual([priv])
		// remainder stays RAW (no rehydration), proves we skip the double-parse
		expect(result?.remainingRaw[0]).toBe(priv)
	})

	test("11. RPC roundtrip — JSON.parse(JSON.stringify(realCall)) rehydrates", () => {
		const real = FunctionCall.from({
			name: "balance_of_public",
			to: AztecAddress.ZERO,
			selector: FunctionSelector.fromField(new Fr(0x12345678n)),
			type: FunctionType.PUBLIC,
			isStatic: true,
			hideMsgSender: false,
			args: [new Fr(7n)],
			returnTypes: [],
		})
		const overWire = JSON.parse(JSON.stringify(real))
		const result = rehydrateOptimizablePrefix([overWire])
		expect(result?.optimizableCalls[0]).toBeInstanceOf(FunctionCall)
		expect(result?.optimizableCalls[0].name).toBe(real.name)
		expect(result?.optimizableCalls[0].selector.toString()).toBe(real.selector.toString())
		expect(result?.optimizableCalls[0].args[0].toString()).toBe(real.args[0].toString())
	})

	test("12. malformed prefix (missing selector) → null (zod throws, helper catches)", () => {
		const malformed = rpcShapedPublicStaticCall()
		malformed.selector = undefined
		expect(rehydrateOptimizablePrefix([malformed])).toBeNull()
	})

	test("13. data-only scan does NOT touch the remainder for rehydration", () => {
		// Remainder is malformed RPC (would throw if zod-parsed) but isn't
		// in the optimizable prefix → caller never sees the throw.
		const priv = { type: FunctionType.PRIVATE, garbage: true }
		const result = rehydrateOptimizablePrefix([rpcShapedPublicStaticCall(), priv])
		expect(result).not.toBeNull()
		expect(result?.remainingRaw[0]).toBe(priv)
	})
})

// ---------- runFastPath orchestration ----------

describe("runFastPath", () => {
	beforeEach(() => {
		simulateViaNodeMock.mockReset()
		buildMergedMock.mockReset()
		buildMergedMock.mockImplementation((opt, normal) => ({
			__merged: true,
			optimized: opt,
			normal,
		}))
	})

	function makeDeps(
		overrides: {
			node?: ReturnType<typeof fakeNode>
			pxe?: ReturnType<typeof fakePxe>
			resolver?: ReturnType<typeof fakeResolver>
			opts?: Record<string, unknown>
			optimizableCalls?: FunctionCall[]
			remainingRaw?: unknown[]
			runStandardArm?: (raw: unknown[]) => Promise<TxSimulationResult>
			logError?: (msg: string, err: unknown) => void
		} = {},
	) {
		const node = overrides.node ?? fakeNode()
		const pxe = overrides.pxe ?? fakePxe()
		const resolver = overrides.resolver ?? fakeResolver()
		const opts = overrides.opts ?? {}
		const logError = overrides.logError ?? vi.fn()
		const split = rehydrateOptimizablePrefix([rpcShapedPublicStaticCall()])
		const optimizableCalls = overrides.optimizableCalls ?? split!.optimizableCalls
		const remainingRaw = overrides.remainingRaw ?? []
		const runStandardArm = overrides.runStandardArm ?? vi.fn(async () => fakeSimResult([{ values: [new Fr(99n)] }]))
		return {
			deps: {
				node: node as never,
				pxe: pxe as never,
				resolver: resolver as never,
				// chainId=0 means assertLiveChainIdentity skips its check (local
				// substrate); tests don't exercise chain-identity drift here.
				network: { chainId: 0, l1ChainId: 11155111 },
				fromAddr: AztecAddress.ZERO,
				opts: opts as never,
				optimizableCalls,
				remainingRaw,
				runStandardArm,
				getContractName: async () => undefined,
				logError,
			},
			node,
			pxe,
			resolver,
			logError,
			runStandardArm,
		}
	}

	test("F-08: a wire name that does not match the selector's ABI function is a scope violation, before any simulation", async () => {
		const split = rehydrateOptimizablePrefix([rpcShapedPublicStaticCall({ selector: TOTAL_SUPPLY_SELECTOR })])
		const { deps, runStandardArm } = makeDeps({ optimizableCalls: split!.optimizableCalls })
		await expect(runFastPath(deps)).rejects.toThrow(
			/Scope violation: call name "balance_of_public" does not match selector's function "total_supply"/,
		)
		expect(simulateViaNodeMock).not.toHaveBeenCalled()
		expect(runStandardArm).not.toHaveBeenCalled()
	})

	test("F-08: a selector the ABI does not contain is rejected, not simulated", async () => {
		const split = rehydrateOptimizablePrefix([
			rpcShapedPublicStaticCall({ selector: FunctionSelector.fromField(new Fr(0x12345678n)).toString() }),
		])
		const { deps } = makeDeps({ optimizableCalls: split!.optimizableCalls })
		await expect(runFastPath(deps)).rejects.toThrow("Method not found")
		expect(simulateViaNodeMock).not.toHaveBeenCalled()
	})

	test("F-08: forged public+static flags on a private function make the prefix ineligible — null, nothing simulated, inputs untouched", async () => {
		const transferSelector = (await selectorOf(ABI_TRANSFER)).toString()
		const wire = rpcShapedPublicStaticCall({ name: "transfer", selector: transferSelector })
		const split = rehydrateOptimizablePrefix([wire])
		const before = split!.optimizableCalls.map((c) => ({ name: c.name, isStatic: c.isStatic, type: c.type }))
		const { deps, runStandardArm } = makeDeps({ optimizableCalls: split!.optimizableCalls })
		await expect(runFastPath(deps)).resolves.toBeNull()
		expect(simulateViaNodeMock).not.toHaveBeenCalled()
		expect(runStandardArm).not.toHaveBeenCalled()
		expect(split!.optimizableCalls.map((c) => ({ name: c.name, isStatic: c.isStatic, type: c.type }))).toEqual(before)
	})

	test("F-08: a contract PXE cannot resolve falls back to the standard path (null) instead of simulating unbound", async () => {
		const { deps } = makeDeps({ resolver: fakeResolver({ instanceMissing: true }) })
		await expect(runFastPath(deps)).resolves.toBeNull()
		expect(simulateViaNodeMock).not.toHaveBeenCalled()
	})

	test("F-08: a bound call simulates with ABI-derived flags and the ABI name", async () => {
		simulateViaNodeMock.mockResolvedValue([fakeSimResult()])
		const { deps } = makeDeps()
		await runFastPath(deps)
		const simulated = simulateViaNodeMock.mock.calls[0][1] as FunctionCall[]
		expect(simulated).toHaveLength(1)
		expect(simulated[0].name).toBe("balance_of_public")
		expect(simulated[0].type).toBe(FunctionType.PUBLIC)
		expect(simulated[0].isStatic).toBe(true)
		expect(simulated[0]).not.toBe(deps.optimizableCalls[0])
	})

	test("bindOptimizableCalls returns a fresh array and leaves the input calls untouched", async () => {
		const split = rehydrateOptimizablePrefix([rpcShapedPublicStaticCall()])
		const input = split!.optimizableCalls
		const bound = await bindOptimizableCalls({} as never, fakeResolver() as never, input)
		expect(bound).not.toBeNull()
		expect(bound).not.toBe(input)
		expect(input[0].name).toBe("balance_of_public")
	})

	test("14. PXE getSyncedBlockHeader is preferred over node.getBlock", async () => {
		simulateViaNodeMock.mockResolvedValue([fakeSimResult()])
		const { deps, node, pxe } = makeDeps()
		await runFastPath(deps)
		expect(pxe.getSyncedBlockHeader).toHaveBeenCalledOnce()
		expect(node.getBlock).not.toHaveBeenCalled()
	})

	test("15. PXE synced-header failure → falls back to node.getBlock", async () => {
		simulateViaNodeMock.mockResolvedValue([fakeSimResult()])
		const pxe = fakePxe({ throws: true })
		const { deps, node } = makeDeps({ pxe })
		await runFastPath(deps)
		expect(pxe.getSyncedBlockHeader).toHaveBeenCalledOnce()
		expect(node.getBlock).toHaveBeenCalledOnce()
	})

	test("16. both header sources return undefined → returns null (no sim)", async () => {
		simulateViaNodeMock.mockResolvedValue([fakeSimResult()])
		const pxe = fakePxe({ throws: true })
		const node = fakeNode({ blockHeader: undefined })
		const { deps } = makeDeps({ node, pxe })
		const result = await runFastPath(deps)
		expect(result).toBeNull()
		expect(simulateViaNodeMock).not.toHaveBeenCalled()
	})

	test("17. pure-prefix (remainingRaw=[]) → standard arm NOT called, merge with normal=null", async () => {
		const opt = fakeSimResult()
		simulateViaNodeMock.mockResolvedValue([opt])
		const runStandardArm = vi.fn(async () => fakeSimResult())
		const { deps } = makeDeps({ remainingRaw: [], runStandardArm })
		await runFastPath(deps)
		expect(runStandardArm).not.toHaveBeenCalled()
		expect(buildMergedMock).toHaveBeenCalledOnce()
		const [optArg, normalArg] = buildMergedMock.mock.calls[0]!
		expect(optArg).toEqual([opt])
		expect(normalArg).toBeNull()
	})

	test("18. mixed (remainingRaw non-empty) → standard arm called, wrapped result passed to merge", async () => {
		const opt = fakeSimResult([{ values: [new Fr(1n)] }])
		const std = fakeSimResult([{ values: [new Fr(2n)] }])
		simulateViaNodeMock.mockResolvedValue([opt])
		const runStandardArm = vi.fn(async () => std)
		const priv = rpcShapedPublicStaticCall({ type: FunctionType.PRIVATE })
		const { deps } = makeDeps({ remainingRaw: [priv], runStandardArm })
		await runFastPath(deps)
		expect(runStandardArm).toHaveBeenCalledOnce()
		expect(runStandardArm).toHaveBeenCalledWith([priv])
		const [_optArg, normalArg] = buildMergedMock.mock.calls[0]!
		expect(normalArg).toBeInstanceOf(TxSimulationResultWithAppOffset)
		expect(normalArg.appCallOffset).toBe(1)
	})

	test("19. simulateViaNode throws SimulationError → re-throws; logError NOT called", async () => {
		const revert = new SimulationError("contract revert", [])
		simulateViaNodeMock.mockRejectedValue(revert)
		const { deps, logError } = makeDeps()
		await expect(runFastPath(deps)).rejects.toBe(revert)
		expect(logError).not.toHaveBeenCalled()
	})

	test("20. simulateViaNode throws generic Error → logs + returns null", async () => {
		simulateViaNodeMock.mockRejectedValue(new Error("transport down"))
		const { deps, logError } = makeDeps()
		const result = await runFastPath(deps)
		expect(result).toBeNull()
		expect(logError).toHaveBeenCalledOnce()
	})

	test("21. node.getNodeInfo() throws → PROPAGATES (shares fate with standard path)", async () => {
		simulateViaNodeMock.mockResolvedValue([fakeSimResult()])
		const node = fakeNode({ getNodeInfoThrows: true })
		const { deps, logError } = makeDeps({ node })
		await expect(runFastPath(deps)).rejects.toThrow(/nodeInfo boom/)
		expect(logError).not.toHaveBeenCalled()
		expect(simulateViaNodeMock).not.toHaveBeenCalled()
	})

	test("22. opts.fee.gasSettings.maxFeesPerGas RPC-shaped → translator passes real GasFees through to simulateViaNode", async () => {
		simulateViaNodeMock.mockResolvedValue([fakeSimResult()])
		const rpcMaxFees = { feePerDaGas: 555n, feePerL2Gas: 666n }
		const { deps } = makeDeps({ opts: { fee: { gasSettings: { maxFeesPerGas: rpcMaxFees } } } })
		await runFastPath(deps)
		const passedGasSettings = simulateViaNodeMock.mock.calls[0]![4] as GasSettings
		expect(passedGasSettings).toBeInstanceOf(GasSettings)
		expect(passedGasSettings.maxFeesPerGas.feePerDaGas).toBe(555n)
		expect(passedGasSettings.maxFeesPerGas.feePerL2Gas).toBe(666n)
	})

	test("23. skipFeeEnforcement:false + explicit fee fields → both flow through to simulateViaNode", async () => {
		simulateViaNodeMock.mockResolvedValue([fakeSimResult()])
		const rpcMaxFees = { feePerDaGas: 1000n, feePerL2Gas: 2000n }
		const rpcPriorityFees = { feePerDaGas: 5n, feePerL2Gas: 10n }
		const { deps } = makeDeps({
			opts: {
				skipFeeEnforcement: false,
				fee: { gasSettings: { maxFeesPerGas: rpcMaxFees, maxPriorityFeesPerGas: rpcPriorityFees } },
			},
		})
		await runFastPath(deps)
		const call = simulateViaNodeMock.mock.calls[0]!
		const passedGasSettings = call[4] as GasSettings
		const passedSkipFeeEnforcement = call[6] as boolean
		expect(passedSkipFeeEnforcement).toBe(false)
		expect(passedGasSettings.maxFeesPerGas.feePerDaGas).toBe(1000n)
		expect(passedGasSettings.maxPriorityFeesPerGas.feePerDaGas).toBe(5n)
		expect(passedGasSettings.maxPriorityFeesPerGas.feePerL2Gas).toBe(10n)
	})
})

// ---------- wrapStandardArmForMixedMerge ----------

describe("wrapStandardArmForMixedMerge", () => {
	test("24. wraps TxSimulationResult with appCallOffset=1", () => {
		const result = fakeSimResult()
		const wrapped = wrapStandardArmForMixedMerge(result)
		expect(wrapped).toBeInstanceOf(TxSimulationResultWithAppOffset)
		expect(wrapped.appCallOffset).toBe(1)
		// passes through privateExecutionResult / publicInputs / publicOutput
		expect(wrapped.privateExecutionResult).toBe(result.privateExecutionResult)
		expect(wrapped.publicInputs).toBe(result.publicInputs)
		expect(wrapped.publicOutput).toBe(result.publicOutput)
	})
})
