import { describe, expect, it, vi } from "vitest"
import { assertPortalInitializerPinned, assertRouterWitnessShape, assertSame, retryOnRevert } from "./script-l1"

// viem's getContract builds `read.<fn>()` callables from the client's readContract — a stub
// client is enough to drive the preflights.
function stubClient(answers: Record<string, unknown>) {
	return {
		readContract: async ({ functionName }: { functionName: string }) => {
			if (!(functionName in answers)) throw new Error(`unexpected read: ${functionName}`)
			return answers[functionName]
		},
	}
}

describe("script-l1", () => {
	it("assertSame is case-insensitive and throws with both values on mismatch", () => {
		expect(() => assertSame("0xAB", "0xab", "x")).not.toThrow()
		expect(() => assertSame("0x01", "0x02", "portal.registry")).toThrow(/portal\.registry - on-chain 0x01 != expected 0x02/)
	})

	it("router witness gate passes on a bound B2 router", async () => {
		const pub = stubClient({ swapTarget: "0xSWAP", BRIDGE_WITNESS_TYPE_STRING: "TokenBridge(... swapTarget ...)" })
		await expect(assertRouterWitnessShape(pub, "0xrouter" as `0x${string}`, "0xswap", "pre-B2; STOP")).resolves.toBeUndefined()
	})

	it("router witness gate rejects a wrong swapTarget and a pre-B2 witness string", async () => {
		const wrongTarget = stubClient({ swapTarget: "0xOTHER", BRIDGE_WITNESS_TYPE_STRING: "has swapTarget" })
		await expect(assertRouterWitnessShape(wrongTarget, "0xrouter" as `0x${string}`, "0xswap", "hint")).rejects.toThrow(
			/router\.swapTarget/,
		)
		const preB2 = stubClient({ swapTarget: "0xSWAP", BRIDGE_WITNESS_TYPE_STRING: "legacy witness" })
		await expect(assertRouterWitnessShape(preB2, "0xrouter" as `0x${string}`, "0xswap", "pre-B2; STOP")).rejects.toThrow(/pre-B2; STOP/)
	})

	it("initializer preflight passes the pinned broadcaster and rejects any other key", async () => {
		const initializerAbi = [
			{ type: "function", name: "initializer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
		] as const
		const pub = stubClient({ initializer: "0xAbCd" })
		await expect(
			assertPortalInitializerPinned(pub, "0xportal" as `0x${string}`, initializerAbi as never, "0xabcd"),
		).resolves.toBeUndefined()
		await expect(assertPortalInitializerPinned(pub, "0xportal" as `0x${string}`, initializerAbi as never, "0x9999")).rejects.toThrow(
			/no rescue path/,
		)
	})

	it("retryOnRevert retries ONLY the transient REVERTED case, rethrows everything else", async () => {
		vi.useFakeTimers()
		try {
			let calls = 0
			const eventuallyOk = retryOnRevert(async () => {
				calls++
				if (calls < 3) throw new Error("execution REVERTED: subtree full")
				return "landed"
			})
			await vi.advanceTimersByTimeAsync(2 * 45_000)
			expect(await eventuallyOk).toBe("landed")
			expect(calls).toBe(3)

			await expect(retryOnRevert(async () => Promise.reject(new Error("insufficient funds")))).rejects.toThrow(/insufficient funds/)

			// Budget exhausted: the persistent revert surfaces after `tries` attempts.
			let persistent = 0
			const exhausted = retryOnRevert(async () => {
				persistent++
				throw new Error("execution REVERTED: forever")
			}, 2).catch((e: Error) => e)
			await vi.advanceTimersByTimeAsync(45_000)
			expect(((await exhausted) as Error).message).toMatch(/REVERTED: forever/)
			expect(persistent).toBe(2)
		} finally {
			vi.useRealTimers()
		}
	})
})
