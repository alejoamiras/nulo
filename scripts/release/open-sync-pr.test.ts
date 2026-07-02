import { describe, expect, test } from "bun:test"
import { decideSyncPrAction, NEEDS_RESOLUTION_LABEL, syncEligible } from "./open-sync-pr"

const SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

describe("syncEligible", () => {
	test("stable Release-PR merge on push:main → eligible", () => {
		expect(syncEligible({ eventName: "push", isPrerelease: false, headSha: SHA, releasePrMergeSha: SHA }).eligible).toBe(true)
	})

	test("(codex Critical-1) workflow_dispatch republish → NOT eligible", () => {
		const r = syncEligible({ eventName: "workflow_dispatch", isPrerelease: false, headSha: SHA, releasePrMergeSha: SHA })
		expect(r.eligible).toBe(false)
		expect(r.reason).toMatch(/republish/)
	})

	test("prerelease (rc) → NOT eligible", () => {
		expect(syncEligible({ eventName: "push", isPrerelease: true, headSha: SHA, releasePrMergeSha: SHA }).eligible).toBe(false)
	})

	test("push but HEAD != the Release-PR merge commit (an old-tag push) → NOT eligible", () => {
		expect(syncEligible({ eventName: "push", isPrerelease: false, headSha: SHA, releasePrMergeSha: "0000" }).eligible).toBe(false)
	})

	test("push with no Release-PR merge sha → NOT eligible", () => {
		expect(syncEligible({ eventName: "push", isPrerelease: false, headSha: SHA, releasePrMergeSha: null }).eligible).toBe(false)
	})

	test("other events (schedule) → NOT eligible", () => {
		expect(syncEligible({ eventName: "schedule", isPrerelease: false, headSha: SHA, releasePrMergeSha: SHA }).eligible).toBe(false)
	})

	test("the eligible reason names the stable Release-PR merge", () => {
		expect(syncEligible({ eventName: "push", isPrerelease: false, headSha: SHA, releasePrMergeSha: SHA }).reason).toMatch(/stable Release-PR/)
	})
})

describe("decideSyncPrAction", () => {
	test("MERGEABLE → clean, no label", () => {
		expect(decideSyncPrAction("MERGEABLE")).toEqual({ label: null, clean: true })
	})
	test("CONFLICTING → labeled, not clean (surface, never silent)", () => {
		expect(decideSyncPrAction("CONFLICTING")).toEqual({ label: NEEDS_RESOLUTION_LABEL, clean: false })
	})
	test("UNKNOWN (not yet computed) → labeled, fail-closed", () => {
		expect(decideSyncPrAction("UNKNOWN")).toEqual({ label: NEEDS_RESOLUTION_LABEL, clean: false })
	})
})
