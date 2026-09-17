import { CLIENT_DISCONNECTED_MESSAGE } from "@nulo/extension-messaging/errors"
import { connectStub, PortRegistry } from "@nulo/extension-messaging/testing"
import { LogLevel } from "@nulo/wallet-core/logger"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { AccountServiceClient } from "@/wallet/services/account/client"
import { ConfigServiceClient } from "@/wallet/services/config/client"
import { ContactServiceClient } from "@/wallet/services/contact/client"
import { NetworkServiceClient } from "@/wallet/services/network/client"
import { ProfileServiceClient } from "@/wallet/services/profile/client"
import { _resetDocumentLoggerForTests, type DocumentLogContext, documentLogger } from "./client"
import { LOGGER_SERVICE_NAME } from "./spec"

vi.unmock("@/wallet/services/logger/client")

/**
 * Counts the `logger` ports a document holds. Every service client logs through the document's
 * logger; a logger that each client builds for itself leaks one port per client, because
 * `ServiceClient.disconnect()` closes the client's own port and never the logger's. The counts
 * come from a registry of its own, in answering mode: every request is answered on its own port,
 * so a line only settles if the port it went out on is still the live one.
 */

let registry: PortRegistry

beforeEach(() => {
	_resetDocumentLoggerForTests()
	registry = new PortRegistry({ answer: "microtask" })
	;(chrome.runtime.connect as ReturnType<typeof vi.fn>).mockImplementation(connectStub(registry))
})

const drain = () => new Promise((resolve) => setTimeout(resolve, 0))
const loggerPorts = () => ({
	live: registry.live.get(LOGGER_SERVICE_NAME)?.size ?? 0,
	opened: registry.opened.get(LOGGER_SERVICE_NAME)?.length ?? 0,
	localDisconnects: registry.localDisconnects.get(LOGGER_SERVICE_NAME) ?? 0,
})
/** The `[context, source, level, message]` of every logger line, in wire order. */
const lines = () => {
	const posted = registry.posted.filter((p) => p.port.name === LOGGER_SERVICE_NAME)
	for (const entry of posted) expect(entry.method).toBe("log")
	return posted.map((p) => p.params)
}

function expectOneLoggerPort(): void {
	const opened = registry.opened.get(LOGGER_SERVICE_NAME) ?? []
	expect(loggerPorts()).toEqual({ live: 1, opened: 1, localDisconnects: 0 })
	expect(new Set(opened).size).toBe(1)
	for (const entry of registry.posted) expect(entry.port).toBe(opened[0])
}

function expectSettled(): void {
	expect(registry.answered.length).toBe(registry.posted.length)
}

describe("logger ports per document", () => {
	test("S1: five service clients share one logger port", async () => {
		const clients = [
			new ConfigServiceClient(),
			new ProfileServiceClient(),
			new ContactServiceClient(),
			new NetworkServiceClient(),
			new AccountServiceClient(),
		]
		for (const client of clients) await client.connect()
		await drain()

		expect(lines()).toEqual(
			clients.map((c) => [undefined, (c as unknown as { clientName: string }).clientName, LogLevel.Debug, "Connected"]),
		)
		expectSettled()
		expectOneLoggerPort()
	})

	test("S2: fifty connect/disconnect cycles leave one logger port and no service port", async () => {
		for (let i = 0; i < 50; i++) {
			const client = new ConfigServiceClient()
			await client.connect()
			client.disconnect()
		}
		await drain()

		const messages = lines().map((l) => l[3])
		expect(messages).toHaveLength(100)
		expect(messages.filter((m) => m === "Connected")).toHaveLength(50)
		expect(messages.filter((m) => m === "Disconnected")).toHaveLength(50)
		expect(registry.live.get("config")?.size ?? 0).toBe(0)
		expect(registry.localDisconnects.get("config")).toBe(50)
		expectSettled()
		expectOneLoggerPort()
	})

	test("S3: a service-worker restart rejects the pending line and opens exactly one replacement port", async () => {
		const logger = documentLogger("popup")
		registry.hold = true
		// `ILogger.log` is typed `void`; the view returns the request promise so a test can hold it.
		const pending = logger.log("ui", LogLevel.Info, "in flight") as unknown as Promise<void>
		const [first] = registry.opened.get(LOGGER_SERVICE_NAME) ?? []
		expect(first).toBeDefined()

		registry.remoteClose(first)
		await expect(pending).rejects.toThrow(CLIENT_DISCONNECTED_MESSAGE)

		registry.hold = false
		logger.log("ui", LogLevel.Info, "after restart")
		await drain()

		const opened = registry.opened.get(LOGGER_SERVICE_NAME) ?? []
		expect(opened).toHaveLength(2)
		expect(loggerPorts()).toMatchObject({ live: 1 })
		expect(registry.answered.map((a) => [a.port, a.params[3]])).toEqual([[opened[1], "after restart"]])
	})

	test("S4: every context tags its lines on the one port; the reset opens a new one", async () => {
		const contexts: Array<DocumentLogContext | undefined> = ["popup", "onboarding", "offscreen", undefined]
		for (const context of contexts) documentLogger(context).log("ui", LogLevel.Info, `from ${context}`)
		await drain()

		expect(lines()).toEqual(contexts.map((context) => [context, "ui", LogLevel.Info, `from ${context}`]))
		expectSettled()
		expectOneLoggerPort()

		_resetDocumentLoggerForTests()
		documentLogger("popup").log("ui", LogLevel.Info, "second generation")
		await drain()
		expect(loggerPorts()).toMatchObject({ live: 2, opened: 2 })
	})
})
