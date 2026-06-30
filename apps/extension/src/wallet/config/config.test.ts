/**
 * Freezing tests for the wallet config defaults.
 *
 * Each `expect(...).toBe(...)` line below is INTENTIONALLY a freeze: a
 * failing assertion here means a default flipped.
 *
 * **Security / financial defaults** (this category covers anything affecting
 * passhash caching, session lifetime, fee payment, or signing exposure) must
 * NOT be flipped without an explicit SECURITY.md entry. The expectation
 * documents the security invariant; "fixing" the test by updating the value
 * silently is a regression.
 *
 * **UX defaults** (theme, animations, panel visibility) may be flipped with
 * reviewer sign-off in the PR description — no SECURITY.md entry required.
 * The freeze exists so a careless change is caught and discussed, not so
 * every UX tweak needs a security paper trail.
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
	test("theme defaults to 'system'", () => {
		// Flipped from 'dark' → 'system' in the QA-feedback-batch-1 PR after
		// friends QA noted the wallet ignores OS appearance on first install.
		// 'system' tracks the OS setting (matches Chrome / macOS conventions);
		// existing users keep their persisted choice via config storage.
		expect(new Config().theme).toBe("system")
	})

	test("debug + developer flags default OFF", () => {
		const config = new Config()
		expect(config.developerMode).toBe(false)
		expect(config.debugMode).toBe(false)
		expect(config.indicateFailures).toBe(false)
	})
})
