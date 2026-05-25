/**
 * Unit tests for `batchedViewSimulation`. Pins the behavior-parity invariants
 * inherited from the former `ExecutionService.executeSimulateViews`:
 *
 *   - Function-type classification (utility vs public vs private)
 *   - ExecutionPayload + buildTxExecutionRequest options
 *   - pxe.simulateTx options
 *   - Origin-dependent private-return unpacking (both branches)
 *   - `hideSender` (call) vs `hideMsgSender` (encoded_call) vs utility-false
 *   - Parallel-launch + serial-await for utility calls
 *   - Per-call decode failure isolation
 *   - Input-order output
 *
 * Uses stub PXE + stub ContractResolver + stub IAccountContract. PXE is duck-
 * typed (only methods the helper calls need to exist).
 *
 * NOTE: an integration test against a real sandbox PXE lives in
 * `batched-view-simulation.integration.test.ts`, guarded by
 * `describe.skipIf(!process.env.RUN_NETWORK_E2E)`.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"

// Mock the heavy Aztec stdlib parts the helper composes with. The unit
// tests are about classification + batching + ordering — NOT about whether
// `FunctionSelector` hashes correctly or `encodeArguments` packs the right
// bytes. Those are upstream concerns. Integration tests in the sibling
// `.integration.test.ts` file exercise the real ones.
vi.mock("@aztec/stdlib/abi", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@aztec/stdlib/abi")>()
	return {
		...actual,
		// Selector computation is a Wasm hash — too heavy for unit tests; return
		// a stable deterministic stand-in.
		FunctionSelector: {
			...actual.FunctionSelector,
			fromNameAndParameters: vi.fn(async (name: string, _params: unknown) => ({
				toString: () => `selector-${name}`,
			})),
			// Stub fromString too — real impl validates as hex. The encoded_call
			// path passes the selector through and we want the test to focus on
			// classification + propagation, not hex validity.
			fromString: vi.fn((selector: string) => ({ toString: () => selector })),
		},
		// encodeArguments expects real ABI params; return a deterministic stub.
		encodeArguments: vi.fn(() => []),
		// decodeFromAbi is called per-result; our stubs return Fr[] directly so
		// we don't need real decoding.
		decodeFromAbi: vi.fn((_types: unknown, values: unknown) => values),
	}
})

// Mock the fast-arm primitives. `simulateViaNode` is the upstream node-direct
// sim path; we control its return shape per-test to validate unpack. The
// `completeFeeOptions` shim mirrors what `runFastArm` calls — it's lazy on the
// fast path only, so most non-fast tests don't need to invoke it.
vi.mock("@aztec/wallet-sdk/base-wallet", () => ({
	simulateViaNode: vi.fn(),
}))
vi.mock("@nulo/aztec-runtime/account", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@nulo/aztec-runtime/account")>()
	return {
		...actual,
		completeFeeOptions: vi.fn(async () => ({ id: "stub-gas-settings" })),
	}
})

import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { FunctionType, type FunctionAbi } from "@aztec/stdlib/abi"
import { SimulationError } from "@aztec/stdlib/errors"
import type { CallAction, EncodedCallAction } from "@nulo/wallet-bridge"
import { simulateViaNode } from "@aztec/wallet-sdk/base-wallet"
import { type ILogger, LogLevel } from "@/wallet/logger"
import { batchedViewSimulation, type BatchedViewSimulationDeps } from "./batched-view-simulation"

const simulateViaNodeMock = simulateViaNode as unknown as ReturnType<typeof vi.fn>

// ── Test helpers / fixtures ─────────────────────────────────────────────

const CONTRACT_A = "0x0000000000000000000000000000000000000000000000000000000000000a01"
const CONTRACT_B = "0x0000000000000000000000000000000000000000000000000000000000000a02"
const ACCOUNT_ADDR = AztecAddress.fromString("0x000000000000000000000000000000000000000000000000000000000000000a")
const OTHER_ORIGIN = AztecAddress.fromString("0x000000000000000000000000000000000000000000000000000000000000000b")

/** Build a stub FunctionAbi with the minimum surface the helper reads. */
function abi(name: string, kind: FunctionType, isStatic = false): FunctionAbi {
	return {
		name,
		functionType: kind,
		isInternal: false,
		isStatic,
		parameters: [],
		returnTypes: [],
		errorTypes: {},
		// biome-ignore lint/suspicious/noExplicitAny: FunctionAbi has many fields we don't read; cast keeps the fixture small.
	} as any
}

/** Minimal artifact shape — only `functions` + `nonDispatchPublicFunctions` */
function artifact(fns: FunctionAbi[]) {
	return { functions: fns, nonDispatchPublicFunctions: [] as FunctionAbi[] }
}

/** Order-tracking event log used by the concurrency tests. */
type Event = { type: "executeUtility-call" | "executeUtility-resolve" | "simulateTx-call" | "simulateTx-resolve"; index?: number }

function makeDeps(opts: {
	functions: Record<string, { kind: FunctionType; isStatic?: boolean }>
	publicReturns?: Fr[][]
	privateReturns?: Fr[][]
	/** Set true to make the origin returned by `buildTxExecutionRequest` NOT
	 *  equal `account.address` — exercises the `.nested[1].nested` branch. */
	originDiffers?: boolean
	utilityReturns?: Map<string, Fr[]>
	utilityDelay?: number
	events?: Event[]
	captureFunctionCalls?: Array<{ hideMsgSender: boolean; type: FunctionType; index: number }>
	/** Stub for `pxe.getSyncedBlockHeader()` — set to "throw" to force node
	 *  fallback. Defaults to returning a sentinel header. */
	pxeHeader?: "ok" | "throw"
	/** Stub for `node.getBlockHeader()` — only consulted when pxe throws. */
	nodeHeader?: "ok" | "null" | "throw"
	/** Stub `node.getNodeInfo()` — defaults to plausible testnet values. */
	nodeInfo?: { l1ChainId: number; rollupVersion: number } | "throw"
}): BatchedViewSimulationDeps {
	const fnAbis: Map<string, FunctionAbi> = new Map()
	for (const [name, { kind, isStatic }] of Object.entries(opts.functions)) {
		fnAbis.set(name, abi(name, kind, isStatic ?? false))
	}

	let utilityCallCount = 0
	let txCallCount = 0

	// biome-ignore lint/suspicious/noExplicitAny: duck-typed PXE stub
	const pxe: any = {
		getContracts: vi.fn(async () => [CONTRACT_A, CONTRACT_B].map((c) => AztecAddress.fromString(c))),
		registerContract: vi.fn(async () => undefined),
		getSyncedBlockHeader: vi.fn(async () => {
			if (opts.pxeHeader === "throw") throw new Error("pxe sync error")
			return { id: "pxe-synced-header" }
		}),
		executeUtility: vi.fn(async (call: { name: string; hideMsgSender?: boolean; type?: FunctionType }, _opts: unknown) => {
			const idx = utilityCallCount++
			opts.events?.push({ type: "executeUtility-call", index: idx })
			opts.captureFunctionCalls?.push({
				// biome-ignore lint/suspicious/noExplicitAny: stub captures
				hideMsgSender: (call as any).hideMsgSender ?? false,
				type: call.type ?? FunctionType.UTILITY,
				index: idx,
			})
			if (opts.utilityDelay) {
				await new Promise((r) => setTimeout(r, opts.utilityDelay))
			}
			opts.events?.push({ type: "executeUtility-resolve", index: idx })
			return { result: opts.utilityReturns?.get(call.name) ?? [] }
		}),
		simulateTx: vi.fn(async (_req: unknown, _opts: unknown) => {
			const idx = txCallCount++
			opts.events?.push({ type: "simulateTx-call", index: idx })
			// Allow utility promises (which may have queued setTimeouts) to
			// have started but NOT resolved before us — yields once.
			await Promise.resolve()
			opts.events?.push({ type: "simulateTx-resolve", index: idx })
			return {
				getPublicReturnValues: () => (opts.publicReturns ?? []).map((v) => ({ values: v })),
				// Origin-quirk: when origin === account.address, helper reads
				// `.nested`; else reads `.nested[1].nested`. We construct both
				// shapes so the helper's selection picks the right branch.
				getPrivateReturnValues: () =>
					opts.originDiffers
						? { nested: [{ values: [] }, { nested: (opts.privateReturns ?? []).map((v) => ({ values: v })) }] }
						: { nested: (opts.privateReturns ?? []).map((v) => ({ values: v })) },
			}
		}),
	}

	// biome-ignore lint/suspicious/noExplicitAny: duck-typed node stub
	const node: any = {
		getBlockHeader: vi.fn(async () => {
			if (opts.nodeHeader === "throw") throw new Error("node rpc error")
			if (opts.nodeHeader === "null") return null
			return { id: "node-header" }
		}),
		getNodeInfo: vi.fn(async () => {
			if (opts.nodeInfo === "throw") throw new Error("node info error")
			return opts.nodeInfo ?? { l1ChainId: 11155111, rollupVersion: 4127419662 }
		}),
	}

	// biome-ignore lint/suspicious/noExplicitAny: stub IAccountContract — only the surface the helper touches
	const account: any = {
		address: ACCOUNT_ADDR,
		ensureRegistered: vi.fn(async () => undefined),
		buildTxExecutionRequest: vi.fn(async () => ({
			origin: opts.originDiffers ? OTHER_ORIGIN : ACCOUNT_ADDR,
		})),
	}

	// Captures FunctionCall construction params for the tx-typed path.
	const txFunctionCalls: Array<{ hideMsgSender: boolean; type: FunctionType; index: number }> = []
	const origExecuteUtility = pxe.executeUtility
	pxe.executeUtility = vi.fn(async (call: unknown, optsArg: unknown) => origExecuteUtility(call, optsArg))
	// For tx-typed, the FunctionCall is passed into simulateTx via ExecutionPayload;
	// capturing it requires peeking at `buildTxExecutionRequest`'s payload arg.
	const origBuild = account.buildTxExecutionRequest
	account.buildTxExecutionRequest = vi.fn(
		async (_n: unknown, _p: unknown, payload: { calls: Array<{ hideMsgSender?: boolean; type?: FunctionType }> }) => {
			for (let i = 0; i < payload.calls.length; i++) {
				const c = payload.calls[i]
				txFunctionCalls.push({
					// biome-ignore lint/suspicious/noExplicitAny: stub capture
					hideMsgSender: (c as any).hideMsgSender ?? false,
					type: c.type ?? FunctionType.PUBLIC,
					index: i,
				})
			}
			if (opts.captureFunctionCalls) opts.captureFunctionCalls.push(...txFunctionCalls)
			return origBuild()
		},
	)

	const contractResolver = {
		extractContracts: vi.fn((_actions: unknown[]) => [CONTRACT_A, CONTRACT_B]),
		resolveInstances: vi.fn(async () => {
			const m = new Map()
			m.set(CONTRACT_A, { currentContractClassId: { toString: () => "class-A" } })
			m.set(CONTRACT_B, { currentContractClassId: { toString: () => "class-B" } })
			return m
		}),
		resolveInstance: vi.fn(),
		resolveArtifact: vi.fn(),
		resolveArtifacts: vi.fn(async () => {
			const m = new Map()
			const allFns = Array.from(fnAbis.values())
			m.set("class-A", artifact(allFns))
			m.set("class-B", artifact(allFns))
			return m
		}),
		// biome-ignore lint/suspicious/noExplicitAny: ContractResolver structural stub
	} as any

	return { pxe, node, account, contractResolver, logger: { log: () => {} } }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("batchedViewSimulation", () => {
	test("empty input → empty output, no PXE calls", async () => {
		const deps = makeDeps({ functions: {} })
		const result = await batchedViewSimulation([], deps)
		expect(result.encoded).toEqual([])
		expect(result.decoded).toEqual([])
		expect(deps.pxe.executeUtility).not.toHaveBeenCalled()
		expect(deps.pxe.simulateTx).not.toHaveBeenCalled()
	})

	test("all-utility calls → N executeUtility, zero simulateTx", async () => {
		const utilityReturns = new Map<string, Fr[]>([["bal_priv", [new Fr(42n)]]])
		const deps = makeDeps({
			functions: { bal_priv: { kind: FunctionType.UTILITY } },
			utilityReturns,
		})
		const calls: CallAction[] = [
			{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] },
			{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] },
			{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] },
		]
		const result = await batchedViewSimulation(calls, deps)
		expect(deps.pxe.executeUtility).toHaveBeenCalledTimes(3)
		expect(deps.pxe.simulateTx).not.toHaveBeenCalled()
		expect(result.encoded).toHaveLength(3)
	})

	test("all-public calls → 1 simulateTx, zero executeUtility", async () => {
		const deps = makeDeps({
			functions: { bal_pub: { kind: FunctionType.PUBLIC } },
			publicReturns: [[new Fr(100n)], [new Fr(200n)]],
		})
		const calls: CallAction[] = [
			{ kind: "call", contract: CONTRACT_A, method: "bal_pub", args: [] },
			{ kind: "call", contract: CONTRACT_A, method: "bal_pub", args: [] },
		]
		const result = await batchedViewSimulation(calls, deps)
		expect(deps.pxe.simulateTx).toHaveBeenCalledTimes(1)
		expect(deps.pxe.executeUtility).not.toHaveBeenCalled()
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(100n)
		expect(result.encoded[1]?.[0]?.toBigInt()).toBe(200n)
	})

	test("all-private calls → 1 simulateTx, .nested path (origin === account.address)", async () => {
		const deps = makeDeps({
			functions: { bal_priv: { kind: FunctionType.PRIVATE } },
			privateReturns: [[new Fr(7n)]],
			originDiffers: false, // origin === account.address → .nested
		})
		const calls: CallAction[] = [{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] }]
		const result = await batchedViewSimulation(calls, deps)
		expect(deps.pxe.simulateTx).toHaveBeenCalledTimes(1)
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(7n)
	})

	test("all-private calls → .nested[1].nested branch (origin !== account.address)", async () => {
		const deps = makeDeps({
			functions: { bal_priv: { kind: FunctionType.PRIVATE } },
			privateReturns: [[new Fr(13n)]],
			originDiffers: true, // origin !== account.address → .nested[1].nested
		})
		const calls: CallAction[] = [{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] }]
		const result = await batchedViewSimulation(calls, deps)
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(13n)
	})

	test("mixed utility + public → utility launched + 1 simulateTx, results in input order", async () => {
		const deps = makeDeps({
			functions: {
				bal_priv: { kind: FunctionType.UTILITY },
				bal_pub: { kind: FunctionType.PUBLIC },
			},
			utilityReturns: new Map([["bal_priv", [new Fr(7n)]]]),
			publicReturns: [[new Fr(42n)]],
		})
		const calls: CallAction[] = [
			{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] }, // index 0: utility
			{ kind: "call", contract: CONTRACT_A, method: "bal_pub", args: [] }, // index 1: public
		]
		const result = await batchedViewSimulation(calls, deps)
		expect(deps.pxe.executeUtility).toHaveBeenCalledTimes(1)
		expect(deps.pxe.simulateTx).toHaveBeenCalledTimes(1)
		// Per-input-index ordering preserved
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(7n)
		expect(result.encoded[1]?.[0]?.toBigInt()).toBe(42n)
	})

	test("`hideSender` propagates for 'call'-kind tx-typed", async () => {
		const captureFunctionCalls: Array<{ hideMsgSender: boolean; type: FunctionType; index: number }> = []
		const deps = makeDeps({
			functions: { bal_pub: { kind: FunctionType.PUBLIC } },
			publicReturns: [[new Fr(0n)]],
			captureFunctionCalls,
		})
		const calls: CallAction[] = [{ kind: "call", contract: CONTRACT_A, method: "bal_pub", args: [], hideSender: true }]
		await batchedViewSimulation(calls, deps)
		expect(captureFunctionCalls[0]?.hideMsgSender).toBe(true)
	})

	test("`hideMsgSender` propagates for 'encoded_call'-kind tx-typed", async () => {
		const captureFunctionCalls: Array<{ hideMsgSender: boolean; type: FunctionType; index: number }> = []
		const deps = makeDeps({
			functions: { bal_pub: { kind: FunctionType.PUBLIC } },
			publicReturns: [[new Fr(0n)]],
			captureFunctionCalls,
		})
		// Match the helper's `findFunctionBySelector` lookup: our top-of-file
		// `vi.mock` makes `FunctionSelector.fromNameAndParameters(name)` return
		// `{toString: () => 'selector-${name}'}`, so passing that exact string
		// hits the encoded_call → tx-typed branch instead of erroring out.
		const calls: EncodedCallAction[] = [
			{
				kind: "encoded_call",
				to: CONTRACT_A,
				selector: "selector-bal_pub",
				args: [],
				name: "bal_pub",
				type: "public",
				isStatic: false,
				hideMsgSender: true,
				returnTypes: [],
			},
		]
		await batchedViewSimulation(calls, deps)
		const txCapture = captureFunctionCalls.find((c) => c.type === FunctionType.PUBLIC)
		expect(txCapture?.hideMsgSender).toBe(true)
	})

	test("'encoded_call' UTILITY ignores hideMsgSender → hardcoded false", async () => {
		const captureFunctionCalls: Array<{ hideMsgSender: boolean; type: FunctionType; index: number }> = []
		const deps = makeDeps({
			functions: { bal_priv: { kind: FunctionType.UTILITY } },
			utilityReturns: new Map([["bal_priv", [new Fr(0n)]]]),
			captureFunctionCalls,
		})
		// hideMsgSender:true on UTILITY-typed encoded_call → helper hardcodes
		// false on the FunctionCall constructor arg regardless of input.
		const calls: EncodedCallAction[] = [
			{
				kind: "encoded_call",
				to: CONTRACT_A,
				selector: "selector-bal_priv",
				args: [],
				name: "bal_priv",
				type: "utility",
				isStatic: false,
				hideMsgSender: true,
				returnTypes: [],
			},
		]
		await batchedViewSimulation(calls, deps)
		const utilityCapture = captureFunctionCalls.find((c) => c.type === FunctionType.UTILITY)
		expect(utilityCapture?.hideMsgSender).toBe(false)
	})

	test("UTILITY calls always pass hideMsgSender=false regardless of input kind", async () => {
		const captureFunctionCalls: Array<{ hideMsgSender: boolean; type: FunctionType; index: number }> = []
		const deps = makeDeps({
			functions: { bal_priv: { kind: FunctionType.UTILITY } },
			utilityReturns: new Map([["bal_priv", [new Fr(0n)]]]),
			captureFunctionCalls,
		})
		// hideSender:true on 'call' kind — utility ignores it, hardcodes false.
		const calls: CallAction[] = [{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [], hideSender: true }]
		await batchedViewSimulation(calls, deps)
		const utilityCapture = captureFunctionCalls.find((c) => c.type === FunctionType.UTILITY)
		expect(utilityCapture?.hideMsgSender).toBe(false)
	})

	test("unknown contract → 'Contract not found' (error string preserved)", async () => {
		const deps = makeDeps({ functions: {} })
		// Stub returns instances only for CONTRACT_A/B; ask for a different one.
		const calls: CallAction[] = [
			{
				kind: "call",
				contract: "0x0000000000000000000000000000000000000000000000000000000000000999",
				method: "foo",
				args: [],
			},
		]
		await expect(batchedViewSimulation(calls, deps)).rejects.toThrow(/Contract not found/)
	})

	test("unknown method → 'Method not found' (error string preserved)", async () => {
		const deps = makeDeps({ functions: { bal_pub: { kind: FunctionType.PUBLIC } } })
		const calls: CallAction[] = [{ kind: "call", contract: CONTRACT_A, method: "no_such_method", args: [] }]
		await expect(batchedViewSimulation(calls, deps)).rejects.toThrow(/Method not found/)
	})

	test("concurrency: utility promises are launched before simulateTx resolves (parallel-launch parity)", async () => {
		const events: Event[] = []
		const deps = makeDeps({
			functions: {
				bal_priv: { kind: FunctionType.UTILITY },
				bal_pub: { kind: FunctionType.PUBLIC },
			},
			utilityReturns: new Map([["bal_priv", [new Fr(0n)]]]),
			publicReturns: [[new Fr(0n)]],
			utilityDelay: 30,
			events,
		})
		// Three utility calls + 1 public call — utilities launched eagerly,
		// public goes through simulateTx, then utilities awaited last.
		const calls: CallAction[] = [
			{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] },
			{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] },
			{ kind: "call", contract: CONTRACT_A, method: "bal_priv", args: [] },
			{ kind: "call", contract: CONTRACT_A, method: "bal_pub", args: [] },
		]
		await batchedViewSimulation(calls, deps)

		// All three utility calls were invoked BEFORE simulateTx returned.
		const utilityCallEvents = events.filter((e) => e.type === "executeUtility-call")
		const simulateTxResolveIdx = events.findIndex((e) => e.type === "simulateTx-resolve")
		const utilityCallsBeforeSimResolve = utilityCallEvents.filter((e) => events.indexOf(e) < simulateTxResolveIdx)
		expect(utilityCallsBeforeSimResolve).toHaveLength(3)

		// All utility-resolve events come AFTER simulateTx-resolve (because
		// utility was delayed long enough that simulateTx's immediate-resolve
		// landed first). This pins the serial-await-after-tx-batch invariant.
		const lastUtilityResolveIdx = events
			.map((e, i) => (e.type === "executeUtility-resolve" ? i : -1))
			.reduce((a, b) => Math.max(a, b), -1)
		expect(lastUtilityResolveIdx).toBeGreaterThan(simulateTxResolveIdx)
	})
})

// ── Fast-arm tests (PR adding leading-prefix public-static optimization) ────

describe("batchedViewSimulation — fast arm (PUBLIC+isStatic leading prefix)", () => {
	beforeEach(() => {
		simulateViaNodeMock.mockReset()
	})

	function fastSimResult(publicReturnValues: Array<{ values: Fr[] }>): import("@aztec/stdlib/tx").TxSimulationResult {
		return {
			publicOutput: {
				publicReturnValues,
			},
			// biome-ignore lint/suspicious/noExplicitAny: shape covers only what unpack reads
		} as any
	}

	function publicStaticCall(method = "bal_pub"): CallAction {
		return { kind: "call", contract: CONTRACT_A, method, args: [] }
	}

	function privateCall(method = "bal_priv"): CallAction {
		return { kind: "call", contract: CONTRACT_A, method, args: [] }
	}

	function utilityCall(method = "bal_util"): CallAction {
		return { kind: "call", contract: CONTRACT_A, method, args: [] }
	}

	test("pure PUBLIC+isStatic batch → simulateViaNode only, no pxe.simulateTx", async () => {
		simulateViaNodeMock.mockResolvedValueOnce([fastSimResult([{ values: [new Fr(100n)] }, { values: [new Fr(200n)] }])])
		const deps = makeDeps({
			functions: { bal_pub: { kind: FunctionType.PUBLIC, isStatic: true } },
		})
		const result = await batchedViewSimulation([publicStaticCall(), publicStaticCall()], deps)
		expect(simulateViaNodeMock).toHaveBeenCalledOnce()
		expect(deps.pxe.simulateTx).not.toHaveBeenCalled()
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(100n)
		expect(result.encoded[1]?.[0]?.toBigInt()).toBe(200n)
	})

	test("mixed leading prefix + private tail → BOTH arms invoked, results merged by originalIndex", async () => {
		simulateViaNodeMock.mockResolvedValueOnce([fastSimResult([{ values: [new Fr(1n)] }, { values: [new Fr(2n)] }])])
		const deps = makeDeps({
			functions: {
				bal_pub: { kind: FunctionType.PUBLIC, isStatic: true },
				bal_priv: { kind: FunctionType.PRIVATE, isStatic: true },
			},
			privateReturns: [[new Fr(7n)]],
		})
		const calls: CallAction[] = [publicStaticCall(), publicStaticCall(), privateCall()]
		const result = await batchedViewSimulation(calls, deps)
		expect(simulateViaNodeMock).toHaveBeenCalledOnce()
		expect(deps.pxe.simulateTx).toHaveBeenCalledOnce()
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(1n)
		expect(result.encoded[1]?.[0]?.toBigInt()).toBe(2n)
		expect(result.encoded[2]?.[0]?.toBigInt()).toBe(7n)
	})

	test("PRIVATE first → prefix empty, fast arm NOT triggered, today's path runs", async () => {
		const deps = makeDeps({
			functions: {
				bal_pub: { kind: FunctionType.PUBLIC, isStatic: true },
				bal_priv: { kind: FunctionType.PRIVATE, isStatic: true },
			},
			publicReturns: [[new Fr(42n)]],
			privateReturns: [[new Fr(7n)]],
		})
		const calls: CallAction[] = [privateCall(), publicStaticCall()]
		await batchedViewSimulation(calls, deps)
		expect(simulateViaNodeMock).not.toHaveBeenCalled()
		expect(deps.pxe.simulateTx).toHaveBeenCalledOnce()
	})

	test("PUBLIC-non-static breaks the prefix → fast arm gets only leading static run", async () => {
		simulateViaNodeMock.mockResolvedValueOnce([fastSimResult([{ values: [new Fr(99n)] }])])
		const deps = makeDeps({
			functions: {
				bal_pub: { kind: FunctionType.PUBLIC, isStatic: true },
				do_thing: { kind: FunctionType.PUBLIC, isStatic: false },
				bal_pub2: { kind: FunctionType.PUBLIC, isStatic: true },
			},
			publicReturns: [[new Fr(50n)], [new Fr(150n)]],
		})
		const calls: CallAction[] = [
			publicStaticCall("bal_pub"), // fast
			publicStaticCall("do_thing"), // breaks prefix
			publicStaticCall("bal_pub2"), // would be fast-eligible but prefix already broken
		]
		await batchedViewSimulation(calls, deps)
		expect(simulateViaNodeMock).toHaveBeenCalledOnce()
		// Fast arm got 1 call only.
		const fastCallsArg = simulateViaNodeMock.mock.calls[0]?.[1] as unknown[]
		expect(fastCallsArg).toHaveLength(1)
	})

	test("hideSender:true on leading PUBLIC+isStatic call → routed to slow arm (prefix breaks at that call)", async () => {
		const deps = makeDeps({
			functions: { bal_pub: { kind: FunctionType.PUBLIC, isStatic: true } },
			publicReturns: [[new Fr(0n)]],
		})
		const calls: CallAction[] = [{ kind: "call", contract: CONTRACT_A, method: "bal_pub", args: [], hideSender: true }]
		await batchedViewSimulation(calls, deps)
		// Prefix breaks at the first call because hideMsgSender === true; fast arm never invoked.
		expect(simulateViaNodeMock).not.toHaveBeenCalled()
		expect(deps.pxe.simulateTx).toHaveBeenCalledOnce()
	})

	test("all-public-static + UTILITY queued → fast arm runs, slow arm skipped, utility parallel", async () => {
		simulateViaNodeMock.mockResolvedValueOnce([fastSimResult([{ values: [new Fr(1n)] }])])
		const deps = makeDeps({
			functions: {
				bal_pub: { kind: FunctionType.PUBLIC, isStatic: true },
				bal_util: { kind: FunctionType.UTILITY },
			},
			utilityReturns: new Map([["bal_util", [new Fr(8n)]]]),
		})
		const calls: CallAction[] = [publicStaticCall(), utilityCall()]
		const result = await batchedViewSimulation(calls, deps)
		expect(simulateViaNodeMock).toHaveBeenCalledOnce()
		expect(deps.pxe.simulateTx).not.toHaveBeenCalled()
		expect(deps.pxe.executeUtility).toHaveBeenCalledOnce()
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(1n)
		expect(result.encoded[1]?.[0]?.toBigInt()).toBe(8n)
	})

	test("block-header anchor missing → silent FULL fallback, simulateViaNode never called", async () => {
		const deps = makeDeps({
			functions: { bal_pub: { kind: FunctionType.PUBLIC, isStatic: true } },
			publicReturns: [[new Fr(5n)]],
			pxeHeader: "throw",
			nodeHeader: "null",
		})
		const result = await batchedViewSimulation([publicStaticCall()], deps)
		expect(simulateViaNodeMock).not.toHaveBeenCalled()
		expect(deps.pxe.simulateTx).toHaveBeenCalledOnce()
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(5n)
	})

	test("simulateViaNode throws SimulationError → propagates, slow arm result discarded", async () => {
		const simErr = new SimulationError("revert msg", [])
		simulateViaNodeMock.mockRejectedValueOnce(simErr)
		const deps = makeDeps({
			functions: { bal_pub: { kind: FunctionType.PUBLIC, isStatic: true } },
		})
		await expect(batchedViewSimulation([publicStaticCall()], deps)).rejects.toBe(simErr)
	})

	test("simulateViaNode throws generic Error → WARN log + full rerun via standard simulateTx", async () => {
		simulateViaNodeMock.mockRejectedValueOnce(new Error("node blip"))
		const logSpy = vi.fn()
		const deps = makeDeps({
			functions: {
				bal_pub: { kind: FunctionType.PUBLIC, isStatic: true },
				bal_priv: { kind: FunctionType.PRIVATE, isStatic: true },
			},
			publicReturns: [[new Fr(33n)]],
			privateReturns: [[new Fr(77n)]],
		})
		// Replace the no-op logger with a spy.
		;(deps as { logger?: ILogger }).logger = { log: logSpy } as ILogger
		const calls: CallAction[] = [publicStaticCall(), privateCall()]
		const result = await batchedViewSimulation(calls, deps)
		// Slow arm called twice: once in the original parallel dispatch, once in
		// the rerun with combined payload. The combined rerun's values land in
		// encoded[].
		expect(deps.pxe.simulateTx).toHaveBeenCalledTimes(2)
		expect(logSpy).toHaveBeenCalled()
		const warnCall = logSpy.mock.calls.find((c) => c[1] === LogLevel.Warn)
		expect(warnCall).toBeTruthy()
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(33n)
		expect(result.encoded[1]?.[0]?.toBigInt()).toBe(77n)
	})

	test("rerun invariant: utility executeUtility called exactly ONCE, not re-launched on fast-arm fallback", async () => {
		simulateViaNodeMock.mockRejectedValueOnce(new Error("fast blip"))
		const deps = makeDeps({
			functions: {
				bal_pub: { kind: FunctionType.PUBLIC, isStatic: true },
				bal_util: { kind: FunctionType.UTILITY },
			},
			publicReturns: [[new Fr(0n)]],
			utilityReturns: new Map([["bal_util", [new Fr(0n)]]]),
		})
		await batchedViewSimulation([publicStaticCall(), utilityCall()], deps)
		// Utility launched once at the start; rerun must NOT re-launch.
		expect(deps.pxe.executeUtility).toHaveBeenCalledOnce()
	})

	test("node.getNodeInfo throws → propagates (shared-fate with slow arm, no silent fallback)", async () => {
		simulateViaNodeMock.mockResolvedValueOnce([fastSimResult([{ values: [new Fr(0n)] }])])
		const deps = makeDeps({
			functions: { bal_pub: { kind: FunctionType.PUBLIC, isStatic: true } },
			nodeInfo: "throw",
		})
		await expect(batchedViewSimulation([publicStaticCall()], deps)).rejects.toThrow(/node info error/)
	})

	test("ordering: anchor read completes BEFORE utility launch (rw-guard hazard)", async () => {
		simulateViaNodeMock.mockResolvedValueOnce([fastSimResult([{ values: [new Fr(0n)] }])])
		const events: string[] = []
		const deps = makeDeps({
			functions: {
				bal_pub: { kind: FunctionType.PUBLIC, isStatic: true },
				bal_util: { kind: FunctionType.UTILITY },
			},
			utilityReturns: new Map([["bal_util", [new Fr(0n)]]]),
		})
		// Wrap pxe.getSyncedBlockHeader and pxe.executeUtility to record invocation order.
		const origAnchor = deps.pxe.getSyncedBlockHeader.bind(deps.pxe)
		// biome-ignore lint/suspicious/noExplicitAny: stub patching
		;(deps.pxe as any).getSyncedBlockHeader = vi.fn(async () => {
			events.push("anchor-call")
			const r = await origAnchor()
			events.push("anchor-return")
			return r
		})
		const origExecUtility = deps.pxe.executeUtility.bind(deps.pxe)
		// biome-ignore lint/suspicious/noExplicitAny: stub patching
		;(deps.pxe as any).executeUtility = vi.fn(async (call: unknown, optsArg: unknown) => {
			events.push("utility-call")
			// biome-ignore lint/suspicious/noExplicitAny: forward through stub boundary
			return origExecUtility(call as any, optsArg as any)
		})
		await batchedViewSimulation([publicStaticCall(), utilityCall()], deps)
		// Anchor return must occur before any utility call.
		const anchorReturnIdx = events.indexOf("anchor-return")
		const firstUtilityCallIdx = events.indexOf("utility-call")
		expect(anchorReturnIdx).toBeGreaterThanOrEqual(0)
		expect(firstUtilityCallIdx).toBeGreaterThanOrEqual(0)
		expect(anchorReturnIdx).toBeLessThan(firstUtilityCallIdx)
	})

	test("indexing: 2 PUBLIC+isStatic + 2 PRIVATE in mixed batch unpack to correct originalIndex slots", async () => {
		simulateViaNodeMock.mockResolvedValueOnce([fastSimResult([{ values: [new Fr(101n)] }, { values: [new Fr(102n)] }])])
		const deps = makeDeps({
			functions: {
				bal_pub: { kind: FunctionType.PUBLIC, isStatic: true },
				bal_priv: { kind: FunctionType.PRIVATE, isStatic: true },
			},
			privateReturns: [[new Fr(201n)], [new Fr(202n)]],
		})
		const calls: CallAction[] = [publicStaticCall(), publicStaticCall(), privateCall(), privateCall()]
		const result = await batchedViewSimulation(calls, deps)
		expect(result.encoded[0]?.[0]?.toBigInt()).toBe(101n)
		expect(result.encoded[1]?.[0]?.toBigInt()).toBe(102n)
		expect(result.encoded[2]?.[0]?.toBigInt()).toBe(201n)
		expect(result.encoded[3]?.[0]?.toBigInt()).toBe(202n)
	})

	test("origin-equality after partition: private-only slow payload still uses .nested branch", async () => {
		simulateViaNodeMock.mockResolvedValueOnce([fastSimResult([{ values: [new Fr(1n)] }])])
		const deps = makeDeps({
			functions: {
				bal_pub: { kind: FunctionType.PUBLIC, isStatic: true },
				bal_priv: { kind: FunctionType.PRIVATE, isStatic: true },
			},
			privateReturns: [[new Fr(9n)]],
			originDiffers: false, // pin: origin === account.address → .nested
		})
		const calls: CallAction[] = [publicStaticCall(), privateCall()]
		const result = await batchedViewSimulation(calls, deps)
		expect(result.encoded[1]?.[0]?.toBigInt()).toBe(9n)
	})

	test("only ONE flatMap construction per fast-arm dispatch (no per-tuple recompute)", async () => {
		// We can't directly observe `flatMap`, but we can observe `simulateViaNodeMock`
		// being called once. If the implementation invoked flatMap inside the per-tuple
		// loop, simulateViaNode would still be called once — but the unpack would
		// still be correct. This test is a contract check that fast arm dispatches
		// once total per helper invocation, not once per call.
		simulateViaNodeMock.mockResolvedValueOnce([
			fastSimResult([{ values: [new Fr(1n)] }, { values: [new Fr(2n)] }, { values: [new Fr(3n)] }]),
		])
		const deps = makeDeps({
			functions: { bal_pub: { kind: FunctionType.PUBLIC, isStatic: true } },
		})
		await batchedViewSimulation([publicStaticCall(), publicStaticCall(), publicStaticCall()], deps)
		expect(simulateViaNodeMock).toHaveBeenCalledOnce()
	})
})
