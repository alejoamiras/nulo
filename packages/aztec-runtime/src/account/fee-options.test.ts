import { describe, expect, test, vi } from "vitest"
import { GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { completeFeeOptions, MIN_FEE_PADDING } from "./fee-options"

/** Minimal fake AztecNode covering only the methods completeFeeOptions calls. */
function fakeNode(minFees: GasFees = new GasFees(100n, 200n)): AztecNode & { getCurrentMinFees: ReturnType<typeof vi.fn> } {
	return {
		getCurrentMinFees: vi.fn(async () => minFees),
		// biome-ignore lint/suspicious/noExplicitAny: fake covers only the surface completeFeeOptions touches
	} as any
}

describe("completeFeeOptions", () => {
	test("1. no gasSettings + forEstimation:true → minFees.mul(1.5) + empty priority + estimation flags", async () => {
		const node = fakeNode(new GasFees(100n, 200n))
		const result = await completeFeeOptions({ node, forEstimation: true })
		expect(result).toBeInstanceOf(GasSettings)
		// minFees.mul(1.5) = (150, 300)
		expect(result.maxFeesPerGas.feePerDaGas).toBe(150n)
		expect(result.maxFeesPerGas.feePerL2Gas).toBe(300n)
		expect(result.maxPriorityFeesPerGas.feePerDaGas).toBe(0n)
		expect(result.maxPriorityFeesPerGas.feePerL2Gas).toBe(0n)
		// forEstimation produces large gas limits — not the protocol max
		expect(result.gasLimits.daGas).toBeGreaterThan(0)
	})

	test("2. no gasSettings + forEstimation:false → same defaults + fallback flags", async () => {
		const node = fakeNode(new GasFees(100n, 200n))
		const result = await completeFeeOptions({ node, forEstimation: false })
		expect(result).toBeInstanceOf(GasSettings)
		expect(result.maxFeesPerGas.feePerDaGas).toBe(150n)
		expect(result.maxFeesPerGas.feePerL2Gas).toBe(300n)
		// `GasSettings.fallback` produces different gas-limit defaults than
		// `forEstimation`; we don't pin specific values (upstream-owned)
		// but we DO pin that priorityFees defaults to empty.
		expect(result.maxPriorityFeesPerGas.feePerDaGas).toBe(0n)
	})

	test("3. explicit maxFeesPerGas only → uses provided + default priority + node NOT consulted", async () => {
		const node = fakeNode()
		const result = await completeFeeOptions({
			node,
			gasSettings: { maxFeesPerGas: { feePerDaGas: 555n, feePerL2Gas: 666n } },
			forEstimation: true,
		})
		expect(result.maxFeesPerGas.feePerDaGas).toBe(555n)
		expect(result.maxFeesPerGas.feePerL2Gas).toBe(666n)
		expect(result.maxPriorityFeesPerGas.feePerDaGas).toBe(0n)
		expect(node.getCurrentMinFees).not.toHaveBeenCalled()
	})

	test("4. explicit maxPriorityFeesPerGas only → defaults maxFees from node + uses provided priority", async () => {
		const node = fakeNode(new GasFees(100n, 200n))
		const result = await completeFeeOptions({
			node,
			gasSettings: { maxPriorityFeesPerGas: { feePerDaGas: 7n, feePerL2Gas: 8n } },
			forEstimation: true,
		})
		expect(result.maxFeesPerGas.feePerDaGas).toBe(150n) // node.minFees * 1.5
		expect(result.maxPriorityFeesPerGas.feePerDaGas).toBe(7n)
		expect(result.maxPriorityFeesPerGas.feePerL2Gas).toBe(8n)
		expect(node.getCurrentMinFees).toHaveBeenCalledOnce()
	})

	test("5. full gasSettings (all 4 fields) → all used", async () => {
		const node = fakeNode()
		const result = await completeFeeOptions({
			node,
			gasSettings: {
				gasLimits: { daGas: 1_000_000, l2Gas: 2_000_000 },
				teardownGasLimits: { daGas: 100_000, l2Gas: 200_000 },
				maxFeesPerGas: { feePerDaGas: 1n, feePerL2Gas: 2n },
				maxPriorityFeesPerGas: { feePerDaGas: 3n, feePerL2Gas: 4n },
			},
			forEstimation: false,
		})
		expect(result.gasLimits.daGas).toBe(1_000_000)
		expect(result.gasLimits.l2Gas).toBe(2_000_000)
		expect(result.teardownGasLimits.daGas).toBe(100_000)
		expect(result.teardownGasLimits.l2Gas).toBe(200_000)
		expect(result.maxFeesPerGas.feePerDaGas).toBe(1n)
		expect(result.maxFeesPerGas.feePerL2Gas).toBe(2n)
		expect(result.maxPriorityFeesPerGas.feePerDaGas).toBe(3n)
		expect(result.maxPriorityFeesPerGas.feePerL2Gas).toBe(4n)
		// node not consulted when explicit fees provided
		expect(node.getCurrentMinFees).not.toHaveBeenCalled()
	})

	test("6. malformed maxFeesPerGas → GasFees.from throws (caller's responsibility)", async () => {
		const node = fakeNode()
		await expect(
			completeFeeOptions({
				node,
				gasSettings: { maxFeesPerGas: { feePerDaGas: "not-a-bigint", feePerL2Gas: {} } },
				forEstimation: true,
			}),
		).rejects.toThrow()
	})

	test("MIN_FEE_PADDING matches upstream 0.5 (regression pin)", () => {
		// Upstream `BaseWallet.minFeePadding = 0.5` (base_wallet.ts:32).
		// If upstream changes this in a minor bump we should know.
		expect(MIN_FEE_PADDING).toBe(0.5)
	})
})
