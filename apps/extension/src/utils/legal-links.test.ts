import { afterEach, describe, expect, test, vi } from "vitest"
import { LEGAL_MANIFEST } from "@nulo/legal"
import { NOTICES_FILE } from "@nulo/third-party-notices"
import { openLegalDocument, openThirdPartyNotices, THIRD_PARTY_NOTICES_FILE } from "./legal-links"

afterEach(() => vi.restoreAllMocks())

describe("openLegalDocument", () => {
	test.each(["terms", "privacy"] as const)("opens the current %s version's permalink, not the moving page", (doc) => {
		const create = vi.fn(async (_options: unknown) => ({}))
		vi.stubGlobal("chrome", { windows: { create } })
		openLegalDocument(doc)
		const version = LEGAL_MANIFEST[doc].at(-1)?.version
		expect(create).toHaveBeenCalledWith({ type: "popup", url: `https://nulo.sh/${doc}/v${version}/`, width: 360, height: 600 })
	})

	test("the onboarding tab gets the larger window", () => {
		const create = vi.fn(async (_options: unknown) => ({}))
		vi.stubGlobal("chrome", { windows: { create } })
		openLegalDocument("terms", "tab")
		expect(create.mock.calls[0]?.[0]).toMatchObject({ width: 480, height: 720 })
	})
})

describe("openThirdPartyNotices", () => {
	test("opens the file the build emits, from the extension's own origin, in a tab", () => {
		const create = vi.fn(async (_options: unknown) => ({}))
		const getURL = vi.fn((path: string) => `chrome-extension://id/${path}`)
		vi.stubGlobal("chrome", { tabs: { create }, runtime: { getURL } })
		openThirdPartyNotices()
		expect(THIRD_PARTY_NOTICES_FILE).toBe(NOTICES_FILE)
		expect(create).toHaveBeenCalledWith({ url: `chrome-extension://id/${NOTICES_FILE}` })
	})
})
