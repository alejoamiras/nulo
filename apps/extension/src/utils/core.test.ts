import { describe, expect, test } from "vitest"
import type { AccountServiceClient } from "@/wallet/services/account/client"
import type { NetworkServiceClient } from "@/wallet/services/network/client"
import { getAccount, getNetwork, managers, requireAccount, requireNetwork } from "@/utils/core"

/**
 * Q-16: the 3 lazy clients are typed `| null`. require*() asserts non-null with a
 * clear error (the safety net replacing the prior silent `null.foo()` TypeError);
 * get*() returns `| null` for the tolerant disconnect-before-reassign sites.
 * State is module-level + Proxy-backed, so each test sets the slot explicitly.
 */
describe("AppServices lazy-client accessors (Q-16)", () => {
	test("(BUG-PIN) require*() throws a clear error when the client is unset", () => {
		managers.network = null
		managers.account = null
		expect(() => requireNetwork()).toThrow("network service not initialized")
		expect(() => requireAccount()).toThrow("account service not initialized")
	})

	test("get*() returns null when unset (tolerant path — no throw)", () => {
		managers.network = null
		expect(getNetwork()).toBeNull()
		expect(getAccount()).toBeNull()
	})

	test("require*()/get*() return the client after the unlock flow assigns it", () => {
		const net = {} as NetworkServiceClient
		const acc = {} as AccountServiceClient
		managers.network = net
		managers.account = acc
		expect(requireNetwork()).toBe(net)
		expect(getNetwork()).toBe(net)
		expect(requireAccount()).toBe(acc)
		expect(getAccount()).toBe(acc)
		// Reset so the module-level slots don't leak into other suites.
		managers.network = null
		managers.account = null
	})
})
