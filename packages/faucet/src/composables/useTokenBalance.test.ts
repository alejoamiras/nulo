import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/*
 * Two read paths share this test file, mocked separately:
 *
 *  - balance_of_public is an `#[external("public")] #[view]` function.
 *    Read via `interaction.simulate({from})`. Mocked here by giving
 *    each method object both `.request()` and `.simulate()`.
 *
 *  - balance_of_private is an `#[external("utility")]` function. Read
 *    via `wallet.executeUtility(call, opts)`. Mocked by having
 *    `.request()` return a payload whose `calls[0]` the wallet's
 *    `executeUtility` stub then receives.
 */

type SimulateResult = unknown
const publicSimulateImpl = vi.fn<(opts: unknown) => Promise<SimulateResult>>(async () => 0n)

const mockContractMethods = {
	balance_of_public: vi.fn(() => ({
		simulate: async (opts: unknown) => publicSimulateImpl(opts),
		request: async () => ({ calls: [{ call: "public" }] }),
	})),
	balance_of_private: vi.fn(() => ({
		request: async () => ({ calls: [{ call: "private" }] }),
		simulate: async () => 0n,
	})),
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

function utility(...values: unknown[]): ExecuteUtilityResult {
	return { result: values }
}

function makeWallet(opts: { privateBalance?: bigint; throwsOnUtility?: Error } = {}) {
	return {
		executeUtility: vi.fn(async (_call: unknown, _opts: unknown) => {
			if (opts.throwsOnUtility) throw opts.throwsOnUtility
			return utility(opts.privateBalance ?? 0n)
		}),
	}
}

describe("useTokenBalance", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		mockContractMethods.balance_of_public.mockClear()
		mockContractMethods.balance_of_private.mockClear()
		publicSimulateImpl.mockReset()
		publicSimulateImpl.mockImplementation(async () => 0n)
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("fetches public via interaction.simulate({from}) and private via executeUtility", async () => {
		publicSimulateImpl.mockResolvedValueOnce({ result: 1_000_000n })
		const w = makeWallet({ privateBalance: 2_000_000n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => {
			expect(handle.publicBalance.value).toBe(1_000_000n)
			expect(handle.privateBalance.value).toBe(2_000_000n)
		})
		expect(publicSimulateImpl).toHaveBeenCalled()
		expect(w.executeUtility).toHaveBeenCalled()
		handle.dispose()
	})

	it("public path invokes .simulate() with { from } (passed even though SDK ignores it)", async () => {
		publicSimulateImpl.mockResolvedValueOnce({ result: 5n })
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(publicSimulateImpl).toHaveBeenCalled())
		const arg = publicSimulateImpl.mock.calls[0][0] as { from: unknown }
		expect(arg).toEqual({ from: ACCOUNT })
		handle.dispose()
	})

	it("private path uses executeUtility with the canonical option shape", async () => {
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
		expect(optsArg).not.toHaveProperty("from")
		handle.dispose()
	})

	it("private path extracts the FunctionCall from ExecutionPayload.calls[0]", async () => {
		const w = makeWallet()
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(w.executeUtility).toHaveBeenCalled())
		const callArg = w.executeUtility.mock.calls[0][0]
		expect(callArg).toMatchObject({ call: "private" })
		handle.dispose()
	})

	it("polls every 15 seconds (re-fetches on tick)", async () => {
		publicSimulateImpl.mockResolvedValue({ result: 1n })
		const w = makeWallet({ privateBalance: 2n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(publicSimulateImpl).toHaveBeenCalledTimes(1))
		await vi.advanceTimersByTimeAsync(15_000)
		await vi.waitFor(() => expect(publicSimulateImpl).toHaveBeenCalledTimes(2))
		handle.dispose()
	})

	it("dispose() stops further polls", async () => {
		publicSimulateImpl.mockResolvedValue({ result: 1n })
		const w = makeWallet({ privateBalance: 2n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(publicSimulateImpl).toHaveBeenCalledTimes(1))
		handle.dispose()
		await vi.advanceTimersByTimeAsync(60_000)
		expect(publicSimulateImpl).toHaveBeenCalledTimes(1)
	})

	it("refresh() re-fetches immediately", async () => {
		publicSimulateImpl.mockResolvedValue({ result: 1n })
		const w = makeWallet({ privateBalance: 2n })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(publicSimulateImpl).toHaveBeenCalledTimes(1))
		await handle.refresh()
		expect(publicSimulateImpl).toHaveBeenCalledTimes(2)
		handle.dispose()
	})

	it("surfaces a normalized error when a read fails", async () => {
		publicSimulateImpl.mockRejectedValue(new Error("Network unreachable"))
		const w = makeWallet({ throwsOnUtility: new Error("Network unreachable") })
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(handle.error.value).not.toBeNull())
		expect(handle.error.value).toMatch(/alpha-testnet is not responding/i)
		handle.dispose()
	})

	it("coerces Fr-shaped results (via toBigInt) on both read paths", async () => {
		publicSimulateImpl.mockResolvedValue({ result: { toBigInt: () => 777n } })
		const w = {
			executeUtility: vi.fn(async () => utility({ toBigInt: () => 888n })),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(handle.publicBalance.value).toBe(777n))
		expect(handle.privateBalance.value).toBe(888n)
		handle.dispose()
	})

	it("returns 0n when UtilityExecutionResult.result is empty (private path)", async () => {
		publicSimulateImpl.mockResolvedValue({ result: 0n })
		const w = {
			executeUtility: vi.fn(async () => ({ result: [] })),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		await vi.waitFor(() => expect(handle.privateBalance.value).toBe(0n))
		handle.dispose()
	})

	it("ignores writes after dispose (no late state updates from in-flight fetch)", async () => {
		let resolvePublic: (v: { result: bigint }) => void = () => {}
		publicSimulateImpl.mockImplementation(
			() =>
				new Promise<{ result: bigint }>((r) => {
					resolvePublic = r
				}),
		)
		const w = {
			executeUtility: vi.fn(() => new Promise<ExecuteUtilityResult>(() => {})),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		const handle = useTokenBalance(w as any, TOKEN, ACCOUNT)
		handle.dispose()
		resolvePublic({ result: 99n })
		await vi.advanceTimersByTimeAsync(0)
		expect(handle.publicBalance.value).toBeNull()
	})
})
