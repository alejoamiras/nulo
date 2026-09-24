/** Does the live landing serve the release just published? Fail-closed: anything not positively
 *  confirmed is a failure. */

export interface VerifyLiveInput {
	expectedVersion: string
	/** landing `/` HTML (null ⇒ unreachable). */
	landingHtml: string | null
}

export interface VerifyLiveResult {
	ok: boolean
	failures: string[]
}

// The tag must end at the link's closing quote: a bare substring match would accept v0.28.10 or
// v0.28.1-rc.2 for an expected 0.28.1.
function linksReleaseTag(html: string, version: string): boolean {
	const tag = `releases/tag/v${version}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return new RegExp(`${tag}["']`).test(html)
}

export function verifyLive(input: VerifyLiveInput): VerifyLiveResult {
	const failures: string[] = []
	if (input.landingHtml === null) {
		failures.push("landing: unreachable")
	} else if (!linksReleaseTag(input.landingHtml, input.expectedVersion)) {
		failures.push(`landing: served HTML does not reference releases/tag/v${input.expectedVersion}`)
	}
	return { ok: failures.length === 0, failures }
}
