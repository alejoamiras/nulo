import { connectStub, PortRegistry } from "@nulo/extension-messaging/testing"
import { afterEach, beforeEach, vi } from "vitest"

// Every service client logs through the document's one logger client, which would outlive each
// test's `chrome` stub below and keep posting later tests' lines into the first test's fake port
// (each line holding a timeout timer). A silent logger removes that; the tests that observe logger
// traffic `vi.unmock` this module and reset the shared client per test.
vi.mock("@/wallet/services/logger/client", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	documentLogger: () => ({ log: () => {} }),
}))

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

let ports = new PortRegistry()

export const emitPortMessage = (service: string, message: unknown) => ports.deliver(service, message)

/** Closes `service`'s port from the far end, as a service-worker restart does. */
export const emitPortDisconnect = (service: string) => ports.closeAll(service)

export const capturePortMessage = (service: string) => ports.sendMock(service)

export const emitMessage = (message: unknown) => {
	for (const listener of messageListeners) {
		listener(message)
	}
}

export const captureMessage = () => {
	return sendMessageMock
}

type Fn = (...args: unknown[]) => void

const messageListeners: Fn[] = []
const sendMessageMock = vi.fn()

beforeEach(() => {
	ports = new PortRegistry()
	vi.stubGlobal("chrome", {
		storage: {},
		runtime: {
			connect: vi.fn().mockImplementation(connectStub(ports)),
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
	messageListeners.splice(0)
	sendMessageMock.mockClear()
})
