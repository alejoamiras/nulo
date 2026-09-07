import { CLIENT_DISCONNECTED_MESSAGE } from "@nulo/extension-messaging/errors"
import { LogLevel } from "@nulo/wallet-core/logger"
import { getErrorData } from "@nulo/wallet-core/utils"
import { beforeEach, describe, expect, test, vi } from "vitest"

const log = vi.hoisted(() => vi.fn())
vi.mock("@/wallet/services/logger/client", () => ({
	LoggerServiceClient: class {
		public readonly log = log
		constructor(public readonly tag: string) {}
	},
}))

import { installConsoleForwarding } from "./console-forwarding"

type Hooks = Record<string, (...args: unknown[]) => void>

beforeEach(() => log.mockClear())

describe("installConsoleForwarding", () => {
	test("hooks every console method to the ui source at its mapped level, under the client tag", () => {
		const client = installConsoleForwarding("popup") as unknown as { tag: string }
		expect(client.tag).toBe("popup")
		const hooks = self as unknown as Hooks
		hooks.onwarn?.("careful", { n: 1 })
		hooks.ondebug?.("trace me")
		expect(log).toHaveBeenNthCalledWith(1, "ui", LogLevel.Warn, "careful", { n: 1 })
		expect(log).toHaveBeenNthCalledWith(2, "ui", LogLevel.Debug, "trace me")
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
