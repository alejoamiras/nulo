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
	const closed: number[] = []
	const releasedIds: string[] = []
	const gate = new VerifyAdmissionGate(clock, {
		closeWindow: (windowId) => closed.push(windowId),
		released: (id) => releasedIds.push(id),
	})
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
	return { gate, served, expired, reservations, admit, closed, releasedIds }
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
		expect(w1.markInFlight()).toBe(true)
		expect(w1.adopt(11)).toBe("live")
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
		// The cancelled attempt keeps its slot on adoption; the caller closes the window it got.
		expect(w1.adopt(11)).toBe("abort")
		expect(served).toEqual(["w1", "w2"])
		expect(gate.windowsHeld(ORIGIN)).toBe(2)
		// w3 is served only once that window is actually removed.
		gate.windowRemoved(11)
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

	test("a duplicate discovery id (dApp-controlled) is rejected, never a second slot", () => {
		const { gate, admit } = harness()
		const needs = { needsWindow: true, consumesToken: false }
		expect(admit("dup", needs)).toBe("now")
		expect(admit("dup", needs)).toBe("rejected")
		expect(gate.windowsHeld(ORIGIN)).toBe(1)
	})

	test("the global cap bounds windows across origins", () => {
		const { gate } = harness()
		const at = (origin: string, id: string) =>
			gate.admit(
				{ id, origin, deadline: Date.now() + 55_000, needsWindow: true, consumesToken: false },
				() => {},
				() => {},
			)
		// Four origins, two each = eight; the ninth is queued on its own origin, not opened.
		for (let o = 0; o < 4; o++) for (let i = 0; i < 2; i++) expect(at(`o${o}`, `o${o}-${i}`)).toBe("now")
		expect(at("o4", "o4-0")).toBe("queued")
	})

	test("a removal arriving before its creation resolves releases the slot on adoption", () => {
		const { gate, admit, reservations } = harness()
		const needs = { needsWindow: true, consumesToken: false }
		admit("w1", needs)
		const w1 = reservations.get("w1")!
		w1.markInFlight()
		// onRemoved fires while the create() promise is still pending: no reservation owns id 7 yet.
		gate.windowRemoved(7)
		expect(w1.adopt(7)).toBe("abort")
		expect(w1.status).toBe("released")
		expect(gate.windowsHeld(ORIGIN)).toBe(0)
	})

	test("a removal evicted from the buffer before adoption leaves that slot held — fail-closed, never over the cap", () => {
		const { gate, admit, served, reservations } = harness()
		const needs = { needsWindow: true, consumesToken: false }
		admit("w1", needs)
		admit("w2", needs)
		const w1 = reservations.get("w1")!
		w1.markInFlight()
		// w1's window closes before create() resolves, then 65 unrelated removals evict that event.
		gate.windowRemoved(11)
		for (let i = 100; i < 165; i++) gate.windowRemoved(i)
		// The port cannot confirm absence, so adoption must trust the window is live: the slot stays
		// held (a third handshake queues) and the origin never gets a window past the cap.
		expect(w1.adopt(11)).toBe("live")
		expect(w1.status).toBe("opened")
		admit("w3", needs)
		expect(served).toEqual(["w1", "w2"])
		expect(gate.windowsHeld(ORIGIN)).toBe(VERIFY_WINDOWS_PER_ORIGIN)
		// Termination does not free an opened slot either — only the (already lost) removal would.
		gate.onSessionGone("w1")
		expect(gate.windowsHeld(ORIGIN)).toBe(VERIFY_WINDOWS_PER_ORIGIN)
		expect(served).toEqual(["w1", "w2"])
	})

	test("an in-flight creation past its deadline does not spin the drain timer", () => {
		const { gate, admit, reservations } = harness()
		const needs = { needsWindow: true, consumesToken: false }
		admit("w1", needs)
		reservations.get("w1")!.markInFlight()
		vi.advanceTimersByTime(55_000 + RESERVATION_GRACE_MS + 1)
		// The reservation is in-flight, not timer-reclaimed, so no wake is armed for it.
		expect(gate.hasTimer).toBe(false)
		expect(gate.windowsHeld(ORIGIN)).toBe(1)
	})

	test("a reservation backs exactly one creation: a second markInFlight is refused", () => {
		const { admit, reservations } = harness()
		admit("w1", { needsWindow: true, consumesToken: false })
		const w1 = reservations.get("w1")!
		expect(w1.markInFlight()).toBe(true)
		expect(w1.markInFlight()).toBe(false)
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

describe("VerifyAdmissionGate — a connect window on standby", () => {
	const needs = { needsWindow: true, consumesToken: false }

	test("an attached window holds its slot until it is removed, and the gate never closes it", () => {
		const { gate, admit, served, reservations, closed, releasedIds } = harness()
		admit("w1", needs)
		admit("w2", needs)
		admit("w3", needs)
		const w1 = reservations.get("w1")!
		expect(w1.attach(41)).toBe(true)
		expect(w1.status).toBe("standby")
		expect(gate.windowsHeld(ORIGIN)).toBe(VERIFY_WINDOWS_PER_ORIGIN)
		expect(served).toEqual(["w1", "w2"])
		gate.windowRemoved(41)
		expect(w1.status).toBe("released")
		expect(served).toEqual(["w1", "w2", "w3"])
		expect(releasedIds).toEqual(["w1"])
		expect(closed).toEqual([])
	})

	test("a window removed before its attach fails the attach and frees the slot", () => {
		const { gate, admit, reservations, closed, releasedIds } = harness()
		admit("w1", needs)
		// Closed while its Allow waited for a slot: no reservation knew the id, so the gate buffered it.
		gate.windowRemoved(41)
		const w1 = reservations.get("w1")!
		expect(w1.attach(41)).toBe(false)
		expect(w1.status).toBe("released")
		expect(gate.windowsHeld(ORIGIN)).toBe(0)
		expect(releasedIds).toEqual(["w1"])
		expect(closed).toEqual([])
	})

	test("attach binds only an unstarted slot", () => {
		const { admit, reservations } = harness()
		admit("w1", needs)
		const w1 = reservations.get("w1")!
		w1.markInFlight()
		expect(w1.attach(41)).toBe(false)
		expect(w1.status).toBe("in-flight")
	})

	type Exit = (gate: VerifyAdmissionGate, w1: WindowReservation) => void
	const exits: Array<[string, Exit]> = [
		["cancel", (gate, w1) => gate.onSessionGone(w1.id)],
		["releaseIfUnstarted", (_, w1) => void w1.releaseIfUnstarted()],
		["expiry", () => vi.advanceTimersByTime(55_000 + RESERVATION_GRACE_MS + 1)],
	]

	test.each(exits)("%s on a standby slot closes its window once and holds the slot until the removal", (_, exit) => {
		const { gate, admit, served, reservations, closed, releasedIds } = harness()
		admit("w1", needs)
		admit("w2", needs)
		admit("w3", { ...needs, deadline: Date.now() + 200_000 })
		const w1 = reservations.get("w1")!
		w1.attach(41)
		// In flight, w2 is never timer-reclaimed: only w1 can free a slot for w3.
		reservations.get("w2")!.markInFlight()
		exit(gate, w1)
		expect(closed).toEqual([41])
		expect(w1.status).toBe("closing")
		expect(served).toEqual(["w1", "w2"])
		expect(gate.windowsHeld(ORIGIN)).toBe(VERIFY_WINDOWS_PER_ORIGIN)
		exit(gate, w1)
		expect(closed).toEqual([41])
		expect(releasedIds).toEqual([])
		gate.windowRemoved(41)
		expect(served).toEqual(["w1", "w2", "w3"])
		expect(releasedIds).toEqual(["w1"])
	})

	test("claimStandby hands the window over once, and markInFlight refuses a standby slot", () => {
		const { admit, reservations } = harness()
		admit("w1", needs)
		const w1 = reservations.get("w1")!
		expect(w1.claimStandby()).toBeUndefined()
		w1.attach(41)
		expect(w1.markInFlight()).toBe(false)
		expect(w1.claimStandby()).toBe(41)
		expect(w1.status).toBe("in-flight")
		expect(w1.claimStandby()).toBeUndefined()
		expect(w1.adopt(41)).toBe("live")
		expect(w1.status).toBe("opened")
	})

	test("a claimed window removed before its adoption frees the slot, and the adoption aborts", () => {
		const { gate, admit, reservations, releasedIds } = harness()
		admit("w1", needs)
		const w1 = reservations.get("w1")!
		w1.attach(41)
		w1.claimStandby()
		gate.windowRemoved(41)
		expect(w1.status).toBe("released")
		expect(gate.windowsHeld(ORIGIN)).toBe(0)
		expect(w1.adopt(41)).toBe("abort")
		expect(releasedIds).toEqual(["w1"])
	})

	test("abandoned is false while unstarted or standby, and true once closing or released", () => {
		const { gate, admit, reservations } = harness()
		admit("w1", needs)
		admit("w2", needs)
		const w1 = reservations.get("w1")!
		expect(w1.abandoned).toBe(false)
		w1.attach(41)
		expect(w1.abandoned).toBe(false)
		w1.releaseIfUnstarted()
		expect(w1.abandoned).toBe(true)
		gate.windowRemoved(41)
		expect(w1.abandoned).toBe(true)
		const w2 = reservations.get("w2")!
		w2.releaseIfUnstarted()
		expect(w2.abandoned).toBe(true)
	})

	test("released(id) fires once per release, from every state that can release", () => {
		const { gate, admit, reservations, releasedIds } = harness()
		const ids = ["unstarted", "gone", "standby", "closing", "failed", "opened", "claimed", "expired"]
		// One origin each, so no slot cap interferes.
		for (const id of ids) admit(id, { ...needs, origin: `https://${id}.example` })
		const r = (id: string) => reservations.get(id)!
		r("unstarted").releaseIfUnstarted()
		gate.windowRemoved(40)
		r("gone").attach(40)
		r("standby").attach(41)
		gate.windowRemoved(41)
		r("closing").attach(42)
		r("closing").cancel()
		gate.windowRemoved(42)
		r("failed").markInFlight()
		r("failed").creationFailed()
		r("opened").markInFlight()
		r("opened").adopt(43)
		gate.windowRemoved(43)
		r("claimed").attach(44)
		r("claimed").claimStandby()
		r("claimed").adopt(44)
		gate.windowRemoved(44)
		vi.advanceTimersByTime(55_000 + RESERVATION_GRACE_MS + 1)
		for (const id of ids) {
			r(id).releaseIfUnstarted()
			r(id).cancel()
			r(id).creationFailed()
		}
		for (const windowId of [40, 41, 42, 43, 44]) gate.windowRemoved(windowId)
		expect(releasedIds).toEqual(ids)
	})
})
