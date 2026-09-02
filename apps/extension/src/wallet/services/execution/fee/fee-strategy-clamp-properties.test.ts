/**
 * Property-based pins for the `finalizeGasLimits` admission clamp — a seeded
 * in-file generator (no fuzzing dependency; deterministic across runs) drives
 * randomized (measured, padding, cap, custom) tuples through the invariants
 * the example-based suite (`fee-strategy-clamp.test.ts`) pins pointwise:
 *
 *   I1  no-throw ⇒ committed gasLimits ≤ effective cap on BOTH axes
 *   I2  (no custom) throws iff measured exceeds the effective cap on either axis
 *   I3  custom limits are honored VERBATIM or thrown on — never silently altered
 *   I4  zero measured teardown commits zero teardown
 *   I5  absent cap ⇒ historical behavior (measured × padding, floor semantics)
 *   I6  (no custom, no-throw) committed gasLimits ≥ measured — the clamp can
 *       shave PADDING, never below what the simulation actually used
 */

import { MAX_PROCESSABLE_L2_GAS, MAX_TX_DA_GAS } from "@aztec/constants"
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { TxSimulationResult } from "@aztec/stdlib/tx"
import { describe, expect, test } from "vitest"
import { finalizeGasLimits } from "./fee-strategy"

const node = { getCurrentMinFees: async () => new GasFees(7n, 9n) } as never

/** Deterministic LCG — reproducible sequences without a fuzzing dependency. */
function makeRng(seed: number) {
	let s = seed >>> 0
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0
		return s / 2 ** 32
	}
}

function req() {
	return {
		txContext: {
			gasSettings: new GasSettings(new Gas(1, 1), new Gas(1, 1), new GasFees(5n, 5n), GasFees.empty()),
		},
	} as never
}

function sim(total: [number, number], teardown: [number, number]): TxSimulationResult {
	return {
		gasUsed: { totalGas: new Gas(total[0], total[1]), teardownGas: new Gas(teardown[0], teardown[1]) },
	} as unknown as TxSimulationResult
}

const gs = (r: unknown) => (r as { txContext: { gasSettings: GasSettings } }).txContext.gasSettings
const effectiveCap = (cap: Gas) => ({
	da: Math.min(cap.daGas, MAX_TX_DA_GAS),
	l2: Math.min(cap.l2Gas, MAX_PROCESSABLE_L2_GAS),
})

const ITERATIONS = 300

describe("finalizeGasLimits clamp properties (seeded)", () => {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: accepted at score 19 — each generated tuple must branch between rejection and the complete postcondition set
	test("I1+I2+I4+I6 — auto-derived limits: cap-bounded, measured-floored, throw iff inadmissible", async () => {
		const rng = makeRng(0xb1)
		for (let i = 0; i < ITERATIONS; i++) {
			const measured: [number, number] = [Math.floor(rng() * 4000), Math.floor(rng() * 1_500_000)]
			const teardown: [number, number] = rng() < 0.3 ? [0, 0] : [Math.floor(rng() * 200), Math.floor(rng() * 5_000)]
			const padding = 1 + rng() * 0.5
			// Caps span under/over the measured range AND occasionally exceed the
			// protocol maxima (exercising the min() composition).
			const cap = new Gas(
				Math.floor(rng() * (rng() < 0.1 ? MAX_TX_DA_GAS * 3 : 5_000)),
				Math.floor(rng() * (rng() < 0.1 ? MAX_PROCESSABLE_L2_GAS * 3 : 2_000_000)),
			)
			const eff = effectiveCap(cap)
			const inadmissible = measured[0] > eff.da || measured[1] > eff.l2
			const r = req()

			const run = finalizeGasLimits(node, r, sim(measured, teardown), padding, undefined, undefined, undefined, cap)
			if (inadmissible) {
				await expect(run, `iter ${i}: measured ${measured} vs cap ${eff.da}/${eff.l2}`).rejects.toThrow(/cannot be included/)
				continue
			}
			await run
			const g = gs(r)
			// I1: never above the effective cap.
			expect(g.gasLimits.daGas, `iter ${i} da≤cap`).toBeLessThanOrEqual(eff.da)
			expect(g.gasLimits.l2Gas, `iter ${i} l2≤cap`).toBeLessThanOrEqual(eff.l2)
			expect(g.teardownGasLimits.daGas, `iter ${i} tdDa≤cap`).toBeLessThanOrEqual(eff.da)
			expect(g.teardownGasLimits.l2Gas, `iter ${i} tdL2≤cap`).toBeLessThanOrEqual(eff.l2)
			// I6: never below what the simulation used (padding is headroom).
			expect(g.gasLimits.daGas, `iter ${i} da≥measured`).toBeGreaterThanOrEqual(measured[0])
			expect(g.gasLimits.l2Gas, `iter ${i} l2≥measured`).toBeGreaterThanOrEqual(measured[1])
			// I4: zero teardown stays zero.
			if (teardown[0] === 0 && teardown[1] === 0) {
				expect([g.teardownGasLimits.daGas, g.teardownGasLimits.l2Gas], `iter ${i} teardown-zero`).toEqual([0, 0])
			}
		}
	})

	test("I3 — dApp custom limits: verbatim or thrown, never silently altered", async () => {
		const rng = makeRng(0xc4)
		for (let i = 0; i < ITERATIONS; i++) {
			const measured: [number, number] = [Math.floor(rng() * 1_000), Math.floor(rng() * 400_000)]
			const cap = new Gas(1_000 + Math.floor(rng() * 4_000), 400_000 + Math.floor(rng() * 1_200_000))
			const eff = effectiveCap(cap)
			// Custom limits straddle the cap so both outcomes are exercised.
			const custom = { daGas: Math.floor(rng() * eff.da * 2), l2Gas: Math.floor(rng() * eff.l2 * 2) }
			const overCap = custom.daGas > eff.da || custom.l2Gas > eff.l2
			const r = req()

			const run = finalizeGasLimits(node, r, sim(measured, [0, 0]), 1.05, undefined, { gasLimits: custom } as never, undefined, cap)
			if (overCap) {
				await expect(run, `iter ${i}: custom ${custom.daGas}/${custom.l2Gas} vs cap ${eff.da}/${eff.l2}`).rejects.toThrow(
					/Requested gasLimits/,
				)
				continue
			}
			await run
			const g = gs(r)
			expect([g.gasLimits.daGas, g.gasLimits.l2Gas], `iter ${i} custom-verbatim`).toEqual([custom.daGas, custom.l2Gas])
		}
	})

	test("I5 — absent cap keeps the historical uncapped shape exactly", async () => {
		const rng = makeRng(0xe7)
		for (let i = 0; i < ITERATIONS; i++) {
			const measured: [number, number] = [Math.floor(rng() * 100_000), Math.floor(rng() * 3_000_000)]
			const padding = 1 + rng()
			const r = req()
			await finalizeGasLimits(node, r, sim(measured, [0, 0]), padding)
			const g = gs(r)
			const expected = new Gas(measured[0], measured[1]).mul(padding)
			expect([g.gasLimits.daGas, g.gasLimits.l2Gas], `iter ${i} historical`).toEqual([expected.daGas, expected.l2Gas])
		}
	})
})
