import { describe, expect, test, vi } from "vitest"
import {
	type SilentCloseWatch,
	abandonSession,
	firefoxDirFor,
	silentlyClosed,
	uuidFromPrefs,
} from "../../tests/e2e/fixtures/browser/firefox"

/**
 * Puppeteer's own `executablePath({ browser: "firefox" })` composes the Firefox path from the
 * CHROME build id, so it returns a directory that was never installed and geckodriver rejects the
 * session with "binary is not a Firefox executable". The driver resolves from the cache instead.
 */
describe("firefox cache directory selection", () => {
	test("picks the locked revision, not the newest a shared cache happens to hold", () => {
		const dirs = ["linux-stable_152.0.4", "linux-stable_153.0.4", "linux-stable_154.0.1"]
		expect(firefoxDirFor(dirs, "stable_153.0.4")).toBe("linux-stable_153.0.4")
	})

	test("a revision that is a suffix of another is not mistaken for it", () => {
		expect(firefoxDirFor(["linux-nightly_stable_153.0.4x", "linux-xstable_153.0.4"], "stable_153.0.4")).toBeUndefined()
	})

	test("a cache without the locked revision has no answer, so the caller can say what to install", () => {
		expect(firefoxDirFor(["linux-stable_154.0.1"], "stable_153.0.4")).toBeUndefined()
		expect(firefoxDirFor([], "stable_153.0.4")).toBeUndefined()
	})
})

describe("a session the launch refuses to keep", () => {
	const record = () => ({
		marker: "m",
		pid: 1,
		ownerPid: 1,
		ownerStartTime: "1",
		profileDir: "/profiles/profile-m",
		ownsProfile: true,
		label: "t",
	})
	const cause = new Error("Firefox did not inherit the launch marker")

	test("is ended, and the launch fails with its original reason", async () => {
		const owned = record()
		const disown = vi.fn()
		await expect(abandonSession({ close: async () => {} }, owned, cause, disown)).rejects.toBe(cause)
		expect(disown).not.toHaveBeenCalled()
	})

	// Its Firefox may carry another launch's marker, invisible to this launch's teardown.
	test("that cannot be ended keeps its profile out of teardown's reach", async () => {
		const owned = record()
		const close = () => Promise.reject(new Error("timed out"))
		const disown = vi.fn()
		await expect(abandonSession({ close }, owned, cause, disown)).rejects.toThrow(/could not be ended \(timed out\).*left in place/)
		expect(disown).toHaveBeenCalledWith(owned)
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
	test("a window the handle list has not shown yet is given far longer than a listed one", () => {
		const watch = fresh()
		for (let read = 0; read < 7; read++) expect(silentlyClosed(watch, ["new"], new Set())).toEqual([])
		expect(silentlyClosed(watch, ["new"], new Set(["new"]))).toEqual([])
	})

	// A verify window can open, be approved and close between two reads. If "never listed" meant
	// "never closed", its target would stay in `targets()` for the rest of the run.
	test("a window that opened and closed between reads is still reported, eventually", () => {
		const watch = fresh()
		for (let read = 0; read < 7; read++) expect(silentlyClosed(watch, ["flash"], new Set())).toEqual([])
		expect(silentlyClosed(watch, ["flash"], new Set())).toEqual(["flash"])
	})

	test("one missed read is forgiven when the window is listed again", () => {
		const watch = fresh()
		silentlyClosed(watch, ["a"], new Set(["a"]))
		silentlyClosed(watch, ["a"], new Set())
		expect(silentlyClosed(watch, ["a"], new Set(["a"]))).toEqual([])
		expect(silentlyClosed(watch, ["a"], new Set())).toEqual([])
	})
})
