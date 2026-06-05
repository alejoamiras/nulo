import { describe, expect, test } from "vitest"
import { trustKey } from "./repository"

describe("IncomingTransferRepository — trustKey", () => {
	test("composes profile|network|contract", () => {
		expect(trustKey("p1", "net-1", "0xabc")).toBe("p1|net-1|0xabc")
	})
	test("different contracts on the same (profile, network) get distinct keys", () => {
		expect(trustKey("p1", "net-1", "0xa")).not.toBe(trustKey("p1", "net-1", "0xb"))
	})
	test("same contract on different networks gets distinct keys", () => {
		expect(trustKey("p1", "net-1", "0xa")).not.toBe(trustKey("p1", "net-2", "0xa"))
	})
	test("same contract on different profiles gets distinct keys", () => {
		expect(trustKey("p1", "net-1", "0xa")).not.toBe(trustKey("p2", "net-1", "0xa"))
	})
})
