import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockContractMethods = {
	balance_of_public: vi.fn(() => ({ request: async () => ({ calls: [{ call: "public" }] }) })),
	balance_of_private: vi.fn(() => ({ request: async () => ({ calls: [{ call: "private" }] }) })),
}
const mockContract = { methods: mockContractMethods }

vi.mock("@aztec/aztec.js/contracts", () => ({
	Contract: { at: vi.fn(async () => mockContract) },
}))

vi.mock("@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js", () => ({
	TokenContractArtifact: { name: "Token" },
}))

import { useTokenBalance } from "./useTokenBalance"

const TOKEN = { toString: () => "0xtoken" } as unknown as Parameters<typeof useTokenBalance>[1]
const ACCOUNT = { toString: () => "0xaccount" } as unknown as Parameters<typeof useTokenBalance>[2]

type ExecuteUtilityResult = { result: unknown[] }

// Wrap a value into the shape executeUtility actually returns —
// `UtilityExecutionResult` per @aztec/stdlib/tx/profiling.d.ts:476.
function utility(...values: unknown[]): ExecuteUtilityResult {
	return { result: values }
}

function makeWallet(opts: { publicBalance?: bigint; privateBalance?: bigint; throws?: Error } = {}) {
	const calls: unknown[] = []
	return {
		_calls: calls,
		executeUtility: vi.fn(async (call: { call: string }, _opts: unknown) => {
			calls.push(call)
			if (opts.throws) throw opts.throws
			return call.call === "public" ? utility(opts.publicBalance ?? 0n) : utility(opts.privateBalance ?? 0n)
		}),
	}
}

describe("useTokenBalance", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		mockContractMethods.balance_of_public.mockClear()
		mockContractMethods.balance_of_private.mockClear()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("fetches both public + private balances on mount (extracts result[0] from UtilityExecutionResult)", async () => {
		const w = makeWallet({ publicBalance: 1_000_000n, privateBalance: 2_000_000n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => {
			expect(handle.publicBalance.value).toBe(1_000_000n)
			expect(handle.privateBalance.value).toBe(2_000_000n)
		})
		handle.dispose()
	})

	it("uses wallet.executeUtility with the canonical option shape (scopes + empty arrays)", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(w.executeUtility).toHaveBeenCalled())
		const optsArg = w.executeUtility.mock.calls[0][1] as Record<string, unknown>
		expect(optsArg).toMatchObject({
			scopes: [ACCOUNT],
			authWitnesses: [],
			capsules: [],
			extraHashedArgs: [],
		})
		// Critical: does NOT pass `from` — that's a SendOptions key, not ExecuteUtilityOptions
		expect(optsArg).not.toHaveProperty("from")
		handle.dispose()
	})

	it("extracts the FunctionCall from ExecutionPayload.calls[0] (not the whole exec)", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(w.executeUtility).toHaveBeenCalled())
		const callArg = w.executeUtility.mock.calls[0][0]
		expect(callArg).toMatchObject({ call: "public" })
		handle.dispose()
	})

	it("polls every 15 seconds (re-fetches on tick)", async () => {
		const w = makeWallet({ publicBalance: 1n, privateBalance: 2n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(w.executeUtility).toHaveBeenCalledTimes(2))
		await vi.advanceTimersByTimeAsync(15_000)
		await vi.waitFor(() => expect(w.executeUtility).toHaveBeenCalledTimes(4))
		handle.dispose()
	})

	it("dispose() stops further polls", async () => {
		const w = makeWallet({ publicBalance: 1n, privateBalance: 2n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(w.executeUtility).toHaveBeenCalledTimes(2))
		handle.dispose()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(w.executeUtility).toHaveBeenCalledTimes(2)
	})

	it("refresh() invalidates the poll cycle and re-fetches immediately", async () => {
		const w = makeWallet({ publicBalance: 1n, privateBalance: 2n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(w.executeUtility).toHaveBeenCalledTimes(2))
		await handle.refresh()
		expect(w.executeUtility).toHaveBeenCalledTimes(4)
		handle.dispose()
	})

	it("surfaces a normalized error message on executeUtility failure", async () => {
		const w = makeWallet({ throws: new Error("Network unreachable") })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(handle.error.value).not.toBeNull())
		expect(handle.error.value).toMatch(/alpha-testnet is not responding/i)
		handle.dispose()
	})

	it("handles Fr-shaped result values (calls toBigInt() on objects that expose it)", async () => {
		const w = {
			executeUtility: vi.fn(async (call: { call: string }) => utility({ toBigInt: () => (call.call === "public" ? 777n : 888n) })),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(handle.publicBalance.value).toBe(777n))
		expect(handle.privateBalance.value).toBe(888n)
		handle.dispose()
	})

	it("returns 0n if UtilityExecutionResult.result is empty", async () => {
		const w = {
			executeUtility: vi.fn(async () => ({ result: [] })),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(handle.publicBalance.value).toBe(0n))
		handle.dispose()
	})

	it("clears the loading flag after a successful fetch", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(handle.loading.value).toBe(false))
		handle.dispose()
	})

	it("ignores writes after dispose (no late state updates from in-flight fetch)", async () => {
		let resolve: (v: ExecuteUtilityResult) => void = () => {}
		const w = {
			executeUtility: vi.fn(
				() =>
					new Promise<ExecuteUtilityResult>((r) => {
						resolve = r
					}),
			),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		handle.dispose()
		resolve(utility(99n))
		await vi.advanceTimersByTimeAsync(0)
		expect(handle.publicBalance.value).toBeNull()
	})
})
