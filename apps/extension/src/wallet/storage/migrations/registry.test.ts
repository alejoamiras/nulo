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

	test("real migrations are CONTIGUOUS from the baseline (a gap means one was skipped or unregistered)", () => {
		// The e2e fixture's 9001 sentinel is excluded; real migrations must be
		// baseline+1, baseline+2, … — a jump (1 → 3) would boot existing users
		// past a transform their data still needs.
		const real = migrations.map((m) => m.version).filter((v) => v < 9000)
		real.forEach((v, i) => expect(v, `version gap before v${v}`).toBe(BASELINE_VERSION + 1 + i))
	})

	test("every NNN-*.ts migration file in this directory is actually registered", async () => {
		// An authored-but-unimported migration file passes every other check
		// while existing users silently skip its transform.
		const { readdirSync } = await import("node:fs")
		const { dirname, join } = await import("node:path")
		const { fileURLToPath } = await import("node:url")
		const here = dirname(fileURLToPath(import.meta.url))
		const files = readdirSync(join(here)).filter((f) => /^\d{3}-.*\.ts$/.test(f) && !f.endsWith(".test.ts"))
		const registered = new Set(migrations.map((m) => m.version))
		for (const f of files) {
			const v = Number.parseInt(f.slice(0, 3), 10)
			expect(registered.has(v), `${f} exists but version ${v} is not in the migrations array`).toBe(true)
		}
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
