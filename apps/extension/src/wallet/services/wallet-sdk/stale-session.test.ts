import { describe, expect, test } from "vitest"
import type { ContentScriptMessageEnvelope } from "./content-script-validator"
import { SESSION_DISCONNECTED, sessionDisconnectedMessage, sessionKnownTo, staleSessionVerdict } from "./stale-session"

const envelope = (over: Partial<ContentScriptMessageEnvelope>): ContentScriptMessageEnvelope => ({
	origin: "content-script",
	type: "ping",
	sessionId: "s1",
	...over,
})
const unknown = () => false
const known = () => true

describe("staleSessionVerdict", () => {
	test.each([
		["ping", "ping"],
		["secure-message", "secure-message"],
	] as const)("a session the sender's tab does not hold, named by a %s, is disconnected in that tab", (_label, type) => {
		expect(staleSessionVerdict(envelope({ type }), 7, unknown)).toEqual({ disconnectTab: 7, sessionId: "s1" })
	})

	test("a session the sender's tab holds is forwarded", () => {
		expect(staleSessionVerdict(envelope({}), 7, known)).toBe("forward")
	})

	test("the predicate is asked for the browser's tab, not one the envelope could name", () => {
		const asked: Array<[string, number]> = []
		const recording = (sessionId: string, tabId: number) => {
			asked.push([sessionId, tabId])
			return true
		}
		const hostile = { ...envelope({}), tabId: 99 } as ContentScriptMessageEnvelope
		staleSessionVerdict(hostile, 7, recording)
		expect(asked).toEqual([["s1", 7]])
	})

	test.each(["discovery-request", "key-exchange-request", "disconnect-request"] as const)(
		"a %s is forwarded whether or not its session is known — none of them presupposes one",
		(type) => {
			expect(staleSessionVerdict(envelope({ type }), 7, unknown)).toBe("forward")
		},
	)

	test("no tab id — nowhere to reply — forwards", () => {
		expect(staleSessionVerdict(envelope({}), undefined, unknown)).toBe("forward")
	})

	test("no session id forwards, and the predicate is never asked", () => {
		let asked = 0
		const counting = () => {
			asked += 1
			return false
		}
		expect(staleSessionVerdict(envelope({ sessionId: undefined }), 7, counting)).toBe("forward")
		expect(asked).toBe(0)
	})

	test("the reply goes to the browser's tab, never one the envelope could name", () => {
		const hostile = { ...envelope({}), tabId: 99 } as ContentScriptMessageEnvelope
		expect(staleSessionVerdict(hostile, 7, unknown)).toEqual({ disconnectTab: 7, sessionId: "s1" })
	})
})

describe("sessionKnownTo", () => {
	const handler = { getSession: (id: string) => (id === "s1" ? { tabId: 7 } : undefined) }

	test("a session is known only to the tab that holds it", () => {
		expect(sessionKnownTo(handler, "s1", 7)).toBe(true)
		expect(sessionKnownTo(handler, "s1", 9)).toBe(false)
	})

	test("an absent session and another tab's session answer alike", () => {
		expect(sessionKnownTo(handler, "ghost", 9)).toBe(sessionKnownTo(handler, "s1", 9))
	})

	test("answers known while no handler exists — the boot window forwards as before", () => {
		expect(sessionKnownTo(undefined, "ghost", 7)).toBe(true)
	})
})

test("the reply is the SDK's own disconnect on the wire", () => {
	expect(sessionDisconnectedMessage("s1")).toEqual({ origin: "background", type: SESSION_DISCONNECTED, sessionId: "s1" })
	expect(SESSION_DISCONNECTED).toBe("session-disconnected")
})
