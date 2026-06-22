import { describe, expect, test } from "bun:test"
import { extractBuildId, verifyLive, type VerifyLiveInput } from "./verify-live"

const CHAIN = 4229590296
const html = (buildId: string) => `<!doctype html><meta name="nulo-build" content="${buildId}"><div id="app"></div>`
const landing = (v: string) => `<a href="https://github.com/alejoamiras/nulo/releases/tag/v${v}">Download</a>`

function ok(over: Partial<VerifyLiveInput> = {}): VerifyLiveInput {
	return {
		expectedVersion: "0.23.0",
		expectedWalletChainId: CHAIN,
		faucetHtml: html("b-0.23.0-abc"),
		faucetBuildJson: { buildId: "b-0.23.0-abc", version: "0.23.0", chainId: CHAIN },
		landingHtml: landing("0.23.0"),
		...over,
	}
}

describe("extractBuildId", () => {
	test("pulls content (name-first)", () => {
		expect(extractBuildId('<meta name="nulo-build" content="xyz">')).toBe("xyz")
	})
	test("pulls content (content-first / attribute-order tolerant)", () => {
		expect(extractBuildId('<meta content="xyz" name="nulo-build" />')).toBe("xyz")
	})
	test("returns null when absent", () => {
		expect(extractBuildId("<head></head>")).toBeNull()
	})
})

describe("verifyLive", () => {
	test("all live + matching → ok", () => {
		expect(verifyLive(ok())).toEqual({ ok: true, failures: [] })
	})

	test("(the false-pass codex flagged) fresh build.json + STALE html → fail", () => {
		const r = verifyLive(ok({ faucetHtml: html("b-0.22.0-OLD") }))
		expect(r.ok).toBe(false)
		expect(r.failures.join(" ")).toMatch(/split CDN cache/)
	})

	test("faucet unreachable → fail-closed", () => {
		expect(verifyLive(ok({ faucetHtml: null })).ok).toBe(false)
	})

	test("build.json unreachable → fail-closed", () => {
		expect(verifyLive(ok({ faucetBuildJson: null })).ok).toBe(false)
	})

	test("wrong chainId (the stale-env class) → fail", () => {
		const r = verifyLive(ok({ faucetBuildJson: { buildId: "b-0.23.0-abc", chainId: 4138294185 } }))
		expect(r.ok).toBe(false)
		expect(r.failures.join(" ")).toMatch(/chainId/)
	})

	test("no nulo-build meta in HTML → fail", () => {
		expect(verifyLive(ok({ faucetHtml: "<div id=app></div>" })).ok).toBe(false)
	})

	test("landing missing the tag reference → fail", () => {
		expect(verifyLive(ok({ landingHtml: "<a>Download</a>" })).ok).toBe(false)
	})

	test("landing still on the old version → fail", () => {
		expect(verifyLive(ok({ landingHtml: landing("0.22.0") })).ok).toBe(false)
	})

	test("landing unreachable → fail-closed", () => {
		expect(verifyLive(ok({ landingHtml: null })).ok).toBe(false)
	})

	test("collects multiple failures", () => {
		const r = verifyLive(ok({ faucetHtml: null, landingHtml: null }))
		expect(r.failures.length).toBeGreaterThanOrEqual(2)
	})
})
