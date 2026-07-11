/**
 * Freezing tests for the wallet config defaults + schema-domain validation.
 *
 * Each `expect(...).toBe(...)` default-freeze below is INTENTIONAL: a failing
 * assertion means a default flipped.
 *
 * **Security / financial defaults** (anything affecting passhash caching,
 * session lifetime, fee payment, or signing exposure) must NOT be flipped
 * without an explicit SECURITY.md entry. "Fixing" the test by updating the
 * value silently is a regression.
 *
 * **UX defaults** (theme, animations, panel visibility) may be flipped with
 * reviewer sign-off in the PR description — no SECURITY.md entry required.
 */

import { describe, expect, test } from "vitest"
import { ConfigSchema, defaultConfig } from "./config"

describe("Config — frozen security defaults", () => {
	test("strictSecurityMode defaults to true", () => {
		// SECURITY.md §strict mode: password profiles do NOT cache passhash in
		// chrome.storage.session when on. Default must stay `true`. SW death →
		// re-auth. Flipping to `false` is an explicit security regression that
		// requires SECURITY.md sign-off.
		expect(defaultConfig().strictSecurityMode).toBe(true)
	})

	test("sessionTtl defaults to 30 minutes", () => {
		// Lock-related — callers (popup auto-lock UI, alarm scheduler) assume it.
		expect(defaultConfig().sessionTtl).toBe(30 * 60 * 1000)
	})
})

describe("Config — frozen UX defaults", () => {
	test("theme defaults to 'system'", () => {
		expect(defaultConfig().theme).toBe("system")
	})

	test("debug + developer flags default OFF", () => {
		const config = defaultConfig()
		expect(config.developerMode).toBe(false)
		expect(config.debugMode).toBe(false)
		expect(config.indicateFailures).toBe(false)
	})
})

describe("ConfigSchema — domain validation (Q-20)", () => {
	test("theme rejects out-of-domain values (closes the prior typeof-check hole)", () => {
		expect(ConfigSchema.shape.theme.safeParse("bogus").success).toBe(false)
		expect(ConfigSchema.shape.theme.safeParse("dark").success).toBe(true)
	})

	test("defaultExplorer accepts null + 'aztecscan', rejects others", () => {
		// `null` is a valid domain value (`BlockExplorerType | null`); the prior
		// `typeof null !== "string"` check WRONGLY rejected a persisted null.
		expect(ConfigSchema.shape.defaultExplorer.safeParse(null).success).toBe(true)
		expect(ConfigSchema.shape.defaultExplorer.safeParse("aztecscan").success).toBe(true)
		expect(ConfigSchema.shape.defaultExplorer.safeParse("etherscan").success).toBe(false)
	})

	test("strictSecurityMode: a corrupted string can't flip it; only a real boolean false (intentional opt-out)", () => {
		expect(ConfigSchema.shape.strictSecurityMode.safeParse("false").success).toBe(false)
		expect(ConfigSchema.shape.strictSecurityMode.safeParse(false).success).toBe(true)
	})

	test("sessionTtl: 0 stays valid (no coercion / .positive / .min); a string is rejected", () => {
		expect(ConfigSchema.shape.sessionTtl.safeParse(0).success).toBe(true)
		expect(ConfigSchema.shape.sessionTtl.safeParse("1800000").success).toBe(false)
	})
})
