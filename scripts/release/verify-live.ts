/**
 * The post-deploy "verify-live" decision: does the LIVE site actually serve the
 * release we just published? Pure over already-fetched strings (the HTTP fetch
 * + bounded retry + cache-bust headers are workflow glue), so every pass/fail
 * branch is unit-testable with zero network.
 *
 * Fail-closed: anything we can't positively confirm is a FAILURE, never a pass.
 * The faucet check defeats a split CDN cache (fresh `/build.json` but stale
 * `index.html`/JS) by requiring the buildId embedded in the served HTML to
 * EXACTLY equal the one in `/build.json` — the exact false-pass codex flagged.
 */

export interface FaucetBuildJson {
	buildId?: string
	version?: string
	chainId?: number
}

export interface VerifyLiveInput {
	expectedVersion: string
	/** the release commit (full sha); the faucet buildId's sha component must match its first 8. */
	expectedSha: string
	expectedWalletChainId: number
	/** faucet `/` HTML (null ⇒ unreachable). */
	faucetHtml: string | null
	/** faucet `/build.json` parsed (null ⇒ unreachable / unparseable). */
	faucetBuildJson: FaucetBuildJson | null
	/** landing `/` HTML (null ⇒ unreachable). */
	landingHtml: string | null
}

export interface VerifyLiveResult {
	ok: boolean
	failures: string[]
}

/** Pull the buildId from `<meta name="nulo-build" content="…">` (attribute-order tolerant). */
export function extractBuildId(html: string): string | null {
	const meta = html.match(/<meta\b[^>]*\bname=["']nulo-build["'][^>]*>/i)?.[0]
	if (!meta) return null
	return meta.match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? null
}

export function verifyLive(input: VerifyLiveInput): VerifyLiveResult {
	const failures: string[] = []

	// --- Faucet: HTML buildId must match build.json buildId (split-cache guard) + chainId ---
	if (input.faucetHtml === null) {
		failures.push("faucet: unreachable")
	}
	if (input.faucetBuildJson === null) {
		failures.push("faucet: /build.json unreachable or unparseable")
	}
	if (input.faucetHtml !== null && input.faucetBuildJson !== null) {
		const htmlBuildId = extractBuildId(input.faucetHtml)
		const jsonBuildId = input.faucetBuildJson.buildId ?? null
		if (!htmlBuildId) failures.push("faucet: no nulo-build meta in served HTML")
		else if (!jsonBuildId) failures.push("faucet: no buildId in /build.json")
		else if (htmlBuildId !== jsonBuildId) {
			failures.push(`faucet: split CDN cache — HTML buildId ${htmlBuildId} != build.json ${jsonBuildId}`)
		} else if (input.expectedSha) {
			// Fresh-deploy guard: buildId is `${version}+${sha}`; its sha component must be
			// THIS release's commit, else a stale-but-self-consistent prior deploy passes
			// (both files old together). The faucet version is decoupled from the release,
			// so the sha — not the version — is the freshness signal.
			const buildSha = jsonBuildId.split("+").pop() ?? ""
			const wantSha = input.expectedSha.slice(0, 8)
			if (buildSha !== wantSha) failures.push(`faucet: stale deploy — build sha '${buildSha}' != release ${wantSha}`)
		}
		if (input.faucetBuildJson.chainId !== input.expectedWalletChainId) {
			failures.push(`faucet: chainId ${input.faucetBuildJson.chainId} != expected ${input.expectedWalletChainId}`)
		}
	}

	// --- Landing: served HTML must reference the new release's tag page ---
	if (input.landingHtml === null) {
		failures.push("landing: unreachable")
	} else if (!input.landingHtml.includes(`releases/tag/v${input.expectedVersion}`)) {
		failures.push(`landing: served HTML does not reference releases/tag/v${input.expectedVersion}`)
	}

	return { ok: failures.length === 0, failures }
}
