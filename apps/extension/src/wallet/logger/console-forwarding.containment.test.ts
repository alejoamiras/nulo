import { RpcConnectError } from "@nulo/extension-messaging/errors"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { LogLevel } from "@/wallet/logger"
import { _resetDocumentLoggerForTests, documentLogger } from "@/wallet/services/logger/client"
import { installConsoleForwarding } from "./console-forwarding"

vi.unmock("@/wallet/services/logger/client")

/**
 * The page's rejection handler logs through the document logger. On a page whose port cannot open
 * every line rejects, so an unobserved line would reach the handler, which logs, which rejects —
 * without yielding, for the life of the page. The runtime never fires jsdom's
 * `onunhandledrejection`, so the process-level event is bridged to it the way a browser would;
 * the bridge stops forwarding after a few turns so a regression fails here instead of hanging.
 */

const BRIDGED_TURNS = 3
const unhandled = vi.fn()
const bridge = (reason: unknown) => {
	unhandled(reason)
	if (unhandled.mock.calls.length > BRIDGED_TURNS) return
	self.onunhandledrejection?.({ reason, preventDefault: () => {} } as unknown as PromiseRejectionEvent)
}
const drain = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
	_resetDocumentLoggerForTests()
	unhandled.mockClear()
	process.on("unhandledRejection", bridge)
})
afterEach(() => {
	process.off("unhandledRejection", bridge)
	self.onunhandledrejection = null
})

test("a log line that cannot be sent never feeds the rejection handler that logs through it", async () => {
	const connect = chrome.runtime.connect as unknown as ReturnType<typeof vi.fn>
	connect.mockImplementation(() => {
		throw new Error("Extension context invalidated.")
	})
	installConsoleForwarding("popup")

	const line = documentLogger("popup").log("ui", LogLevel.Error, "boom") as unknown as Promise<void>
	for (let turn = 0; turn < 3; turn++) await drain()

	expect(unhandled).not.toHaveBeenCalled()
	expect(connect).toHaveBeenCalledTimes(1)
	// Asserted only now: observing the line earlier would itself mark it handled.
	await expect(line).rejects.toBeInstanceOf(RpcConnectError)
})
