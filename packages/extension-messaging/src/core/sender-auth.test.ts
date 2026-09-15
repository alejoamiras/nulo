import { beforeEach, describe, expect, test, vi } from "vitest"
import { isBackgroundSender, isSenderAtUrl, isTrustedInternalSender, resetBackgroundContextUrls } from "./sender-auth"

const s = (v: object | undefined) => v as unknown as chrome.runtime.MessageSender | undefined

beforeEach(() => {
	resetBackgroundContextUrls()
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

describe("isSenderAtUrl (exact-document peer)", () => {
	const DOC = "chrome-extension://nulo-ext-id/src/offscreen/index.html"
	test("accepts the exact document URL, with or without a query, tab-hosted or not", () => {
		expect(isSenderAtUrl(s({ id: "nulo-ext-id", url: DOC }), DOC)).toBe(true)
		expect(isSenderAtUrl(s({ id: "nulo-ext-id", url: `${DOC}?instance=abc` }), DOC)).toBe(true)
		expect(isSenderAtUrl(s({ id: "nulo-ext-id", url: `${DOC}?instance=abc`, tab: { id: 3 } }), DOC)).toBe(true)
	})
	test("rejects another same-extension page, a prefix/suffix of the path, a missing url and a foreign id", () => {
		expect(isSenderAtUrl(s({ id: "nulo-ext-id", url: "chrome-extension://nulo-ext-id/src/popup/index.html" }), DOC)).toBe(false)
		expect(isSenderAtUrl(s({ id: "nulo-ext-id", url: `${DOC}x` }), DOC)).toBe(false)
		expect(isSenderAtUrl(s({ id: "nulo-ext-id", url: DOC.slice(0, -1) }), DOC)).toBe(false)
		expect(isSenderAtUrl(s({ id: "nulo-ext-id" }), DOC)).toBe(false)
		expect(isSenderAtUrl(s({ id: "other-ext", url: DOC }), DOC)).toBe(false)
		expect(isSenderAtUrl(undefined, DOC)).toBe(false)
	})
})

describe("isBackgroundSender (the only sender an offscreen request may come from)", () => {
	test("Chrome: the manifest's service-worker script URL, or a url-less same-extension worker sender", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: minimal chrome stub for the test
		;(globalThis as any).chrome.runtime.getManifest = () => ({ background: { service_worker: "sw.js" } })
		expect(await isBackgroundSender(s({ id: "nulo-ext-id", url: "chrome-extension://nulo-ext-id/sw.js" }))).toBe(true)
		expect(await isBackgroundSender(s({ id: "nulo-ext-id" }))).toBe(true)
	})
	test("Firefox: the generated background page for `scripts`, or an explicit `page`", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: minimal chrome stub for the test
		const c = (globalThis as any).chrome
		c.runtime.getURL = (p: string) => `moz-extension://nulo-ext-id/${p}`
		c.runtime.getManifest = () => ({ background: { scripts: ["bg.js"] } })
		expect(await isBackgroundSender(s({ id: "nulo-ext-id", url: "moz-extension://nulo-ext-id/_generated_background_page.html" }))).toBe(
			true,
		)
		resetBackgroundContextUrls()
		c.runtime.getManifest = () => ({ background: { page: "bg.html" } })
		expect(await isBackgroundSender(s({ id: "nulo-ext-id", url: "moz-extension://nulo-ext-id/bg.html" }))).toBe(true)
	})
	test("Chrome OFFSCREEN document (no getManifest): the manifest is fetched by URL and cached", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: minimal chrome stub for the test
		const c = (globalThis as any).chrome
		c.runtime.getManifest = undefined
		const fetched: string[] = []
		vi.stubGlobal("fetch", async (url: string) => {
			fetched.push(url)
			return { json: async () => ({ background: { service_worker: "service-worker-loader.js", type: "module" } }) }
		})
		try {
			expect(await isBackgroundSender(s({ id: "nulo-ext-id", url: "chrome-extension://nulo-ext-id/service-worker-loader.js" }))).toBe(
				true,
			)
			expect(await isBackgroundSender(s({ id: "nulo-ext-id", url: "chrome-extension://nulo-ext-id/src/popup/index.html" }))).toBe(
				false,
			)
			expect(fetched).toEqual(["chrome-extension://nulo-ext-id/manifest.json"])
		} finally {
			vi.unstubAllGlobals()
		}
	})

	test("rejects a popup / offscreen / options page, a tab-bound sender, a foreign id and a content script", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: minimal chrome stub for the test
		;(globalThis as any).chrome.runtime.getManifest = () => ({ background: { service_worker: "sw.js" } })
		expect(await isBackgroundSender(s({ id: "nulo-ext-id", url: "chrome-extension://nulo-ext-id/src/popup/index.html" }))).toBe(false)
		expect(await isBackgroundSender(s({ id: "nulo-ext-id", url: "chrome-extension://nulo-ext-id/src/offscreen/index.html" }))).toBe(
			false,
		)
		expect(await isBackgroundSender(s({ id: "nulo-ext-id", url: "chrome-extension://nulo-ext-id/sw.js", tab: { id: 1 } }))).toBe(false)
		expect(await isBackgroundSender(s({ id: "nulo-ext-id", tab: { id: 1 } }))).toBe(false)
		expect(await isBackgroundSender(s({ id: "other-ext" }))).toBe(false)
		expect(await isBackgroundSender(s({ id: "nulo-ext-id", url: "https://evil.example/x", tab: { id: 5 } }))).toBe(false)
		expect(await isBackgroundSender(undefined)).toBe(false)
	})
})
