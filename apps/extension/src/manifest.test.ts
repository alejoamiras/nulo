import { describe, expect, test } from "vitest"
import logoDataUri from "@/assets/logo.png?inline"
import manifest from "../manifest/manifest.config"

/**
 * The source manifest declares no web-accessible resources: the logo entry let every page fetch
 * it and so fingerprint the install, and the wallet-sdk discovery icon — the one asset a page
 * legitimately needs — travels inline instead. (The build plugin still emits entries for the
 * content-script chunks; that is a separate, tracked exposure.)
 */
describe("manifest surface", () => {
	test("declares no web-accessible resources", () => {
		expect((manifest as unknown as Record<string, unknown>).web_accessible_resources).toBeUndefined()
	})

	test("the discovery icon is a data URI, so no URL has to be exposed for it", () => {
		expect(logoDataUri.startsWith("data:image/png;base64,")).toBe(true)
	})
})
