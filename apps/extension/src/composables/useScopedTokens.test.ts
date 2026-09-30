import { EventHandler } from "@nulo/wallet-core/utils"
import { flushPromises } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { reactive } from "vue"
import type { TokenInfo } from "@/wallet/services/token/spec"
import { type UseScopedTokensOptions, useScopedTokens } from "./useScopedTokens"

const token = (id: number, symbol: string): TokenInfo => ({
	id,
	chainId: 1,
	contract: `0x${id}`,
	name: symbol,
	symbol,
	decimals: 18,
	hasDecimals: true,
	hasPublicBalances: true,
	hasPublicTransfers: true,
	hasPublicToPrivateTransfers: true,
	hasPrivateBalances: true,
	hasPrivateTransfers: true,
	hasPrivateToPublicTransfers: true,
})

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

let getTokens: ReturnType<typeof vi.fn>
let onTokenAdded: EventHandler<TokenInfo>
let store: { profileId: string | null; chainId: number | null; account: string }

const setup = () =>
	useScopedTokens({
		tokenService: { getTokens, onTokenAdded } as unknown as UseScopedTokensOptions["tokenService"],
		scope: () => (store.profileId && store.chainId ? { profileId: store.profileId, chainId: store.chainId } : undefined),
	})

beforeEach(() => {
	getTokens = vi.fn().mockResolvedValue([token(1, "TST")])
	onTokenAdded = new EventHandler<TokenInfo>()
	store = reactive({ profileId: "p1", chainId: 1, account: "0xa" })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("useScopedTokens", () => {
	test("reload() reads the scope's tokens", async () => {
		const { tokens, reload } = setup()
		await reload()
		expect(getTokens).toHaveBeenCalledWith("p1", 1)
		expect(tokens.value.map((t) => t.symbol)).toEqual(["TST"])
	})

	test("an unset scope reads nothing, and a scope that becomes unset clears the list", async () => {
		store.chainId = null
		const { tokens, reload } = setup()
		await reload()
		expect(getTokens).not.toHaveBeenCalled()

		store.chainId = 1
		await flushPromises()
		expect(tokens.value).toHaveLength(1)
		store.profileId = null
		expect(tokens.value).toEqual([])
		await flushPromises()
		expect(getTokens).toHaveBeenCalledTimes(1)
	})

	test("a scope change clears the list before anything paints, then reads the new scope", async () => {
		const { tokens, reload } = setup()
		await reload()
		getTokens.mockResolvedValue([token(2, "NEW")])

		store.chainId = 2
		expect(tokens.value).toEqual([])
		expect(getTokens).toHaveBeenLastCalledWith("p1", 2)
		await flushPromises()
		expect(tokens.value.map((t) => t.symbol)).toEqual(["NEW"])
	})

	test("an account switch within the profile and chain keeps the list and reads nothing", async () => {
		const { tokens, reload } = setup()
		await reload()
		store.account = "0xb"
		await flushPromises()
		expect(getTokens).toHaveBeenCalledTimes(1)
		expect(tokens.value.map((t) => t.symbol)).toEqual(["TST"])
	})

	test("a read for the old scope that resolves after the new one is dropped", async () => {
		const slow = deferred<TokenInfo[]>()
		getTokens.mockReturnValueOnce(slow.promise)
		const { tokens, reload } = setup()
		void reload()

		getTokens.mockResolvedValue([token(2, "FRESH")])
		store.profileId = "p2"
		await flushPromises()
		slow.resolve([token(9, "STALE")])
		await flushPromises()
		expect(tokens.value.map((t) => t.symbol)).toEqual(["FRESH"])
	})

	test("a failed read keeps the list and logs the error at debug", async () => {
		const debug = vi.spyOn(console, "debug").mockImplementation(() => {})
		const { tokens, reload } = setup()
		await reload()
		const error = new Error("port cannot open")
		getTokens.mockRejectedValue(error)

		await reload()
		expect(tokens.value.map((t) => t.symbol)).toEqual(["TST"])
		expect(debug).toHaveBeenCalledWith("token lookup failed", { error })
	})

	test("a token added anywhere re-reads the scope, whatever the event carries", async () => {
		const { tokens, reload } = setup()
		await reload()
		getTokens.mockResolvedValue([token(1, "TST"), token(3, "ADD")])

		onTokenAdded.invoke({ ...token(99, "FOREIGN"), chainId: 7 })
		await flushPromises()
		expect(getTokens).toHaveBeenLastCalledWith("p1", 1)
		expect(tokens.value.map((t) => t.symbol)).toEqual(["TST", "ADD"])
	})

	test("tokenById finds a known id and nothing for an unknown or missing one", async () => {
		const { tokenById, reload } = setup()
		await reload()
		expect(tokenById(1)?.symbol).toBe("TST")
		expect(tokenById(2)).toBeUndefined()
		expect(tokenById(undefined)).toBeUndefined()
	})

	test("reload() replaces the list with the latest read", async () => {
		const { tokens, reload } = setup()
		await reload()
		getTokens.mockResolvedValue([token(4, "LATEST")])
		await reload()
		expect(tokens.value.map((t) => t.symbol)).toEqual(["LATEST"])
	})

	test("dispose() stops the scope watch, the token listener and any later reload", async () => {
		const { tokens, reload, dispose } = setup()
		await reload()
		dispose()

		store.chainId = 2
		onTokenAdded.invoke(token(3, "ADD"))
		await reload()
		await flushPromises()
		expect(getTokens).toHaveBeenCalledTimes(1)
		expect(tokens.value.map((t) => t.symbol)).toEqual(["TST"])
	})

	test("a read that resolves after dispose() changes nothing", async () => {
		const slow = deferred<TokenInfo[]>()
		getTokens.mockReturnValueOnce(slow.promise)
		const { tokens, reload, dispose } = setup()
		void reload()
		dispose()
		slow.resolve([token(1, "LATE")])
		await flushPromises()
		expect(tokens.value).toEqual([])
	})
})
