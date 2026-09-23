/**
 * Helper-seam pins for the dispatch split: the `via: "handler"` route returns
 * the handler's EXACT promise (no wrapping await — rejection timing stays the
 * handler's), returns `undefined` for the generic build-and-execute path, and
 * the wallet-local registry read still throws synchronously without a reader.
 */

import { describe, expect, test, vi } from "vitest"
import { WalletSdkDispatcher } from "./dispatcher"
import type { SessionContext } from "./types"

const ctx: SessionContext = { origin: "https://dapp.example", chainId: 1, profileId: "p1", sessionId: "s1" }

function bareDispatcher(): WalletSdkDispatcher {
	return Object.create(WalletSdkDispatcher.prototype) as WalletSdkDispatcher
}

function route(d: WalletSdkDispatcher, method: string, args: unknown[] = []): Promise<unknown> | undefined {
	// biome-ignore lint/suspicious/noExplicitAny: reaching the private seam under test.
	return (d as any).routeHandlerMethod(method, args, ctx, undefined, [], undefined)
}

describe("routeHandlerMethod — helper seam pins", () => {
	test("returns the handler's exact promise for every handler-routed method", () => {
		const d = bareDispatcher()
		const table: Array<[string, string, unknown[]]> = [
			["requestCapabilities", "handleRequestCapabilities", [{ capabilities: [] }]],
			["getAccounts", "handleGetAccounts", []],
			["getWalletFeatures", "handleGetWalletFeatures", []],
			["batch", "handleBatch", [[]]],
			["sendTx", "handleSendTx", [{}]],
			["registerToken", "handleRegisterToken", ["0x1", "0x2"]],
			["grantPublicAuthwit", "handleGrantPublicAuthwit", ["0x1", {}]],
			["createAuthWit", "handleCreateAuthWit", [{}]],
		]
		for (const [method, handlerName, args] of table) {
			const sentinel = new Promise<unknown>(() => {})
			// biome-ignore lint/suspicious/noExplicitAny: stubbing the private handler.
			;(d as any)[handlerName] = vi.fn(() => sentinel)
			expect(route(d, method, args), method).toBe(sentinel)
		}
	})

	test("isTokenRegistered routes to the reader's exact promise, and throws synchronously without one", () => {
		const d = bareDispatcher()
		expect(() => route(d, "isTokenRegistered", ["0x1"])).toThrow("isTokenRegistered is not available in this wallet build")
		const sentinel = new Promise<boolean>(() => {})
		// biome-ignore lint/suspicious/noExplicitAny: installing the optional reader on the bare instance.
		;(d as any).tokenRegistryReader = { isTokenRegistered: vi.fn(() => sentinel) }
		expect(route(d, "isTokenRegistered", ["0x1"])).toBe(sentinel)
	})

	test("returns undefined for build-and-execute methods (no handler touched)", () => {
		const d = bareDispatcher()
		for (const method of ["getChainInfo", "simulateTx", "registerContract", "getPrivateEvents"]) {
			expect(route(d, method), method).toBeUndefined()
		}
	})
})
