import { TxHash } from "@aztec/stdlib/tx"
import { afterEach, describe, expect, test, vi } from "vitest"
import { AztecNodeFactoryAdapter } from "./aztec-node-factory-adapter"

describe("AztecNodeFactoryAdapter.createSingleAttemptNode", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test("a call that fails is one request: nothing is retried after it", async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError("Failed to fetch")
		})
		vi.stubGlobal("fetch", fetch)
		const node = new AztecNodeFactoryAdapter().createSingleAttemptNode("http://localhost:1", 1_000)
		await expect(node.getTxReceipt(TxHash.random())).rejects.toThrow()
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	test("refuses a URL outside the allowlist, as createNode does", () => {
		expect(() => new AztecNodeFactoryAdapter().createSingleAttemptNode("http://example.com", 1_000)).toThrow(/refused/)
	})
})
