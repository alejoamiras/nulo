import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { NodeStatus } from "@/wallet/services/network/spec"
import { preflightNetworkConnectivity } from "./importPreflight"

/** Fake timers patch BOTH `Date.now` (the deadline clock) and `setTimeout`
 *  (the module's real sleep), so instant probes win their page-side race and
 *  hanging probes lose it, deterministically. */
beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
})

const NEVER = new Promise<NodeStatus>(() => {})

async function run(promise: Promise<Map<string, string>>): Promise<Map<string, string>> {
	await vi.runAllTimersAsync()
	return await promise
}

describe("preflightNetworkConnectivity", () => {
	test("Active on the first attempt → go, one probe, full attempt budget", async () => {
		const calls: Array<{ id: string; timeoutMs: number }> = []
		const verdicts = await run(
			preflightNetworkConnectivity({
				networkIds: ["n1"],
				probe: async (id, timeoutMs) => {
					calls.push({ id, timeoutMs })
					return NodeStatus.Active
				},
				deadlineAt: Date.now() + 21_000,
			}),
		)
		expect(verdicts.get("n1")).toBe("go")
		expect(calls).toEqual([{ id: "n1", timeoutMs: 5_000 }])
	})

	test("InvalidChain → wrong-network immediately, NO retries (the node answered)", async () => {
		let calls = 0
		const verdicts = await run(
			preflightNetworkConnectivity({
				networkIds: ["n1"],
				probe: async () => {
					calls++
					return NodeStatus.InvalidChain
				},
				deadlineAt: Date.now() + 21_000,
			}),
		)
		expect(verdicts.get("n1")).toBe("wrong-network")
		expect(calls).toBe(1)
	})

	test("Inactive retries through the exponential backoff waits, then unreachable", async () => {
		let calls = 0
		const verdicts = await run(
			preflightNetworkConnectivity({
				networkIds: ["n1"],
				probe: async () => {
					calls++
					return NodeStatus.Inactive
				},
				deadlineAt: Date.now() + 60_000,
			}),
		)
		expect(verdicts.get("n1")).toBe("unreachable")
		expect(calls).toBe(3)
	})

	test("recovery mid-sequence: Inactive then Active → go", async () => {
		let calls = 0
		const verdicts = await run(
			preflightNetworkConnectivity({
				networkIds: ["n1"],
				probe: async () => (++calls === 1 ? NodeStatus.Inactive : NodeStatus.Active),
				deadlineAt: Date.now() + 60_000,
			}),
		)
		expect(verdicts.get("n1")).toBe("go")
		expect(calls).toBe(2)
	})

	test("a HANGING probe loses the page-side race per attempt; later attempts shrink to the deadline remainder", async () => {
		const budgets: number[] = []
		const verdicts = await run(
			preflightNetworkConnectivity({
				networkIds: ["n1"],
				probe: (_id, timeoutMs) => {
					budgets.push(timeoutMs)
					return NEVER
				},
				deadlineAt: Date.now() + 21_000,
			}),
		)
		expect(verdicts.get("n1")).toBe("unreachable")
		// Exact-deadline races (no page-side grace): attempt 1 burns 5000
		// (t=5000, wait 2000 → 7000); attempt 2 burns 5000 (t=12000, wait 4000
		// → 16000); attempt 3 gets min(5000, 21000-16000) = 5000 → t=21000,
		// exactly the deadline.
		expect(budgets).toEqual([5_000, 5_000, 5_000])
	})

	test("a throwing probe counts as an attempt and retries", async () => {
		let calls = 0
		const verdicts = await run(
			preflightNetworkConnectivity({
				networkIds: ["n1"],
				probe: async () => {
					calls++
					throw new Error("port race")
				},
				deadlineAt: Date.now() + 60_000,
			}),
		)
		expect(verdicts.get("n1")).toBe("unreachable")
		expect(calls).toBe(3)
	})

	test("an already-expired deadline probes NOTHING", async () => {
		let calls = 0
		const verdicts = await run(
			preflightNetworkConnectivity({
				networkIds: ["n1"],
				probe: async () => {
					calls++
					return NodeStatus.Active
				},
				deadlineAt: Date.now() - 1,
			}),
		)
		expect(verdicts.get("n1")).toBe("unreachable")
		expect(calls).toBe(0)
	})

	test("duplicate network ids probe once; every network gets a verdict", async () => {
		const probed: string[] = []
		const verdicts = await run(
			preflightNetworkConnectivity({
				networkIds: ["n1", "n2", "n1", "n3"],
				probe: async (id) => {
					probed.push(id)
					return NodeStatus.Active
				},
				deadlineAt: Date.now() + 21_000,
			}),
		)
		expect(probed.sort()).toEqual(["n1", "n2", "n3"])
		expect([...verdicts.keys()].sort()).toEqual(["n1", "n2", "n3"])
	})
})
