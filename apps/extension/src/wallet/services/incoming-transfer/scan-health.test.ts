import { describe, expect, test } from "vitest"
import { BACKOFF_CAP_MS, isScanFailure, isScanSuccess, isStalled, nextBackoffMs, type ScanOutcome } from "./scan-health"

const MIN = 60_000

describe("scan outcomes", () => {
	test.each<[ScanOutcome, boolean, boolean]>([
		["progress", true, false],
		["idle-at-tip", true, false],
		["no-progress", false, true],
		["failed", false, true],
		["ineligible", false, false],
	])("%s: success=%s failure=%s", (outcome, success, failure) => {
		expect(isScanSuccess(outcome)).toBe(success)
		expect(isScanFailure(outcome)).toBe(failure)
	})
})

describe("nextBackoffMs", () => {
	test("30 s doubling per consecutive failure, capped at 5 min", () => {
		expect([1, 2, 3, 4, 5, 6].map(nextBackoffMs)).toEqual([30_000, 60_000, 120_000, 240_000, BACKOFF_CAP_MS, BACKOFF_CAP_MS])
	})

	test("no failures, or a count that is not a positive safe integer, means no delay", () => {
		expect([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map(nextBackoffMs)).toEqual([0, 0, 0, 0, 0])
	})

	test("a huge count stays at the cap instead of overflowing", () => {
		expect(nextBackoffMs(Number.MAX_SAFE_INTEGER)).toBe(BACKOFF_CAP_MS)
	})
})

describe("isStalled", () => {
	test("needs at least two failures AND more than ten minutes", () => {
		expect(isStalled({ failingSince: 0, failures: 2 }, 10 * MIN + 1)).toBe(true)
		expect(isStalled({ failingSince: 0, failures: 2 }, 10 * MIN)).toBe(false)
		expect(isStalled({ failingSince: 0, failures: 1 }, 60 * MIN)).toBe(false)
	})

	test("a healthy episode is never stalled", () => {
		expect(isStalled({ failingSince: null, failures: 9 }, 60 * MIN)).toBe(false)
	})
})
