import { describe, expect, test } from "vitest"
import type { ConfigProp } from "./config"
import { ConfigStore } from "./store"

/**
 * Seed an in-memory `chrome.storage.local` with `stored` (or empty), then the
 * ConfigStore reads/writes through it. The shared vitest setup stubs `chrome`
 * with a non-functional `storage: {}`; we install a real `.local` per test
 * (before `new ConfigStore()`, which captures `chrome.storage.local`).
 */
function withStored(stored: Record<string, unknown> | undefined): void {
	const mem: Record<string, string> = {}
	if (stored !== undefined) mem["nulo:config"] = JSON.stringify(stored)
	;(chrome.storage as { local: unknown }).local = {
		get: async (key: string) => (key in mem ? { [key]: mem[key] } : {}),
		set: async (obj: Record<string, string>) => {
			Object.assign(mem, obj)
		},
	}
}

describe("ConfigStore — persisted-value validation (Q-20)", () => {
	test("ignores an out-of-domain stored value, applies valid overrides", async () => {
		withStored({ theme: "bogus", sidePanel: true })
		const store = new ConfigStore()
		await store.load()
		expect(store.get("theme")).toBe("system") // 'bogus' rejected → default kept
		expect(store.get("sidePanel")).toBe(true) // valid override applied
	})

	test("applies + emits a persisted defaultExplorer:null (the prior typeof check wrongly rejected it)", async () => {
		withStored({ defaultExplorer: null })
		const store = new ConfigStore()
		const emitted: ConfigProp[] = []
		store.onUpdate.add((p) => emitted.push(p))
		await store.load()
		expect(store.get("defaultExplorer")).toBe(null)
		expect(emitted.some((e) => e.key === "defaultExplorer" && e.value === null)).toBe(true)
	})

	test("a corrupted stored strictSecurityMode string cannot flip the security default", async () => {
		withStored({ strictSecurityMode: "false" })
		const store = new ConfigStore()
		await store.load()
		expect(store.get("strictSecurityMode")).toBe(true) // string rejected → default true kept
	})

	test("set() throws on an out-of-domain value and does not mutate", async () => {
		withStored(undefined)
		const store = new ConfigStore()
		await store.load()
		await expect(store.set("theme", "bogus" as never)).rejects.toThrow(/Invalid config value/)
		expect(store.get("theme")).toBe("system")
	})

	test("set() persists + emits a valid value", async () => {
		withStored(undefined)
		const store = new ConfigStore()
		const emitted: ConfigProp[] = []
		store.onUpdate.add((p) => emitted.push(p))
		await store.set("theme", "dark")
		expect(store.get("theme")).toBe("dark")
		expect(emitted).toContainEqual({ key: "theme", value: "dark" })
	})
})

describe("ConfigStore — apply/set serialization", () => {
	test("a set() racing reset()'s parked persist is not clobbered in storage", async () => {
		// Manufacture the interleave: park reset()'s final persist (the first
		// storage write after this test arms), fire a concurrent set(), then
		// release the park. An unlocked apply persists its pre-set snapshot
		// AFTER set()'s write, leaving storage stale; the shared lock instead
		// queues set() behind the whole apply, so the fresher value lands last.
		const mem: Record<string, string> = {}
		let parked: (() => void) | null = null
		let armed = false
		;(chrome.storage as { local: unknown }).local = {
			get: async (key: string) => (key in mem ? { [key]: mem[key] } : {}),
			set: async (obj: Record<string, string>) => {
				if (armed && parked === null) {
					await new Promise<void>((resolve) => {
						parked = resolve
					})
				}
				Object.assign(mem, obj)
			},
		}
		const store = new ConfigStore()
		await store.load()
		await store.set("theme", "dark")

		armed = true
		const resetRun = store.reset()
		// Let reset reach its parked persist before firing the racing set.
		await new Promise((resolve) => setTimeout(resolve, 0))
		const setRun = store.set("theme", "light")
		await new Promise((resolve) => setTimeout(resolve, 0))
		parked?.()
		await Promise.all([resetRun, setRun])

		expect(store.get("theme")).toBe("light")
		expect(JSON.parse(mem["nulo:config"]).theme).toBe("light")
	})
})
