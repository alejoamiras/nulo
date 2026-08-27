import { beforeEach, describe, expect, test, vi } from "vitest"
import type { AccountServiceClient } from "@/wallet/services/account/client"
import type { NetworkServiceClient } from "@/wallet/services/network/client"
import type { TransactionServiceClient } from "@/wallet/services/transaction/client"
import {
	getAccount,
	getNetwork,
	getTransaction,
	managers,
	refreshBalances,
	requireAccount,
	requireNetwork,
	requireTransaction,
} from "@/utils/core"

const tbMock = vi.hoisted(() => ({
	getTokenBalances: vi.fn(),
	refreshTokenBalance: vi.fn(),
	disconnect: vi.fn(),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	// Constructed with `new` — needs a real function (a constructor returning an object
	// yields that object), not an arrow.
	TokenBalanceServiceClient: vi.fn(function TokenBalanceServiceClient() {
		return tbMock
	}),
}))

/**
 * Q-16: the 3 lazy clients are typed `| null`. require*() asserts non-null with a
 * clear error (the safety net replacing the prior silent `null.foo()` TypeError);
 * get*() returns `| null` for the tolerant disconnect-before-reassign sites.
 * State is module-level + Proxy-backed, so reset all three slots before each test.
 */
describe("AppServices lazy-client accessors (Q-16)", () => {
	beforeEach(() => {
		managers.network = null
		managers.transaction = null
		managers.account = null
	})

	test("(BUG-PIN) require*() throws a clear error when the client is unset", () => {
		expect(() => requireNetwork()).toThrow("network service not initialized")
		expect(() => requireTransaction()).toThrow("transaction service not initialized")
		expect(() => requireAccount()).toThrow("account service not initialized")
	})

	test("get*() returns null when unset (tolerant path — no throw)", () => {
		expect(getNetwork()).toBeNull()
		expect(getTransaction()).toBeNull()
		expect(getAccount()).toBeNull()
	})

	test("require*()/get*() return the client after the unlock flow assigns it", () => {
		const net = {} as NetworkServiceClient
		const txn = {} as TransactionServiceClient
		const acc = {} as AccountServiceClient
		managers.network = net
		managers.transaction = txn
		managers.account = acc
		expect(requireNetwork()).toBe(net)
		expect(getNetwork()).toBe(net)
		expect(requireTransaction()).toBe(txn)
		expect(getTransaction()).toBe(txn)
		expect(requireAccount()).toBe(acc)
		expect(getAccount()).toBe(acc)
	})
})

describe("refreshBalances — the disconnect must not cancel its own refresh RPCs", () => {
	const STALE = () => Date.now() - 31 * 60_000

	beforeEach(() => {
		tbMock.getTokenBalances.mockReset()
		tbMock.refreshTokenBalance.mockReset()
		tbMock.disconnect.mockReset()
	})

	test("disconnect waits for every stale-balance refresh to settle; fresh rows are not refreshed", async () => {
		tbMock.getTokenBalances.mockResolvedValue([
			{ id: 1, updatedAt: STALE() },
			{ id: 2, updatedAt: Date.now() },
		])
		let release!: () => void
		tbMock.refreshTokenBalance.mockImplementation(
			() =>
				new Promise<void>((r) => {
					release = r
				}),
		)

		const done = refreshBalances(10, [{ address: "0xa" }])
		await new Promise((r) => setTimeout(r, 0))

		expect(tbMock.refreshTokenBalance).toHaveBeenCalledTimes(1)
		expect(tbMock.refreshTokenBalance).toHaveBeenCalledWith(1)
		// The refresh is still in flight — the port used to be torn down right here.
		expect(tbMock.disconnect).not.toHaveBeenCalled()

		release()
		await done
		expect(tbMock.disconnect).toHaveBeenCalledTimes(1)
	})

	test("a thrown balance read still releases the connection (the throw path used to leak it)", async () => {
		tbMock.getTokenBalances.mockRejectedValue(new Error("port closed"))

		await expect(refreshBalances(10, [{ address: "0xa" }])).rejects.toThrow("port closed")
		expect(tbMock.refreshTokenBalance).not.toHaveBeenCalled()
		expect(tbMock.disconnect).toHaveBeenCalledTimes(1)
	})

	test("one failed refresh is logged and does not cut the others short; the function still resolves", async () => {
		tbMock.getTokenBalances.mockResolvedValue([
			{ id: 1, updatedAt: STALE() },
			{ id: 2, updatedAt: STALE() },
		])
		let releaseSecond!: () => void
		tbMock.refreshTokenBalance.mockImplementation((id: number) =>
			id === 1
				? Promise.reject(new Error("boom"))
				: new Promise<void>((r) => {
						releaseSecond = r
					}),
		)
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		const done = refreshBalances(10, [{ address: "0xa" }])
		await new Promise((r) => setTimeout(r, 0))

		// The first refresh has already rejected while the second is still in flight — a
		// fail-fast implementation (Promise.all) would have disconnected right here.
		expect(tbMock.disconnect).not.toHaveBeenCalled()

		releaseSecond()
		await done

		expect(tbMock.refreshTokenBalance).toHaveBeenCalledTimes(2)
		expect(consoleSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }))
		expect(tbMock.disconnect).toHaveBeenCalledTimes(1)
		consoleSpy.mockRestore()
	})
})
