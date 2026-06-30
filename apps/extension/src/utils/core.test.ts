import { beforeEach, describe, expect, test } from "vitest"
import type { AccountServiceClient } from "@/wallet/services/account/client"
import type { NetworkServiceClient } from "@/wallet/services/network/client"
import type { TransactionServiceClient } from "@/wallet/services/transaction/client"
import { getAccount, getNetwork, getTransaction, managers, requireAccount, requireNetwork, requireTransaction } from "@/utils/core"

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
