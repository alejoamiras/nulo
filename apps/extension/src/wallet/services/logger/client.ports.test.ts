import { CLIENT_DISCONNECTED_MESSAGE } from "@nulo/extension-messaging/errors"
import { MessageType } from "@nulo/extension-messaging/messages"
import { unwrapParams } from "@nulo/extension-messaging/utils"
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
 * `ServiceClient.disconnect()` closes the client's own port and never the logger's. The global
 * port double cannot count (it refuses a second same-name port), so this file replaces
 * `chrome.runtime.connect` with a stub that mirrors Chrome: a closed port throws on `postMessage`,
 * only the far end's `onDisconnect` fires, and every request is answered on its own port.
 */

type Listener = (...args: unknown[]) => void
type Envelope = { type: MessageType; content: { requestId: number; method: string; params: unknown } }
type Posted = { port: FakePort; requestId: number; method: string; params: unknown[] }

class FakePort {
	public closed = false
	public readonly message = new Set<Listener>()
	public readonly disconnectListeners = new Set<Listener>()
	public readonly onMessage = {
		addListener: (l: Listener) => this.message.add(l),
		removeListener: (l: Listener) => this.message.delete(l),
	}
	public readonly onDisconnect = {
		addListener: (l: Listener) => this.disconnectListeners.add(l),
		removeListener: (l: Listener) => this.disconnectListeners.delete(l),
	}

	public constructor(
		public readonly name: string,
		private readonly registry: PortRegistry,
	) {}

	public postMessage(message: unknown): void {
		if (this.closed) throw new Error("Attempting to use a disconnected port object")
		this.registry.post(this, message as Envelope)
	}

	public disconnect(): void {
		this.closed = true
		this.registry.closedLocally(this)
	}
}

class PortRegistry {
	public readonly live = new Map<string, Set<FakePort>>()
	public readonly opened = new Map<string, FakePort[]>()
	public readonly localDisconnects = new Map<string, number>()
	public readonly posted: Posted[] = []
	public readonly answered: Posted[] = []
	public hold = false

	public open(name: string): FakePort {
		const port = new FakePort(name, this)
		this.bucket(this.live, name).add(port)
		this.bucket(this.opened, name).push(port)
		return port
	}

	public post(port: FakePort, envelope: Envelope): void {
		expect(envelope.type).toBe(MessageType.Request)
		expect(typeof envelope.content.requestId).toBe("number")
		expect(envelope.content.method).toBe("log")
		const entry = {
			port,
			requestId: envelope.content.requestId,
			method: envelope.content.method,
			params: unwrapParams(envelope.content.params as unknown[]),
		}
		this.posted.push(entry)
		if (!this.hold) queueMicrotask(() => this.answer(entry))
	}

	/** A service-worker restart, as the page sees it: the port closes and its `onDisconnect` fires. */
	public remoteClose(port: FakePort): void {
		port.closed = true
		this.live.get(port.name)?.delete(port)
		for (const listener of [...port.disconnectListeners]) listener()
	}

	public closedLocally(port: FakePort): void {
		this.live.get(port.name)?.delete(port)
		this.localDisconnects.set(port.name, (this.localDisconnects.get(port.name) ?? 0) + 1)
	}

	public answerHeld(): void {
		for (const entry of this.posted) if (!this.answered.includes(entry)) this.answer(entry)
	}

	private answer(entry: Posted): void {
		if (entry.port.closed) return
		this.answered.push(entry)
		const response = { type: MessageType.Response, content: { requestId: entry.requestId, result: undefined } }
		for (const listener of [...entry.port.message]) listener(response)
	}

	private bucket<T>(map: Map<string, T>, name: string): T {
		let value = map.get(name)
		if (!value) {
			value = (map === this.live ? new Set() : []) as T
			map.set(name, value)
		}
		return value
	}
}

let registry: PortRegistry

beforeEach(() => {
	_resetDocumentLoggerForTests()
	registry = new PortRegistry()
	;(chrome.runtime.connect as ReturnType<typeof vi.fn>).mockImplementation((_: unknown, options: { name: string }) =>
		registry.open(options.name),
	)
})

const drain = () => new Promise((resolve) => setTimeout(resolve, 0))
const loggerPorts = () => ({
	live: registry.live.get(LOGGER_SERVICE_NAME)?.size ?? 0,
	opened: registry.opened.get(LOGGER_SERVICE_NAME)?.length ?? 0,
	localDisconnects: registry.localDisconnects.get(LOGGER_SERVICE_NAME) ?? 0,
})
/** The `[context, source, level, message]` of every logger line, in wire order. */
const lines = () => registry.posted.filter((p) => p.port.name === LOGGER_SERVICE_NAME).map((p) => p.params)

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
