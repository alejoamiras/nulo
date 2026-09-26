/**
 * Real-Chrome implementation of BrowserApi. Wraps chrome.{storage, runtime,
 * windows, alarms}. Tests substitute FakeBrowserApi (see src/core/testing/).
 *
 * Notes on MV3 semantics carried through:
 *
 * 1. chrome.runtime.lastError is only meaningful inside a callback. The
 *    RuntimePort.lastError getter reflects the current value at read time;
 *    adapters don't cache it.
 * 2. chrome.storage.local.onChanged / .session.onChanged are area-specific
 *    listeners; we use those instead of the global onChanged so consumers
 *    only see changes in their area.
 * 3. chrome.alarms requires the "alarms" permission in the manifest.
 *    Instantiation is fine without it; method calls will throw.
 * 4. chrome.windows works without a permission declaration.
 */

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
	RuntimePort,
	StorageArea,
	StorageChanges,
	StorageEntries,
	StoragePort,
	Unsubscribe,
	WindowPort,
} from "@nulo/wallet-core/ports"

class ChromeStorageAreaAdapter implements StorageArea {
	public constructor(private readonly area: chrome.storage.StorageArea) {}

	public async get(keys: string | string[] | null): Promise<StorageEntries> {
		// chrome.storage.StorageArea.get's type overloads don't include
		// `null` for "all entries" in every @types/chrome release; call with
		// no args instead when requesting everything.
		const area = this.area as unknown as { get(k?: string | string[]): Promise<StorageEntries> }
		return keys === null ? await area.get() : await area.get(keys)
	}

	public async set(entries: StorageEntries): Promise<void> {
		await this.area.set(entries)
	}

	public async remove(keys: string | string[]): Promise<void> {
		await this.area.remove(keys)
	}

	public async clear(): Promise<void> {
		await this.area.clear()
	}

	public onChange(listener: (changes: StorageChanges) => void): Unsubscribe {
		const wrapped = (changes: { [key: string]: chrome.storage.StorageChange }) => {
			listener(changes as StorageChanges)
		}
		this.area.onChanged.addListener(wrapped)
		return () => this.area.onChanged.removeListener(wrapped)
	}
}

class ChromeStorageAdapter implements StoragePort {
	public readonly local: StorageArea = new ChromeStorageAreaAdapter(chrome.storage.local)
	public readonly session: StorageArea = new ChromeStorageAreaAdapter(chrome.storage.session)
}

function adaptPort(port: chrome.runtime.Port): MessagePortLike {
	return {
		name: port.name,
		postMessage: (message) => port.postMessage(message),
		disconnect: () => port.disconnect(),
		onMessage: (listener) => {
			const wrapped = (msg: unknown) => listener(msg)
			port.onMessage.addListener(wrapped)
			return () => port.onMessage.removeListener(wrapped)
		},
		onDisconnect: (listener) => {
			port.onDisconnect.addListener(listener)
			return () => port.onDisconnect.removeListener(listener)
		},
	}
}

class ChromeRuntimeAdapter implements RuntimePort {
	public async sendMessage(message: unknown): Promise<unknown> {
		return await chrome.runtime.sendMessage(message)
	}

	public onMessage(listener: MessageListener): Unsubscribe {
		const wrapped = (
			message: unknown,
			sender: chrome.runtime.MessageSender,
			sendResponse: (response: unknown) => void,
		): boolean | undefined => {
			const result = listener(message, sender)
			if (result instanceof Promise) {
				result.then(sendResponse).catch(() => sendResponse(undefined))
				return true
			}
			sendResponse(result)
			return undefined
		}
		chrome.runtime.onMessage.addListener(wrapped)
		return () => chrome.runtime.onMessage.removeListener(wrapped)
	}

	public connect(options: { name: string }): MessagePortLike {
		// @types/chrome version disagreement on connect() overloads across versions.
		const connect = chrome.runtime.connect as unknown as (opts: { name: string }) => chrome.runtime.Port
		return adaptPort(connect(options))
	}

	public onConnect(listener: (port: MessagePortLike) => void): Unsubscribe {
		const wrapped = (port: chrome.runtime.Port) => listener(adaptPort(port))
		chrome.runtime.onConnect.addListener(wrapped)
		return () => chrome.runtime.onConnect.removeListener(wrapped)
	}

	public getURL(path: string): string {
		return chrome.runtime.getURL(path)
	}

	public onInstalled(listener: (details: { reason: string; previousVersion?: string }) => void): Unsubscribe {
		const wrapped = (details: { reason: string; previousVersion?: string }) =>
			listener({ reason: details.reason, previousVersion: details.previousVersion })
		chrome.runtime.onInstalled.addListener(wrapped)
		return () => chrome.runtime.onInstalled.removeListener(wrapped)
	}

	public get lastError(): { message: string } | undefined {
		const err = (chrome.runtime as unknown as { lastError?: { message?: string } }).lastError
		if (!err) return undefined
		return { message: err.message ?? "unknown error" }
	}

	public async setUninstallURL(url: string): Promise<void> {
		await chrome.runtime.setUninstallURL(url)
	}

	public async getContexts(filter: {
		contextTypes?: string[]
		documentUrls?: string[]
	}): Promise<Array<{ contextId: string; contextType: string; documentUrl?: string }>> {
		// chrome.runtime.getContexts is MV3 / Chrome 116+; we rely on it for
		// offscreen supervision. The runtime.d.ts type is looser than ours.
		type GetContextsFn = (f: unknown) => Promise<Array<{ contextId: string; contextType: string; documentUrl?: string }>>
		const runtime = chrome.runtime as unknown as { getContexts?: GetContextsFn }
		if (!runtime.getContexts) {
			throw new Error("chrome.runtime.getContexts is unavailable; Chrome 116+ required")
		}
		return await runtime.getContexts(filter)
	}
}

function boundsOf(win: chrome.windows.Window | undefined): WindowBounds | undefined {
	const { left, top, width, height } = win ?? {}
	if ([left, top, width, height].some((n) => typeof n !== "number")) return undefined
	return { left, top, width, height }
}

class ChromeWindowsAdapter implements WindowPort {
	/** The newest normal-window observation; `seq` orders observations by when they started. */
	private lastNormal: { id: number; seq: number } | undefined
	private seq = 0
	private readonly pendingFocusLookups = new Set<Promise<void>>()
	private trackerChecked = false

	public async create(options: CreateWindowOptions): Promise<CreatedWindow> {
		const created = await chrome.windows.create(options)
		return { id: created?.id }
	}

	public onRemoved(listener: (windowId: number) => void): Unsubscribe {
		// @types/chrome for chrome.windows.onRemoved.addListener signature
		// varies across releases; the runtime API is (callback[, filter]).
		const onRemoved = chrome.windows.onRemoved as unknown as {
			addListener(cb: (windowId: number) => void): void
			removeListener(cb: (windowId: number) => void): void
		}
		onRemoved.addListener(listener)
		return () => onRemoved.removeListener(listener)
	}

	public async remove(windowId: number): Promise<void> {
		await chrome.windows.remove(windowId)
	}

	public async update(windowId: number, options: UpdateWindowOptions): Promise<void> {
		await chrome.windows.update(windowId, options)
	}

	public async getLastFocused(): Promise<WindowBounds | undefined> {
		try {
			this.trackFocusOnFirefox()
			const seq = ++this.seq
			// `normal` only: anchoring on another approval popup would stack popups
			// on top of each other instead of on the dApp's window.
			const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
			if (win?.type === "normal") {
				this.recordNormal(win.id, seq)
				return boundsOf(win)
			}
			// A snapshot: focus events received from here on must not extend the wait.
			await Promise.all([...this.pendingFocusLookups])
			if (!this.lastNormal) return undefined
			const remembered = await chrome.windows.get(this.lastNormal.id)
			return remembered.type === "normal" ? boundsOf(remembered) : undefined
		} catch {
			return undefined
		}
	}

	/** Firefox ignores `windowTypes` and can answer with an approval popup, so the adapter tracks
	 *  normal-window focus there itself. Added on first use and only on Firefox: Chrome keeps every
	 *  listener a service worker adds as a wake-up, and Firefox persists only those added at startup. */
	private trackFocusOnFirefox(): void {
		if (this.trackerChecked) return
		this.trackerChecked = true
		if (typeof (chrome.runtime as { getBrowserInfo?: unknown }).getBrowserInfo !== "function") return
		chrome.windows.onFocusChanged.addListener((windowId) => {
			if (windowId === chrome.windows.WINDOW_ID_NONE) return
			const seq = ++this.seq
			const lookup = chrome.windows.get(windowId).then(
				(win) => {
					if (win.type === "normal") this.recordNormal(win.id, seq)
				},
				() => undefined,
			)
			this.pendingFocusLookups.add(lookup)
			void lookup.then(() => this.pendingFocusLookups.delete(lookup))
		})
	}

	private recordNormal(id: number | undefined, seq: number): void {
		if (id === undefined || (this.lastNormal && this.lastNormal.seq > seq)) return
		this.lastNormal = { id, seq }
	}
}

class ChromeAlarmsAdapter implements AlarmsPort {
	public async create(name: string, options: AlarmCreateOptions): Promise<void> {
		await chrome.alarms.create(name, options)
	}

	public async clear(name: string): Promise<boolean> {
		return await chrome.alarms.clear(name)
	}

	public onAlarm(listener: (alarm: AlarmEvent) => void): Unsubscribe {
		const wrapped = (alarm: chrome.alarms.Alarm) => listener({ name: alarm.name, scheduledTime: alarm.scheduledTime })
		chrome.alarms.onAlarm.addListener(wrapped)
		return () => chrome.alarms.onAlarm.removeListener(wrapped)
	}
}

export class RealChromeBrowserApi implements BrowserApi {
	public readonly storage: StoragePort = new ChromeStorageAdapter()
	public readonly runtime: RuntimePort = new ChromeRuntimeAdapter()
	public readonly windows: WindowPort = new ChromeWindowsAdapter()
	public readonly alarms: AlarmsPort = new ChromeAlarmsAdapter()
}
