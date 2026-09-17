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
 *   - CLIENT (popup ↔ SW Port): `capturePortMessage` / `emitPortMessage` /
 *     `emitPortDisconnect`, over the shared `PortRegistry` (`./port-registry`).
 *   - CLIENT (SW ↔ offscreen sendMessage): `captureMessage` / `emitMessage`.
 *   - SERVICE (Port server): `connectServiceClient` fires `onConnect`.
 *   - SERVICE (offscreen): registers on the shared `onMessage`; drive it with
 *     `emitMessage` and read responses via `captureMessage`.
 */

import type { ILogger, LogLevel } from "@nulo/wallet-core/logger"
import { createListenerBag } from "@nulo/wallet-core/testing"
import { afterEach, beforeEach, type Mock, vi } from "vitest"
import { connectStub, PortRegistry } from "./port-registry"

type Fn = (...args: unknown[]) => void

// ── Background CLIENT side (chrome.runtime.connect → Port) ──────────────
let ports = new PortRegistry()

/** Hand `message` to the client's port for `service` — simulates the server replying. */
export const emitPortMessage = (service: string, message: unknown) => ports.deliver(service, message)

/** Close `service`'s port from the far end — the service worker dying while the popup is open
 *  (the live-reconnect path). */
export const emitPortDisconnect = (service: string) => ports.closeAll(service)

/** The `vi.fn` the client's `port.postMessage` for `service` sends through — i.e. what the
 *  client just sent. Throws if no client has connected yet. */
export const capturePortMessage = (service: string) => ports.sendMock(service)

// ── Background SERVICE side (chrome.runtime.onConnect) ──────────────────
const connectListeners = createListenerBag<(port: unknown) => void>()

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
	const inbound = createListenerBag<Fn>()
	const disconnectListeners = createListenerBag<Fn>()
	const postMessageMock = vi.fn()
	const port = {
		name: service,
		// F-09: the service's onConnect authenticates the Port's sender.
		sender: { id: chrome.runtime.id } as chrome.runtime.MessageSender,
		postMessage: postMessageMock,
		disconnect: vi.fn(),
		onMessage: { addListener: inbound.add, removeListener: inbound.removeAll },
		onDisconnect: { addListener: disconnectListeners.add, removeListener: disconnectListeners.removeAll },
	}
	for (const listener of [...connectListeners.items]) listener(port)
	return {
		sendToService: (message: unknown) => {
			for (const l of [...inbound.items]) l(message, port)
		},
		captureResponse: () => postMessageMock,
		disconnect: () => {
			for (const l of [...disconnectListeners.items]) l(port)
		},
		port,
	}
}

// ── Shared sendMessage (offscreen client send + offscreen service) ──────
const messageListeners = createListenerBag<Fn>()
const sendMessageMock: Mock<Fn> = vi.fn()

/** Invoke every `chrome.runtime.onMessage` listener — drives offscreen client
 *  responses AND offscreen service requests, depending on which is mounted. */
export const emitMessage = (message: unknown, sender?: chrome.runtime.MessageSender) => {
	// The offscreen listeners authenticate their sender. Default to the same-extension
	// background context (matching `runtime.id`, no `tab`, no url) so contract tests exercise
	// the message path; a test that targets the sender gate passes its own.
	const from = sender ?? ({ id: chrome.runtime.id } as chrome.runtime.MessageSender)
	for (const listener of [...messageListeners.items]) listener(message, from)
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
	ports = new PortRegistry()
	vi.stubGlobal("chrome", {
		storage: {},
		runtime: {
			connect: vi.fn().mockImplementation(connectStub(ports)),
			getContexts: vi.fn(),
			getURL: vi.fn(),
			onConnect: { addListener: connectListeners.add, removeListener: connectListeners.removeAll },
			onMessage: { addListener: messageListeners.add, removeListener: messageListeners.removeAll },
			sendMessage: sendMessageMock,
		},
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
	messageListeners.items.splice(0)
	connectListeners.items.splice(0)
	sendMessageMock.mockReset()
})
