/**
 * Test double for `BackgroundTickerPort`. Tests drive ticks manually
 * via `tick()` instead of wall-clock time. Preserves the same
 * serialized/coalescing contract as the production adapter so tests
 * exercise the real concurrency semantics.
 */

import type { BackgroundTickerPort, TickerHandle } from "../ports/background-ticker-port"

type Subscription = {
	intervalMs: number
	onTick: () => void | Promise<void>
	running: boolean
	pending: boolean
	cancelled: boolean
}

export class FakeBackgroundTicker implements BackgroundTickerPort {
	private readonly subs: Subscription[] = []

	public subscribe(intervalMs: number, onTick: () => void | Promise<void>): TickerHandle {
		const sub: Subscription = { intervalMs, onTick, running: false, pending: false, cancelled: false }
		this.subs.push(sub)
		return {
			cancel: () => {
				if (sub.cancelled) return
				sub.cancelled = true
				sub.pending = false
			},
		}
	}

	/** Fire one tick on every active subscription. If a tick is already
	 *  in flight, coalesce into the pending slot (mirrors production). */
	public async tick(): Promise<void> {
		for (const sub of this.subs) {
			if (sub.cancelled) continue
			if (sub.running) {
				sub.pending = true
				continue
			}
			await this.runOnce(sub)
		}
	}

	/** Snapshot of currently-active subscriptions (not cancelled). */
	public get activeSubscriptions(): number {
		return this.subs.filter((s) => !s.cancelled).length
	}

	private async runOnce(sub: Subscription): Promise<void> {
		if (sub.cancelled) return
		sub.running = true
		try {
			await sub.onTick()
		} catch {
			// Swallow — matches production's error-containment contract.
		} finally {
			sub.running = false
			if (sub.pending && !sub.cancelled) {
				sub.pending = false
				await this.runOnce(sub)
			}
		}
	}
}
