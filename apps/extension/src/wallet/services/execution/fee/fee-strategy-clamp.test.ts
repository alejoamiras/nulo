/**
 * `finalizeGasLimits` admission-clamp pins + the per-path forwarding
 * enumeration (fj / fjwc / embedded / fpc×2 — the "send" transfer path rides
 * the same strategies; NO_FROM never reaches finalize, its gasSettings are
 * capped by construction in the builder via `GasSettings.fallback`).
 *
 * Contract (plan ledger #14 / Ask 2):
 * - measured usage over the cap ⇒ THROW (tx can never be admitted);
 * - auto-derived limits (measured × padding) clamp to min(node txsLimits,
 *   protocol MAX_TX_DA_GAS on the DA axis);
 * - dApp customLimits over the cap ⇒ THROW, never silently capped;
 * - zero teardown stays zero; absent txsLimits (defensive) ⇒ unchanged.
 */

import { MAX_PROCESSABLE_L2_GAS, MAX_TX_DA_GAS } from "@aztec/constants"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { TxSimulationResult } from "@aztec/stdlib/tx"
import { describe, expect, test, vi } from "vitest"
import type { Action } from "../spec"
import { EmbeddedStrategy } from "./embedded-strategy"
import { FeeJuiceStrategy } from "./fee-juice-strategy"
import { FeeJuiceWithClaimStrategy } from "./fee-juice-with-claim-strategy"
import type { FeeStrategyContext, FeeStrategyDeps } from "./fee-strategy"
import { finalizeGasLimits } from "./fee-strategy"
import { FpcStrategy } from "./fpc-strategy"
import { FpcType } from "@/wallet/services/fpc/service"

const node = { getCurrentMinFees: async () => new GasFees(10n, 10n) } as never

function req() {
	return {
		txContext: {
			gasSettings: new GasSettings(new Gas(1, 1), new Gas(1, 1), new GasFees(5n, 5n), GasFees.empty()),
		},
	} as never
}

function sim(total: [number, number], teardown: [number, number] = [0, 0]): TxSimulationResult {
	return {
		gasUsed: { totalGas: new Gas(total[0], total[1]), teardownGas: new Gas(teardown[0], teardown[1]) },
	} as unknown as TxSimulationResult
}

describe("finalizeGasLimits admission clamp", () => {
	test("measured usage over the cap throws — the tx can never be admitted", async () => {
		await expect(
			finalizeGasLimits(node, req(), sim([2_000, 500]), 1.05, undefined, undefined, undefined, new Gas(1_000, 1_000)),
		).rejects.toThrow(/cannot be included/)
	})

	test("auto-derived limits clamp to the cap; under-cap padding is untouched", async () => {
		const r = req()
		await finalizeGasLimits(node, r, sim([1_000, 900]), 1.5, undefined, undefined, undefined, new Gas(1_200, 10_000))
		const gs = (r as { txContext: { gasSettings: GasSettings } }).txContext.gasSettings
		// da: 1000×1.5=1500 > cap 1200 → clamped; l2: 900×1.5=1350 ≤ 10000 → padded.
		expect([gs.gasLimits.daGas, gs.gasLimits.l2Gas]).toEqual([1_200, 1_350])
	})

	test("zero teardown stays zero under the clamp", async () => {
		const r = req()
		await finalizeGasLimits(node, r, sim([100, 100], [0, 0]), 1.05, undefined, undefined, undefined, new Gas(1_000, 1_000))
		const gs = (r as { txContext: { gasSettings: GasSettings } }).txContext.gasSettings
		expect([gs.teardownGasLimits.daGas, gs.teardownGasLimits.l2Gas]).toEqual([0, 0])
	})

	test("dApp custom gasLimits over the cap throw — never silently capped", async () => {
		await expect(
			finalizeGasLimits(
				node,
				req(),
				sim([100, 100]),
				1,
				undefined,
				{ gasLimits: { daGas: 5_000, l2Gas: 100 } } as never,
				undefined,
				new Gas(1_000, 1_000),
			),
		).rejects.toThrow(/Requested gasLimits/)
	})

	test("dApp custom gasLimits within the cap ride through verbatim", async () => {
		const r = req()
		await finalizeGasLimits(
			node,
			r,
			sim([100, 100]),
			1,
			undefined,
			{ gasLimits: { daGas: 900, l2Gas: 800 } } as never,
			undefined,
			new Gas(1_000, 1_000),
		)
		const gs = (r as { txContext: { gasSettings: GasSettings } }).txContext.gasSettings
		expect([gs.gasLimits.daGas, gs.gasLimits.l2Gas]).toEqual([900, 800])
	})

	test("dApp custom teardownGasLimits over the cap throw", async () => {
		await expect(
			finalizeGasLimits(
				node,
				req(),
				sim([100, 100]),
				1,
				undefined,
				{ teardownGasLimits: { daGas: 5_000, l2Gas: 100 } } as never,
				undefined,
				new Gas(1_000, 1_000),
			),
		).rejects.toThrow(/Requested teardownGasLimits/)
	})

	test("the DA axis is additionally bounded by the protocol MAX_TX_DA_GAS", async () => {
		const r = req()
		const hugeNodeCap = new Gas(MAX_TX_DA_GAS * 10, 10_000_000)
		await finalizeGasLimits(node, r, sim([MAX_TX_DA_GAS - 1, 100]), 100, undefined, undefined, undefined, hugeNodeCap)
		const gs = (r as { txContext: { gasSettings: GasSettings } }).txContext.gasSettings
		// padded da (huge) clamps to the PROTOCOL max, not the node's inflated cap.
		expect(gs.gasLimits.daGas).toBe(MAX_TX_DA_GAS)
	})

	test("the L2 axis is additionally bounded by the protocol MAX_PROCESSABLE_L2_GAS", async () => {
		const r = req()
		const hugeNodeCap = new Gas(1_000_000, MAX_PROCESSABLE_L2_GAS * 10)
		await finalizeGasLimits(node, r, sim([100, MAX_PROCESSABLE_L2_GAS - 1]), 100, undefined, undefined, undefined, hugeNodeCap)
		const gs = (r as { txContext: { gasSettings: GasSettings } }).txContext.gasSettings
		expect(gs.gasLimits.l2Gas).toBe(MAX_PROCESSABLE_L2_GAS)
	})

	test("absent txsLimits (defensive) keeps the historical uncapped behavior", async () => {
		const r = req()
		await finalizeGasLimits(node, r, sim([1_000, 1_000]), 2)
		const gs = (r as { txContext: { gasSettings: GasSettings } }).txContext.gasSettings
		expect([gs.gasLimits.daGas, gs.gasLimits.l2Gas]).toEqual([2_000, 2_000])
	})
})

describe("per-path clamp forwarding — every strategy passes its build's retained txsLimits", () => {
	const TIGHT = new Gas(10, 10) // far below the 31_000/32_000 sentinel sim
	function built(txsLimits: Gas) {
		return {
			txRequest: {
				origin: { toString: () => "0xaccount" },
				txContext: { gasSettings: new GasSettings(new Gas(1, 1), new Gas(1, 1), new GasFees(5n, 5n), GasFees.empty()) },
			},
			node,
			pxe: {},
			account: { address: { toString: () => "0xaccount" } },
			network: { chainId: 7 },
			nonce: {},
			txCalls: [],
			txsLimits,
		}
	}
	function deps(b: ReturnType<typeof built>, fpc?: unknown) {
		return {
			txBuilder: { buildStandard: vi.fn(async () => b) },
			simulateTxTask: vi.fn(async () => ({
				gasUsed: { totalGas: new Gas(31_000, 32_000), teardownGas: new Gas(0, 0) },
			})),
			fpcService: { getFpcImpl: vi.fn(async () => fpc) },
			tasks: { startNewTask: () => ({ complete: vi.fn(), fail: vi.fn(), startSubtask: vi.fn() }) },
			logger: { log: () => {} },
		} as unknown as FeeStrategyDeps
	}
	function ctx(kind: string, opFee?: unknown): FeeStrategyContext {
		return {
			op: { networkId: "n", accountAddress: "0xacc", actions: [] as Action[], ...(opFee ? { fee: opFee } : {}) },
			feeSettings: { paymentMethod: { kind, fpcId: "f1" } },
			gasPadding: 1,
		} as unknown as FeeStrategyContext
	}

	test("fj forwards txsLimits (tight cap ⇒ measured-over throw)", async () => {
		await expect(new FeeJuiceStrategy(deps(built(TIGHT))).buildAndEstimate(ctx("fj"))).rejects.toThrow(/cannot be included/)
	})

	test("fjwc forwards txsLimits", async () => {
		const b = built(TIGHT)
		const d = deps(b)
		await expect(new FeeJuiceWithClaimStrategy(d).buildAndEstimate(ctx("fjwc", undefined))).rejects.toThrow(/cannot be included/)
	})

	test("embedded forwards txsLimits", async () => {
		await expect(
			new EmbeddedStrategy(deps(built(TIGHT))).buildAndEstimate(ctx("embedded", { embeddedFeePayment: "fpc" })),
		).rejects.toThrow(/cannot be included/)
	})

	test("fpc two-pass forwards txsLimits", async () => {
		const fpc = {
			infoData: { type: FpcType.PrivateFpc, isProtocol: true },
			getTotalGas: () => new Gas(0, 0),
			getTeardownGas: () => new Gas(0, 0),
			getFeePayload: () => [],
		}
		await expect(new FpcStrategy(deps(built(TIGHT), fpc)).buildAndEstimate(ctx("fpc"))).rejects.toThrow(/cannot be included/)
	})

	test("fpc canonical-Sponsored fast path forwards txsLimits", async () => {
		const fpc = {
			infoData: { type: FpcType.DefaultSponsoredFpc, isProtocol: true, chainId: 7 },
			getTotalGas: () => new Gas(0, 0),
			getTeardownGas: () => new Gas(0, 0),
			getFeePayload: () => [],
		}
		await expect(new FpcStrategy(deps(built(TIGHT), fpc)).buildAndEstimate(ctx("fpc"))).rejects.toThrow(/cannot be included/)
	})

	test("fpc paths ASSERT over-cap dApp custom limits instead of silently discarding them", async () => {
		const fpc = {
			infoData: { type: FpcType.PrivateFpc, isProtocol: true },
			getTotalGas: () => new Gas(0, 0),
			getTeardownGas: () => new Gas(0, 0),
			getFeePayload: () => [],
		}
		const b = built(new Gas(1_000_000, 1_000_000))
		await expect(
			new FpcStrategy(deps(b, fpc)).buildAndEstimate(ctx("fpc", { gasLimits: { daGas: 2_000_000, l2Gas: 1 } })),
		).rejects.toThrow(/Requested gasLimits/)
	})

	test("generous cap leaves every strategy's estimate untouched (fj probe)", async () => {
		const b = built(new Gas(1_000_000, 1_000_000))
		const result = await new FeeJuiceStrategy(deps(b)).buildAndEstimate(ctx("fj"))
		const gs = (result.txRequest as { txContext: { gasSettings: GasSettings } }).txContext.gasSettings
		expect([gs.gasLimits.daGas, gs.gasLimits.l2Gas]).toEqual([31_000, 32_000])
		expect(result.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
	})
})
