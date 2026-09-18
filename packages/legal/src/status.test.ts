import { describe, expect, test } from "vitest"
import type { LegalDocument, LegalVersion } from "./manifest"
import { LEGAL_HISTORY_LIMIT, acceptanceStatus, applyAcceptance, parseAcceptanceRecord, pendingTermsVersions, permalink } from "./status"

const v = (version: string, material: boolean): LegalVersion => ({
	version,
	effective: null,
	material,
	changes: material ? [`change in ${version}`] : [],
})
const manifest: Record<LegalDocument, readonly LegalVersion[]> = {
	terms: [v("1.0", true), v("1.0.1", false), v("1.1", true), v("1.1.1", false)],
	privacy: [v("1.0", true), v("2.0", true)],
}
const record = (termsVersion: string) => ({ termsVersion, privacyVersionShown: "1.0", acceptedAt: 1, surface: "popup", history: [] })

describe("acceptanceStatus", () => {
	test.each([
		["1.1", "current"],
		["1.1.1", "current"],
		["1.1.0", "current"],
		["1.0", "stale"],
		["1.0.1", "stale"],
		["0.9", "stale"],
		["1.2", "current"],
		["2.0", "current"],
	])("accepted %s is %s", (accepted, expected) => {
		expect(acceptanceStatus(record(accepted), manifest)).toBe(expected)
	})

	test("a non-material head does not require re-acceptance", () => {
		expect(acceptanceStatus(record("1.1"), { ...manifest, terms: [...manifest.terms, v("1.1.2", false)] })).toBe("current")
	})

	test("the privacy version never gates", () => {
		expect(acceptanceStatus({ ...record("1.1"), privacyVersionShown: "1.0" }, manifest)).toBe("current")
	})

	test.each([
		["nothing", undefined],
		["null", null],
		["a string", "1.1"],
		["a bad version", record("v1.1")],
		["an injected version", record("1.1<script>")],
		["a missing timestamp", { ...record("1.1"), acceptedAt: "now" }],
		["an unknown surface", { ...record("1.1"), surface: "dapp" }],
		["a bad privacy version", { ...record("1.1"), privacyVersionShown: 1 }],
	])("%s is missing", (_name, raw) => {
		expect(acceptanceStatus(raw, manifest)).toBe("missing")
	})
})

describe("hostile shapes", () => {
	test("inherited fields are not a stored record", () => {
		expect(acceptanceStatus(Object.create(record("1.1")), manifest)).toBe("missing")
	})

	test("an array carrying the fields is not a record", () => {
		expect(acceptanceStatus(Object.assign([], record("1.1")), manifest)).toBe("missing")
	})

	test("a getter is never run, and a throwing proxy is just no record", () => {
		const ran = { getter: false }
		const withGetter = Object.defineProperty({ ...record("1.1") }, "termsVersion", {
			enumerable: true,
			get: () => {
				ran.getter = true
				return "1.1"
			},
		})
		expect(acceptanceStatus(withGetter, manifest)).toBe("missing")
		expect(ran.getter).toBe(false)
		const hostile = new Proxy(record("1.1"), {
			getPrototypeOf: () => {
				throw new Error("boom")
			},
		})
		expect(acceptanceStatus(hostile, manifest)).toBe("missing")
	})

	test("a Date carrying the fields is not a record", () => {
		expect(acceptanceStatus(Object.assign(new Date(), record("1.1")), manifest)).toBe("missing")
	})

	test("history entries get the same scrutiny, and only the tail is walked", () => {
		const history = [...Array.from({ length: 500 }, () => record("1.0")), Object.create(record("1.0")), record("1.1")]
		const parsed = parseAcceptanceRecord({ ...record("1.1"), history })
		expect(parsed?.history.length).toBe(LEGAL_HISTORY_LIMIT - 1)
	})
})

describe("parseAcceptanceRecord", () => {
	test("drops malformed history entries and keeps the rest", () => {
		const parsed = parseAcceptanceRecord({ ...record("1.1"), history: [record("1.0"), "junk", { termsVersion: "x" }] })
		expect(parsed?.history.map((entry) => entry.termsVersion)).toEqual(["1.0"])
	})

	test("tolerates a non-array history", () => {
		expect(parseAcceptanceRecord({ ...record("1.1"), history: "junk" })?.history).toEqual([])
	})
})

describe("pendingTermsVersions", () => {
	test("accumulates every material version skipped, oldest first", () => {
		expect(pendingTermsVersions(record("0.9"), manifest).map((entry) => entry.version)).toEqual(["1.0", "1.1"])
	})

	test("is empty when current and complete when there is no record", () => {
		expect(pendingTermsVersions(record("1.1"), manifest)).toEqual([])
		expect(pendingTermsVersions(undefined, manifest).map((entry) => entry.version)).toEqual(["1.0", "1.1"])
	})
})

describe("applyAcceptance", () => {
	test("stamps the manifest heads and starts a history", () => {
		const next = applyAcceptance(undefined, "onboarding", 42, manifest)
		expect(next).toMatchObject({ termsVersion: "1.1.1", privacyVersionShown: "2.0", acceptedAt: 42, surface: "onboarding" })
		expect(next.history).toHaveLength(1)
	})

	test("appends to history and makes a stale record current", () => {
		const next = applyAcceptance(applyAcceptance(record("1.0"), "popup", 2, manifest), "popup", 3, manifest)
		expect(next.history.map((entry) => entry.acceptedAt)).toEqual([2, 3])
		expect(acceptanceStatus(next, manifest)).toBe("current")
	})

	test("never replaces a newer accepted version, but still logs the acceptance", () => {
		const next = applyAcceptance(record("3.0"), "popup", 9, manifest)
		expect(next.termsVersion).toBe("3.0")
		expect(next.history.at(-1)?.termsVersion).toBe("1.1.1")
	})

	test("a newer PATCH is evidence too and is not overwritten", () => {
		const next = applyAcceptance({ ...record("1.1.9"), acceptedAt: 7 }, "popup", 9, manifest)
		expect(next).toMatchObject({ termsVersion: "1.1.9", acceptedAt: 7 })
	})

	test("keeps only the most recent entries", () => {
		let current: unknown
		for (let i = 0; i < LEGAL_HISTORY_LIMIT + 5; i++) current = applyAcceptance(current, "popup", i, manifest)
		const history = parseAcceptanceRecord(current)?.history ?? []
		expect(history).toHaveLength(LEGAL_HISTORY_LIMIT)
		expect(history[0]?.acceptedAt).toBe(5)
	})
})

test("permalink is versioned and ends in a slash", () => {
	expect(permalink("terms", "1.0")).toBe("https://nulo.sh/terms/v1.0/")
})
