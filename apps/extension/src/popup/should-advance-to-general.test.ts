import { describe, expect, test } from "vitest"
import { shouldAdvanceToGeneral } from "./should-advance-to-general"

describe("shouldAdvanceToGeneral", () => {
	test("advances from an entry route when the session stayed active", () => {
		expect(shouldAdvanceToGeneral(true, "popup-auth")).toBe(true)
		expect(shouldAdvanceToGeneral(true, "popup-register")).toBe(true)
	})

	// The Q-15 fix: a lock mid-bootstrap leaves stillActive=false. Advancing to the
	// auth-required /popup/general would drop the user behind the router auth guard,
	// which bounces back to /popup/auth. The flag must gate the push.
	test("does NOT advance when the session was locked mid-bootstrap (stillActive=false)", () => {
		expect(shouldAdvanceToGeneral(false, "popup-auth")).toBe(false)
		expect(shouldAdvanceToGeneral(false, "popup-register")).toBe(false)
	})

	test("does NOT advance from a non-entry route even when active (no redirect loop from deeper screens)", () => {
		expect(shouldAdvanceToGeneral(true, "popup-general")).toBe(false)
		expect(shouldAdvanceToGeneral(true, "popup-settings")).toBe(false)
	})

	// route.name is `string | symbol | undefined`; a non-string is not a member.
	test("treats a non-string / absent route name as not-an-entry-route", () => {
		expect(shouldAdvanceToGeneral(true, undefined)).toBe(false)
		expect(shouldAdvanceToGeneral(true, null)).toBe(false)
		expect(shouldAdvanceToGeneral(true, Symbol("popup-auth"))).toBe(false)
	})
})
