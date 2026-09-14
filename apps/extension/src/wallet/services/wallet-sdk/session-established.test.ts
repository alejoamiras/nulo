/**
 * Prove-first pins for the security-critical session-established path (arc 4).
 *
 * B-06: the verify window must show THIS session's own verification emojis — the
 * hash is passed per-session via the window URL, not read from the shared row.
 * B-13: the callback is fail-closed — any failure terminates the session, and the
 * pending-verification marker is always cleared (incl. the missing-row early return).
 * The verify window opens against the slot admission reserved at discovery, and the
 * slot is held until that window is removed.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { ILogger } from "@/wallet/logger"
import { PENDING_VERIFICATION_STALE_MS, type PendingVerificationEntry } from "./pending-verification"
import { type SessionEstablishedDeps, handleSessionEstablished } from "./session-established"
import { VerifyAdmissionGate, type WindowReservation } from "./verify-admission"

const noopLogger = { log: () => {} } as unknown as ILogger
const ORIGIN = "https://dapp.example"

const makeSession = (over: Record<string, unknown> = {}) => ({
	origin: ORIGIN,
	sessionId: "sess-1",
	verificationHash: "DEADBEEF",
	// chainInfoToChainId = (1 ^ 1) >>> 0 = 0 → key "https://dapp.example|0"
	chainInfo: { chainId: "1", version: "1" },
	...over,
})

const clock = {
	now: () => Date.now(),
	setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** A gate holding one reserved slot for `id`, as discovery admission leaves it. */
function reserved(id = "sess-1"): { gate: VerifyAdmissionGate; reservation: WindowReservation } {
	const gate = new VerifyAdmissionGate(clock)
	let reservation: WindowReservation | undefined
	gate.admit(
		{ id, origin: ORIGIN, deadline: Date.now() + 55_000, needsWindow: true, consumesToken: false },
		(r) => {
			reservation = r
		},
		() => {},
	)
	return { gate, reservation: reservation! }
}

function makeDeps(over: Partial<SessionEstablishedDeps> = {}) {
	const terminate = vi.fn()
	const stamp = vi.fn()
	const create = vi.fn().mockResolvedValue({ id: 99 })
	const remove = vi.fn().mockResolvedValue(undefined)
	const { gate, reservation } = reserved()
	const deps: SessionEstablishedDeps = {
		dappSessionService: {
			tryGetDappSessionByOriginAndChain: vi.fn().mockResolvedValue({ id: "dapp-1", profileId: "prof-A", trustedVerification: false }),
			setVerificationHash: vi.fn().mockResolvedValue(undefined),
		},
		terminateSession: terminate,
		pendingVerification: new Map<string, PendingVerificationEntry>(),
		stampSessionProfile: stamp,
		isSessionLive: () => true,
		windows: { create, remove },
		reservations: gate,
		logger: noopLogger,
		...over,
	}
	return { deps, terminate, stamp, create, remove, gate, reservation }
}

/** A fresh marker for the harness session, approved under `profileId`. */
const marker = (profileId = "prof-A", over: Partial<PendingVerificationEntry> = {}): PendingVerificationEntry => ({
	at: Date.now(),
	profileId,
	tabId: 7,
	...over,
})

beforeEach(() => {
	const c = (globalThis.chrome ?? {}) as Record<string, unknown>
	c.runtime = { ...((c.runtime as object) ?? {}), getURL: (p: string) => p }
	globalThis.chrome = c as never
})

describe("handleSessionEstablished — B-06 / B-13 pins", () => {
	test("(B-06 PIN) opens the verify window with THIS session's own verification hash", async () => {
		const { deps, create } = makeDeps()
		await handleSessionEstablished(makeSession({ verificationHash: "CAFEBABE" }), deps)
		expect(create).toHaveBeenCalledTimes(1)
		const url = create.mock.calls[0][0].url as string
		// The trust-decision emojis derive from the URL's hash, immune to the shared
		// row being overwritten by a concurrent same-tuple session.
		expect(url).toContain("verificationHash=CAFEBABE")
	})

	test("(B-13 PIN) a missing DappSession terminates the session AND clears pendingVerification", async () => {
		const pendingVerification = new Map([["sess-1", marker()]])
		const { deps, terminate, gate } = makeDeps({
			pendingVerification,
			dappSessionService: {
				tryGetDappSessionByOriginAndChain: vi.fn().mockResolvedValue(undefined),
				setVerificationHash: vi.fn(),
			},
		})
		await handleSessionEstablished(makeSession(), deps)
		expect(terminate).toHaveBeenCalledWith("sess-1")
		// The early return no longer leaks the pending marker for the SW's lifetime.
		expect(pendingVerification.has("sess-1")).toBe(false)
		expect(gate.windowsHeld(ORIGIN)).toBe(0)
	})

	test("(B-13 PIN) a failed verify-window open terminates the session (fail closed) and frees the slot", async () => {
		const { deps, terminate, create, gate } = makeDeps()
		create.mockResolvedValueOnce({ id: undefined })
		await handleSessionEstablished(makeSession(), deps)
		// A session whose verification UI couldn't open must not stay live unverified.
		expect(terminate).toHaveBeenCalledWith("sess-1")
		expect(gate.windowsHeld(ORIGIN)).toBe(0)
	})
})

describe("handleSessionEstablished — verify-window reservation", () => {
	test("opens against the held reservation and keeps the slot until that window is removed", async () => {
		const { deps, gate, reservation } = makeDeps()
		expect(await handleSessionEstablished(makeSession(), deps)).toBe(true)
		expect(reservation.status).toBe("opened")
		expect(gate.windowsHeld(ORIGIN)).toBe(1)
		gate.onSessionGone("sess-1")
		expect(gate.windowsHeld(ORIGIN)).toBe(1)
		gate.windowRemoved(99)
		expect(gate.windowsHeld(ORIGIN)).toBe(0)
	})

	test("a trusted reconnect opens nothing and releases the slot admission reserved", async () => {
		const { deps, create, gate } = makeDeps({
			dappSessionService: {
				tryGetDappSessionByOriginAndChain: vi
					.fn()
					.mockResolvedValue({ id: "dapp-1", profileId: "prof-B", trustedVerification: true }),
				setVerificationHash: vi.fn().mockResolvedValue(undefined),
			},
		})
		expect(await handleSessionEstablished(makeSession(), deps)).toBe(true)
		expect(create).not.toHaveBeenCalled()
		expect(gate.windowsHeld(ORIGIN)).toBe(0)
	})

	test("a window that needs opening without a reservation terminates the session", async () => {
		const { deps, terminate, create } = makeDeps({ reservations: { reservation: () => undefined } })
		expect(await handleSessionEstablished(makeSession(), deps)).toBe(false)
		expect(create).not.toHaveBeenCalled()
		expect(terminate).toHaveBeenCalledWith("sess-1")
	})

	test("a termination during creation closes the window that arrives and admits no replacement early", async () => {
		const { deps, create, remove, gate, terminate } = makeDeps()
		let resolveCreate!: (w: { id: number }) => void
		create.mockReturnValueOnce(new Promise<{ id: number }>((r) => (resolveCreate = r)))
		// A second handshake for the origin takes the last slot; a third must wait.
		let third: WindowReservation | undefined
		gate.admit(
			{ id: "sess-2", origin: ORIGIN, deadline: Date.now() + 55_000, needsWindow: true, consumesToken: false },
			() => {},
			() => {},
		)
		gate.admit(
			{ id: "sess-3", origin: ORIGIN, deadline: Date.now() + 55_000, needsWindow: true, consumesToken: false },
			(r) => {
				third = r
			},
			() => {},
		)
		const establishing = handleSessionEstablished(makeSession(), deps)
		await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
		gate.onSessionGone("sess-1")
		expect(third).toBeUndefined()
		expect(gate.windowsHeld(ORIGIN)).toBe(2)
		resolveCreate({ id: 42 })
		expect(await establishing).toBe(false)
		expect(remove).toHaveBeenCalledWith(42)
		expect(terminate).toHaveBeenCalledWith("sess-1")
		expect(third).toBeDefined()
		expect(gate.windowsHeld(ORIGIN)).toBe(2)
	})
})

describe("handleSessionEstablished — profile binding (N-04)", () => {
	test("a fresh matching marker stamps the session with the validated row's profile", async () => {
		const pendingVerification = new Map([["sess-1", marker("prof-A")]])
		const { deps, stamp, terminate } = makeDeps({ pendingVerification })
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(true)
		expect(stamp).toHaveBeenCalledWith("sess-1", "prof-A")
		expect(terminate).not.toHaveBeenCalled()
		expect(pendingVerification.has("sess-1")).toBe(false) // consumed
	})

	test("approve-under-A, validate-under-B fail-closes (profile skew)", async () => {
		const pendingVerification = new Map([["sess-1", marker("prof-A")]])
		const { deps, stamp, terminate } = makeDeps({
			pendingVerification,
			dappSessionService: {
				tryGetDappSessionByOriginAndChain: vi
					.fn()
					.mockResolvedValue({ id: "dapp-1", profileId: "prof-B", trustedVerification: false }),
				setVerificationHash: vi.fn().mockResolvedValue(undefined),
			},
		})
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(false)
		expect(terminate).toHaveBeenCalledWith("sess-1")
		expect(stamp).not.toHaveBeenCalled()
		expect(pendingVerification.has("sess-1")).toBe(false) // consumed either way
	})

	test("a STALE marker terminates — a parked approval is dead, never a reconnect", async () => {
		const pendingVerification = new Map([["sess-1", marker("prof-A", { at: Date.now() - PENDING_VERIFICATION_STALE_MS - 1 })]])
		const { deps, stamp, terminate } = makeDeps({ pendingVerification })
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(false)
		expect(terminate).toHaveBeenCalledWith("sess-1")
		expect(stamp).not.toHaveBeenCalled()
		expect(pendingVerification.has("sess-1")).toBe(false)
	})

	test("no marker (trusted reconnect) stamps from the validated row", async () => {
		const { deps, stamp } = makeDeps({
			dappSessionService: {
				tryGetDappSessionByOriginAndChain: vi
					.fn()
					.mockResolvedValue({ id: "dapp-1", profileId: "prof-B", trustedVerification: true }),
				setVerificationHash: vi.fn().mockResolvedValue(undefined),
			},
		})
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(true)
		expect(stamp).toHaveBeenCalledWith("sess-1", "prof-B")
	})

	test("a concurrent handshake's marker is untouched (request-keyed isolation)", async () => {
		const other = marker("prof-A")
		const pendingVerification = new Map([
			["sess-1", marker("prof-A")],
			["sess-OTHER", other],
		])
		const { deps } = makeDeps({ pendingVerification })
		await handleSessionEstablished(makeSession(), deps)
		expect(pendingVerification.get("sess-OTHER")).toBe(other) // survives intact
	})

	test("a session terminated mid-validation is never stamped and opens no verify window", async () => {
		const pendingVerification = new Map([["sess-1", marker("prof-A")]])
		const { deps, stamp, create, gate } = makeDeps({ pendingVerification, isSessionLive: () => false })
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(false)
		expect(stamp).not.toHaveBeenCalled()
		expect(create).not.toHaveBeenCalled()
		expect(pendingVerification.has("sess-1")).toBe(false) // marker still cleared
		expect(gate.windowsHeld(ORIGIN)).toBe(0)
	})

	test("a termination landing during the hash write is caught by the second gate (no stamp, no window)", async () => {
		const isSessionLive = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
		const { deps, stamp, create } = makeDeps({
			pendingVerification: new Map([["sess-1", marker("prof-A")]]),
			isSessionLive,
		})
		const ok = await handleSessionEstablished(makeSession(), deps)
		expect(ok).toBe(false)
		expect(stamp).not.toHaveBeenCalled()
		expect(create).not.toHaveBeenCalled()
		expect(isSessionLive).toHaveBeenCalledTimes(2)
	})
})
