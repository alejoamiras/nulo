/**
 * The e2e seed blob is written by a trusted extension page, so it is shaped by
 * whatever a test (or a bug) puts there. These pin the reader's fail-empty
 * contract: an armed build REPLACES the production seed list with this, so
 * every rejection path must yield `[]` rather than falling back to
 * `DEFAULT_TOKEN_SEEDS` — a fallback would point e2e wallets at the public
 * RPC endpoints the real seeds name.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ChromeStorageTokenSeeds, TOKEN_SEEDS_KEY } from "./chrome-storage-token-seeds"

const CONTRACT = "0x1c81a6d581e065e82d4d3b969020e9d0f899b975ae844f6e4305031ff62be9ae"
const CLASS_ID = "0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf"

const valid = { chainId: 0, contract: CONTRACT, expectedClassId: CLASS_ID }

/** The global `chrome.storage` stub in tests/vitest.setup.ts is `{}`, so the
 *  session slice this reader uses is faked per-test — same approach as
 *  `chrome-storage-proof-gate.test.ts`. */
let store: Map<string, unknown>

function write(value: unknown): void {
	store.set(TOKEN_SEEDS_KEY, value)
}

beforeEach(() => {
	store = new Map<string, unknown>()
	vi.stubGlobal("chrome", {
		storage: {
			session: {
				get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
			},
		},
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("ChromeStorageTokenSeeds", () => {
	test("absent key → empty list (never the production seeds)", async () => {
		expect(await new ChromeStorageTokenSeeds().get()).toEqual([])
	})

	test("a throwing storage read fails empty rather than propagating", async () => {
		vi.stubGlobal("chrome", {
			storage: {
				session: {
					get: async () => {
						throw new Error("no session area")
					},
				},
			},
		})
		expect(await new ChromeStorageTokenSeeds().get()).toEqual([])
	})

	test("one valid sandbox entry → returned with the symbol pinned here, not read from storage", async () => {
		// A writer that tries to choose the expected symbol must not be able to:
		// it is the one pin the fixture already knows.
		write([{ ...valid, expectedSymbol: "NOT-TST" }])
		expect(await new ChromeStorageTokenSeeds().get()).toEqual([
			{ chainId: 0, contract: CONTRACT, expectedClassId: CLASS_ID, expectedSymbol: "TST" },
		])
	})

	test("a non-sandbox chain is rejected — an armed build cannot inject against a real network", async () => {
		write([{ ...valid, chainId: 4248422646 }])
		expect(await new ChromeStorageTokenSeeds().get()).toEqual([])
	})

	test("more than one entry is rejected outright", async () => {
		write([valid, { ...valid, contract: CLASS_ID }])
		expect(await new ChromeStorageTokenSeeds().get()).toEqual([])
	})

	test("malformed blobs and non-canonical fields all fail empty", async () => {
		for (const bad of [
			null,
			{},
			[],
			"nope",
			[null],
			[{ ...valid, contract: "0xdeadbeef" }],
			[{ ...valid, contract: CONTRACT.toUpperCase() }],
			[{ ...valid, expectedClassId: "not-hex" }],
			[{ chainId: 0, contract: CONTRACT }],
		]) {
			write(bad)
			expect(await new ChromeStorageTokenSeeds().get(), JSON.stringify(bad)).toEqual([])
		}
	})
})
