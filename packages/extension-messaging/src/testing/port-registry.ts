/**
 * The `chrome.runtime.connect` fake every port-client test shares.
 *
 * It mirrors the parts of Chrome a client's lifecycle depends on: any number of ports may be open
 * under one name, a closed port throws on `postMessage`, a local `disconnect()` fires nothing, and
 * only the far end closing fires that one port's `onDisconnect`. Tests read counts off the
 * registry instead of relying on the fake to refuse a second port.
 */

import { type Mock, vi } from "vitest"
import { MessageType } from "../messages"
import { unwrapParams } from "../utils"

type Listener = (...args: unknown[]) => void

/** A request a client posted, as recorded by the registry. `params` are unwrapped. */
export interface PostedRequest {
	port: FakePort
	requestId: number
	method: string
	params: unknown[]
}

export interface PortRegistryOptions {
	/** `manual`: the test delivers responses itself. `microtask`: every request is answered with
	 *  `undefined` on its own port, one microtask after it was posted. */
	answer: "manual" | "microtask"
}

export class FakePort {
	public closed = false
	public readonly messageListeners = new Set<Listener>()
	public readonly disconnectListeners = new Set<Listener>()
	public readonly onMessage = {
		addListener: (l: Listener) => this.messageListeners.add(l),
		removeListener: (l: Listener) => this.messageListeners.delete(l),
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
		this.registry.post(this, message)
	}

	public disconnect(): void {
		this.closed = true
		this.registry.closedLocally(this)
	}
}

export class PortRegistry {
	public readonly live = new Map<string, Set<FakePort>>()
	/** Every port ever opened under a name, in order — live or not. */
	public readonly opened = new Map<string, FakePort[]>()
	/** Local `disconnect()` calls per name, including a client's own teardown after a remote close. */
	public readonly localDisconnects = new Map<string, number>()
	public readonly posted: PostedRequest[] = []
	public readonly answered: PostedRequest[] = []
	/** `microtask` mode only: while set, requests are recorded but not answered. */
	public hold = false

	private readonly sendMocks = new Map<string, Mock<Listener>>()

	public constructor(private readonly options: PortRegistryOptions = { answer: "manual" }) {}

	public open(name: string): FakePort {
		const port = new FakePort(name, this)
		// A name with no live port starts a fresh send mock, so call counts read per connection.
		if (!this.live.get(name)?.size) this.sendMocks.set(name, vi.fn())
		this.liveSet(name).add(port)
		this.opened.set(name, [...(this.opened.get(name) ?? []), port])
		return port
	}

	/**
	 * The `vi.fn` every port under `name` sends through. It receives the original envelope,
	 * synchronously, before anything is recorded — so `mockImplementationOnce(() => { throw … })`
	 * fails that send exactly as a torn-down port would.
	 */
	public sendMock(name: string): Mock<Listener> {
		const mock = this.sendMocks.get(name)
		if (!mock) throw new Error(`Port for '${name}' hasn't been opened`)
		return mock
	}

	public post(port: FakePort, message: unknown): void {
		this.sendMock(port.name)(message)
		const entry = toPostedRequest(port, message)
		this.posted.push(entry)
		if (this.options.answer === "microtask" && !this.hold) queueMicrotask(() => this.answer(entry))
	}

	/** Hands `message` to every live port under `name`. A broadcast: two live clients of one name
	 *  whose request ids collide cannot be told apart here — use the port's own listeners for that. */
	public deliver(name: string, message: unknown): void {
		for (const port of [...this.liveSet(name)]) {
			for (const listener of [...port.messageListeners]) listener(message)
		}
	}

	/** A service-worker restart, as the page sees it: the port closes and its `onDisconnect` fires. */
	public remoteClose(port: FakePort): void {
		port.closed = true
		this.live.get(port.name)?.delete(port)
		for (const listener of [...port.disconnectListeners]) listener()
	}

	/** Remote-closes the ports live when called. A client reconnects from inside its listener, so
	 *  the replacement it opens must not be visited. */
	public closeAll(name: string): void {
		for (const port of [...this.liveSet(name)]) this.remoteClose(port)
	}

	public closedLocally(port: FakePort): void {
		this.live.get(port.name)?.delete(port)
		this.localDisconnects.set(port.name, (this.localDisconnects.get(port.name) ?? 0) + 1)
	}

	public answerHeld(): void {
		for (const entry of this.posted) if (!this.answered.includes(entry)) this.answer(entry)
	}

	private answer(entry: PostedRequest): void {
		if (entry.port.closed) return
		this.answered.push(entry)
		const response = { type: MessageType.Response, content: { requestId: entry.requestId, result: undefined } }
		for (const listener of [...entry.port.messageListeners]) listener(response)
	}

	private liveSet(name: string): Set<FakePort> {
		let ports = this.live.get(name)
		if (!ports) {
			ports = new Set()
			this.live.set(name, ports)
		}
		return ports
	}
}

/** The `chrome.runtime.connect` implementation backed by `registry`. */
export const connectStub =
	(registry: PortRegistry) =>
	(_extensionId: unknown, options: { name: string }): FakePort =>
		registry.open(options.name)

function toPostedRequest(port: FakePort, message: unknown): PostedRequest {
	const envelope = message as { type?: unknown; content?: { requestId?: unknown; method?: unknown; params?: unknown } }
	const { requestId, method, params } = envelope?.content ?? {}
	if (envelope?.type !== MessageType.Request || typeof requestId !== "number" || typeof method !== "string") {
		throw new Error("PortRegistry: a client posted something that is not a request envelope")
	}
	return { port, requestId, method, params: unwrapParams(params as unknown[]) }
}
