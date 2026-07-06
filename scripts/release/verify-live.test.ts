import { describe, expect, test } from "bun:test"
import { TESTNET_WALLET_CHAIN_ID } from "./chain-guard"
import { extractBuildId, verifyLive, type VerifyLiveInput } from "./verify-live"

const CHAIN = TESTNET_WALLET_CHAIN_ID
const SHA = "abc12345def67890abc12345def67890abc12345" // 40-char release sha; first 8 = abc12345
const BUILD = "0.23.0+abc12345" // the real faucet buildId shape: `${version}+${sha[:8]}`
const html = (buildId: string) => `<!doctype html><meta name="nulo-build" content="${buildId}"><div id="app"></div>`
const landing = (v: string) => `<a href="https://github.com/alejoamiras/nulo/releases/tag/v${v}">Download</a>`

function ok(over: Partial<VerifyLiveInput> = {}): VerifyLiveInput {
	return {
		expectedVersion: "0.23.0",
		expectedSha: SHA,
		expectedWalletChainId: CHAIN,
		faucetHtml: html(BUILD),
		faucetBuildJson: { buildId: BUILD, version: "0.23.0", chainId: CHAIN },
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
		const r = verifyLive(ok({ faucetHtml: html("0.22.0+stale111") }))
		expect(r.ok).toBe(false)
		expect(r.failures.join(" ")).toMatch(/split CDN cache/)
	})

	test("(stale-but-self-consistent deploy) buildId sha != release sha → fail", () => {
		const stale = "0.23.0+0ld00000" // self-consistent HTML+JSON, right version, but a prior commit's sha
		const r = verifyLive(ok({ faucetHtml: html(stale), faucetBuildJson: { buildId: stale, version: "0.23.0", chainId: CHAIN } }))
		expect(r.ok).toBe(false)
		expect(r.failures.join(" ")).toMatch(/stale deploy/)
	})

	test("faucet unreachable → fail-closed", () => {
		expect(verifyLive(ok({ faucetHtml: null })).ok).toBe(false)
	})

	test("build.json unreachable → fail-closed", () => {
		expect(verifyLive(ok({ faucetBuildJson: null })).ok).toBe(false)
	})

	test("wrong chainId (the stale-env class) → fail", () => {
		const r = verifyLive(ok({ faucetBuildJson: { buildId: BUILD, version: "0.23.0", chainId: 4138294185 } }))
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
