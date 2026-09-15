/** Inert window + real-timer clock ports for tests that boot the SDK handler without opening windows. */
import type { ClockPort, WindowPort } from "@nulo/wallet-core/ports"

export function fakeSdkPorts(over: Partial<WindowPort> = {}): { windows: WindowPort; clock: ClockPort } {
	return {
		windows: {
			create: async () => ({ id: 1 }),
			onRemoved: () => () => {},
			remove: async () => {},
			update: async () => {},
			getLastFocused: async () => undefined,
			...over,
		},
		clock: {
			now: () => Date.now(),
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
			setTimeout: (fn, ms) => setTimeout(fn, ms),
			clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
			setInterval: (fn, ms) => setInterval(fn, ms),
			clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
		},
	}
}
