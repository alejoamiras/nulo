import { describe, expect, test } from "vitest"
import { GasFees } from "@aztec/stdlib/gas"
import { type MinFeeNode, predictedWorstMinFees } from "./fee-juice"

// An error from getPredictedMinFees falls back to the (possibly stale) current min fee only when
// the method is missing; silently downgrading on a transient error under-prices the cap.
describe("predictedWorstMinFees fallback", () => {
	test("a transient 'block not found' error PROPAGATES (no fee downgrade)", async () => {
		const box = { currentCalls: 0 }
		const n: MinFeeNode = {
			getPredictedMinFees: async () => {
				throw new Error("block not found")
			},
			getCurrentMinFees: async () => {
				box.currentCalls++
				return new GasFees(1n, 1n)
			},
		}
		await expect(predictedWorstMinFees(n)).rejects.toThrow(/block not found/)
		expect(box.currentCalls).toBe(0)
	})

	test("a genuine 'method not found' STILL falls back to getCurrentMinFees", async () => {
		const box = { currentCalls: 0 }
		const n: MinFeeNode = {
			getPredictedMinFees: async () => {
				throw new Error("method not found")
			},
			getCurrentMinFees: async () => {
				box.currentCalls++
				return new GasFees(1n, 1n)
			},
		}
		await expect(predictedWorstMinFees(n)).resolves.toBeInstanceOf(GasFees)
		expect(box.currentCalls).toBe(1)
	})

	test("a JSON-RPC -32601 (via error.cause.code) falls back even without the phrase", async () => {
		const box = { currentCalls: 0 }
		const err = Object.assign(new Error("rpc error"), { cause: { code: -32601 } })
		const n: MinFeeNode = {
			getPredictedMinFees: async () => {
				throw err
			},
			getCurrentMinFees: async () => {
				box.currentCalls++
				return new GasFees(1n, 1n)
			},
		}
		await expect(predictedWorstMinFees(n)).resolves.toBeInstanceOf(GasFees)
		expect(box.currentCalls).toBe(1)
	})
})
