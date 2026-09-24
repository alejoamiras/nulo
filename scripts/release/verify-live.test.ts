import { describe, expect, test } from "bun:test"
import { verifyLive, type VerifyLiveInput } from "./verify-live"

const landing = (v: string) => `<a href="https://github.com/alejoamiras/nulo/releases/tag/v${v}">Download</a>`

function ok(over: Partial<VerifyLiveInput> = {}): VerifyLiveInput {
	return {
		expectedVersion: "0.23.0",
		landingHtml: landing("0.23.0"),
		...over,
	}
}

describe("verifyLive", () => {
	test("all live + matching → ok", () => {
		expect(verifyLive(ok())).toEqual({ ok: true, failures: [] })
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

	test("a longer version sharing the prefix is not a match", () => {
		expect(verifyLive(ok({ expectedVersion: "0.23.1", landingHtml: landing("0.23.10") })).ok).toBe(false)
	})

	test("a prerelease of the expected version is not a match", () => {
		expect(verifyLive(ok({ landingHtml: landing("0.23.0-rc.1") })).ok).toBe(false)
	})
})
