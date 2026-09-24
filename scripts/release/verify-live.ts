/**
 * The post-deploy "verify-live" decision: does the LIVE landing actually serve the
 * release we just published? Pure over already-fetched strings (the HTTP fetch
 * + bounded retry + cache-bust headers are workflow glue), so every pass/fail
 * branch is unit-testable with zero network.
 *
 * Fail-closed: anything we can't positively confirm is a FAILURE, never a pass.
 */

export interface VerifyLiveInput {
	expectedVersion: string
	/** landing `/` HTML (null ⇒ unreachable). */
	landingHtml: string | null
}

export interface VerifyLiveResult {
	ok: boolean
	failures: string[]
}

export function verifyLive(input: VerifyLiveInput): VerifyLiveResult {
	const failures: string[] = []

	// --- Landing: served HTML must reference the new release's tag page ---
	if (input.landingHtml === null) {
		failures.push("landing: unreachable")
	} else if (!input.landingHtml.includes(`releases/tag/v${input.expectedVersion}`)) {
		failures.push(`landing: served HTML does not reference releases/tag/v${input.expectedVersion}`)
	}

	return { ok: failures.length === 0, failures }
}
