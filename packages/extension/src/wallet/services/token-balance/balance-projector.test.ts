/**
 * Unit tests for `BalanceProjector`. The helper it composes
 * (`batchedViewSimulation`) has its own tests; this file pins the projector's
 * compositional logic: grouping by `(account, chainId)`, chunking into 12,
 * single-token vs multi-token, missing balance fns, unknown tokens, error
 * propagation.
 *
 * Stubs `batchedViewSimulation` so the projector's call shape can be observed
 * without standing up a real PXE.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// Mock the helpers before importing the SUT.
const batchedViewSimulationMock = vi.fn()
vi.mock("@/wallet/services/execution/helpers/batched-view-simulation", () => ({
	batchedViewSimulation: (...args: unknown[]) => batchedViewSimulationMock(...args),
}))
vi.mock("@/wallet/services/execution/helpers/get-view-simulation-deps", () => ({
	getViewSimulationDeps: vi.fn(async () => ({
		pxe: {},
		node: {},
		account: { address: "0xacct" },
		contractResolver: {},
	})),
}))

// The projector's `enqueueCall` computes selectors + encoded args for PUBLIC
// fns — both go through real Aztec stdlib bytecode hashing. Stub both so unit
// tests focus on the projector's grouping/batching logic, not the encoding.
vi.mock("@aztec/stdlib/abi", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@aztec/stdlib/abi")>()
	return {
		...actual,
		FunctionSelector: {
			...actual.FunctionSelector,
			fromNameAndParameters: vi.fn(async (name: string) => ({ toString: () => `selector-${name}` })),
			fromString: actual.FunctionSelector.fromString,
		},
		encodeArguments: vi.fn(() => []),
	}
})

import { Fr } from "@aztec/foundation/curves/bn254"
import { BalanceProjector } from "./balance-projector"
import type { TokenBalanceRaw } from "./spec"
import type { Token } from "@/wallet/services/token/service"

const ACCOUNT_A = "0x000000000000000000000000000000000000000000000000000000000000000a"
const ACCOUNT_B = "0x000000000000000000000000000000000000000000000000000000000000000b"

function token(id: number, chainId = 1, opts: Partial<Token> = {}): Token {
	return {
		id,
		profileId: "p1",
		chainId,
		contract: `0x${id.toString(16).padStart(64, "0")}`,
		name: `T${id}`,
		symbol: `T${id}`,
		decimals: 18,
		// FnImpl shape: { name, impl: 0 = Default variant }
		balanceOfPrivateFn: { name: "balance_of_private", impl: 0 },
		balanceOfPublicFn: { name: "balance_of_public", impl: 0 },
		...opts,
	}
}

function balance(id: number, tokenId: number, account = ACCOUNT_A): TokenBalanceRaw {
	return {
		id,
		token: tokenId,
		account,
		updatedAt: 0,
	}
}

function makeProjector(opts: { tokens: Token[]; getNetworkResult?: { id: string; chainId: number } }) {
	const tokensById = new Map(opts.tokens.map((t) => [t.id, t]))
	const tokenService = {
		getTokenRaw: vi.fn(async (id: number) => {
			const t = tokensById.get(id)
			if (!t) throw new Error(`Unknown token #${id}`)
			return t
		}),
		// biome-ignore lint/suspicious/noExplicitAny: structural stub
	} as any

	const network = opts.getNetworkResult ?? { id: "net1", chainId: 1 }
	const networkService = {
		getNetworks: vi.fn(async (_chainId: number) => [network]),
		// biome-ignore lint/suspicious/noExplicitAny: structural stub
	} as any

	const executionService = {
		// biome-ignore lint/suspicious/noExplicitAny: stub
		contractResolver: {} as any,
		// biome-ignore lint/suspicious/noExplicitAny: stub
	} as any
	const profileService = {} as never
	const accountService = {} as never
	const pxeService = {} as never

	const projector = new BalanceProjector(executionService, networkService, tokenService, profileService, accountService, pxeService)
	return projector
}

beforeEach(() => {
	batchedViewSimulationMock.mockReset()
})

afterEach(() => {
	vi.clearAllMocks()
})

describe("BalanceProjector", () => {
	test("empty input → empty output, no helper call", async () => {
		const projector = makeProjector({ tokens: [] })
		const result = await projector.project([])
		expect(result).toEqual([])
		expect(batchedViewSimulationMock).not.toHaveBeenCalled()
	})

	test("single token with both balance fns → enqueues 2 calls in [PUBLIC, PRIVATE] order, returns ok", async () => {
		const t = token(1)
		const projector = makeProjector({ tokens: [t] })
		// Two-pass enqueue: PUBLIC first (index 0), then PRIVATE (index 1).
		// Reordered in fast-path-internal-views PR so `batchedViewSimulation`'s
		// leading PUBLIC+isStatic prefix covers the public arm.
		batchedViewSimulationMock.mockResolvedValueOnce({
			encoded: [[new Fr(42n)], [new Fr(7n)]],
			decoded: [],
		})

		const result = await projector.project([balance(1, 1)])
		expect(batchedViewSimulationMock).toHaveBeenCalledTimes(1)
		const callsArg = batchedViewSimulationMock.mock.calls[0][0]
		expect(callsArg).toHaveLength(2) // public + private
		expect(result[0]).toEqual({
			kind: "ok",
			id: 1,
			privateBalance: "7",
			publicBalance: "42",
		})
	})

	test("token with only public balance fn → 1 call, private defaults to '0'", async () => {
		const t = token(1, 1, { balanceOfPrivateFn: undefined })
		const projector = makeProjector({ tokens: [t] })
		batchedViewSimulationMock.mockResolvedValueOnce({
			encoded: [[new Fr(99n)]],
			decoded: [],
		})

		const result = await projector.project([balance(1, 1)])
		expect(batchedViewSimulationMock.mock.calls[0][0]).toHaveLength(1)
		expect(result[0]).toMatchObject({ kind: "ok", privateBalance: "0", publicBalance: "99" })
	})

	test("multiple tokens, same (account, chain) → grouped into one chunk", async () => {
		const t1 = token(1)
		const t2 = token(2)
		const projector = makeProjector({ tokens: [t1, t2] })
		batchedViewSimulationMock.mockResolvedValueOnce({
			encoded: [[new Fr(1n)], [new Fr(2n)], [new Fr(3n)], [new Fr(4n)]],
			decoded: [],
		})
		const result = await projector.project([balance(1, 1), balance(2, 2)])
		expect(batchedViewSimulationMock).toHaveBeenCalledTimes(1)
		expect(result).toHaveLength(2)
		expect(result.every((r) => r.kind === "ok")).toBe(true)
	})

	test("multiple (account, chain) groups → independent batches", async () => {
		const t = token(1)
		const projector = makeProjector({ tokens: [t] })
		batchedViewSimulationMock
			.mockResolvedValueOnce({ encoded: [[new Fr(1n)], [new Fr(2n)]], decoded: [] })
			.mockResolvedValueOnce({ encoded: [[new Fr(3n)], [new Fr(4n)]], decoded: [] })
		await projector.project([balance(1, 1, ACCOUNT_A), balance(2, 1, ACCOUNT_B)])
		expect(batchedViewSimulationMock).toHaveBeenCalledTimes(2)
	})

	test("15 tokens in one group → chunked into 12 + 3 (BATCH_SIZE = 12 regression)", async () => {
		const tokens = Array.from({ length: 15 }, (_, i) => token(i + 1))
		const projector = makeProjector({ tokens })
		// 12 tokens × 2 fns = 24 results in batch 1; 3 tokens × 2 fns = 6 in batch 2
		batchedViewSimulationMock
			.mockResolvedValueOnce({ encoded: Array.from({ length: 24 }, () => [new Fr(0n)]), decoded: [] })
			.mockResolvedValueOnce({ encoded: Array.from({ length: 6 }, () => [new Fr(0n)]), decoded: [] })
		const balances = tokens.map((t) => balance(t.id, t.id))
		await projector.project(balances)
		expect(batchedViewSimulationMock).toHaveBeenCalledTimes(2)
		// First chunk size: 12 tokens × 2 fns
		expect(batchedViewSimulationMock.mock.calls[0][0]).toHaveLength(24)
		// Second chunk size: 3 tokens × 2 fns
		expect(batchedViewSimulationMock.mock.calls[1][0]).toHaveLength(6)
	})

	test("unknown token id → error entry preserves message", async () => {
		const projector = makeProjector({ tokens: [] })
		const result = await projector.project([balance(99, 999)])
		expect(result[0]).toEqual({ kind: "error", id: 99, error: "Unknown token #999" })
		expect(batchedViewSimulationMock).not.toHaveBeenCalled()
	})

	test("batchedViewSimulation throws → one error per input balance, message preserved", async () => {
		const t = token(1)
		const projector = makeProjector({ tokens: [t] })
		batchedViewSimulationMock.mockRejectedValueOnce(new Error("PXE went away"))
		const result = await projector.project([balance(1, 1), balance(2, 1)])
		expect(result).toHaveLength(2)
		expect(result.every((r) => r.kind === "error" && r.error === "PXE went away")).toBe(true)
	})

	test("two-pass enqueue: all PUBLIC calls precede all PRIVATE calls in the chunk (regression pin for fast-path-internal-views)", async () => {
		// Fixture: 3 tokens, each with BOTH public and private balance fns.
		// After the two-pass enqueue (PUBLIC first across all balances, then
		// PRIVATE), the chunk should be:
		//   [pub_t1, pub_t2, pub_t3, priv_t1, priv_t2, priv_t3]
		// NOT the old per-token interleaving:
		//   [priv_t1, pub_t1, priv_t2, pub_t2, priv_t3, pub_t3]
		const tokens = [token(1), token(2), token(3)]
		const projector = makeProjector({ tokens })
		batchedViewSimulationMock.mockResolvedValueOnce({
			encoded: Array.from({ length: 6 }, () => [new Fr(0n)]),
			decoded: [],
		})
		await projector.project([balance(10, 1), balance(20, 2), balance(30, 3)])
		expect(batchedViewSimulationMock).toHaveBeenCalledTimes(1)
		const callsArg = batchedViewSimulationMock.mock.calls[0][0] as Array<
			{ kind: "call"; method: string } | { kind: "encoded_call"; selector: string }
		>
		expect(callsArg).toHaveLength(6)
		// First three calls = all PUBLIC. balance_of_public is encoded
		// (kind="encoded_call" + selector-balance_of_public).
		for (let i = 0; i < 3; i++) {
			const c = callsArg[i]
			expect(c.kind).toBe("encoded_call")
			expect((c as { selector: string }).selector).toBe("selector-balance_of_public")
		}
		// Last three calls = all PRIVATE. balance_of_private is UTILITY-typed,
		// enqueued as kind="call" with method name.
		for (let i = 3; i < 6; i++) {
			const c = callsArg[i]
			expect(c.kind).toBe("call")
			expect((c as { method: string }).method).toBe("balance_of_private")
		}
	})
})
