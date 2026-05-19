/**
 * Test-mode detection for the playground.
 *
 * The playground ships a couple of debug-only behaviors (input persistence via
 * localStorage, protocol log) that we want OFF when driven by Puppeteer to keep
 * tests deterministic. The flag is sourced from a `?test=1` query param so the
 * test driver can opt in without env-var coordination.
 */

export const IS_TEST_MODE = (() => {
	if (typeof window === "undefined") return false
	const url = new URL(window.location.href)
	return url.searchParams.get("test") === "1"
})()
