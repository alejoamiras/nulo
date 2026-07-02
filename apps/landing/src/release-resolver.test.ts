import { describe, expect, it } from "vitest"
import { noReleaseInfo, resolveReleaseInfo } from "./release-resolver"

const apiOk = {
	tag_name: "v0.15.0",
	html_url: "https://github.com/alejoamiras/nulo/releases/tag/v0.15.0",
	published_at: "2026-05-15T12:00:00Z",
	assets: [
		{ name: "nulo-chrome-0.15.0.zip", browser_download_url: "https://example.test/nulo-chrome-0.15.0.zip" },
		{ name: "nulo-firefox-0.15.0.zip", browser_download_url: "https://example.test/nulo-firefox-0.15.0.zip" },
		{ name: "SHASUMS256.txt", browser_download_url: "https://example.test/SHASUMS256.txt" },
	],
}

describe("resolveReleaseInfo", () => {
	it("parses a release payload into the landing's release shape", () => {
		expect(resolveReleaseInfo(apiOk)).toEqual({
			status: "ok",
			version: "0.15.0",
			publishedAt: "2026-05-15T12:00:00Z",
			chromeZipUrl: "https://example.test/nulo-chrome-0.15.0.zip",
			releaseUrl: "https://github.com/alejoamiras/nulo/releases/tag/v0.15.0",
			shasumsUrl: "https://example.test/SHASUMS256.txt",
		})
	})

	it("throws when no nulo-chrome-*.zip asset is present (must fail loud, not silently)", () => {
		const without = { ...apiOk, assets: apiOk.assets.filter((a) => !a.name.startsWith("nulo-chrome-")) }
		expect(() => resolveReleaseInfo(without)).toThrow(/no nulo-chrome-.*\.zip asset/)
	})
})

describe("noReleaseInfo", () => {
	it("points at the repo's releases page so first-time deploys don't break the CTA", () => {
		expect(noReleaseInfo("alejoamiras/nulo")).toEqual({
			status: "no-release",
			releaseUrl: "https://github.com/alejoamiras/nulo/releases",
		})
	})
})
