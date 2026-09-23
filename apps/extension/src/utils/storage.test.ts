import { SCHEMA_RUNNING_KEY } from "@nulo/wallet-core/migration"
import { describe, expect, test, vi } from "vitest"
import { installChromeStorage } from "../../tests/helpers/chrome-storage-mock"
import { migrationIdle, storageLocalGet, storageLocalRemove, storageLocalSet } from "./storage"

describe("migration-aware storage facade", () => {
	test("migrationIdle resolves immediately when no migration is running", async () => {
		const s = installChromeStorage({})
		await expect(migrationIdle()).resolves.toBeUndefined()
		expect(s.listeners).toHaveLength(0) // fast path: no listener ever attached
	})

	test("accessors pass through when idle", async () => {
		const s = installChromeStorage({ "nulo:ui:pref": 1 })
		expect(await storageLocalGet("nulo:ui:pref")).toEqual({ "nulo:ui:pref": 1 })
		await storageLocalSet({ "nulo:ui:other": 2 })
		expect(s.data["nulo:ui:other"]).toBe(2)
		await storageLocalRemove("nulo:ui:pref")
		expect("nulo:ui:pref" in s.data).toBe(false)
	})

	test("a write BLOCKS while a migration is running and completes once it clears", async () => {
		const s = installChromeStorage({ [SCHEMA_RUNNING_KEY]: 2 })
		let done = false
		const p = storageLocalSet({ "nulo:ui:pref": 9 }).then(() => {
			done = true
		})
		await vi.waitFor(() => expect(s.listeners.length).toBeGreaterThan(0))
		expect(done).toBe(false)
		expect(s.set).not.toHaveBeenCalled() // nothing written mid-migration
		s.clearRunning(SCHEMA_RUNNING_KEY)
		await p
		expect(done).toBe(true)
		expect(s.data["nulo:ui:pref"]).toBe(9)
	})

	test("a read BLOCKS while running, resolves after clear", async () => {
		const s = installChromeStorage({ [SCHEMA_RUNNING_KEY]: 1, "nulo:ui:pref": "old" })
		const p = storageLocalGet("nulo:ui:pref")
		await vi.waitFor(() => expect(s.listeners.length).toBeGreaterThan(0))
		s.data["nulo:ui:pref"] = "new" // the migration transforms it
		s.clearRunning(SCHEMA_RUNNING_KEY)
		expect(await p).toEqual({ "nulo:ui:pref": "new" }) // post-migration value
	})

	test("check-then-subscribe race: marker cleared between first read and listener attach", async () => {
		const s = installChromeStorage({ [SCHEMA_RUNNING_KEY]: 1 })
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

	test("(B-22) a rejecting re-check settles (rejects) instead of hanging forever", async () => {
		const s = installChromeStorage({ [SCHEMA_RUNNING_KEY]: 1 })
		// First get() sees the marker (migration running); the re-check get()
		// rejects transiently. Pre-fix that `.then` had no rejection handler, so
		// the outer promise never settled and every later UI storage access hung.
		let calls = 0
		s.get.mockImplementation(async (_keys?: string | string[] | null) => {
			calls++
			if (calls === 1) return { [SCHEMA_RUNNING_KEY]: 1 }
			throw new Error("storage unavailable")
		})
		await expect(migrationIdle()).rejects.toThrow("storage unavailable")
		expect(s.listeners).toHaveLength(0) // listener removed on the failed re-check
	})

	test("changes in OTHER areas or keys don't unblock", async () => {
		const s = installChromeStorage({ [SCHEMA_RUNNING_KEY]: 1 })
		let done = false
		const p = migrationIdle().then(() => {
			done = true
		})
		await vi.waitFor(() => expect(s.listeners.length).toBeGreaterThan(0))
		s.fire({ "nulo:ui:pref": { newValue: 5 } }) // unrelated key
		s.fire({ [SCHEMA_RUNNING_KEY]: { newValue: undefined } }, "session") // wrong area
		await new Promise((r) => setTimeout(r, 0))
		expect(done).toBe(false)
		s.clearRunning(SCHEMA_RUNNING_KEY)
		await p
		expect(done).toBe(true)
	})

	test("a guarded write consults `unless` AFTER the barrier, right before writing", async () => {
		const s = installChromeStorage({})
		let lapsed = false
		const gate = s.deferNextGet() // the barrier's own read, suspended
		const p = storageLocalSet({ "nulo:ui:pref": 1 }, { unless: () => lapsed })
		lapsed = true // the reason to write goes away while the facade waits
		gate.release()
		expect(await p).toBe(false)
		expect(s.set).not.toHaveBeenCalled()
	})

	test("a guarded write whose predicate stays false writes and reports true; the plain call is unchanged", async () => {
		const s = installChromeStorage({})
		expect(await storageLocalSet({ "nulo:ui:pref": 1 }, { unless: () => false })).toBe(true)
		expect(s.data["nulo:ui:pref"]).toBe(1)
		expect(await storageLocalSet({ "nulo:ui:pref": 2 })).toBe(true)
		expect(s.data["nulo:ui:pref"]).toBe(2)
	})
})
