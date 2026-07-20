import { beforeEach, describe, expect, test } from "vitest"
import { isTrustedInternalSender } from "./sender-auth"

const s = (v: object | undefined) => v as unknown as chrome.runtime.MessageSender | undefined

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: minimal chrome stub for the test
	;(globalThis as any).chrome = {
		runtime: { id: "nulo-ext-id", getURL: (p: string) => `chrome-extension://nulo-ext-id/${p}` },
	}
})

describe("isTrustedInternalSender (F-09)", () => {
	test("accepts a service-worker sender (matching id, no url)", () => {
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id" }))).toBe(true)
	})

	test("accepts an extension page — popup / offscreen / options — INCLUDING when hosted in a tab", () => {
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id", url: "chrome-extension://nulo-ext-id/popup.html" }))).toBe(true)
		// options page or popup-opened-in-a-tab (the e2e case): tab present, but a
		// chrome-extension URL → still trusted (this is the F-09 cascade fix).
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id", url: "chrome-extension://nulo-ext-id/options.html", tab: { id: 5 } }))).toBe(
			true,
		)
	})

	test("rejects a foreign extension id", () => {
		expect(isTrustedInternalSender(s({ id: "other-ext", url: "chrome-extension://other-ext/popup.html" }))).toBe(false)
	})

	test("rejects a content script the extension injected into a web page (web-url sender)", () => {
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id", url: "https://evil.example/x", tab: { id: 5 } }))).toBe(false)
	})

	test("rejects an undefined sender", () => {
		expect(isTrustedInternalSender(undefined)).toBe(false)
	})

	test("Firefox parity: a moz-extension page is trusted; a web page is not", () => {
		// biome-ignore lint/suspicious/noExplicitAny: swap getURL to the Firefox scheme
		;(globalThis as any).chrome.runtime.getURL = (p: string) => `moz-extension://nulo-ext-id/${p}`
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id", url: "moz-extension://nulo-ext-id/popup.html", tab: { id: 5 } }))).toBe(true)
		expect(isTrustedInternalSender(s({ id: "nulo-ext-id", url: "https://x/page" }))).toBe(false)
	})
})
