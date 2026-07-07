import { beforeEach, describe, expect, test } from "vitest"
import { isTrustedInternalSender } from "./sender-auth"

const s = (v: object | undefined) => v as unknown as chrome.runtime.MessageSender | undefined

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: minimal chrome stub for the test
	;(globalThis as any).chrome = { runtime: { id: "nulo-ext-id" } }
})

describe("isTrustedInternalSender (F-09)", () => {
	test("accepts a same-extension SW/popup/offscreen sender (matching id, no tab)", () => {
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id" }))).toBe(true)
	})

	test("rejects a foreign extension id", () => {
		expect(isTrustedInternalSender(s({ id: "other-ext" }))).toBe(false)
	})

	test("rejects a tab-bound sender (content script / page) even with a matching id", () => {
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id", tab: { id: 5 } }))).toBe(false)
	})

	test("rejects an undefined sender", () => {
		expect(isTrustedInternalSender(undefined)).toBe(false)
	})

	test("Firefox sender shape uses the same predicate", () => {
		// Firefox `MessageSender` carries the identical `{id, tab}` shape.
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id" }))).toBe(true)
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id", tab: { url: "https://x" } }))).toBe(false)
	})
})
