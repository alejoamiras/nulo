import { describe, expect, test } from "vitest"
import { type LegalSheetContext, shouldShowLegalSheet } from "./legal-sheet"

const ctx = (over: Partial<LegalSheetContext> = {}): LegalSheetContext => ({
	status: "stale",
	routeName: "popup-general",
	routePath: "/popup/general",
	isAuthRequired: true,
	dismissedVersion: undefined,
	termsVersion: "1.1",
	...over,
})

describe("shouldShowLegalSheet", () => {
	test.each(["missing", "stale"] as const)("shows on a normal wallet page while %s", (status) => {
		expect(shouldShowLegalSheet(ctx({ status }))).toBe(true)
	})

	test.each(["loading", "current"] as const)("never shows while %s", (status) => {
		expect(shouldShowLegalSheet(ctx({ status }))).toBe(false)
	})

	test("never shows on a route reachable while locked (auth, register, import)", () => {
		expect(shouldShowLegalSheet(ctx({ isAuthRequired: false, routeName: "popup-auth", routePath: "/popup/auth" }))).toBe(false)
	})

	test.each(["windows-execute", "windows-discover", "windows-passkey"])("never covers the %s window", (routeName) => {
		expect(shouldShowLegalSheet(ctx({ routeName, routePath: "/windows/x" }))).toBe(false)
	})

	test.each([
		"/popup/settings/security/export",
		"/popup/settings/security/export/seed",
		"/popup/settings/security/export/account",
		"/popup/settings/security/export/full",
		"/popup/legal/declined",
	])("never covers %s", (routePath) => {
		expect(shouldShowLegalSheet(ctx({ routePath }))).toBe(false)
	})

	test("Not now holds for that version only: a newer version asks again", () => {
		expect(shouldShowLegalSheet(ctx({ dismissedVersion: "1.1" }))).toBe(false)
		expect(shouldShowLegalSheet(ctx({ dismissedVersion: "1.0" }))).toBe(true)
		expect(shouldShowLegalSheet(ctx({ dismissedVersion: { version: "1.1" } }))).toBe(true)
	})
})
