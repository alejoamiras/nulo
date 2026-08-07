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

	test("undecorated FPC shape (cold protocol cache) fails safe to two-pass", async () => {
		const fpc = makeSponsoredFpc()
		;(fpc as { infoData?: unknown }).infoData = undefined
		const { deps, buildStandard } = makeFpcDeps(fpc)

		await new FpcStrategy(deps).buildAndEstimate(makeFpcCtx())

		expect(buildStandard).toHaveBeenCalledTimes(2)
	})
})
