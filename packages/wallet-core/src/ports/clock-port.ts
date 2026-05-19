/**
 * Time + timers abstracted so services can be unit-tested with a MockClock
 * that advances virtual time, instead of real-wall-clock waits.
 *
 * Not included: alarms. Those are Chrome-specific and live on `AlarmsPort`.
 */

export type TimerHandle = unknown

export interface ClockPort {
	/** Epoch milliseconds; equivalent to `Date.now()` with the real clock. */
	now(): number

	/** Resolve after `ms` milliseconds. Used by services that busy-wait. */
	sleep(ms: number): Promise<void>

	/** Schedule `fn` after `ms`. Returns a handle for `clearTimeout`. */
	setTimeout(fn: () => void, ms: number): TimerHandle
	clearTimeout(handle: TimerHandle): void

	/** Schedule `fn` every `ms`. Returns a handle for `clearInterval`. */
	setInterval(fn: () => void, ms: number): TimerHandle
	clearInterval(handle: TimerHandle): void
}
