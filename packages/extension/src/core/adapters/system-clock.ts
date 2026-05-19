/**
 * Real-clock implementation of ClockPort. Wraps Date.now and the global
 * timer functions. Tests substitute MockClock (see src/core/testing/).
 */

import type { ClockPort, TimerHandle } from "@nulo/wallet-core/ports"

export class SystemClock implements ClockPort {
	public now(): number {
		return Date.now()
	}

	public sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	public setTimeout(fn: () => void, ms: number): TimerHandle {
		return globalThis.setTimeout(fn, ms)
	}

	public clearTimeout(handle: TimerHandle): void {
		globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0])
	}

	public setInterval(fn: () => void, ms: number): TimerHandle {
		return globalThis.setInterval(fn, ms)
	}

	public clearInterval(handle: TimerHandle): void {
		globalThis.clearInterval(handle as Parameters<typeof globalThis.clearInterval>[0])
	}
}
