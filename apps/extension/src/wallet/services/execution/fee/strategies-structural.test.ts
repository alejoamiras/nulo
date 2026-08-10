/**
 * Per-strategy structural parity fixtures — the anti-transposition
 * tripwire for the tuple→object conversion (and any future reshaping).
 *
 * Every same-typed slot carries a DISTINCT sentinel, every passthrough
 * field a distinct identity. A swap of gas/teardown/fee values, a
 * passthrough mix-up (node vs pxe), or a payment-method mismatch fails
 * loudly here while staying invisible to scenario-level e2e.
 *
 * The FPC fixture additionally pins the two-pass build choreography the
 * byte-parity constraint freezes: build(PREEXISTING) → sim → fee payload
 * unshift → build(EXTERNAL) → gasSettings from FIRST sim → sim → splice
 * payload+originals → finalize with baseFees.
 */

import { describe, expect, test, vi } from "vitest"
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { TxSimulationResult } from "@aztec/stdlib/tx"
import { FpcType } from "@/wallet/services/fpc/service"
import type { FeeStrategyContext, FeeStrategyDeps } from "./fee-strategy"
import { FeeJuiceStrategy } from "./fee-juice-strategy"
import { FpcStrategy } from "./fpc-strategy"
import { EmbeddedStrategy } from "./embedded-strategy"
import type { Action } from "../spec"

const PRIORITY = new GasFees(7n, 8n)

function sentinelTxRequest() {
	return {
		// A non-initialization-wrapped request: origin == the account address
		// (the multicall-wrapped shape carries the entrypoint address instead,
		// and must never be stubbed — pinned below).
		origin: { toString: () => "0xaccount" },
		txContext: {
			gasSettings: new GasSettings(new Gas(11_000, 22_000), new Gas(3_300, 4_400), new GasFees(555n, 666n), PRIORITY),
		},
	}
}

function sentinelSim(): TxSimulationResult {
	return {
		gasUsed: {
			totalGas: new Gas(31_000, 32_000),
			teardownGas: new Gas(3_500, 3_600),
		},
	} as unknown as TxSimulationResult
}

const fakeTask = { complete: vi.fn(), fail: vi.fn(), startSubtask: vi.fn() }

/** Distinct identities per passthrough slot — a node/pxe/account swap
 *  shows up as a failed identity assertion. */
function makeBuilt() {
	return {
		txRequest: sentinelTxRequest(),
		node: { getCurrentMinFees: async () => new GasFees(555n, 666n), marker: "node" },
		pxe: { marker: "pxe" },
		account: { address: { toString: () => "0xaccount" }, marker: "account" },
		network: { marker: "network" },
		nonce: { toString: () => "nonce-1" },
		txCalls: [{ contract: "0xc", method: "m", args: [] }],
	}
}

function makeDeps(built = makeBuilt()) {
	const buildStandard = vi.fn(async () => built)
	const simulateTxTask = vi.fn(async () => sentinelSim())
	const deps = {
		txBuilder: { buildStandard },
		simulateTxTask,
		fpcService: { getFpcImpl: vi.fn() },
		tasks: { startNewTask: () => fakeTask },
		logger: { log: () => {} },
	} as unknown as FeeStrategyDeps
	return { deps, buildStandard, simulateTxTask, built }
}

function makeCtx(overrides: Partial<FeeStrategyContext["op"]> = {}): FeeStrategyContext {
	return {
		op: { networkId: "net-1", accountAddress: "0xacc", actions: [] as Action[], ...overrides },
		feeSettings: { paymentMethod: { kind: "fj" } },
		gasPadding: 1,
		deps: undefined as never, // strategies receive deps via ctor, not ctx
	} as unknown as FeeStrategyContext
}

function shape(txRequest: { txContext: { gasSettings: GasSettings } }) {
	const gs = txRequest.txContext.gasSettings
	return {
		gasDa: gs.gasLimits.daGas,
		gasL2: gs.gasLimits.l2Gas,
		teardownDa: gs.teardownGasLimits.daGas,
		teardownL2: gs.teardownGasLimits.l2Gas,
		feeDa: gs.maxFeesPerGas.feePerDaGas,
		feeL2: gs.maxFeesPerGas.feePerL2Gas,
	}
}

describe("FeeJuiceStrategy structural parity", () => {
	test("passthrough identities + finalized sentinel shape + payment method", async () => {
		const { deps, buildStandard, simulateTxTask, built } = makeDeps()
		const result = await new FeeJuiceStrategy(deps).buildAndEstimate(makeCtx())

		// Passthroughs are the EXACT objects the builder returned.
		expect(result.txRequest).toBe(built.txRequest)
		expect(result.node).toBe(built.node)
		expect(result.pxe).toBe(built.pxe)
		expect(result.account).toBe(built.account)
		expect(result.network).toBe(built.network)
		expect(result.nonce).toBe(built.nonce)
		expect(result.txCalls).toBe(built.txCalls)
		expect(result.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)

		expect(buildStandard).toHaveBeenCalledTimes(1)
		expect((buildStandard.mock.calls[0] as unknown[])[1]).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		expect(simulateTxTask).toHaveBeenCalledTimes(1)
		// Sim opts: scopes = [account.address] exactly.
		expect((simulateTxTask.mock.calls[0] as unknown[])[2]).toEqual({
			simulatePublic: true,
			skipFeeEnforcement: true,
			scopes: [built.account.address],
		})

		// finalizeGasLimits with padding 1, multiplier default 2:
		// limits = simulated sentinels, fees = min(555,666) × 2.
		expect(shape(result.txRequest)).toEqual({
			gasDa: 31_000,
			gasL2: 32_000,
			teardownDa: 3_500,
			teardownL2: 3_600,
			feeDa: 1_110n,
			feeL2: 1_332n,
		})
	})
})

describe("EmbeddedStrategy structural parity", () => {
	test("1x multiplier keeps fees at node min; embedded kind maps to method", async () => {
		const { deps, built } = makeDeps()
		const ctx = makeCtx({ fee: { embeddedFeePayment: "fpc" } as never })
		const result = await new EmbeddedStrategy(deps).buildAndEstimate(ctx)

		expect(result.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.EXTERNAL)
		expect(result.txRequest).toBe(built.txRequest)
		// Embedded contract: multiplier 1 → fees stay at node min exactly.
		const s = shape(result.txRequest)
		expect([s.feeDa, s.feeL2]).toEqual([555n, 666n])
		expect([s.gasDa, s.gasL2]).toEqual([31_000, 32_000])
	})

	test("fjwc embedded kind maps to FEE_JUICE_WITH_CLAIM", async () => {
		const { deps } = makeDeps()
		const ctx = makeCtx({ fee: { embeddedFeePayment: "fjwc" } as never })
		const result = await new EmbeddedStrategy(deps).buildAndEstimate(ctx)
		expect(result.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM)
	})

	test("missing embeddedFeePayment throws the frozen message", async () => {
		const { deps } = makeDeps()
		await expect(new EmbeddedStrategy(deps).buildAndEstimate(makeCtx())).rejects.toThrow("Embedded fee payment not specified")
	})
})

describe("FpcStrategy structural parity (two-pass choreography — byte-parity constraint)", () => {
	function makeFpc() {
		const feePayloadAction = { kind: "call", contract: "0xfpc", method: "pay_fee", args: [] } as unknown as Action
		return {
			getTotalGas: () => new Gas(1_000, 2_000),
			getTeardownGas: () => new Gas(100, 200),
			getFeePayload: vi.fn(() => [feePayloadAction]),
			feePayloadAction,
		}
	}

	test("build×2 (PREEXISTING then EXTERNAL), action mutation sequence, fees from baseFees", async () => {
		// Two distinct built objects so pass identity is provable.
		const builtA = makeBuilt()
		const builtB = makeBuilt()
		const buildStandard = vi.fn().mockResolvedValueOnce(builtA).mockResolvedValueOnce(builtB)
		const simulateTxTask = vi.fn(async () => sentinelSim())
		const fpc = makeFpc()
		const deps = {
			txBuilder: { buildStandard },
			simulateTxTask,
			fpcService: { getFpcImpl: vi.fn(async () => fpc) },
			tasks: { startNewTask: () => fakeTask },
			logger: { log: () => {} },
		} as unknown as FeeStrategyDeps

		const originalAction = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
		const ctx = makeCtx({ actions: [originalAction] })
		ctx.feeSettings = { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } }

		const result = await new FpcStrategy(deps).buildAndEstimate(ctx)

		// Two-pass: first PREEXISTING_FEE_JUICE, then EXTERNAL.
		expect(buildStandard).toHaveBeenCalledTimes(2)
		expect(buildStandard.mock.calls[0]?.[1]).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		expect(buildStandard.mock.calls[1]?.[1]).toBe(AccountFeePaymentMethodOptions.EXTERNAL)
		// Result carries the SECOND pass's identities.
		expect(result.txRequest).toBe(builtB.txRequest)
		expect(result.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.EXTERNAL)

		// Final action shape: fee payload first, then originals (splice pin).
		expect(ctx.op.actions[0]).toBe(fpc.feePayloadAction)
		expect(ctx.op.actions[1]).toBe(originalAction)
		expect(ctx.op.actions).toHaveLength(2)

		// Fees finalized from baseFees = min × multiplier(2): 1_110/1_332.
		const s = shape(result.txRequest)
		expect([s.feeDa, s.feeL2]).toEqual([1_110n, 1_332n])
		// Limits from finalize: second sim × padding 1.
		expect([s.gasDa, s.gasL2]).toEqual([31_000, 32_000])
	})
})

describe("FpcStrategy canonical-Sponsored fast path (single-pass)", () => {
	function makeSponsoredFpc(overrides: Partial<{ type: FpcType; isProtocol: boolean }> = {}) {
		const feePayloadAction = { kind: "call", contract: "0xsfpc", method: "sponsor_unconditionally", args: [] } as unknown as Action
		return {
			infoData: { type: FpcType.DefaultSponsoredFpc, isProtocol: true, ...overrides },
			getTotalGas: () => new Gas(1_000, 2_000),
			getTeardownGas: () => new Gas(100, 200),
			getFeePayload: vi.fn(() => [feePayloadAction]),
			feePayloadAction,
		}
	}

	function makeFpcDeps(fpc: ReturnType<typeof makeSponsoredFpc>) {
		const buildStandard = vi.fn(async () => makeBuilt())
		const simulateTxTask = vi.fn(async () => sentinelSim())
		const deps = {
			txBuilder: { buildStandard },
			simulateTxTask,
			fpcService: { getFpcImpl: vi.fn(async () => fpc) },
			tasks: { startNewTask: () => fakeTask },
			logger: { log: () => {} },
		} as unknown as FeeStrategyDeps
		return { deps, buildStandard, simulateTxTask }
	}

	function makeFpcCtx(opOverrides: Partial<FeeStrategyContext["op"]> = {}): FeeStrategyContext {
		const originalAction = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
		const ctx = makeCtx({ actions: [originalAction], ...opOverrides })
		ctx.feeSettings = { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } } as never
		return ctx
	}

	test("SIM-COUNT PIN: build×1 (EXTERNAL only) + sim×1 — send fpc estimate 2→1", async () => {
		const fpc = makeSponsoredFpc()
		const { deps, buildStandard, simulateTxTask } = makeFpcDeps(fpc)
		const ctx = makeFpcCtx()

		const result = await new FpcStrategy(deps).buildAndEstimate(ctx)

		expect(buildStandard).toHaveBeenCalledTimes(1)
		expect((buildStandard.mock.calls[0] as unknown[])[1]).toBe(AccountFeePaymentMethodOptions.EXTERNAL)
		expect(simulateTxTask).toHaveBeenCalledTimes(1)
		expect(result.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.EXTERNAL)

		// Final action shape identical to the two-pass output: payload first,
		// then originals, nothing else.
		expect(ctx.op.actions[0]).toBe(fpc.feePayloadAction)
		expect(ctx.op.actions).toHaveLength(2)

		// OLD-VS-NEW GAS-SLOT PIN: finalize composes the same sentinel shape
		// the two-pass produced — sim limits × padding 1, fees = min × 2.
		expect(shape(result.txRequest as never)).toEqual({
			gasDa: 31_000,
			gasL2: 32_000,
			teardownDa: 3_500,
			teardownL2: 3_600,
			feeDa: 1_110n,
			feeL2: 1_332n,
		})
	})

	test("dApp-supplied custom gas limits force the two-pass path (H2 carve-out)", async () => {
		const fpc = makeSponsoredFpc()
		const { deps, buildStandard, simulateTxTask } = makeFpcDeps(fpc)
		const ctx = makeFpcCtx({ fee: { gasLimits: { daGas: 9, l2Gas: 9 } } as never })

		await new FpcStrategy(deps).buildAndEstimate(ctx)

		expect(buildStandard).toHaveBeenCalledTimes(2)
		expect(simulateTxTask).toHaveBeenCalledTimes(2)
	})

	test("non-protocol (user-added) Sponsored address stays two-pass", async () => {
		const fpc = makeSponsoredFpc({ isProtocol: false })
		const { deps, buildStandard } = makeFpcDeps(fpc)

		await new FpcStrategy(deps).buildAndEstimate(makeFpcCtx())

		expect(buildStandard).toHaveBeenCalledTimes(2)
	})

	test("PrivateFPC stays two-pass (envelope-dependent pay_fee — load-bearing Pass 1)", async () => {
		const fpc = makeSponsoredFpc({ type: FpcType.PrivateFpc, isProtocol: true })
		const { deps, buildStandard, simulateTxTask } = makeFpcDeps(fpc)

		await new FpcStrategy(deps).buildAndEstimate(makeFpcCtx())

		expect(buildStandard).toHaveBeenCalledTimes(2)
		expect(simulateTxTask).toHaveBeenCalledTimes(2)
	})

	test("row-chain vs operation-chain mismatch bails to two-pass after the probe build", async () => {
		// isProtocol was decorated against the row's OWN chain — a cross-chain
		// row selection must not ride that stale signal into the fast path.
		const fpc = makeSponsoredFpc()
		;(fpc.infoData as { chainId?: number }).chainId = 999
		const buildStandard = vi.fn(async () => ({ ...makeBuilt(), network: { marker: "network", chainId: 7 } }))
		const simulateTxTask = vi.fn(async () => sentinelSim())
		const deps = {
			txBuilder: { buildStandard },
			simulateTxTask,
			fpcService: { getFpcImpl: vi.fn(async () => fpc) },
			tasks: { startNewTask: () => fakeTask },
			logger: { log: () => {} },
		} as unknown as FeeStrategyDeps
		const ctx = makeFpcCtx()
		const originalAction = ctx.op.actions[0]

		await new FpcStrategy(deps).buildAndEstimate(ctx)

		// 1 probe build (fast path) + 2 two-pass builds; two-pass sims only.
		expect(buildStandard).toHaveBeenCalledTimes(3)
		expect(simulateTxTask).toHaveBeenCalledTimes(2)
		// Final action shape is the two-pass output: payload + originals.
		expect(ctx.op.actions[1]).toBe(originalAction)
		expect(ctx.op.actions).toHaveLength(2)
	})

	test("undecorated FPC shape (cold protocol cache) fails safe to two-pass", async () => {
		const fpc = makeSponsoredFpc()
		;(fpc as { infoData?: unknown }).infoData = undefined
		const { deps, buildStandard } = makeFpcDeps(fpc)

		await new FpcStrategy(deps).buildAndEstimate(makeFpcCtx())

		expect(buildStandard).toHaveBeenCalledTimes(2)
	})
})

describe("FeeJuiceStrategy folded (probed) runs", () => {
	const DISCOVERED_FJ = { kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "0xfj" } } as unknown as Action

	function fjFoldedCtx(probe: unknown, actions: Action[]): FeeStrategyContext {
		const ctx = makeCtx({ actions })
		;(ctx as { probe?: unknown }).probe = probe
		return ctx
	}

	test("SIM-COUNT PIN: no effects ⇒ ONE stubbed sim, one build — dApp fj estimate 2→1", async () => {
		const builtA = makeBuilt()
		const buildStandard = vi.fn(async () => builtA)
		const simulateTxTask = vi.fn(async () => sentinelSim())
		const deps = {
			txBuilder: { buildStandard },
			simulateTxTask,
			fpcService: { getFpcImpl: vi.fn() },
			tasks: { startNewTask: () => fakeTask },
			logger: { log: () => {} },
		} as unknown as FeeStrategyDeps
		const probe = { extractEffects: vi.fn(async () => []), collected: [] }
		const original = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
		const ctx = fjFoldedCtx(probe, [original])

		const result = await new FeeJuiceStrategy(deps).buildAndEstimate(ctx)

		expect(buildStandard).toHaveBeenCalledTimes(1)
		expect(simulateTxTask).toHaveBeenCalledTimes(1)
		expect((simulateTxTask.mock.calls[0] as unknown[])[2]).toEqual({
			simulatePublic: true,
			skipFeeEnforcement: true,
			skipTxValidation: true,
			scopes: [builtA.account.address],
			stubAccountAddresses: ["0xaccount"],
		})
		expect(probe.extractEffects).toHaveBeenCalledTimes(1)
		expect(result.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		expect(ctx.op.actions).toEqual([original])
	})

	test("effects ⇒ VALIDATED rebuild + re-sim (both builds PREEXISTING); discovered actions after originals", async () => {
		const builtA = makeBuilt()
		const builtB = makeBuilt()
		const buildStandard = vi.fn().mockResolvedValueOnce(builtA).mockResolvedValueOnce(builtB)
		const simulateTxTask = vi.fn(async () => sentinelSim())
		const deps = {
			txBuilder: { buildStandard },
			simulateTxTask,
			fpcService: { getFpcImpl: vi.fn() },
			tasks: { startNewTask: () => fakeTask },
			logger: { log: () => {} },
		} as unknown as FeeStrategyDeps
		const probe = { extractEffects: vi.fn(async () => [DISCOVERED_FJ]), collected: [DISCOVERED_FJ] }
		const original = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
		const ctx = fjFoldedCtx(probe, [original])

		const result = await new FeeJuiceStrategy(deps).buildAndEstimate(ctx)

		expect(buildStandard).toHaveBeenCalledTimes(2)
		expect(buildStandard.mock.calls[0]?.[1]).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		expect(buildStandard.mock.calls[1]?.[1]).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		expect(simulateTxTask).toHaveBeenCalledTimes(2)
		expect((simulateTxTask.mock.calls[1] as unknown[])[2]).toEqual({
			simulatePublic: true,
			skipFeeEnforcement: true,
			scopes: [builtB.account.address],
		})
		// Result carries the rebuild's identities; finalize reads the SECOND sim.
		expect(result.txRequest).toBe(builtB.txRequest)
		expect(ctx.op.actions).toEqual([original, DISCOVERED_FJ])
	})

	test("INITIALIZATION-WRAPPED build (origin ≠ account): first sim STUBBED for discovery, then a forced VALIDATED sizing re-sim", async () => {
		// origin ≠ account ⇒ the build wraps the account's own deploy. The stub
		// still runs (discovery works even for an undeployed account — the
		// delegated inner hash is about the token call, not the constructor),
		// but the stub's constructor GAS is untrustworthy, so a validated
		// sizing re-sim is FORCED even with no discovered effects (B1 excluded
		// init-wrapped shapes from stub-gas parity).
		const builtA = makeBuilt()
		;(builtA.txRequest as { origin: unknown }).origin = { toString: () => "0xmulticall-entrypoint" }
		const buildStandard = vi.fn(async () => builtA)
		const simulateTxTask = vi.fn(async () => sentinelSim())
		const deps = {
			txBuilder: { buildStandard },
			simulateTxTask,
			fpcService: { getFpcImpl: vi.fn() },
			tasks: { startNewTask: () => fakeTask },
			logger: { log: () => {} },
		} as unknown as FeeStrategyDeps
		const probe = { extractEffects: vi.fn(async () => []), collected: [] }
		const ctx = fjFoldedCtx(probe, [])

		await new FeeJuiceStrategy(deps).buildAndEstimate(ctx)

		expect(simulateTxTask).toHaveBeenCalledTimes(2)
		// Sim 1 STUBBED (discovery); sim 2 VALIDATED (trustworthy gas).
		expect((simulateTxTask.mock.calls[0] as unknown[])[2]).toEqual({
			simulatePublic: true,
			skipFeeEnforcement: true,
			skipTxValidation: true,
			scopes: [builtA.account.address],
			stubAccountAddresses: ["0xaccount"],
		})
		expect((simulateTxTask.mock.calls[1] as unknown[])[2]).toEqual({
			simulatePublic: true,
			skipFeeEnforcement: true,
			scopes: [builtA.account.address],
		})
		expect(probe.extractEffects).toHaveBeenCalledTimes(1)
	})

	test("probe-free fj run keeps ONE validated sim byte-for-byte (inertness)", async () => {
		const { deps, simulateTxTask, built } = makeDeps()
		await new FeeJuiceStrategy(deps).buildAndEstimate(makeCtx())
		expect(simulateTxTask).toHaveBeenCalledTimes(1)
		expect((simulateTxTask.mock.calls[0] as unknown[])[2]).toEqual({
			simulatePublic: true,
			skipFeeEnforcement: true,
			scopes: [built.account.address],
		})
	})
})

describe("FpcStrategy folded (probed) runs — discovery collapses into the first sim", () => {
	const DISCOVERED = { kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "0xm" } } as unknown as Action

	function makeProbe(discovered: Action[] = []) {
		return { extractEffects: vi.fn(async () => discovered), collected: discovered }
	}

	function stubbedOpts(address: unknown) {
		return {
			simulatePublic: true,
			skipFeeEnforcement: true,
			skipTxValidation: true,
			scopes: [address],
			stubAccountAddresses: ["0xaccount"],
		}
	}
	const validatedOpts = (address: unknown) => ({ simulatePublic: true, skipFeeEnforcement: true, scopes: [address] })

	function makePrivateFpc() {
		const feePayloadAction = { kind: "call", contract: "0xfpc", method: "pay_fee", args: [] } as unknown as Action
		return {
			infoData: { type: FpcType.PrivateFpc, isProtocol: true },
			getTotalGas: () => new Gas(1_000, 2_000),
			getTeardownGas: () => new Gas(100, 200),
			getFeePayload: vi.fn(() => [feePayloadAction]),
			feePayloadAction,
		}
	}

	function foldedHarness(fpc: ReturnType<typeof makePrivateFpc> | ReturnType<typeof makeSponsoredFpcLocal>) {
		const builtA = makeBuilt()
		const builtB = makeBuilt()
		const buildStandard = vi.fn().mockResolvedValueOnce(builtA).mockResolvedValueOnce(builtB)
		const simulateTxTask = vi.fn(async () => sentinelSim())
		const deps = {
			txBuilder: { buildStandard },
			simulateTxTask,
			fpcService: { getFpcImpl: vi.fn(async () => fpc) },
			tasks: { startNewTask: () => fakeTask },
			logger: { log: () => {} },
		} as unknown as FeeStrategyDeps
		return { deps, buildStandard, simulateTxTask, builtA, builtB }
	}

	function makeSponsoredFpcLocal() {
		const feePayloadAction = { kind: "call", contract: "0xsfpc", method: "sponsor_unconditionally", args: [] } as unknown as Action
		return {
			infoData: { type: FpcType.DefaultSponsoredFpc, isProtocol: true },
			getTotalGas: () => new Gas(1_000, 2_000),
			getTeardownGas: () => new Gas(100, 200),
			getFeePayload: vi.fn(() => [feePayloadAction]),
			feePayloadAction,
		}
	}

	function foldedCtx(probe: ReturnType<typeof makeProbe>, actions: Action[]): FeeStrategyContext {
		const ctx = makeCtx({ actions })
		ctx.feeSettings = { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } } as never
		;(ctx as { probe?: unknown }).probe = probe
		return ctx
	}

	test("two-pass fold: P1 STUBBED (+skipTxValidation), probe fed P1's sim with P1's node/network, P2 stays validated", async () => {
		const fpc = makePrivateFpc()
		const { deps, buildStandard, simulateTxTask, builtA, builtB } = foldedHarness(fpc)
		const original = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
		const probe = makeProbe()
		const ctx = foldedCtx(probe, [original])

		await new FpcStrategy(deps).buildAndEstimate(ctx)

		expect(buildStandard).toHaveBeenCalledTimes(2)
		expect(simulateTxTask).toHaveBeenCalledTimes(2)
		// P1 stubbed with the exact discovery option set; P2 untouched.
		expect((simulateTxTask.mock.calls[0] as unknown[])[2]).toEqual(stubbedOpts(builtA.account.address))
		expect((simulateTxTask.mock.calls[1] as unknown[])[2]).toEqual(validatedOpts(builtB.account.address))
		// Probe consumed exactly once, on the FIRST sim, chain-bound to P1's build.
		expect(probe.extractEffects).toHaveBeenCalledTimes(1)
		const [sim, chainCtx] = probe.extractEffects.mock.calls[0] as unknown as [unknown, { node: unknown; network: unknown }]
		expect(sim).toBeDefined()
		expect(chainCtx.node).toBe(builtA.node)
		expect(chainCtx.network).toBe(builtA.network)
		// No effects → final action shape identical to the classic two-pass.
		expect(ctx.op.actions[0]).toBe(fpc.feePayloadAction)
		expect(ctx.op.actions).toHaveLength(2)
	})

	test("two-pass fold with effects: discovered actions ride AFTER originals into Pass 2 and the final splice", async () => {
		const fpc = makePrivateFpc()
		const { deps, simulateTxTask } = foldedHarness(fpc)
		const original = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
		const probe = makeProbe([DISCOVERED])
		const ctx = foldedCtx(probe, [original])

		await new FpcStrategy(deps).buildAndEstimate(ctx)

		expect(simulateTxTask).toHaveBeenCalledTimes(2)
		expect(ctx.op.actions[0]).toBe(fpc.feePayloadAction)
		expect(ctx.op.actions[1]).toBe(original)
		expect(ctx.op.actions[2]).toBe(DISCOVERED)
		expect(ctx.op.actions).toHaveLength(3)
	})

	test("ADVERSARIAL (Ask 1, standalone inner-hash class): folded estimate SUCCEEDS where validated fails — failure moves to prove time", async () => {
		// Models a contract that asserts an intent-hash authwit via
		// `assert_inner_hash_valid_authwit`: it emits NO offchain effect (Noir
		// fact 12), so discovery cannot see the need. A VALIDATED sim dies in
		// the account's verify (authwit oracle throw); a STUBBED sim completes
		// with zero effects. The folded pipeline therefore returns an estimate
		// (and the tx later fails at PROVE time, pre-broadcast) — the
		// owner-accepted Ask-1 trade. The classic probe-free run of the same op
		// keeps failing at estimate time.
		const innerHashSim = (opts: { stubAccountAddresses?: string[] }) => {
			if (opts.stubAccountAddresses?.length) return Promise.resolve(sentinelSim())
			return Promise.reject(new Error("Unknown auth witness for message hash 0xdeadbeef"))
		}
		const fpc = makeSponsoredFpcLocal()
		const makeHarness = () => {
			const builtA = makeBuilt()
			const buildStandard = vi.fn(async () => builtA)
			const simulateTxTask = vi.fn((_pxe: unknown, _req: unknown, opts: { stubAccountAddresses?: string[] }) => innerHashSim(opts))
			const deps = {
				txBuilder: { buildStandard },
				simulateTxTask,
				fpcService: { getFpcImpl: vi.fn(async () => fpc) },
				tasks: { startNewTask: () => fakeTask },
				logger: { log: () => {} },
			} as unknown as FeeStrategyDeps
			return { deps, simulateTxTask }
		}
		const original = { kind: "call", contract: "0xdapp", method: "consume_intent", args: [] } as unknown as Action

		// Folded: succeeds in ONE stubbed sim (no effects → no validated rebuild).
		const folded = makeHarness()
		const probe = makeProbe()
		const result = await new FpcStrategy(folded.deps).buildAndEstimate(foldedCtx(probe, [original]))
		expect(result.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.EXTERNAL)
		expect(folded.simulateTxTask).toHaveBeenCalledTimes(1)

		// Classic (probe-free): the validated sim still fails at estimate time.
		const classic = makeHarness()
		const classicCtx = makeCtx({ actions: [original] })
		classicCtx.feeSettings = { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } } as never
		await expect(new FpcStrategy(classic.deps).buildAndEstimate(classicCtx)).rejects.toThrow(/Unknown auth witness/)
	})

	test("SIM-COUNT PIN (fast path fold): no effects ⇒ ONE stubbed sim total — dApp Sponsored estimate 2→1", async () => {
		const fpc = makeSponsoredFpcLocal()
		const { deps, buildStandard, simulateTxTask, builtA } = foldedHarness(fpc)
		const original = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
		const probe = makeProbe()
		const ctx = foldedCtx(probe, [original])

		const result = await new FpcStrategy(deps).buildAndEstimate(ctx)

		expect(buildStandard).toHaveBeenCalledTimes(1)
		expect(simulateTxTask).toHaveBeenCalledTimes(1)
		expect((simulateTxTask.mock.calls[0] as unknown[])[2]).toEqual(stubbedOpts(builtA.account.address))
		expect(probe.extractEffects).toHaveBeenCalledTimes(1)
		expect(result.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.EXTERNAL)
		expect(ctx.op.actions[0]).toBe(fpc.feePayloadAction)
		expect(ctx.op.actions).toHaveLength(2)
	})

	test("ADVERSARIAL: sponsored-TYPED non-canonical row under a probe — two-pass only, payload-inclusive sim NEVER stubbed", async () => {
		// A user-added FPC row that mimics the canonical Sponsored's type but
		// fails `isProtocol` must keep the two-pass shape even when probed: the
		// only stubbed sim is the payload-FREE P1; the payload-inclusive Pass 2
		// stays validated. (Hard limit: never stub a payload-inclusive sim for
		// any non-canonical FPC.)
		const fpc = makeSponsoredFpcLocal()
		;(fpc.infoData as { isProtocol: boolean }).isProtocol = false
		const { deps, buildStandard, simulateTxTask, builtA, builtB } = foldedHarness(fpc)
		const original = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
		const probe = makeProbe()
		const ctx = foldedCtx(probe, [original])

		await new FpcStrategy(deps).buildAndEstimate(ctx)

		// Two-pass choreography: PREEXISTING (payload-free, stubbed) → EXTERNAL
		// (payload-inclusive, VALIDATED).
		expect(buildStandard).toHaveBeenCalledTimes(2)
		expect(buildStandard.mock.calls[0]?.[1]).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		expect(buildStandard.mock.calls[1]?.[1]).toBe(AccountFeePaymentMethodOptions.EXTERNAL)
		expect(simulateTxTask).toHaveBeenCalledTimes(2)
		expect((simulateTxTask.mock.calls[0] as unknown[])[2]).toEqual(stubbedOpts(builtA.account.address))
		expect((simulateTxTask.mock.calls[1] as unknown[])[2]).toEqual(validatedOpts(builtB.account.address))
	})

	test("fast path fold with effects: VALIDATED rebuild+re-sim so fresh witnesses are verified (1→2 sims)", async () => {
		const fpc = makeSponsoredFpcLocal()
		const { deps, buildStandard, simulateTxTask, builtA, builtB } = foldedHarness(fpc)
		const original = { kind: "call", contract: "0xtoken", method: "transfer", args: [] } as unknown as Action
		const probe = makeProbe([DISCOVERED])
		const ctx = foldedCtx(probe, [original])

		await new FpcStrategy(deps).buildAndEstimate(ctx)

		expect(buildStandard).toHaveBeenCalledTimes(2)
		expect(simulateTxTask).toHaveBeenCalledTimes(2)
		expect((simulateTxTask.mock.calls[0] as unknown[])[2]).toEqual(stubbedOpts(builtA.account.address))
		expect((simulateTxTask.mock.calls[1] as unknown[])[2]).toEqual(validatedOpts(builtB.account.address))
		expect(ctx.op.actions[0]).toBe(fpc.feePayloadAction)
		expect(ctx.op.actions[1]).toBe(original)
		expect(ctx.op.actions[2]).toBe(DISCOVERED)
		expect(ctx.op.actions).toHaveLength(3)
	})
})
