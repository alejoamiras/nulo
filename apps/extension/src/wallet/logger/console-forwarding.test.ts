import { CLIENT_DISCONNECTED_MESSAGE } from "@nulo/extension-messaging/errors"
import { consoleMethods, LogLevel } from "@nulo/wallet-core/logger"
import { getErrorData } from "@nulo/wallet-core/utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const log = vi.hoisted(() => vi.fn())
vi.mock("@/wallet/services/logger/client", () => ({
	LoggerServiceClient: class {
		public readonly log = log
		constructor(public readonly tag: string) {}
	},
}))

import { installConsoleForwarding } from "./console-forwarding"

type Hooks = Record<string, (...args: unknown[]) => void>

const hookNames = [...consoleMethods.map(([method]) => `on${method}`), "onunhandledrejection"]
let installed: Array<[string, unknown]> = []
beforeEach(() => {
	log.mockClear()
	installed = hookNames.map((name) => [name, (self as unknown as Hooks)[name]])
})
afterEach(() => {
	for (const [name, value] of installed) (self as unknown as Record<string, unknown>)[name] = value
})

describe("installConsoleForwarding", () => {
	test("hooks all six console methods to the ui source at their mapped levels, under the client tag", () => {
		const client = installConsoleForwarding("popup") as unknown as { tag: string }
		expect(client.tag).toBe("popup")
		const hooks = self as unknown as Hooks
		for (const [method, level] of consoleMethods) {
			log.mockClear()
			hooks[`on${method}`]?.(`via ${method}`, { n: 1 })
			expect(log).toHaveBeenCalledTimes(1)
			expect(log).toHaveBeenCalledWith("ui", level, `via ${method}`, { n: 1 })
		}
	})

	test("(BUG PIN) the error hook lands on window.onerror, so a script error is logged with the handler's raw arguments", () => {
		// The entry files always wrote `self.onerror` for console.error; preserved verbatim in the extraction.
		installConsoleForwarding("popup")
		;(self as unknown as Hooks).onerror?.("Uncaught boom", "popup.js", 3, 7)
		expect(log).toHaveBeenCalledWith("ui", LogLevel.Error, "Uncaught boom", "popup.js", 3, 7)
	})

	test("a client-disconnect rejection logs at debug, anything else at error, both as error data", () => {
		installConsoleForwarding("onboarding")
		const disconnect = new Error(CLIENT_DISCONNECTED_MESSAGE)
		const other = new Error("boom")
		self.onunhandledrejection?.({ reason: disconnect } as PromiseRejectionEvent)
		self.onunhandledrejection?.({ reason: other } as PromiseRejectionEvent)
		expect(log).toHaveBeenNthCalledWith(1, "ui", LogLevel.Debug, getErrorData(disconnect))
		expect(log).toHaveBeenNthCalledWith(2, "ui", LogLevel.Error, getErrorData(other))
	})
})
