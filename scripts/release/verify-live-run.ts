/**
 * The I/O runner around the pure `verifyLive` decision (verify-live.ts). Fetches
 * the live tools + landing (cache-busted, `no-cache`), retries to ride out CDN
 * propagation lag, and fails CLOSED — if the live state can't be confirmed to
 * match the release after the retry budget, it's a failure, never a pass.
 *
 * `fetch` is injectable so the retry / fail-closed / split-cache branches are
 * unit-testable with zero network.
 */

import { TESTNET_WALLET_CHAIN_ID } from "./chain-guard"
import { type ToolsBuildJson, verifyLive, type VerifyLiveResult } from "./verify-live"

export interface RunVerifyLiveOpts {
	/** the release version the landing must reference, e.g. "0.23.0". */
	version: string
	/** the release commit (full sha); the tools app buildId's sha component must match its first 8. */
	sha: string
	/** landing origin, e.g. "https://nulo.sh". */
	landingUrl: string
	/** tools origin — MUST be the OPEN host. A CF-Access-gated host returns the
	 *  login page, not build.json, so verify-live would fail. e.g. "https://testnet.tools.nulo.sh". */
	toolsUrl: string
	fetchImpl?: typeof fetch
	/** retries AFTER the first attempt (default 6). */
	retries?: number
	/** delay between attempts in ms (default 10s). */
	retryDelayMs?: number
	/** injectable sleep so tests don't actually wait. */
	sleepImpl?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** A cache-busted text GET; returns null on any non-2xx / network error. */
async function getText(fetchImpl: typeof fetch, url: string): Promise<string | null> {
	try {
		const bust = url.includes("?") ? "&" : "?"
		const res = await fetchImpl(`${url}${bust}_cb=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } })
		if (!res.ok) return null
		return await res.text()
	} catch {
		return null
	}
}

async function gather(fetchImpl: typeof fetch, opts: RunVerifyLiveOpts) {
	const [toolsHtml, toolsBuildRaw, landingHtml] = await Promise.all([
		getText(fetchImpl, `${opts.toolsUrl}/`),
		getText(fetchImpl, `${opts.toolsUrl}/build.json`),
		getText(fetchImpl, `${opts.landingUrl}/`),
	])
	let toolsBuildJson: ToolsBuildJson | null = null
	if (toolsBuildRaw !== null) {
		try {
			toolsBuildJson = JSON.parse(toolsBuildRaw) as ToolsBuildJson
		} catch {
			toolsBuildJson = null // unparseable → treated as unreachable → fail-closed
		}
	}
	return {
		expectedVersion: opts.version,
		expectedSha: opts.sha,
		expectedWalletChainId: TESTNET_WALLET_CHAIN_ID,
		toolsHtml,
		toolsBuildJson,
		landingHtml,
	}
}

export async function runVerifyLive(opts: RunVerifyLiveOpts): Promise<VerifyLiveResult> {
	const fetchImpl = opts.fetchImpl ?? fetch
	const sleep = opts.sleepImpl ?? realSleep
	const retries = opts.retries ?? 6
	const delay = opts.retryDelayMs ?? 10_000
	let last: VerifyLiveResult = { ok: false, failures: ["verify-live: not attempted"] }
	for (let attempt = 0; attempt <= retries; attempt++) {
		last = verifyLive(await gather(fetchImpl, opts))
		if (last.ok) return last
		if (attempt < retries) await sleep(delay)
	}
	return last // fail-closed: the last (failing) result after the retry budget
}

// CLI entry — the `verify-live` release job runs `bun scripts/release/verify-live-run.ts`.
// Skipped on import (import.meta.main is false in the unit tests).
if (import.meta.main) {
	const result = await runVerifyLive({
		version: process.env.VERSION ?? "",
		sha: process.env.SHA ?? "",
		landingUrl: process.env.LANDING_URL ?? "https://nulo.sh",
		toolsUrl: process.env.TOOLS_URL ?? "https://testnet.tools.nulo.sh",
	})
	if (result.ok) {
		console.log("verify-live: OK — both surfaces serve this release")
		process.exit(0)
	}
	console.error(`verify-live: FAILED (fail-closed)\n${result.failures.map((f) => `  - ${f}`).join("\n")}`)
	process.exit(1)
}
