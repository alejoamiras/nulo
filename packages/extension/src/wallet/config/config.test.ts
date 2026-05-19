/**
 * Freezing tests for the wallet config defaults.
 *
 * Each `expect(...).toBe(...)` line below is INTENTIONALLY a freeze: a
 * failing assertion here means a default flipped, and a flipped default has
 * security or UX consequences that should be reviewed explicitly. Do NOT
 * "fix" a failing test here by updating the expected value without an
 * explicit SECURITY.md entry justifying the change.
 */

import { describe, expect, test } from "vitest"
import { Config } from "./config"

describe("Config — frozen security defaults", () => {
	test("strictSecurityMode defaults to true", () => {
		// SECURITY.md §strict mode:
		// password profiles do NOT cache passhash in chrome.storage.session
		// when this is on. Default must stay `true`. SW death → re-auth.
		// Flipping this to `false` is an explicit security regression that
		// requires SECURITY.md sign-off.
		const config = new Config()
		expect(config.strictSecurityMode).toBe(true)
	})

	test("sessionTtl defaults to 30 minutes", () => {
		// Lock-related freezing — UX choice, not security-critical, but
		// callers (popup auto-lock UI, alarm scheduler) assume this default.
		const config = new Config()
		expect(config.sessionTtl).toBe(30 * 60 * 1000)
	})
})

describe("Config — frozen UX defaults", () => {
	test("theme defaults to 'dark'", () => {
		expect(new Config().theme).toBe("dark")
	})

	test("debug + developer flags default OFF", () => {
		const config = new Config()
		expect(config.developerMode).toBe(false)
		expect(config.debugMode).toBe(false)
		expect(config.indicateFailures).toBe(false)
	})
})
