/**
 * The per-origin admission gate: a burst of three remembered handshakes is served at once, the
 * next four wait for refills in order, anything past that is rejected; window capacity queues a
 * handshake even with tokens left and a closed window serves it. Time is advanced, never a second
 * `admit`, so the drain itself is what is proven.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	ADMISSION_QUEUE_PER_ORIGIN,
	type AdmissionRequest,
	RECONNECT_REFILL_MS,
	RECONNECT_TOKENS,
	RESERVATION_GRACE_MS,
	VERIFY_WINDOWS_PER_ORIGIN,
	VerifyAdmissionGate,
	type WindowReservation,
} from "./verify-admission"

const ORIGIN = "https://dapp.example"
const clock = {
	now: () => Date.now(),
	setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

function harness() {
	const gate = new VerifyAdmissionGate(clock)
	const served: string[] = []
	const expired: string[] = []
	const reservations = new Map<string, WindowReservation | undefined>()
	const admit = (id: string, over: Partial<AdmissionRequest> = {}) =>
		gate.admit(
			{ id, origin: ORIGIN, deadline: Date.now() + 55_000, needsWindow: false, consumesToken: true, ...over },
			(r) => {
				served.push(id)
				reservations.set(id, r)
			},
			() => expired.push(id),
		)
	return { gate, served, expired, reservations, admit }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("VerifyAdmissionGate — reconnect rate", () => {
	test("a burst of 3 is admitted now, the 4th queues, the 8th is rejected", () => {
		const { admit, served } = harness()
		const outcomes = Array.from({ length: 8 }, (_, i) => admit(`r${i + 1}`))
		expect(outcomes.slice(0, RECONNECT_TOKENS)).toEqual(["now", "now", "now"])
		expect(outcomes.slice(RECONNECT_TOKENS, RECONNECT_TOKENS + ADMISSION_QUEUE_PER_ORIGIN)).toEqual([
			"queued",
			"queued",
			"queued",
			"queued",
		])
		expect(outcomes[7]).toBe("rejected")
		expect(served).toEqual(["r1", "r2", "r3"])
	})

	test("the refill serves the queue one per interval, FIFO, and the timer stops when it empties", () => {
		const { gate, admit, served } = harness()
		// Deadlines beyond the last refill so only the rate is under test.
		for (let i = 1; i <= 6; i++) admit(`r${i}`, { deadline: Date.now() + 120_000 })
		expect(gate.hasTimer).toBe(true)
		vi.advanceTimersByTime(RECONNECT_REFILL_MS)
		expect(served).toEqual(["r1", "r2", "r3", "r4"])
		vi.advanceTimersByTime(RECONNECT_REFILL_MS)
		expect(served).toEqual(["r1", "r2", "r3", "r4", "r5"])
		vi.advanceTimersByTime(RECONNECT_REFILL_MS)
		expect(served).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"])
		expect(gate.hasTimer).toBe(false)
	})

	test("a queued entry past its deadline is rejected at its turn, and the one behind it is served", () => {
		const { admit, served, expired } = harness()
		for (let i = 1; i <= 3; i++) admit(`r${i}`)
		admit("short", { deadline: Date.now() + 5_000 })
		admit("long")
		vi.advanceTimersByTime(RECONNECT_REFILL_MS)
		expect(expired).toEqual(["short"])
		expect(served).toEqual(["r1", "r2", "r3", "long"])
	})

	test("origins are independent", () => {
		const { admit } = harness()
		for (let i = 1; i <= 3; i++) admit(`a${i}`)
		expect(admit("a4")).toBe("queued")
		expect(admit("b1", { origin: "https://other.example" })).toBe("now")
	})
})

describe("VerifyAdmissionGate — verify-window capacity", () => {
	test("the 3rd handshake that needs a window queues even with tokens left; a closed window serves it", () => {
		const { gate, admit, served, reservations } = harness()
		const needs = { needsWindow: true, consumesToken: false }
		expect(admit("w1", needs)).toBe("now")
		expect(admit("w2", needs)).toBe("now")
		expect(admit("w3", needs)).toBe("queued")
		expect(gate.windowsHeld(ORIGIN)).toBe(VERIFY_WINDOWS_PER_ORIGIN)
		// A token refill admits nothing while both slots stay held.
		vi.advanceTimersByTime(RECONNECT_REFILL_MS)
		expect(served).toEqual(["w1", "w2"])
		const w1 = reservations.get("w1")!
		w1.markInFlight()
		expect(w1.adopt(11)).toBe(true)
		gate.windowRemoved(11)
		expect(served).toEqual(["w1", "w2", "w3"])
		expect(gate.windowsHeld(ORIGIN)).toBe(VERIFY_WINDOWS_PER_ORIGIN)
	})

	test("a cancelled in-flight creation keeps its slot until the window arrives, then closes it", () => {
		const { gate, admit, served, reservations } = harness()
		const needs = { needsWindow: true, consumesToken: false }
		admit("w1", needs)
		admit("w2", needs)
		admit("w3", needs)
		const w1 = reservations.get("w1")!
		w1.markInFlight()
		gate.onSessionGone("w1")
		// Still held: releasing here would let w3 open before w1's window exists.
		expect(served).toEqual(["w1", "w2"])
		expect(gate.windowsHeld(ORIGIN)).toBe(2)
		expect(w1.adopt(11)).toBe(false)
		expect(served).toEqual(["w1", "w2", "w3"])
	})

	test("an unstarted reservation is freed on session termination and reclaimed past its grace", () => {
		const { gate, admit, served, reservations } = harness()
		const needs = { needsWindow: true, consumesToken: false }
		admit("w1", needs)
		admit("w2", needs)
		admit("w3", needs)
		gate.onSessionGone("w1")
		expect(served).toEqual(["w1", "w2", "w3"])
		expect(reservations.get("w1")!.status).toBe("released")
		admit("w4", { ...needs, deadline: Date.now() + 120_000 })
		expect(served).toHaveLength(3)
		// w2 and w3 were never established: past the grace their slots come back and w4 is served.
		vi.advanceTimersByTime(55_000 + RESERVATION_GRACE_MS + 1)
		expect(served).toEqual(["w1", "w2", "w3", "w4"])
		expect(reservations.get("w2")!.status).toBe("released")
	})

	test("an opened window keeps its slot through termination until it is removed", () => {
		const { gate, admit, served, reservations } = harness()
		const needs = { needsWindow: true, consumesToken: false }
		admit("w1", needs)
		admit("w2", needs)
		admit("w3", needs)
		const w1 = reservations.get("w1")!
		w1.markInFlight()
		w1.adopt(11)
		gate.onSessionGone("w1")
		expect(served).toEqual(["w1", "w2"])
		gate.windowRemoved(11)
		expect(served).toEqual(["w1", "w2", "w3"])
	})
})
