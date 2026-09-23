import { describe, expect, test } from "bun:test"
import { TESTNET_WALLET_CHAIN_ID } from "./chain-guard"
import { runVerifyLive } from "./verify-live-run"

const CHAIN = TESTNET_WALLET_CHAIN_ID
const TOOLS = "https://tools.test"
const LANDING = "https://landing.test"
const toolsHtml = (id: string) => `<!doctype html><meta name="nulo-build" content="${id}"><div id=app></div>`
const buildJson = (id: string, chainId = CHAIN) => JSON.stringify({ buildId: id, version: "0.1.0", chainId })
const landingHtml = (v: string) => `<a href="https://github.com/alejoamiras/nulo/releases/tag/v${v}">dl</a>`

/** Build an injectable fetch from a per-attempt responder. `null` = network error. */
function mkFetch(plan: (url: string, attempt: number) => { ok: boolean; body: string } | null) {
	let calls = 0
	const fetchImpl = (async (input: string | URL) => {
		const url = String(input)
		// One "attempt" = the 3 parallel gets; bump per build.json fetch as the marker.
		const attempt = calls
		if (url.includes("/build.json")) calls++
		const r = plan(url, attempt)
		if (r === null) throw new Error("network")
		return { ok: r.ok, text: async () => r.body } as Response
	}) as unknown as typeof fetch
	return { fetchImpl, attempts: () => calls }
}

const SHA = "abc12345def67890abc12345def67890abc12345" // release sha; first 8 = abc12345
const BUILD = "0.1.0+abc12345" // buildJson's version (0.1.0) + SHA[:8] — passes the freshness guard
const base = { version: "0.23.0", sha: SHA, landingUrl: LANDING, toolsUrl: TOOLS, retries: 3, retryDelayMs: 0, sleepImpl: async () => {} }

function good(url: string): { ok: boolean; body: string } {
	if (url.includes("/build.json")) return { ok: true, body: buildJson(BUILD) }
	if (url.startsWith(TOOLS)) return { ok: true, body: toolsHtml(BUILD) }
	return { ok: true, body: landingHtml("0.23.0") }
}

describe("runVerifyLive", () => {
	test("all live + matching → ok on the first attempt (no retries)", async () => {
		const f = mkFetch((url) => good(url))
		const r = await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })
		expect(r.ok).toBe(true)
		expect(f.attempts()).toBe(1)
	})

	test("(split-cache) stale HTML buildId vs fresh build.json → fail after the retry budget", async () => {
		const f = mkFetch((url) => {
			if (url.includes("/build.json")) return { ok: true, body: buildJson("b1") }
			if (url.startsWith(TOOLS)) return { ok: true, body: toolsHtml("b0-STALE") }
			return { ok: true, body: landingHtml("0.23.0") }
		})
		const r = await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })
		expect(r.ok).toBe(false)
		expect(r.failures.join(" ")).toMatch(/split CDN cache/)
		expect(f.attempts()).toBe(4) // 1 + 3 retries
	})

	test("rides out propagation: unreachable on attempt 1, good on attempt 2", async () => {
		const f = mkFetch((url, attempt) => (attempt === 0 ? null : good(url)))
		const r = await runVerifyLive({ ...base, fetchImpl: f.fetchImpl, retries: 2 })
		expect(r.ok).toBe(true)
	})

	test("persistent unreachable → fail-closed", async () => {
		const f = mkFetch(() => null)
		const r = await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })
		expect(r.ok).toBe(false)
		expect(r.failures.join(" ")).toMatch(/unreachable/)
	})

	test("unparseable build.json → fail-closed", async () => {
		const f = mkFetch((url) => {
			if (url.includes("/build.json")) return { ok: true, body: "<html>not json</html>" }
			if (url.startsWith(TOOLS)) return { ok: true, body: toolsHtml("b1") }
			return { ok: true, body: landingHtml("0.23.0") }
		})
		const r = await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })
		expect(r.ok).toBe(false)
	})

	test("landing on the wrong version → fail", async () => {
		const f = mkFetch((url) => (url.startsWith(LANDING) ? { ok: true, body: landingHtml("0.22.0") } : good(url)))
		expect((await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })).ok).toBe(false)
	})

	test("wrong chainId (stale-env class) → fail", async () => {
		const f = mkFetch((url) => (url.includes("/build.json") ? { ok: true, body: buildJson(BUILD, 4138294185) } : good(url)))
		expect((await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })).ok).toBe(false)
	})

	test("a non-200 on the tools app → fail-closed", async () => {
		const f = mkFetch((url) => (url.startsWith(TOOLS) && !url.includes("/build.json") ? { ok: false, body: "" } : good(url)))
		expect((await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })).ok).toBe(false)
	})
})
