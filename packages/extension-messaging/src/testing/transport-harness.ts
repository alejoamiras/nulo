/**
 * Local transport test harness for `@nulo/extension-messaging`.
 *
 * The package's `setup.ts` installs `@webext-core/fake-browser`, which is
 * fine for pure-logic tests but cannot express the two things the transport
 * contract suites need: a `chrome.runtime.connect` Port whose `postMessage`
 * is a `vi.fn` (so a test can make it throw via `mockImplementationOnce`),
 * and a `chrome.runtime.sendMessage` that a test can make reject via
 * `mockRejectedValueOnce`. This harness provides exactly that — a hand-rolled
 * `chrome` stub with broker maps for both transport directions.
 *
 * Importing this module registers its own `beforeEach`/`afterEach` that
 * `vi.stubGlobal("chrome", …)` over whatever `setup.ts` installed, so only
 * the test files that import it get the custom stub; `errors.test.ts` keeps
 * the fake-browser default.
 *
 * Directions covered:
 *   - CLIENT (popup ↔ SW Port): `capturePortMessage` / `emitPortMessage`.
 *   - CLIENT (SW ↔ offscreen sendMessage): `captureMessage` / `emitMessage`.
 *   - SERVICE (Port server): `connectServiceClient` fires `onConnect`.
 *   - SERVICE (offscreen): registers on the shared `onMessage`; drive it with
 *     `emitMessage` and read responses via `captureMessage`.
 */

import type { ILogger, LogLevel } from "@nulo/wallet-core/logger"
import { afterEach, beforeEach, type Mock, vi } from "vitest"

type Fn = (...args: unknown[]) => void

// ── Background CLIENT side (chrome.runtime.connect → Port) ──────────────
const portMessageListeners = new Map<string, Fn[]>()
const sendPortMessageMocks = new Map<string, Mock<Fn>>()

/** Invoke the client's port.onMessage listeners for `service` — simulates the
 *  server replying without a real port broker. */
export const emitPortMessage = (service: string, message: unknown) => {
	const listeners = portMessageListeners.get(service)
	if (listeners) {
		for (const listener of [...listeners]) listener(message)
	}
}

/** The `vi.fn` backing the client's `port.postMessage` for `service` — i.e.
 *  what the client just sent. Throws if no client has connected yet. */
export const capturePortMessage = (service: string) => {
	const fnMock = sendPortMessageMocks.get(service)
	if (!fnMock) throw new Error(`Port for '${service}' hasn't been mocked`)
	return fnMock
}

const mockClientPort = (service: string) => {
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
						if (listeners[i] === listener) listeners.splice(i, 1)
					}
				}
			},
		},
		onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
		postMessage: postMessageMock,
	}
}

// ── Background SERVICE side (chrome.runtime.onConnect) ──────────────────
const connectListeners: Array<(port: unknown) => void> = []

/** Service-side view of a connected client port. */
export interface ServiceClientHandle {
	/** Deliver a request envelope to the service's `onMessage(message, port)`. */
	sendToService: (message: unknown) => void
	/** The `vi.fn` backing this client port's `postMessage` — what the service
	 *  sent back to this client. */
	captureResponse: () => Mock<Fn>
	/** Fire the service's `onDisconnect` for this client. */
	disconnect: () => void
	port: unknown
}

/**
 * Simulate a client connecting to a Port `Service`: builds a fake client port
 * named `service`, fires every registered `onConnect` listener with it, and
 * returns handles to drive the service and read its responses.
 */
export const connectServiceClient = (service: string): ServiceClientHandle => {
	const inbound: Fn[] = []
	const disconnectListeners: Fn[] = []
	const postMessageMock = vi.fn()
	const port = {
		name: service,
		postMessage: postMessageMock,
		disconnect: vi.fn(),
		onMessage: {
			addListener: (l: Fn) => inbound.push(l),
			removeListener: (l: Fn) => {
				for (let i = inbound.length - 1; i >= 0; i--) if (inbound[i] === l) inbound.splice(i, 1)
			},
		},
		onDisconnect: {
			addListener: (l: Fn) => disconnectListeners.push(l),
			removeListener: (l: Fn) => {
				for (let i = disconnectListeners.length - 1; i >= 0; i--) if (disconnectListeners[i] === l) disconnectListeners.splice(i, 1)
			},
		},
	}
	for (const listener of [...connectListeners]) listener(port)
	return {
		sendToService: (message: unknown) => {
			for (const l of [...inbound]) l(message, port)
		},
		captureResponse: () => postMessageMock,
		disconnect: () => {
			for (const l of [...disconnectListeners]) l(port)
		},
		port,
	}
}

// ── Shared sendMessage (offscreen client send + offscreen service) ──────
const messageListeners: Fn[] = []
const sendMessageMock: Mock<Fn> = vi.fn()

/** Invoke every `chrome.runtime.onMessage` listener — drives offscreen client
 *  responses AND offscreen service requests, depending on which is mounted. */
export const emitMessage = (message: unknown) => {
	for (const listener of [...messageListeners]) listener(message)
}

/** The `vi.fn` backing `chrome.runtime.sendMessage`. */
export const captureMessage = () => sendMessageMock

// ── Loggers (no console shim — silent/spy ILogger avoids it) ────────────
export const silentLogger: ILogger = { log: () => {} } as unknown as ILogger

export function makeSpyLogger(): { logger: ILogger; calls: Array<[string, LogLevel, ...unknown[]]> } {
	const calls: Array<[string, LogLevel, ...unknown[]]> = []
	const logger: ILogger = {
		log: (source: string, level: LogLevel, ...data: unknown[]): void => {
			calls.push([source, level, ...data])
		},
	}
	return { logger, calls }
}

// ── Lifecycle ──────────────────────────────────────────────────────────
beforeEach(() => {
	// Default sendMessage to a resolved promise so the offscreen service's
	// fire-and-forget `.catch()` calls (keepalive, emit) don't trip on
	// `undefined.catch`. Tests override per-call with mockRejectedValueOnce.
	sendMessageMock.mockResolvedValue(undefined)
	vi.stubGlobal("chrome", {
		storage: {},
		runtime: {
			connect: vi.fn().mockImplementation((_: unknown, { name }: { name: string }) => mockClientPort(name)),
			getContexts: vi.fn(),
			getURL: vi.fn(),
			onConnect: {
				addListener: (listener: (port: unknown) => void) => connectListeners.push(listener),
				removeListener: (listener: (port: unknown) => void) => {
					for (let i = connectListeners.length - 1; i >= 0; i--)
						if (connectListeners[i] === listener) connectListeners.splice(i, 1)
				},
			},
			onMessage: {
				addListener: (listener: Fn) => messageListeners.push(listener),
				removeListener: (listener: Fn) => {
					for (let i = messageListeners.length - 1; i >= 0; i--)
						if (messageListeners[i] === listener) messageListeners.splice(i, 1)
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
	connectListeners.splice(0)
	sendMessageMock.mockReset()
})
