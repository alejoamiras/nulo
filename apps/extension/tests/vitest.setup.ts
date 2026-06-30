import { afterEach, beforeEach, type Mock, vi } from "vitest"

// The wallet logger prints via `console._<level>` (see
// src/wallet/logger/utils.ts). Those aliases are installed by
// src/utils/console-sniffer at SW / popup boot; unit tests don't import that
// module, so without this shim any test that triggers a logWarn/logError
// path explodes with "console._warn is not a function".
// biome-ignore lint/suspicious/noExplicitAny: runtime global augmentation for test shim
const _console = console as any
for (const method of ["trace", "debug", "log", "info", "warn", "error"] as const) {
	if (typeof _console[`_${method}`] !== "function") {
		_console[`_${method}`] = _console[method].bind(_console)
	}
}

export const emitPortMessage = (service: string, message: unknown) => {
	const listeners = portMessageListeners.get(service)
	if (listeners) {
		for (const listener of listeners) {
			listener(message)
		}
	}
}

export const capturePortMessage = (service: string) => {
	const fnMock = sendPortMessageMocks.get(service)
	if (!fnMock) {
		throw new Error(`Port for '${service}' hasn't been mocked`)
	}
	return fnMock
}

export const emitMessage = (message: unknown) => {
	for (const listener of messageListeners) {
		listener(message)
	}
}

export const captureMessage = () => {
	return sendMessageMock
}

type Fn = (...args: unknown[]) => void

const portMessageListeners = new Map<string, Fn[]>()
const sendPortMessageMocks = new Map<string, Mock<Fn>>()
const messageListeners: Fn[] = []
const sendMessageMock = vi.fn()

const mockPort = (service: string) => {
	if (sendPortMessageMocks.has(service)) {
		throw new Error(`Port for '${service}' has already been mocked`)
	}

	const postMessageMock = vi.fn()
	sendPortMessageMocks.set(service, postMessageMock)

	return {
		disconnect: vi.fn(),
		onMessage: {
			addListener: (listener: Fn) => {
				let listeners = portMessageListeners.get(service)
				if (!listeners) {
					listeners = []
					portMessageListeners.set(service, listeners)
				}
				listeners.push(listener)
			},
			removeListener: (listener: Fn) => {
				const listeners = portMessageListeners.get(service)
				if (listeners) {
					for (let i = listeners.length - 1; i >= 0; i--) {
						if (listeners[i] === listener) {
							listeners.splice(i, 1)
						}
					}
				}
			},
		},
		onDisconnect: {
			addListener: vi.fn(),
			removeListener: vi.fn(),
		},
		postMessage: postMessageMock,
	}
}

beforeEach(() => {
	vi.stubGlobal("chrome", {
		storage: {},
		runtime: {
			connect: vi.fn().mockImplementation((_, { name }) => mockPort(name)),
			getContexts: vi.fn(),
			getURL: vi.fn(),
			onConnect: {
				addListener: vi.fn(),
				removeListener: vi.fn(),
			},
			onMessage: {
				addListener: (listener: Fn) => {
					messageListeners.push(listener)
				},
				removeListener: (listener: Fn) => {
					for (let i = messageListeners.length - 1; i >= 0; i--) {
						if (messageListeners[i] === listener) {
							messageListeners.splice(i, 1)
						}
					}
				},
			},
			sendMessage: sendMessageMock,
		},
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
	portMessageListeners.clear()
	sendPortMessageMocks.clear()
	messageListeners.splice(0)
	sendMessageMock.mockClear()
})
