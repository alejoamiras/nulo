import { describe, expect, test } from "vitest"
import { decideLockLanding, decideUnreachableLanding } from "./lock-landing"

const base = { hasProfile: false, onAuthRequiredRoute: false, isPasskeyRoute: false, hasCandidate: true, pageEstablished: false }

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

	test("an established page never gets a candidate selected: an import mid-restore keeps its flow", () => {
		expect(decideLockLanding({ ...base, pageEstablished: true })).toBe("settle")
		// The restart lock itself is unaffected.
		expect(decideLockLanding({ ...base, pageEstablished: true, hasProfile: true, onAuthRequiredRoute: true })).toBe("lock")
	})

	test("a reconnect whose mount-time boot was lost (no route resolved yet) still lands on auth", () => {
		expect(decideLockLanding({ ...base, pageEstablished: false })).toBe("select-and-auth")
	})
})

describe("decideUnreachableLanding", () => {
	const u = { hasProfile: false, hasCandidate: true, pageEstablished: false }
	test("a selected profile: the lock screen is the recovery", () => {
		expect(decideUnreachableLanding({ ...u, hasProfile: true })).toBe("auth")
		expect(decideUnreachableLanding({ ...u, hasProfile: true, pageEstablished: true })).toBe("auth")
	})
	test("no profile, no page yet: select the candidate and go to auth", () => {
		expect(decideUnreachableLanding(u)).toBe("select-and-auth")
	})
	test("no profile on an established page (import mid-restore): the banner shows in place", () => {
		expect(decideUnreachableLanding({ ...u, pageEstablished: true })).toBe("stay")
	})
	test("no profile, no candidate: stay", () => {
		expect(decideUnreachableLanding({ ...u, hasCandidate: false })).toBe("stay")
	})
})
