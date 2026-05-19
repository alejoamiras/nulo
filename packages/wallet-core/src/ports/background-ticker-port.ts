/**
 * Periodic async background work abstraction.
 *
 * Use when you want a tick to fire every N ms for work that may take
 * longer than the tick interval, and you need at-most-one-in-flight
 * semantics. If you only need raw interval scheduling with no
 * concurrency contract, use `ClockPort.setInterval` directly.
 *
 * ### What this port guarantees that raw `setInterval` does NOT
 * - **Serialized**: at most ONE `onTick` invocation in flight at a
 *   time. If a tick is still running when the next interval fires,
 *   the new tick is COALESCED into a single pending slot — no backlog
 *   builds up even if `onTick` is slow.
 * - **`cancel()` prevents future delivery**: the already-running tick
 *   (if any) completes; any pending coalesced tick is DROPPED; no
 *   further ticks fire.
 * - **Error containment**: if `onTick` throws or its promise rejects,
 *   the error is logged and swallowed. The running flag is always
 *   cleared (try/finally); the next tick can still fire.
 *
 * ### What this port DOES NOT promise
 * - Persistence across SW suspension. The default adapter wraps
 *   `ClockPort.setInterval`, which pauses when the MV3 service worker
 *   suspends. A future `chrome.alarms`-backed adapter is NOT
 *   swap-in compatible at sub-30s cadences (alarms floor is 30s).
 * - Exact timing. Ticks may be delayed by arbitrary JS work or the
 *   coalescing rule above.
 * - First-tick-on-subscribe. The first tick fires after `intervalMs`,
 *   not immediately. Callers that want a cold-start refresh enqueue
 *   work BEFORE calling `subscribe`.
 */
export interface BackgroundTickerPort {
	/** Register a periodic tick. Returns a handle for cancellation. */
	subscribe(intervalMs: number, onTick: () => void | Promise<void>): TickerHandle
}

export interface TickerHandle {
	/** Prevent future tick delivery. Idempotent. */
	cancel(): void
}
