import { describe, expect, test } from "vitest"
import { decideLockLanding } from "./lock-landing"

const base = { hasProfile: false, onAuthRequiredRoute: false, isPasskeyRoute: false, hasCandidate: true }

describe("decideLockLanding", () => {
	test("a passkey-interaction route with no profile owns its ceremony: hold", () => {
		expect(decideLockLanding({ ...base, isPasskeyRoute: true })).toBe("passkey-hold")
		expect(decideLockLanding({ ...base, isPasskeyRoute: true, hasCandidate: false })).toBe("passkey-hold")
	})

	test("a passkey-interaction route WITH a profile is not exempt", () => {
		expect(decideLockLanding({ ...base, isPasskeyRoute: true, hasProfile: true, onAuthRequiredRoute: true })).toBe("lock")
		expect(decideLockLanding({ ...base, isPasskeyRoute: true, hasProfile: true })).toBe("settle")
	})

	test("no profile selected: select the candidate and go to auth, or settle when there is none", () => {
		expect(decideLockLanding(base)).toBe("select-and-auth")
		expect(decideLockLanding({ ...base, hasCandidate: false })).toBe("settle")
	})

	test("a profile selected on an auth-required page over no session: lock", () => {
		expect(decideLockLanding({ ...base, hasProfile: true, onAuthRequiredRoute: true })).toBe("lock")
	})

	test("a profile selected on a page that needs no session (auth, register): settle", () => {
		expect(decideLockLanding({ ...base, hasProfile: true })).toBe("settle")
	})
})
