/**
 * BrowserApi implementation for tests. Wraps `@webext-core/fake-browser`'s
 * in-memory state machine and adapts its `webextension-polyfill` shape into
 * our port contracts.
 *
 * Not a free-form mock: storage behaves like real chrome.storage (persists
 * across reads, fires onChanged on writes, etc.). That catches integration
 * bugs a vi.mock'd stub would hide.
 *
 * Usage:
 *   import { FakeBrowserApi } from "@/core/testing"
 *   beforeEach(() => { api = new FakeBrowserApi(); api.reset() })
 *   const svc = new SomeService(api, ...)
 */

import { fakeBrowser } from "@webext-core/fake-browser"
import type {
	AlarmCreateOptions,
	AlarmEvent,
	AlarmsPort,
	BrowserApi,
	CreatedWindow,
	CreateWindowOptions,
	UpdateWindowOptions,
	WindowBounds,
	MessageListener,
	MessagePortLike,
	MessageSender,
	RuntimePort,
	StorageArea,
	StorageChanges,
	StorageEntries,
	StoragePort,
	Unsubscribe,
	WindowPort,
} from "../ports"
import { createListenerBag, type ListenerBag } from "./listener-bag"

// ── Storage ───────────────────────────────────────────────────────────

class FakeStorageAreaAdapter implements StorageArea {
	public constructor(private readonly area: "local" | "session") {}

	public async get(keys?: string | string[] | null): Promise<StorageEntries> {
		const target = fakeBrowser.storage[this.area]
		const raw = keys === null || keys === undefined ? await target.get() : await target.get(keys)

		// @webext-core/fake-browser follows webextension-polyfill's get() shape:
		// when a specific key is missing it returns `{ [key]: undefined }`.
		// Real chrome.storage returns `{}` for missing keys. EntityStorage and
		// several other consumers check `key in res` as an existence test, which
		// is true for `{ key: undefined }` — causing infinite loops in
		// "pick-a-free-id" retry patterns. Normalize to chrome's semantics.
		const result: StorageEntries = {}
		for (const [k, v] of Object.entries(raw)) {
			if (v !== undefined) result[k] = v
		}
		return result
	}

	public async set(entries: StorageEntries): Promise<void> {
		await fakeBrowser.storage[this.area].set(entries)
	}

	public async remove(keys: string | string[]): Promise<void> {
		await fakeBrowser.storage[this.area].remove(keys)
	}

	public async clear(): Promise<void> {
		await fakeBrowser.storage[this.area].clear()
	}

	public onChange(listener: (changes: StorageChanges) => void): Unsubscribe {
		const wrapped = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => {
			listener(changes as StorageChanges)
		}
		fakeBrowser.storage[this.area].onChanged.addListener(wrapped)
		return () => fakeBrowser.storage[this.area].onChanged.removeListener(wrapped)
	}
}

class FakeStorageAdapter implements StoragePort {
	public readonly local: StorageArea = new FakeStorageAreaAdapter("local")
	public readonly session: StorageArea = new FakeStorageAreaAdapter("session")
}

// ── Runtime ───────────────────────────────────────────────────────────
// fake-browser doesn't simulate chrome.runtime.connect / onConnect (long-lived
// ports). We ship a minimal in-memory port broker so popup↔SW tests can run.

interface PortRegistry {
	listeners: ListenerBag<(port: MessagePortLike) => void>
	ports: Map<string, MessagePortLike[]>
}

function newPortRegistry(): PortRegistry {
	return { listeners: createListenerBag(), ports: new Map() }
}

function linkedPortPair(name: string): { client: MessagePortLike; server: MessagePortLike } {
	const clientMsgListeners = createListenerBag<(msg: unknown) => void>()
	const serverMsgListeners = createListenerBag<(msg: unknown) => void>()
	const clientDisconnectListeners = createListenerBag<() => void>()
	const serverDisconnectListeners = createListenerBag<() => void>()
	let disconnected = false

	const disconnectBoth = () => {
		if (disconnected) return
		disconnected = true
		for (const l of clientDisconnectListeners.items) l()
		for (const l of serverDisconnectListeners.items) l()
	}

	const client: MessagePortLike = {
		name,
		postMessage: (m) => {
			if (!disconnected) for (const l of serverMsgListeners.items) l(m)
		},
		disconnect: disconnectBoth,
		onMessage: (l) => {
			clientMsgListeners.add(l)
			return () => clientMsgListeners.remove(l)
		},
		onDisconnect: (l) => {
			clientDisconnectListeners.add(l)
			return () => clientDisconnectListeners.remove(l)
		},
	}

	const server: MessagePortLike = {
		name,
		postMessage: (m) => {
			if (!disconnected) for (const l of clientMsgListeners.items) l(m)
		},
		disconnect: disconnectBoth,
		onMessage: (l) => {
			serverMsgListeners.add(l)
			return () => serverMsgListeners.remove(l)
		},
		onDisconnect: (l) => {
			serverDisconnectListeners.add(l)
			return () => serverDisconnectListeners.remove(l)
		},
	}

	return { client, server }
}

class FakeRuntimeAdapter implements RuntimePort {
	private readonly portRegistry: PortRegistry
	private lastErrorSlot: { message: string } | undefined

	public constructor(portRegistry: PortRegistry) {
		this.portRegistry = portRegistry
	}

	public async sendMessage(message: unknown): Promise<unknown> {
		return await fakeBrowser.runtime.sendMessage(message)
	}

	public onMessage(listener: MessageListener): Unsubscribe {
		const wrapped = (message: unknown, sender: { id?: string; origin?: string; url?: string; tab?: { id?: number; url?: string } }) => {
			return listener(message, sender as MessageSender)
		}
		fakeBrowser.runtime.onMessage.addListener(wrapped)
		return () => fakeBrowser.runtime.onMessage.removeListener(wrapped)
	}

	public connect(options: { name: string }): MessagePortLike {
		const pair = linkedPortPair(options.name)
		// Notify any onConnect listeners (in creation order).
		for (const l of this.portRegistry.listeners.items) l(pair.server)
		return pair.client
	}

	public onConnect(listener: (port: MessagePortLike) => void): Unsubscribe {
		this.portRegistry.listeners.add(listener)
		return () => this.portRegistry.listeners.remove(listener)
	}

	public getURL(path: string): string {
		return fakeBrowser.runtime.getURL(path)
	}

	public onInstalled(listener: (details: { reason: string; previousVersion?: string }) => void): Unsubscribe {
		const wrapped = (details: { reason: string; previousVersion?: string }) =>
			listener({ reason: details.reason, previousVersion: details.previousVersion })
		fakeBrowser.runtime.onInstalled.addListener(wrapped)
		return () => fakeBrowser.runtime.onInstalled.removeListener(wrapped)
	}

	public get lastError(): { message: string } | undefined {
		return this.lastErrorSlot
	}

	public async setUninstallURL(_url: string): Promise<void> {
		// No-op in tests.
	}
}

// ── Windows ───────────────────────────────────────────────────────────
// fake-browser doesn't ship a chrome.windows fake. Minimal in-memory impl.

class FakeWindowsAdapter implements WindowPort {
	private nextId = 1000
	private readonly live = new Set<number>()
	private readonly removedListeners = createListenerBag<(id: number) => void>()
	/** Test-only: every `create` call's options, in order. */
	public readonly creates: CreateWindowOptions[] = []
	/** Test-only: every `update` call, in order. */
	public readonly updates: Array<{ windowId: number; options: UpdateWindowOptions }> = []
	/** Test-only: what `getLastFocused` returns. */
	public lastFocused: WindowBounds | undefined

	public async create(options: CreateWindowOptions): Promise<CreatedWindow> {
		this.creates.push(options)
		const id = this.nextId++
		this.live.add(id)
		return { id }
	}

	public async update(windowId: number, options: UpdateWindowOptions): Promise<void> {
		if (!this.live.has(windowId)) throw new Error(`No window with id: ${windowId}.`)
		this.updates.push({ windowId, options })
	}

	public async getLastFocused(): Promise<WindowBounds | undefined> {
		return this.lastFocused
	}

	public onRemoved(listener: (windowId: number) => void): Unsubscribe {
		this.removedListeners.add(listener)
		return () => this.removedListeners.remove(listener)
	}

	public async remove(windowId: number): Promise<void> {
		if (this.live.delete(windowId)) {
			for (const l of this.removedListeners.items) l(windowId)
		}
	}

	/** Test-only: fire onRemoved for `windowId` as if the user closed it. */
	public closeByUser(windowId: number): void {
		if (this.live.delete(windowId)) {
			for (const l of this.removedListeners.items) l(windowId)
		}
	}

	public reset(): void {
		this.live.clear()
		this.removedListeners.items.length = 0
		this.creates.length = 0
		this.updates.length = 0
		this.lastFocused = undefined
	}
}

// ── Alarms ────────────────────────────────────────────────────────────

class FakeAlarmsAdapter implements AlarmsPort {
	public async create(name: string, options: AlarmCreateOptions): Promise<void> {
		await fakeBrowser.alarms.create(name, options)
	}

	public async clear(name: string): Promise<boolean> {
		return await fakeBrowser.alarms.clear(name)
	}

	public onAlarm(listener: (alarm: AlarmEvent) => void): Unsubscribe {
		const wrapped = (alarm: { name: string; scheduledTime: number }) =>
			listener({ name: alarm.name, scheduledTime: alarm.scheduledTime })
		fakeBrowser.alarms.onAlarm.addListener(wrapped)
		return () => fakeBrowser.alarms.onAlarm.removeListener(wrapped)
	}
}

// ── Composite ─────────────────────────────────────────────────────────

export class FakeBrowserApi implements BrowserApi {
	public readonly storage: StoragePort = new FakeStorageAdapter()
	public readonly runtime: RuntimePort
	public readonly windows: WindowPort = new FakeWindowsAdapter()
	public readonly alarms: AlarmsPort = new FakeAlarmsAdapter()

	private readonly portRegistry: PortRegistry = newPortRegistry()

	public constructor() {
		this.runtime = new FakeRuntimeAdapter(this.portRegistry)
	}

	/**
	 * Reset all in-memory state. Call from `beforeEach` to isolate tests.
	 */
	public reset(): void {
		fakeBrowser.reset()
		this.portRegistry.listeners.items.length = 0
		this.portRegistry.ports.clear()
		;(this.windows as FakeWindowsAdapter).reset()
	}
}
