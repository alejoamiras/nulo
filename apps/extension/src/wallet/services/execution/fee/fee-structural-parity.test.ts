/**
 * Structural fee-path parity fixtures.
 *
 * `suggestGasLimits` + `finalizeGasLimits` decide the gas/fee shape for
 * the FJ / FJWC / Embedded strategies. e2e proves SCENARIO parity only —
 * a refactor can keep every scenario green while transposing same-typed
 * slots (gas vs teardown vs fee) inside the multiplier tolerance the
 * network accepts. These fixtures use DISTINCT sentinel values in every
 * slot so any transposition or projection drift fails loudly.
 *
 * Sentinel scheme: da-gas 11_000, l2-gas 22_000, teardown-da 3_300,
 * teardown-l2 4_400, fee-per-da 555n, fee-per-l2 666n, priority-da 7n,
 * priority-l2 8n. No two slots share a value.
 */

import { describe, expect, test } from "vitest"
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { TxExecutionRequest, TxSimulationResult } from "@aztec/stdlib/tx"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { finalizeGasLimits, suggestGasLimits } from "./fee-strategy"

const PRIORITY = new GasFees(7n, 8n)

function makeTxRequest(): TxExecutionRequest {
	return {
		txContext: {
			gasSettings: new GasSettings(new Gas(11_000, 22_000), new Gas(3_300, 4_400), new GasFees(555n, 666n), PRIORITY),
		},
	} as unknown as TxExecutionRequest
}

function makeSimulated(totalDa: number, totalL2: number, teardownDa: number, teardownL2: number): TxSimulationResult {
	return {
		gasUsed: {
			totalGas: new Gas(totalDa, totalL2),
			teardownGas: new Gas(teardownDa, teardownL2),
		},
	} as unknown as TxSimulationResult
}

const NODE = {
	getCurrentMinFees: async () => new GasFees(555n, 666n),
} as unknown as AztecNode

function shape(txRequest: TxExecutionRequest) {
	const gs = txRequest.txContext.gasSettings
	return {
		gasDa: gs.gasLimits.daGas,
		gasL2: gs.gasLimits.l2Gas,
		teardownDa: gs.teardownGasLimits.daGas,
		teardownL2: gs.teardownGasLimits.l2Gas,
		feeDa: gs.maxFeesPerGas.feePerDaGas,
		feeL2: gs.maxFeesPerGas.feePerL2Gas,
		priorityDa: gs.maxPriorityFeesPerGas.feePerDaGas,
		priorityL2: gs.maxPriorityFeesPerGas.feePerL2Gas,
	}
}

describe("suggestGasLimits: exact slot projection", () => {
	test("no options → gasSettings untouched (all 8 sentinels intact)", () => {
		const tx = makeTxRequest()
		suggestGasLimits(tx, undefined)
		expect(shape(tx)).toEqual({
			gasDa: 11_000,
			gasL2: 22_000,
			teardownDa: 3_300,
			teardownL2: 4_400,
			feeDa: 555n,
			feeL2: 666n,
			priorityDa: 7n,
			priorityL2: 8n,
		})
	})

	test("gasLimits + teardownGasLimits → both replaced, fees + priority preserved", () => {
		const tx = makeTxRequest()
		suggestGasLimits(tx, {
			gasLimits: { daGas: 91_000, l2Gas: 92_000 },
			teardownGasLimits: { daGas: 93_000, l2Gas: 94_000 },
		})
		expect(shape(tx)).toEqual({
			gasDa: 91_000,
			gasL2: 92_000,
			teardownDa: 93_000,
			teardownL2: 94_000,
			feeDa: 555n,
			feeL2: 666n,
			priorityDa: 7n,
			priorityL2: 8n,
		})
	})

	test("gasLimits only → teardown preserved", () => {
		const tx = makeTxRequest()
		suggestGasLimits(tx, { gasLimits: { daGas: 91_000, l2Gas: 92_000 } })
		const s = shape(tx)
		expect([s.gasDa, s.gasL2]).toEqual([91_000, 92_000])
		expect([s.teardownDa, s.teardownL2]).toEqual([3_300, 4_400])
	})

	test("teardownGasLimits only → gasLimits preserved", () => {
		const tx = makeTxRequest()
		suggestGasLimits(tx, { teardownGasLimits: { daGas: 93_000, l2Gas: 94_000 } })
		const s = shape(tx)
		expect([s.gasDa, s.gasL2]).toEqual([11_000, 22_000])
		expect([s.teardownDa, s.teardownL2]).toEqual([93_000, 94_000])
	})
})

describe("finalizeGasLimits: exact slot projection", () => {
	test("computed path: limits = simulated × padding, fees = min × multiplier, priority preserved", async () => {
		const tx = makeTxRequest()
		// Distinct simulated sentinels; padding 1 keeps them byte-readable.
		await finalizeGasLimits(NODE, tx, makeSimulated(31_000, 32_000, 3_500, 3_600), 1, undefined, undefined, 2)
		expect(shape(tx)).toEqual({
			gasDa: 31_000,
			gasL2: 32_000,
			teardownDa: 3_500,
			teardownL2: 3_600,
			feeDa: 1_110n, // 555 × 2 — NOT 666 × 2: a da/l2 swap would produce 1_332n here
			feeL2: 1_332n,
			priorityDa: 7n,
			priorityL2: 8n,
		})
	})

	test("explicit maxFeesPerGas wins over node min fees", async () => {
		const tx = makeTxRequest()
		await finalizeGasLimits(NODE, tx, makeSimulated(31_000, 32_000, 3_500, 3_600), 1, new GasFees(777n, 888n))
		const s = shape(tx)
		expect([s.feeDa, s.feeL2]).toEqual([777n, 888n])
	})

	test("customLimits.maxFeesPerGas wins when no explicit maxFees", async () => {
		const tx = makeTxRequest()
		await finalizeGasLimits(NODE, tx, makeSimulated(31_000, 32_000, 3_500, 3_600), 1, undefined, {
			maxFeesPerGas: { feePerDaGas: "991", feePerL2Gas: "992" },
		})
		const s = shape(tx)
		expect([s.feeDa, s.feeL2]).toEqual([991n, 992n])
	})

	test("customLimits gas + teardown win over simulated values", async () => {
		const tx = makeTxRequest()
		await finalizeGasLimits(NODE, tx, makeSimulated(31_000, 32_000, 3_500, 3_600), 1, undefined, {
			gasLimits: { daGas: 81_000, l2Gas: 82_000 },
			teardownGasLimits: { daGas: 83_000, l2Gas: 84_000 },
		})
		const s = shape(tx)
		expect([s.gasDa, s.gasL2, s.teardownDa, s.teardownL2]).toEqual([81_000, 82_000, 83_000, 84_000])
	})

	test("gas padding multiplies simulated limits (1.05 default path)", async () => {
		const tx = makeTxRequest()
		await finalizeGasLimits(NODE, tx, makeSimulated(10_000, 20_000, 1_000, 2_000), 1.05, undefined, undefined, 2)
		const s = shape(tx)
		expect([s.gasDa, s.gasL2]).toEqual([10_500, 21_000])
		expect([s.teardownDa, s.teardownL2]).toEqual([1_050, 2_100])
	})

	test("multiplier fallback: omitted feeMultiplier uses DEFAULT_FEE_MULTIPLIER (2 in test env)", async () => {
		const tx = makeTxRequest()
		await finalizeGasLimits(NODE, tx, makeSimulated(31_000, 32_000, 3_500, 3_600), 1)
		const s = shape(tx)
		expect([s.feeDa, s.feeL2]).toEqual([1_110n, 1_332n])
	})

	test("embedded contract: multiplier 1 keeps fees at node min exactly", async () => {
		const tx = makeTxRequest()
		await finalizeGasLimits(NODE, tx, makeSimulated(31_000, 32_000, 3_500, 3_600), 1, undefined, undefined, 1)
		const s = shape(tx)
		expect([s.feeDa, s.feeL2]).toEqual([555n, 666n])
	})

	// A node whose CURRENT min fee differs from the committed cap — so a refetch is observable as drift.
	const DRIFT_NODE = { getCurrentMinFees: async () => new GasFees(999n, 1_111n) } as unknown as AztecNode

	test("embedded (no explicit fee): reuses the committed cap, does NOT refetch (drift fix)", async () => {
		const tx = makeTxRequest() // committed cap = 555/666 (set by applyEmbeddedFpcGasCap upstream)
		await finalizeGasLimits(
			DRIFT_NODE,
			tx,
			makeSimulated(31_000, 32_000, 3_500, 3_600),
			1,
			undefined,
			{ embeddedFeePayment: "fjwc" } as never,
			1,
		)
		const s = shape(tx)
		// Reused the committed cap (555/666) — NOT the post-sim node refetch (999/1111). The FPC budget is
		// reasoned against exactly what gets committed.
		expect([s.feeDa, s.feeL2]).toEqual([555n, 666n])
	})

	test("embedded WITH explicit customLimits.maxFeesPerGas: commits exactly that (predicted-worst headroom)", async () => {
		const tx = makeTxRequest()
		await finalizeGasLimits(
			DRIFT_NODE,
			tx,
			makeSimulated(31_000, 32_000, 3_500, 3_600),
			1,
			undefined,
			{
				embeddedFeePayment: "fjwc",
				maxFeesPerGas: { feePerDaGas: 1_500n, feePerL2Gas: 1_800n },
			} as never,
			1,
		)
		const s = shape(tx)
		expect([s.feeDa, s.feeL2]).toEqual([1_500n, 1_800n])
	})

	test("NON-embedded (no explicit fee): still refetches node min × multiplier (general default preserved)", async () => {
		const tx = makeTxRequest()
		await finalizeGasLimits(DRIFT_NODE, tx, makeSimulated(31_000, 32_000, 3_500, 3_600), 1, undefined, undefined, 2)
		const s = shape(tx)
		// Non-embedded path is unchanged: refetch (999/1111) × 2 — proves the drift fix is embedded-gated.
		expect([s.feeDa, s.feeL2]).toEqual([1_998n, 2_222n])
	})
})
