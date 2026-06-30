/**
 * Production `BackgroundTickerPort` implementation. Wraps `ClockPort.setInterval`
 * with a serialized/coalescing contract + error containment.
 *
 * A future `chrome.alarms`-backed adapter is NOT swap-in compatible at
 * sub-30s cadences — use this adapter for any work that needs a
 * cadence faster than `chrome.alarms`' 30s floor.
 */

import type { ClockPort, TimerHandle } from "@nulo/wallet-core/ports"
import type { BackgroundTickerPort, TickerHandle } from "@nulo/wallet-core/ports"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"

export class ClockTickerAdapter implements BackgroundTickerPort {
	public constructor(
		private readonly clock: ClockPort,
		private readonly logger?: ILogger,
		private readonly logSource: string = "background-ticker",
	) {}

	public subscribe(intervalMs: number, onTick: () => void | Promise<void>): TickerHandle {
		let running = false
		let pending = false
		let cancelled = false

		const runOnce = async () => {
			if (cancelled) return
			if (running) {
				// Coalesce: remember we missed a tick, but don't queue a new one.
				pending = true
				return
			}
			running = true
			try {
				await onTick()
			} catch (err) {
				this.logger?.log(this.logSource, LogLevel.Error, `Ticker error: ${err instanceof Error ? err.message : String(err)}`)
			} finally {
				running = false
				if (pending && !cancelled) {
					pending = false
					// Queue the coalesced tick as a fresh microtask so we don't
					// blow the stack on a tight sequence of late ticks.
					queueMicrotask(runOnce)
				}
			}
		}

		const handle: TimerHandle = this.clock.setInterval(runOnce, intervalMs)

		return {
			cancel: () => {
				if (cancelled) return
				cancelled = true
				pending = false
				this.clock.clearInterval(handle)
			},
		}
	}
}
