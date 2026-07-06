import { vi } from "vitest"

type ChangeListener = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void

export interface ChromeStorageMock {
	data: Record<string, unknown>
	get: ReturnType<typeof vi.fn>
	set: ReturnType<typeof vi.fn>
	remove: ReturnType<typeof vi.fn>
	listeners: ChangeListener[]
	/** Fire a chrome.storage.onChanged event to every subscriber. */
	fire: (changes: Record<string, { newValue?: unknown }>, area?: string) => void
	/** Remove the running marker AND fire the corresponding change event. */
	clearRunning: (runningKey: string) => void
	/** Make the NEXT get() hang until `release()` is called (orders a stale
	 *  snapshot after a change event, for race tests). */
	deferNextGet: () => { release: () => void }
}

/** Install a controllable `chrome.storage.local` + `onChanged` mock over the
 *  vitest setup's empty `chrome.storage` stub. Shared by the facade, barrier,
 *  and any future storage-adjacent suites so the mock surface can't drift. */
export function installChromeStorage(initial: Record<string, unknown> = {}): ChromeStorageMock {
	const data: Record<string, unknown> = { ...initial }
	const listeners: ChangeListener[] = []
	let gate: Promise<void> | null = null
	let openGate: (() => void) | null = null

	const get = vi.fn(async (keys?: string | string[] | null) => {
		// Snapshot at CALL time, resolve after the gate: a deferred get returns
		// genuinely stale values, which is exactly the IPC race being simulated.
		const arr = keys === undefined || keys === null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys]
		const out: Record<string, unknown> = {}
		for (const k of arr) if (k in data) out[k] = data[k]
		if (gate) await gate
		return out
	})
	const set = vi.fn(async (items: Record<string, unknown>) => {
		Object.assign(data, items)
	})
	const remove = vi.fn(async (keys: string | string[]) => {
		for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]
	})

	// biome-ignore lint/suspicious/noExplicitAny: test override of the setup's chrome stub
	const c = chrome as any
	c.storage.local = { get, set, remove }
	c.storage.onChanged = {
		addListener: (l: ChangeListener) => listeners.push(l),
		removeListener: (l: ChangeListener) => {
			const i = listeners.indexOf(l)
			if (i >= 0) listeners.splice(i, 1)
		},
	}

	const fire = (changes: Record<string, { newValue?: unknown }>, area = "local") => {
		for (const [k, ch] of Object.entries(changes)) {
			if (ch.newValue === undefined) delete data[k]
			else data[k] = ch.newValue
		}
		for (const l of [...listeners]) l(changes, area)
	}
	return {
		data,
		get,
		set,
		remove,
		listeners,
		fire,
		clearRunning: (runningKey: string) => fire({ [runningKey]: { newValue: undefined } }),
		deferNextGet: () => {
			gate = new Promise<void>((r) => {
				openGate = r
			})
			return {
				release: () => {
					openGate?.()
					gate = null
				},
			}
		},
	}
}
