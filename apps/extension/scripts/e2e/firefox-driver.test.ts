import { describe, expect, test } from "vitest"
import { type SilentCloseWatch, newestFirefoxDir, silentlyClosed, uuidFromPrefs } from "../../tests/e2e/fixtures/browser/firefox"

/**
 * Puppeteer's own `executablePath({ browser: "firefox" })` composes the Firefox path from the
 * CHROME build id, so it returns a directory that was never installed and geckodriver rejects the
 * session with "binary is not a Firefox executable". The driver resolves from the cache instead,
 * and this is the comparison it resolves with.
 */
describe("firefox cache directory selection", () => {
	test("picks the newest by version, not lexically", () => {
		// Lexical order would put 152 after 153 here, and the 9 before the 10.
		expect(newestFirefoxDir(["linux-stable_152.0.4", "linux-stable_153.0.4"])).toBe("linux-stable_153.0.4")
		expect(newestFirefoxDir(["linux-stable_9.0.0", "linux-stable_10.0.0"])).toBe("linux-stable_10.0.0")
	})

	test("compares every component, not just the major", () => {
		expect(newestFirefoxDir(["linux-stable_153.0.4", "linux-stable_153.0.10"])).toBe("linux-stable_153.0.10")
		expect(newestFirefoxDir(["linux-stable_153.0.4", "linux-stable_153.1.0"])).toBe("linux-stable_153.1.0")
	})

	test("treats a missing component as zero rather than as newer", () => {
		expect(newestFirefoxDir(["linux-stable_153", "linux-stable_153.0.1"])).toBe("linux-stable_153.0.1")
	})

	test("an empty cache has no answer, so the caller can say what to install", () => {
		expect(newestFirefoxDir([])).toBeUndefined()
	})

	test("does not mutate the caller's list", () => {
		const dirs = ["linux-stable_152.0.4", "linux-stable_153.0.4"]
		newestFirefoxDir(dirs)
		expect(dirs).toEqual(["linux-stable_152.0.4", "linux-stable_153.0.4"])
	})
})

/** `installAddon` returns the manifest id; the add-on's pages are served from a per-profile UUID. */
describe("per-profile UUID from prefs.js", () => {
	const pref = (json: string) => `user_pref("extensions.webextensions.uuids", ${JSON.stringify(json)});`

	test("reads the UUID mapped to the add-on id, among other add-ons and prefs", () => {
		const prefs = [
			'user_pref("browser.startup.page", 0);',
			pref('{"formautofill@mozilla.org":"11111111-aaaa","wallet@nulo.sh":"22222222-bbbb"}'),
		].join("\n")
		expect(uuidFromPrefs(prefs, "wallet@nulo.sh")).toBe("22222222-bbbb")
	})

	test("has no answer before the add-on is mapped or the pref is flushed", () => {
		expect(uuidFromPrefs(pref('{"formautofill@mozilla.org":"11111111-aaaa"}'), "wallet@nulo.sh")).toBeUndefined()
		expect(uuidFromPrefs('user_pref("browser.startup.page", 0);', "wallet@nulo.sh")).toBeUndefined()
	})

	test("a half-written pref is a miss, not a throw — the caller polls", () => {
		expect(uuidFromPrefs('user_pref("extensions.webextensions.uuids", "{\\"wallet@nulo.sh\\":\\"22', "wallet@nulo.sh")).toBeUndefined()
		expect(uuidFromPrefs('user_pref("extensions.webextensions.uuids", "not json");', "wallet@nulo.sh")).toBeUndefined()
	})
})

/** Firefox sends no BiDi event for a window that closes itself, so the handle list decides. */
describe("silent window closes", () => {
	const fresh = (): SilentCloseWatch => ({ listed: new Set(), misses: new Map() })

	test("a listed window that leaves the handle list is closed on the second miss, not the first", () => {
		const watch = fresh()
		expect(silentlyClosed(watch, ["a"], new Set(["a"]))).toEqual([])
		expect(silentlyClosed(watch, ["a"], new Set())).toEqual([])
		expect(silentlyClosed(watch, ["a"], new Set())).toEqual(["a"])
	})

	// BiDi can announce a window before the classic channel lists it. Calling that window closed
	// would tear a live approval window out from under the test waiting for it.
	test("a window the handle list has never shown is not closed, however long it is missing", () => {
		const watch = fresh()
		for (let read = 0; read < 5; read++) expect(silentlyClosed(watch, ["new"], new Set())).toEqual([])
		expect(silentlyClosed(watch, ["new"], new Set(["new"]))).toEqual([])
	})

	test("one missed read is forgiven when the window is listed again", () => {
		const watch = fresh()
		silentlyClosed(watch, ["a"], new Set(["a"]))
		silentlyClosed(watch, ["a"], new Set())
		expect(silentlyClosed(watch, ["a"], new Set(["a"]))).toEqual([])
		expect(silentlyClosed(watch, ["a"], new Set())).toEqual([])
	})
})
