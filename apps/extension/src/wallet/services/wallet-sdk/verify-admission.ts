/**
 * Per-origin admission for dApp handshakes that the wallet will approve without a user gesture
 * (a remembered session) or that will open a verify window.
 *
 * Two budgets, both keyed on the page origin: a token bucket bounds how fast a remembered origin
 * is re-approved (a reload loop is slowed, not blocked), and a window budget bounds how many verify
 * windows an origin can have open or reserved at once. A handshake that fits runs at once; one that
 * does not waits in a bounded FIFO and is served when a token refills or a window closes, or is
 * rejected once its discovery deadline passes. Admission happens BEFORE the approval so a session
 * is never live with its verification merely queued.
 *
 * A window slot is reserved at admission and released only when the window it produced is gone:
 * releasing on session termination alone would let an origin connect, keep the window, close the
 * tab and reconnect past the cap, and releasing while a creation is in flight would let a
 * replacement open before the original window appears.
 */

import type { ClockPort, TimerHandle } from "@nulo/wallet-core/ports"

export const RECONNECT_TOKENS = 3
export const RECONNECT_REFILL_MS = 20_000
export const VERIFY_WINDOWS_PER_ORIGIN = 2
export const VERIFY_WINDOWS_GLOBAL = 8
export const ADMISSION_QUEUE_PER_ORIGIN = 4
/** Key exchange runs after the approval and can straddle the discovery deadline by a few seconds;
 *  a reservation nobody established by then is reclaimed so a dApp that never completed its
 *  handshake cannot hold a slot for the worker's lifetime. */
export const RESERVATION_GRACE_MS = 10_000

export interface AdmissionRequest {
	/** The discovery request id — the SDK reuses it verbatim as the session id. */
	readonly id: string
	readonly origin: string
	/** Epoch ms after which the dApp no longer listens for the approval. */
	readonly deadline: number
	/** Whether establishment will open a verify window for this handshake. */
	readonly needsWindow: boolean
	/** Whether this handshake counts against the origin's reconnect rate (a user-approved
	 *  connect popup does not; a remembered-session auto-approval does). */
	readonly consumesToken: boolean
}

export type AdmissionOutcome = "now" | "queued" | "rejected"
export type AdmissionRun = (reservation: WindowReservation | undefined) => void

export type AdmissionClock = Pick<ClockPort, "now" | "setTimeout" | "clearTimeout">

type ReservationState = "unstarted" | "in-flight" | "opened" | "released"

/** One reserved verify-window slot, held from admission until its window is removed. */
export class WindowReservation {
	private state: ReservationState = "unstarted"
	private cancelled = false
	public windowId: number | undefined

	public constructor(
		public readonly id: string,
		public readonly origin: string,
		/** When an unestablished reservation is reclaimed. */
		public readonly expiresAt: number,
		private readonly release: (r: WindowReservation) => void,
	) {}

	public get status(): ReservationState {
		return this.state
	}

	/** Give the slot back while no window creation has been issued. `false` once one has. */
	public releaseIfUnstarted(): boolean {
		if (this.state !== "unstarted") return false
		this.finish()
		return true
	}

	/** A window creation is being issued: the slot is held until the window is gone or creation fails. */
	public markInFlight(): void {
		if (this.state === "unstarted") this.state = "in-flight"
	}

	/** Bind the created window to the slot. `false` when the attempt was cancelled meanwhile — the
	 *  caller must close that window; the slot is released here. */
	public adopt(windowId: number): boolean {
		if (this.state !== "in-flight") return false
		if (this.cancelled) {
			this.finish()
			return false
		}
		this.state = "opened"
		this.windowId = windowId
		return true
	}

	public creationFailed(): void {
		if (this.state === "in-flight") this.finish()
	}

	/** The session behind this slot is gone: an unstarted slot is freed, an in-flight creation is
	 *  marked so its window is closed on arrival, an open window keeps the slot until it closes. */
	public cancel(): void {
		if (this.state === "unstarted") this.finish()
		else if (this.state === "in-flight") this.cancelled = true
	}

	public windowRemoved(windowId: number): void {
		if (this.state === "opened" && this.windowId === windowId) this.finish()
	}

	private finish(): void {
		this.state = "released"
		this.release(this)
	}
}

interface Queued {
	readonly req: AdmissionRequest
	readonly run: AdmissionRun
	readonly expire: () => void
}

interface OriginState {
	tokens: number
	refilledAt: number
	windows: number
	readonly queue: Queued[]
}

export class VerifyAdmissionGate {
	private readonly origins = new Map<string, OriginState>()
	private readonly reservations = new Map<string, WindowReservation>()
	private globalWindows = 0
	private timer: TimerHandle | undefined

	public constructor(private readonly clock: AdmissionClock) {}

	/**
	 * Admit `req` now (`run` is invoked synchronously with the window reservation, if one was
	 * requested), queue it (`run` or `expire` is invoked later from the drain), or reject it
	 * outright when the origin's queue is full.
	 */
	public admit(req: AdmissionRequest, run: AdmissionRun, expire: () => void): AdmissionOutcome {
		const origin = this.originState(req.origin)
		this.refill(origin)
		if (this.fits(origin, req)) {
			run(this.consume(origin, req))
			return "now"
		}
		if (origin.queue.length >= ADMISSION_QUEUE_PER_ORIGIN) return "rejected"
		origin.queue.push({ req, run, expire })
		this.arm()
		return "queued"
	}

	public reservation(id: string): WindowReservation | undefined {
		return this.reservations.get(id)
	}

	/** The session `id` was terminated (or its approval never became a session). */
	public onSessionGone(id: string): void {
		this.reservations.get(id)?.cancel()
	}

	public windowRemoved(windowId: number): void {
		for (const r of this.reservations.values()) r.windowRemoved(windowId)
	}

	/** Open or reserved verify windows for `origin` (test and diagnostics surface). */
	public windowsHeld(origin: string): number {
		return this.origins.get(origin)?.windows ?? 0
	}

	public queued(origin: string): number {
		return this.origins.get(origin)?.queue.length ?? 0
	}

	public get hasTimer(): boolean {
		return this.timer !== undefined
	}

	private originState(origin: string): OriginState {
		let state = this.origins.get(origin)
		if (!state) {
			state = { tokens: RECONNECT_TOKENS, refilledAt: this.clock.now(), windows: 0, queue: [] }
			this.origins.set(origin, state)
		}
		return state
	}

	private refill(origin: OriginState): void {
		if (origin.tokens >= RECONNECT_TOKENS) {
			origin.refilledAt = this.clock.now()
			return
		}
		const earned = Math.floor((this.clock.now() - origin.refilledAt) / RECONNECT_REFILL_MS)
		if (earned <= 0) return
		origin.tokens = Math.min(RECONNECT_TOKENS, origin.tokens + earned)
		origin.refilledAt = origin.tokens >= RECONNECT_TOKENS ? this.clock.now() : origin.refilledAt + earned * RECONNECT_REFILL_MS
	}

	private fits(origin: OriginState, req: AdmissionRequest): boolean {
		if (req.consumesToken && origin.tokens < 1) return false
		if (req.needsWindow && (origin.windows >= VERIFY_WINDOWS_PER_ORIGIN || this.globalWindows >= VERIFY_WINDOWS_GLOBAL)) return false
		return true
	}

	private consume(origin: OriginState, req: AdmissionRequest): WindowReservation | undefined {
		if (req.consumesToken) origin.tokens -= 1
		if (!req.needsWindow) return undefined
		origin.windows += 1
		this.globalWindows += 1
		const reservation = new WindowReservation(req.id, req.origin, req.deadline + RESERVATION_GRACE_MS, (r) => this.released(r))
		this.reservations.set(req.id, reservation)
		this.arm()
		return reservation
	}

	private released(r: WindowReservation): void {
		if (this.reservations.get(r.id) !== r) return
		this.reservations.delete(r.id)
		const origin = this.originState(r.origin)
		origin.windows -= 1
		this.globalWindows -= 1
		this.serve()
	}

	/** Serve every origin's queue as far as budgets allow, reclaim stale reservations, re-arm. */
	private serve(): void {
		const now = this.clock.now()
		for (const r of [...this.reservations.values()]) {
			if (now <= r.expiresAt) continue
			if (r.status === "unstarted") r.releaseIfUnstarted()
			else if (r.status === "in-flight") r.cancel()
		}
		for (const [name, origin] of this.origins) {
			this.refill(origin)
			this.drain(origin, now)
			if (origin.queue.length === 0 && origin.windows === 0 && origin.tokens >= RECONNECT_TOKENS) this.origins.delete(name)
		}
		this.arm()
	}

	private drain(origin: OriginState, now: number): void {
		while (origin.queue.length > 0) {
			const head = origin.queue[0]
			if (now > head.req.deadline) {
				origin.queue.shift()
				head.expire()
				continue
			}
			if (!this.fits(origin, head.req)) return
			origin.queue.shift()
			head.run(this.consume(origin, head.req))
		}
	}

	private nextWake(): number | undefined {
		let next: number | undefined
		const consider = (t: number) => {
			next = next === undefined ? t : Math.min(next, t)
		}
		for (const origin of this.origins.values()) {
			if (origin.queue.length === 0) continue
			if (origin.tokens < RECONNECT_TOKENS) consider(origin.refilledAt + RECONNECT_REFILL_MS)
			consider(origin.queue[0].req.deadline + 1)
		}
		for (const r of this.reservations.values()) if (r.status !== "opened") consider(r.expiresAt + 1)
		return next
	}

	private arm(): void {
		if (this.timer !== undefined) {
			this.clock.clearTimeout(this.timer)
			this.timer = undefined
		}
		const next = this.nextWake()
		if (next === undefined) return
		this.timer = this.clock.setTimeout(
			() => {
				this.timer = undefined
				this.serve()
			},
			Math.max(0, next - this.clock.now()),
		)
	}
}

/** Promise form for the async approval sites: resolves with the reservation once admitted. */
export function admitAsync(
	gate: VerifyAdmissionGate,
	req: AdmissionRequest,
): Promise<WindowReservation | undefined | "rejected" | "expired"> {
	return new Promise((resolve) => {
		const outcome = gate.admit(
			req,
			(reservation) => resolve(reservation),
			() => resolve("expired"),
		)
		if (outcome === "rejected") resolve("rejected")
	})
}
