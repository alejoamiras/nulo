import type { PrestoStatus } from "@alejoamiras/presto-core"
import { describe, expect, test } from "vitest"
import { copyFor, detailRowsFor, rowDescriptionFor, uiStateFromStatus } from "./presto-ui-state"

const available: PrestoStatus = {
	available: true,
	needsDownload: false,
	appVersion: "1.1.1",
	nativeAztecVersion: "5.2.0",
	protocol: "https",
}

const denied = { outcome: null, denial: { at: 1 } }

describe("uiStateFromStatus", () => {
	test("available → available with the detailed body's facts", () => {
		expect(uiStateFromStatus(available)).toEqual({
			kind: "available",
			info: { appVersion: "1.1.1", nativeAztecVersion: "5.2.0", protocol: "https" },
		})
	})

	test("available + needsDownload → downloading", () => {
		expect(uiStateFromStatus({ ...available, needsDownload: true }).kind).toBe("downloading")
	})

	test("minimal health body (unapproved origin) → available with an empty info", () => {
		expect(uiStateFromStatus({ available: true, needsDownload: false, protocol: "https" })).toEqual({
			kind: "available",
			info: { appVersion: undefined, nativeAztecVersion: undefined, protocol: "https" },
		})
	})

	test("offline and permission-blocked keep their arm with no facts", () => {
		expect(uiStateFromStatus({ available: false, reason: "offline" })).toEqual({ kind: "offline", info: {} })
		expect(uiStateFromStatus({ available: false, reason: "permission-blocked" })).toEqual({ kind: "permission-blocked", info: {} })
	})

	test("secure-connection-unavailable + unconfirmed is the install pitch (offline), not a warning", () => {
		expect(uiStateFromStatus({ available: false, reason: "secure-connection-unavailable", diagnosis: "unconfirmed" })).toEqual({
			kind: "offline",
			info: {},
		})
	})

	test.each(["presto-reachable", "https-disabled", "tls-or-trust-failure"] as const)(
		"secure-connection-unavailable + %s keeps the diagnosis",
		(diagnosis) => {
			expect(uiStateFromStatus({ available: false, reason: "secure-connection-unavailable", diagnosis })).toEqual({
				kind: "secure-connection-unavailable",
				diagnosis,
				info: {},
			})
		},
	)

	test("version-mismatch carries the native version; error carries the protocol", () => {
		expect(uiStateFromStatus({ available: false, reason: "version-mismatch", nativeAztecVersion: "5.1.0", protocol: "https" })).toEqual(
			{
				kind: "version-mismatch",
				info: { nativeAztecVersion: "5.1.0", protocol: "https" },
			},
		)
		expect(uiStateFromStatus({ available: false, reason: "error", protocol: "http" })).toEqual({
			kind: "error",
			info: { protocol: "http" },
		})
	})

	test("an unknown reason maps to error, never to the install pitch", () => {
		expect(uiStateFromStatus({ available: false, reason: "quantum-flux" } as unknown as PrestoStatus).kind).toBe("error")
	})
})

describe("copyFor", () => {
	test("detecting/idle → Looking…, pending tone, no retry", () => {
		expect(copyFor({ kind: "detecting" })).toEqual({ tone: "pending", title: "Looking…", detail: "" })
		expect(copyFor({ kind: "idle" })).toEqual({ tone: "pending", title: "Looking…", detail: "" })
	})

	test("available → connected line built from the facts present, Re-test, go tone", () => {
		expect(copyFor(uiStateFromStatus(available))).toEqual({
			tone: "go",
			title: "Presto connected",
			detail: "Proving natively · Presto 1.1.1 · Aztec 5.2.0 · encrypted",
			retry: "Re-test",
		})
		expect(copyFor({ kind: "available", info: {} }).detail).toBe("Proving natively")
	})

	test("the settings surface keeps only the app version on the connected line", () => {
		expect(copyFor(uiStateFromStatus(available), null, "settings").detail).toBe("Proving natively · Presto 1.1.1")
	})

	test("available + a remembered denial → the declined-earlier overlay with the wait-and-resend step", () => {
		const copy = copyFor(uiStateFromStatus(available), denied)
		expect(copy.tone).toBe("warn")
		expect(copy.title).toBe("Presto declined Nulo earlier")
		expect(copy.steps).toEqual(["Wait about 30 seconds, then send again and choose Allow in Presto's prompt."])
		expect(copy.retry).toBe("Re-test")
		// The outcome alone never overlays: only the separately held denial does.
		expect(
			copyFor(uiStateFromStatus(available), { outcome: { at: 1, phase: "fallback", backend: "browser" }, denial: null }).title,
		).toBe("Presto connected")
	})

	test("downloading → connected title with the one-time download detail, accent tone", () => {
		expect(copyFor({ kind: "downloading", info: {} })).toMatchObject({ tone: "accent", title: "Presto connected", retry: "Re-test" })
		expect(copyFor({ kind: "downloading", info: {} }).detail).toContain("one-time download")
	})

	test("offline → not detected, Test, off tone", () => {
		expect(copyFor({ kind: "offline", info: {} })).toEqual({
			tone: "off",
			title: "Presto not detected",
			detail: "Proofs run in your browser (slower).",
			retry: "Test",
		})
	})

	test("permission-blocked → Presto's title and three steps on onboarding; the compact variant on settings", () => {
		const onboarding = copyFor({ kind: "permission-blocked", info: {} })
		expect(onboarding.title).toBe("Your browser blocked local access")
		expect(onboarding.steps).toHaveLength(3)
		expect(onboarding.retry).toBe("Retry")
		const settings = copyFor({ kind: "permission-blocked", info: {} }, null, "settings")
		expect(settings.title).toBe("Browser blocked local access")
		expect(settings.detail).toBe("Proofs run in your browser until it's allowed.")
		expect(settings.steps).toHaveLength(3)
	})

	test("secure-connection-unavailable → steps per diagnosis; presto-reachable is the default", () => {
		const reachable = copyFor({ kind: "secure-connection-unavailable", diagnosis: "presto-reachable", info: {} })
		expect(reachable.title).toBe("Presto is installed, but its encrypted connection isn't working")
		expect(reachable.detail).toContain("Presto is running")
		expect(reachable.steps?.[1]).toBe("Turn on Encrypted Connection.")
		expect(copyFor({ kind: "secure-connection-unavailable", info: {} })).toEqual(reachable)
		expect(copyFor({ kind: "secure-connection-unavailable", diagnosis: "tls-or-trust-failure", info: {} }).steps?.[1]).toBe(
			"Run the certificate setup again.",
		)
		expect(copyFor({ kind: "secure-connection-unavailable", diagnosis: "https-disabled", info: {} }).detail).toBe(
			"Nulo only hands proofs to Presto over HTTPS.",
		)
	})

	test("version-mismatch names both versions when the native one is known", () => {
		expect(copyFor({ kind: "version-mismatch", info: { nativeAztecVersion: "5.1.0" } }).detail).toBe(
			"Presto runs Aztec 5.1.0; Nulo needs 5.2.0. Open Presto from your menu bar and let it update.",
		)
		expect(copyFor({ kind: "version-mismatch", info: {} }).detail).toBe("Open Presto from your menu bar and let it update.")
	})

	test("error → Presto's error copy, Retry", () => {
		expect(copyFor({ kind: "error", info: {} })).toEqual({
			tone: "warn",
			title: "Presto answered, but something went wrong",
			detail: "Open Presto from your menu bar, check it is running properly, then retry.",
			retry: "Retry",
		})
	})
})

describe("rowDescriptionFor", () => {
	test.each([
		[{ kind: "detecting" } as const, null, "Checking Presto…"],
		[uiStateFromStatus(available), null, "Presto · connected"],
		[uiStateFromStatus(available), denied, "Presto · approval needed"],
		[{ kind: "downloading", info: {} } as const, null, "Presto · one-time download pending"],
		[{ kind: "offline", info: {} } as const, null, "In browser · Presto not detected"],
		[{ kind: "permission-blocked", info: {} } as const, null, "Browser blocked local access"],
		[{ kind: "secure-connection-unavailable", info: {} } as const, null, "Presto · encrypted connection unavailable"],
		[{ kind: "version-mismatch", info: {} } as const, null, "Presto · update needed"],
		[{ kind: "error", info: {} } as const, null, "Presto · not responding"],
	])("%o → %s", (state, last, expected) => {
		expect(rowDescriptionFor(state, last)).toBe(expected)
	})
})

describe("detailRowsFor", () => {
	test("the detailed body fills every row", () => {
		expect(detailRowsFor(uiStateFromStatus(available)).map((r) => r.value)).toEqual(["1.1.1", "5.2.0", "Encrypted"])
	})

	test("the minimal body and the pending states degrade to dashes", () => {
		expect(detailRowsFor({ kind: "available", info: { protocol: "https" } }).map((r) => r.value)).toEqual(["—", "—", "Encrypted"])
		expect(detailRowsFor({ kind: "detecting" }).map((r) => r.value)).toEqual(["—", "—", "—"])
	})

	test("the connection row names a plain-HTTP answer and a blocked probe", () => {
		expect(detailRowsFor({ kind: "error", info: { protocol: "http" } })[2].value).toBe("Plain HTTP")
		expect(detailRowsFor({ kind: "permission-blocked", info: {} })[2].value).toBe("Blocked")
	})
})
