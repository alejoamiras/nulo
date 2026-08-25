import { describe, expect, test, vi } from "vitest"
import type { ILogger } from "@/wallet/logger"
import {
	enforceSessionProfileBinding,
	stampSessionProfileGuarded,
	trackProfileSwitchEpoch,
	wireProfileSwitchTeardown,
} from "./profile-switch-teardown"

const noopLogger = { log: () => {} } as unknown as ILogger

type Listener = (profile: { id: string } | undefined) => void

function harness(sessions: Array<{ sessionId: string; origin: string }>, stamps: Array<[string, string]>) {
	let listener: Listener | undefined
	const terminate = vi.fn()
	wireProfileSwitchTeardown({
		onActiveProfileChanged: {
			add: (l: Listener) => {
				listener = l
			},
		},
		getActiveSessions: () => sessions,
		sessionProfiles: new Map(stamps),
		terminateSession: terminate,
		logger: noopLogger,
	})
	if (!listener) throw new Error("listener not registered")
	return { fire: listener, terminate }
}

describe("wireProfileSwitchTeardown — the switch matrix", () => {
	const sessions = [
		{ sessionId: "sA", origin: "https://a.example" },
		{ sessionId: "sB", origin: "https://b.example" },
		{ sessionId: "sX", origin: "https://x.example" }, // unstamped
	]
	const stamps: Array<[string, string]> = [
		["sA", "prof-A"],
		["sB", "prof-B"],
	]

	test("switch to B: stamped-B survives; stamped-A and UNSTAMPED are terminated", () => {
		const { fire, terminate } = harness(sessions, stamps)
		fire({ id: "prof-B" })
		expect(terminate).toHaveBeenCalledWith("sA")
		expect(terminate).toHaveBeenCalledWith("sX") // fail closed: unstamped debris dies too
		expect(terminate).not.toHaveBeenCalledWith("sB")
	})

	test("lock (undefined) tears nothing down — pinned per-call-error semantics", () => {
		const { fire, terminate } = harness(sessions, stamps)
		fire(undefined)
		expect(terminate).not.toHaveBeenCalled()
	})

	test("unlock back to the SAME profile keeps its own sessions", () => {
		const { fire, terminate } = harness([sessions[0]], [["sA", "prof-A"]])
		fire(undefined) // lock
		fire({ id: "prof-A" }) // unlock, same profile
		expect(terminate).not.toHaveBeenCalled()
	})
})

describe("enforceSessionProfileBinding — the dispatch guard", () => {
	function guardArgs(over: Record<string, unknown> = {}) {
		const calls: string[] = []
		const respond = vi.fn(async () => {
			calls.push("respond")
		})
		const terminateSession = vi.fn(() => {
			calls.push("terminate")
		})
		return {
			args: {
				sessionId: "s1",
				origin: "https://a.example",
				activeProfileId: "prof-A",
				sessionProfiles: new Map([["s1", "prof-A"]]),
				respond,
				terminateSession,
				logger: noopLogger,
				...over,
			},
			calls,
			respond,
			terminateSession,
		}
	}

	test("matching stamp proceeds — nothing sent, nothing terminated", async () => {
		const { args, respond, terminateSession } = guardArgs()
		expect(await enforceSessionProfileBinding(args)).toBe(true)
		expect(respond).not.toHaveBeenCalled()
		expect(terminateSession).not.toHaveBeenCalled()
	})

	test("mismatch: responds FIRST, then terminates, and blocks dispatch", async () => {
		const { args, calls } = guardArgs({ activeProfileId: "prof-B" })
		expect(await enforceSessionProfileBinding(args)).toBe(false)
		expect(calls).toEqual(["respond", "terminate"]) // envelope before teardown
	})

	test("map-miss fails closed (terminates + blocks)", async () => {
		const { args, terminateSession } = guardArgs({ sessionProfiles: new Map() })
		expect(await enforceSessionProfileBinding(args)).toBe(false)
		expect(terminateSession).toHaveBeenCalledWith("s1")
	})

	test("a failing respond still terminates", async () => {
		const { args, terminateSession } = guardArgs({
			activeProfileId: "prof-B",
			respond: vi.fn(async () => {
				throw new Error("port gone")
			}),
		})
		expect(await enforceSessionProfileBinding(args)).toBe(false)
		expect(terminateSession).toHaveBeenCalledWith("s1")
	})
})

describe("trackProfileSwitchEpoch", () => {
	function makeEmitter() {
		const listeners: Array<(p: { id: string } | undefined) => void> = []
		return {
			add: (l: (p: { id: string } | undefined) => void) => listeners.push(l),
			emit: (p: { id: string } | undefined) => {
				for (const l of listeners) l(p)
			},
		}
	}

	test("bumps on truthy identity changes AND the unknowable first emission — lock and unlock-to-same stay flat", () => {
		const emitter = makeEmitter()
		const epoch = trackProfileSwitchEpoch(emitter)
		// First truthy emission bumps: silent restore emits nothing, so the
		// baseline is unknown and must be treated as potentially-switched.
		emitter.emit({ id: "A" })
		expect(epoch.current()).toBe(1)
		emitter.emit({ id: "A" }) // re-emission, same identity
		expect(epoch.current()).toBe(1)
		emitter.emit(undefined) // lock
		emitter.emit({ id: "A" }) // unlock to the SAME profile — baseline known
		expect(epoch.current()).toBe(1)
		emitter.emit({ id: "B" }) // real switch
		expect(epoch.current()).toBe(2)
		emitter.emit(undefined) // switch-then-lock: the bump is already recorded
		expect(epoch.current()).toBe(2)
		emitter.emit({ id: "A" }) // unlock into a DIFFERENT profile
		expect(epoch.current()).toBe(3)
	})
})

describe("stampSessionProfileGuarded", () => {
	test("a live session's stamp survives", () => {
		const map = new Map<string, string>()
		stampSessionProfileGuarded(map, "s1", "prof-A", () => true)
		expect(map.get("s1")).toBe("prof-A")
	})

	test("a session terminated before the stamp is compensated (no leaked entry)", () => {
		const map = new Map<string, string>()
		stampSessionProfileGuarded(map, "s1", "prof-A", () => false)
		expect(map.has("s1")).toBe(false)
	})
})
