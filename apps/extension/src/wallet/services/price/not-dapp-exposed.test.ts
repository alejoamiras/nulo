/**
 * Pins the security invariant that PriceService is NOT reachable from the
 * dApp surface. The wallet-sdk background handler wires services into the
 * dispatcher explicitly, so "not exposed" is the default — this test exists
 * so that wiring price data into the dApp surface can only happen as a
 * deliberate, reviewed decision (this file changing), never as a side
 * effect of refactoring.
 */

import { describe, expect, test } from "vitest"
import backgroundSource from "@/wallet/services/wallet-sdk/background.ts?raw"
import dispatcherSource from "../../../../../../packages/wallet-bridge/src/dispatcher.ts?raw"

describe("PriceService dApp exposure", () => {
	test("wallet-sdk background handler does not wire the price service", () => {
		expect(backgroundSource).not.toContain("PriceService")
		expect(backgroundSource).not.toContain("services/price")
	})

	test("wallet-bridge dispatcher has no price dependency", () => {
		expect(dispatcherSource).not.toContain("PriceService")
		expect(dispatcherSource).not.toMatch(/price/i)
	})
})
