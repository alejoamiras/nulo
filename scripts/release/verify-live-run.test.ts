import { describe, expect, test } from "bun:test"
import { runVerifyLive } from "./verify-live-run"

const LANDING = "https://landing.test"
const landingHtml = (v: string) => `<a href="https://github.com/alejoamiras/nulo/releases/tag/v${v}">dl</a>`

/** Build an injectable fetch from a per-attempt responder. `null` = network error. */
function mkFetch(plan: (url: string, attempt: number) => { ok: boolean; body: string } | null) {
	let calls = 0
	const fetchImpl = (async (input: string | URL) => {
		const url = String(input)
		const attempt = calls++ // one attempt = one landing fetch
		const r = plan(url, attempt)
		if (r === null) throw new Error("network")
		return { ok: r.ok, text: async () => r.body } as Response
	}) as unknown as typeof fetch
	return { fetchImpl, attempts: () => calls }
}

const base = { version: "0.23.0", landingUrl: LANDING, retries: 3, retryDelayMs: 0, sleepImpl: async () => {} }

function good(): { ok: boolean; body: string } {
	return { ok: true, body: landingHtml("0.23.0") }
}

describe("runVerifyLive", () => {
	test("all live + matching → ok on the first attempt (no retries)", async () => {
		const f = mkFetch(() => good())
		const r = await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })
		expect(r.ok).toBe(true)
		expect(f.attempts()).toBe(1)
	})

	test("rides out propagation: unreachable on attempt 1, good on attempt 2", async () => {
		const f = mkFetch((_url, attempt) => (attempt === 0 ? null : good()))
		const r = await runVerifyLive({ ...base, fetchImpl: f.fetchImpl, retries: 2 })
		expect(r.ok).toBe(true)
	})

	test("persistent unreachable → fail-closed", async () => {
		const f = mkFetch(() => null)
		const r = await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })
		expect(r.ok).toBe(false)
		expect(r.failures.join(" ")).toMatch(/unreachable/)
	})

	test("landing on the wrong version → fail after the retry budget", async () => {
		const f = mkFetch(() => ({ ok: true, body: landingHtml("0.22.0") }))
		expect((await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })).ok).toBe(false)
		expect(f.attempts()).toBe(4) // 1 + 3 retries
	})

	test("a non-200 on the landing → fail-closed", async () => {
		const f = mkFetch(() => ({ ok: false, body: "" }))
		expect((await runVerifyLive({ ...base, fetchImpl: f.fetchImpl })).ok).toBe(false)
	})

	test("empty version → fail without fetching", async () => {
		const f = mkFetch(() => good())
		const r = await runVerifyLive({ ...base, version: "", fetchImpl: f.fetchImpl })
		expect(r.ok).toBe(false)
		expect(f.attempts()).toBe(0)
	})
})
