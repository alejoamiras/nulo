import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockContractMethods = {
	balance_of_public: vi.fn(() => ({ request: async () => ({ call: "public" }) })),
	balance_of_private: vi.fn(() => ({ request: async () => ({ call: "private" }) })),
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

function makeWallet(opts: { publicBalance?: bigint; privateBalance?: bigint; throws?: Error } = {}) {
	const calls: unknown[] = []
	return {
		_calls: calls,
		executeUtility: vi.fn(async (call: { call: string }, _opts: unknown) => {
			calls.push(call)
			if (opts.throws) throw opts.throws
			return call.call === "public" ? (opts.publicBalance ?? 0n) : (opts.privateBalance ?? 0n)
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

	it("fetches both public + private balances on mount", async () => {
		const w = makeWallet({ publicBalance: 1_000_000n, privateBalance: 2_000_000n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => {
			expect(handle.publicBalance.value).toBe(1_000_000n)
			expect(handle.privateBalance.value).toBe(2_000_000n)
		})
		handle.dispose()
	})

	it("uses wallet.executeUtility with the correct empty-arrays option shape", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(w.executeUtility).toHaveBeenCalled())
		const optsArg = w.executeUtility.mock.calls[0][1] as Record<string, unknown>
		expect(optsArg).toMatchObject({
			from: ACCOUNT,
			scopes: [],
			authWitnesses: [],
			capsules: [],
			extraHashedArgs: [],
		})
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

	it("returns BigInt unchanged when the SDK returns bigint", async () => {
		const w = makeWallet({ publicBalance: 12345678901234567890n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(handle.publicBalance.value).toBe(12345678901234567890n))
		handle.dispose()
	})

	it("coerces SDK return values with a toBigInt() method", async () => {
		const w = {
			executeUtility: vi.fn(async (call: { call: string }) => ({
				toBigInt: () => (call.call === "public" ? 777n : 888n),
			})),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(handle.publicBalance.value).toBe(777n))
		expect(handle.privateBalance.value).toBe(888n)
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
		let resolve: (v: bigint) => void = () => {}
		const w = {
			executeUtility: vi.fn(
				() =>
					new Promise<bigint>((r) => {
						resolve = r
					}),
			),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		handle.dispose()
		resolve(99n)
		await vi.advanceTimersByTimeAsync(0)
		expect(handle.publicBalance.value).toBeNull()
	})
})
