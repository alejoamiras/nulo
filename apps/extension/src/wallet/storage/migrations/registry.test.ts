import { Migrator, RESERVED_KEYS, SCHEMA_VERSION_KEY } from "@nulo/wallet-core/migration"
import { describe, expect, test } from "vitest"
import { BASELINE_VERSION, migrations } from "./index"

/** Minimal in-memory store for structural registry checks. */
function memStore() {
	const data = new Map<string, unknown>()
	return {
		data,
		async get(keys?: string | string[]) {
			if (keys === undefined) return Object.fromEntries(data)
			const arr = Array.isArray(keys) ? keys : [keys]
			const out: Record<string, unknown> = {}
			for (const k of arr) if (data.has(k)) out[k] = data.get(k)
			return out
		},
		async set(items: Record<string, unknown>) {
			for (const [k, v] of Object.entries(items)) data.set(k, v)
		},
		async remove(keys: string | string[]) {
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k)
		},
	}
}

/** Structural invariants over the REAL registry — every migration that ever
 *  lands here is checked, so a non-idempotent or mis-versioned entry fails the
 *  unit gate the moment it's registered. (Empty registry ⇒ vacuously green.) */
describe("migrations registry (structural)", () => {
	test("versions are unique, ascending, and above the baseline", () => {
		const versions = migrations.map((m) => m.version)
		expect(versions).toEqual([...versions].sort((a, b) => a - b))
		expect(new Set(versions).size).toBe(versions.length)
		for (const v of versions) expect(v).toBeGreaterThan(BASELINE_VERSION)
	})

	test("every registered migration declares a footprint", () => {
		for (const m of migrations) {
			expect(m.reads.length + m.writes.length, `migration ${m.version} declares no refs`).toBeGreaterThan(0)
		}
	})

	// Empty-store double-runs catch structural non-idempotency only; a row
	// transform can pass vacuously here. Every REAL migration must ship its own
	// colocated test with seeded pre-shape fixtures (see template.ts step 6) —
	// this is the safety net, not the proof.
	test("every registered migration is idempotent (run twice ≡ once) from an empty store", async () => {
		for (const m of migrations) {
			const store = memStore()
			await store.set({ [SCHEMA_VERSION_KEY]: m.version - 1 })
			await new Migrator({ store, migrations: [m] }).run()
			const nonReserved = () => JSON.stringify(Object.fromEntries([...store.data].filter(([k]) => !RESERVED_KEYS.includes(k))))
			const once = nonReserved()
			await store.set({ [SCHEMA_VERSION_KEY]: m.version - 1 })
			await new Migrator({ store, migrations: [m] }).run()
			expect(nonReserved(), `migration ${m.version} is not idempotent`).toBe(once)
		}
	})
})
