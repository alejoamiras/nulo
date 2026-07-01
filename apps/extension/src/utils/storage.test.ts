import { SCHEMA_RUNNING_KEY } from "@nulo/wallet-core/migration"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { migrationIdle, storageLocalGet, storageLocalRemove, storageLocalSet } from "./storage"

type ChangeListener = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void

/** Install a controllable chrome.storage mock over the setup's empty stub. */
function installStorage(initial: Record<string, unknown>) {
	const data = { ...initial }
	const listeners: ChangeListener[] = []
	const get = vi.fn(async (keys?: string | string[]) => {
		if (keys === undefined || keys === null) return { ...data }
		const arr = Array.isArray(keys) ? keys : [keys]
		const out: Record<string, unknown> = {}
		for (const k of arr) if (k in data) out[k] = data[k]
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
		removeListener: (l: ChangeListener) => listeners.splice(listeners.indexOf(l), 1),
	}
	const fire = (changes: Record<string, { newValue?: unknown }>, area = "local") => {
		for (const l of [...listeners]) l(changes, area)
	}
	const clearRunning = () => {
		delete data[SCHEMA_RUNNING_KEY]
		fire({ [SCHEMA_RUNNING_KEY]: { newValue: undefined } })
	}
	return { data, get, set, remove, fire, clearRunning, listeners }
}

describe("migration-aware storage facade", () => {
	beforeEach(() => {
		// The shared setup stubs chrome.storage as {}; each test installs its own.
	})

	test("migrationIdle resolves immediately when no migration is running", async () => {
		const s = installStorage({})
		await expect(migrationIdle()).resolves.toBeUndefined()
		expect(s.listeners).toHaveLength(0) // fast path: no listener ever attached
	})

	test("accessors pass through when idle", async () => {
		const s = installStorage({ "nulo:ui:pref": 1 })
		expect(await storageLocalGet("nulo:ui:pref")).toEqual({ "nulo:ui:pref": 1 })
		await storageLocalSet({ "nulo:ui:other": 2 })
		expect(s.data["nulo:ui:other"]).toBe(2)
		await storageLocalRemove("nulo:ui:pref")
		expect("nulo:ui:pref" in s.data).toBe(false)
	})

	test("a write BLOCKS while a migration is running and completes once it clears", async () => {
		const s = installStorage({ [SCHEMA_RUNNING_KEY]: 2 })
		let done = false
		const p = storageLocalSet({ "nulo:ui:pref": 9 }).then(() => {
			done = true
		})
		await vi.waitFor(() => expect(s.listeners.length).toBeGreaterThan(0))
		expect(done).toBe(false)
		expect(s.set).not.toHaveBeenCalled() // nothing written mid-migration
		s.clearRunning()
		await p
		expect(done).toBe(true)
		expect(s.data["nulo:ui:pref"]).toBe(9)
	})

	test("a read BLOCKS while running, resolves after clear", async () => {
		const s = installStorage({ [SCHEMA_RUNNING_KEY]: 1, "nulo:ui:pref": "old" })
		const p = storageLocalGet("nulo:ui:pref")
		await vi.waitFor(() => expect(s.listeners.length).toBeGreaterThan(0))
		s.data["nulo:ui:pref"] = "new" // the migration transforms it
		s.clearRunning()
		expect(await p).toEqual({ "nulo:ui:pref": "new" }) // post-migration value
	})

	test("check-then-subscribe race: marker cleared between first read and listener attach", async () => {
		const s = installStorage({ [SCHEMA_RUNNING_KEY]: 1 })
		// First get() sees the marker; the re-check get() must see it gone and
		// resolve WITHOUT any onChanged event ever firing.
		let calls = 0
		s.get.mockImplementation(async (_keys?: string | string[]) => {
			calls++
			if (calls === 1) return { [SCHEMA_RUNNING_KEY]: 1 }
			return {}
		})
		await expect(migrationIdle()).resolves.toBeUndefined()
		expect(s.listeners).toHaveLength(0) // listener removed after the re-check
	})

	test("changes in OTHER areas or keys don't unblock", async () => {
		const s = installStorage({ [SCHEMA_RUNNING_KEY]: 1 })
		let done = false
		const p = migrationIdle().then(() => {
			done = true
		})
		await vi.waitFor(() => expect(s.listeners.length).toBeGreaterThan(0))
		s.fire({ "nulo:ui:pref": { newValue: 5 } }) // unrelated key
		s.fire({ [SCHEMA_RUNNING_KEY]: { newValue: undefined } }, "session") // wrong area
		await new Promise((r) => setTimeout(r, 0))
		expect(done).toBe(false)
		s.clearRunning()
		await p
		expect(done).toBe(true)
	})
})
