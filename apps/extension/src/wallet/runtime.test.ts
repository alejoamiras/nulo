/**
 * Prove-first pins for `createWalletRuntime().start()`'s single-flight
 * contract. The first two pins were RED against the `started`-boolean latch:
 *
 *  (a) a concurrent second `start()` void-resolved IMMEDIATELY while the first
 *      boot was still in flight — the price-alarm shim's
 *      `start().then(() => services.get(PriceService))` then raced a
 *      not-yet-registered service and lost the tick;
 *  (b) after a FAILED boot, `started` stayed latched true — every later
 *      `start()` void-resolved against a half-booted runtime and no retry
 *      ever happened for the SW's remaining lifetime.
 *
 * The remaining pins came out of the mid-tier audit (codex + fable): a
 * Barretenberg failure vetoes retry (upstream initSingleton memoizes its
 * REJECTED promise) and cannot cause an overlapping re-run even while config
 * still pends; EVERY migration-blocked outcome vetoes retry (the engine's
 * durable attempt budget is next-boot-cadenced); the genuinely-retryable
 * representative is a transient storage write.
 *
 * Every pin stays inside the PRE-REGISTRATION boot zone — no service is ever
 * constructed.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { BrowserApi, ClockPort } from "@nulo/wallet-core/ports"
import type { LoggerStore } from "@/wallet/logger"

let bbImpl: () => Promise<unknown>
vi.mock("@aztec/bb.js", () => ({
	BarretenbergSync: {
		initSingleton: (..._args: unknown[]) => bbImpl(),
	},
}))

// Swappable migration outcome; `migratorRuns` counts engine invocations. The
// real engine is exercised by its own package tests — these pins only need to
// steer the runtime's blocked-branch classification.
let migratorImpl: () => Promise<unknown>
let migratorRuns = 0
vi.mock("@nulo/wallet-core/migration", async (importOriginal) => ({
	...(await importOriginal<object>()),
	Migrator: class {
		run() {
			migratorRuns++
			return migratorImpl()
		}
	},
}))

import { createWalletRuntime } from "./runtime"
import type { ConfigStore } from "./config"

// `applyRetentionPolicy` is on the boot path (chained off `config.load()`), so the fake must carry
// it or every start() test dies on an unrelated TypeError.
const noopLogger = { log: () => {}, applyRetentionPolicy: async () => {} } as unknown as LoggerStore

/** Minimal chrome.storage-shaped area backed by a Map — enough for the
 *  schema-status writes. */
function makeStorageArea() {
	const data = new Map<string, unknown>()
	return {
		get: async (keys?: string | string[]) => {
			if (keys === undefined) return Object.fromEntries(data)
			const list = Array.isArray(keys) ? keys : [keys]
			return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]))
		},
		set: async (items: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(items)) data.set(k, v)
		},
		remove: async (keys: string | string[]) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k)
		},
	}
}

function makeDeps() {
	const browserApi = {
		runtime: { setUninstallURL: async () => {} },
		storage: { local: makeStorageArea(), session: makeStorageArea() },
	} as unknown as BrowserApi
	const clock = {
		now: () => 0,
		setInterval: () => 0,
		clearInterval: () => {},
	} as unknown as ClockPort
	const configLoad = vi.fn(async () => {})
	const config = { load: configLoad } as unknown as ConfigStore
	return { deps: { browserApi, clock, config, logger: noopLogger, manifestVersion: "0.0.0-test" }, configLoad }
}

const tick = () => new Promise((r) => setTimeout(r, 10))

beforeEach(() => {
	bbImpl = async () => ({})
	migratorImpl = async () => ({ kind: "noop", version: 1 })
	migratorRuns = 0
})

afterEach(() => {
	vi.clearAllMocks()
})

describe("runtime.start() single-flight contract", () => {
	test("a concurrent second start() awaits the SAME in-flight boot (no resolve-before-ready)", async () => {
		let releaseBb!: () => void
		bbImpl = () => new Promise((r) => (releaseBb = () => r({})))
		void releaseBb // never released — the boot stays in flight for the whole test
		const runtime = createWalletRuntime(makeDeps().deps)

		const p1 = runtime.start()
		p1.catch(() => {})
		await tick()
		const p2 = runtime.start()
		p2.catch(() => {})

		// The second caller must still be PENDING while the boot is in flight —
		// resolving now is exactly the lost-price-tick race.
		const outcome = await Promise.race([p2.then(() => "settled"), tick().then(() => "pending")])
		expect(outcome).toBe("pending")
	})

	test("a failed pre-registration boot permits a real retry (no permanent latch)", async () => {
		// The genuinely-retryable representative: a transient schema-status
		// storage write. (config.load's apply() write can also reject and is
		// equally retryable; BB and migration-blocked failures are
		// veto-classified below.)
		const { deps, configLoad } = makeDeps()
		const removeMock = vi.fn().mockRejectedValue(new Error("storage transient"))
		;(deps.browserApi.storage.local as { remove: unknown }).remove = removeMock
		const runtime = createWalletRuntime(deps)

		await expect(runtime.start()).rejects.toThrow("storage transient")
		expect(migratorRuns).toBe(1)

		// The second call must RE-ATTEMPT the boot (and surface its outcome),
		// not void-resolve against the half-booted runtime.
		await expect(runtime.start()).rejects.toThrow("storage transient")
		expect(migratorRuns).toBe(2)
		// The failure precedes config/BB — neither leg ever ran.
		expect(configLoad).not.toHaveBeenCalled()
	})

	test("a fast BB rejection with config still pending: memo KEPT, no overlapping re-run", async () => {
		bbImpl = () => Promise.reject(new Error("bb down"))
		const { deps, configLoad } = makeDeps()
		configLoad.mockImplementation(() => new Promise(() => {})) // config never settles
		const runtime = createWalletRuntime(deps)

		// Promise.all rejects fast (no silent forever-pending boot)…
		await expect(runtime.start()).rejects.toThrow("bb down")
		// …and the BB veto keeps the memo, so a second start() joins the SAME
		// rejection instead of re-running migration/config concurrently with
		// the first attempt's still-pending config leg.
		await expect(runtime.start()).rejects.toThrow("bb down")
		expect(migratorRuns).toBe(1)
		expect(configLoad).toHaveBeenCalledTimes(1)
	})

	test("a Barretenberg failure vetoes retry — the rejection is memoized for the SW lifetime", async () => {
		let bbCalls = 0
		bbImpl = () => {
			bbCalls++
			return Promise.reject(new Error("bb down"))
		}
		const runtime = createWalletRuntime(makeDeps().deps)

		await expect(runtime.start()).rejects.toThrow("bb down")
		// Upstream initSingleton memoizes its rejected promise — a retry could
		// only re-observe the same error, so the memo must be KEPT.
		await expect(runtime.start()).rejects.toThrow("bb down")
		expect(bbCalls).toBe(1)
		expect(migratorRuns).toBe(1)
	})

	test("EVERY migration-blocked outcome vetoes retry — the engine's durable attempt budget is next-boot-cadenced", async () => {
		// The budget-burner variant: failed+breaking with attempts still below
		// max. An in-lifetime retry loop (the surviving price alarm) would bump
		// the durable counter every 3 minutes and flip a recoverable block to
		// terminal without a single real boot — so even NON-terminal blocks
		// keep the memo.
		migratorImpl = async () => ({ kind: "failed", version: 1, breaking: true, reason: "boom", attempts: 1, terminal: false })
		const runtime = createWalletRuntime(makeDeps().deps)
		await expect(runtime.start()).rejects.toThrow("storage migration blocked")
		await expect(runtime.start()).rejects.toThrow("storage migration blocked")
		expect(migratorRuns).toBe(1)

		// Same for a retryable needs-recovery: its retry cadence is the NEXT
		// BOOT (SW respawn), never an in-lifetime loop.
		migratorRuns = 0
		migratorImpl = async () => ({ kind: "needs-recovery", reason: "transient", retryable: true })
		const runtime2 = createWalletRuntime(makeDeps().deps)
		await expect(runtime2.start()).rejects.toThrow("storage migration blocked")
		await expect(runtime2.start()).rejects.toThrow("storage migration blocked")
		expect(migratorRuns).toBe(1)
	})
})
