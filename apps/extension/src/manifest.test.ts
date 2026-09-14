import { describe, expect, test } from "vitest"
import logoDataUri from "@/assets/logo.png?inline"
import manifest from "../manifest/manifest.config"

/**
 * Nothing the extension ships is web-accessible: a `web_accessible_resources` entry lets every
 * page fetch the listed file and so fingerprint the install. The wallet-sdk discovery icon, the
 * one asset a page legitimately needs, travels inline instead.
 */
describe("manifest surface", () => {
	test("declares no web-accessible resources", () => {
		expect((manifest as unknown as Record<string, unknown>).web_accessible_resources).toBeUndefined()
	})

	test("the discovery icon is a data URI, so no URL has to be exposed for it", () => {
		expect(logoDataUri.startsWith("data:image/png;base64,")).toBe(true)
	})
})
