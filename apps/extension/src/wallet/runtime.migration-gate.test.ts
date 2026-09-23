/**
 * The migration GATE against the REAL engine — the adopted (runtime-layer)
 * form of the audit's c3-1 proof: ambient SW wakes must not burn the durable
 * retry budget, and the terminalizing attempt must be gesture-initiated.
 *
 * `runtime.test.ts` file-wide-mocks the Migrator (its pins steer blocked-branch
 * classification), so this sibling keeps the engine real and mocks ONLY the
 * migration REGISTRY (a deliberately failing v1) plus Barretenberg. Every
 * scenario here ends inside the pre-registration boot zone — no service is
 * ever constructed. (The N-27 probe is post-registration and is therefore
 * out of this harness's reach — verified by inspection + smoke boots.)
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import type { BrowserApi, ClockPort } from "@nulo/wallet-core/ports"
import { defineMigration } from "@nulo/wallet-core/migration"
import type { LoggerStore } from "@/wallet/logger"

vi.mock("@aztec/bb.js", () => ({
	BarretenbergSync: { initSingleton: async () => ({}) },
}))

let upRuns = 0
vi.mock("./storage/migrations", async (importOriginal) => {
	const original = await importOriginal<Record<string, unknown>>()
	return {
		...original,
		migrations: [
			defineMigration({
				version: 1,
				description: "always fails (gate harness)",
				reads: [],
				writes: [],
				up: async () => {
					upRuns++
					throw new Error("transient boom")
				},
			}),
		],
	}
})

import { createWalletRuntime } from "./runtime"
import { SCHEMA_BLOCKED_KEY, SCHEMA_RETRY_REQUESTED_KEY, type MigrationBlockedStatus } from "./storage/migrations"
import type { ConfigStore } from "./config"

const noopLogger = { log: () => {} } as unknown as LoggerStore
const MIN = 60_000

function makeStorageArea() {
	const data = new Map<string, unknown>()
	let failNextGet = false
	let failSetKeyOnce: string | undefined
	return {
		data,
		armGetFailure: () => {
			failNextGet = true
		},
		armSetFailure: (key: string) => {
			failSetKeyOnce = key
		},
		get: async (keys?: string | string[]) => {
			if (failNextGet) {
				failNextGet = false
				throw new Error("injected gate read failure")
			}
			if (keys === undefined) return Object.fromEntries(data)
			const list = Array.isArray(keys) ? keys : [keys]
			return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]))
		},
		set: async (items: Record<string, unknown>) => {
			if (failSetKeyOnce && failSetKeyOnce in items) {
				failSetKeyOnce = undefined
				throw new Error("injected set failure")
			}
			for (const [k, v] of Object.entries(items)) data.set(k, v)
		},
		remove: async (keys: string | string[]) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k)
		},
	}
}

/** One durable store + clock across many fresh runtimes = many SW respawns. */
function makeWorld() {
	const local = makeStorageArea()
	local.data.set("nulo:schema:version", 0) // pre-max: the failing v1 is pending
	const world = { local, now: 0 }
	const boot = async (manifestVersion = "0.0.0-test") => {
		const browserApi = {
			runtime: { setUninstallURL: async () => {} },
			storage: { local, session: makeStorageArea() },
		} as unknown as BrowserApi
		const clock = { now: () => world.now, setInterval: () => 0, clearInterval: () => {} } as unknown as ClockPort
		const config = { load: vi.fn(async () => {}) } as unknown as ConfigStore
		const runtime = createWalletRuntime({ browserApi, clock, config, logger: noopLogger, manifestVersion })
		return runtime.start().then(
			() => "resolved" as const,
			(err: unknown) => String((err as Error).message),
		)
	}
	const blocked = () => local.data.get(SCHEMA_BLOCKED_KEY) as MigrationBlockedStatus | undefined
	return { world, local, boot, blocked }
}

beforeEach(() => {
	upRuns = 0
})

describe("migration gate — ambient wakes spend nothing (adopted c3-1 invariant)", () => {
	test("one engine run on the first wake; the next three ambient wakes short-circuit engineless", async () => {
		const { boot, blocked } = makeWorld()
		expect(await boot()).toMatch(/storage migration blocked/)
		expect(upRuns).toBe(1)
		expect(blocked()).toMatchObject({ terminal: false, backstopRuns: 0, gestureRuns: 0 })

		for (let i = 0; i < 3; i++) expect(await boot()).toMatch(/storage migration blocked/)
		expect(upRuns).toBe(1) // the audited invariant: wakes 2..4 burned nothing
		expect(blocked()).toMatchObject({ terminal: false })
	})

	test("pure-ambient traffic can NEVER terminalize: one backstop run, then frozen", async () => {
		const { world, boot, blocked } = makeWorld()
		await boot() // attempt 1
		world.now += 31 * MIN
		await boot() // the one autonomous backstop run → attempt 2
		expect(upRuns).toBe(2)
		expect(blocked()).toMatchObject({ terminal: false, backstopRuns: 1 })

		world.now += 31 * MIN
		await boot() // backstop spent → short-circuit
		world.now += 24 * 60 * MIN
		await boot()
		expect(upRuns).toBe(2) // frozen forever without a gesture
		expect(blocked()).toMatchObject({ terminal: false })
	})

	test("the terminalizing attempt is the GESTURE: retry key consumed, runs once, terminal only then", async () => {
		const { world, local, boot, blocked } = makeWorld()
		await boot() // 1
		world.now += 31 * MIN
		await boot() // backstop → 2
		local.data.set(SCHEMA_RETRY_REQUESTED_KEY, { requestedAt: world.now })
		await boot() // gesture → 3 → terminal
		expect(upRuns).toBe(3)
		expect(local.data.has(SCHEMA_RETRY_REQUESTED_KEY)).toBe(false) // consumed
		expect(blocked()).toMatchObject({ terminal: true, gestureRuns: 1 })

		await boot() // terminal: engineless short-circuit
		expect(upRuns).toBe(3)
	})

	test("a spent gesture disables the backstop (the user owns the remaining budget)", async () => {
		const { world, local, boot, blocked } = makeWorld()
		await boot() // 1
		local.data.set(SCHEMA_RETRY_REQUESTED_KEY, { requestedAt: 0 })
		await boot() // gesture → 2
		expect(blocked()).toMatchObject({ gestureRuns: 1, backstopRuns: 0 })

		world.now += 31 * MIN
		await boot() // would-be backstop: disabled by the gesture
		expect(upRuns).toBe(2)
	})

	test("a manifest-version change voids even a terminal verdict and re-runs once", async () => {
		const { world, local, boot, blocked } = makeWorld()
		await boot()
		world.now += 31 * MIN
		await boot()
		local.data.set(SCHEMA_RETRY_REQUESTED_KEY, { requestedAt: world.now })
		await boot()
		expect(blocked()).toMatchObject({ terminal: true })

		await boot("0.0.1-next") // update shipped: verdict void, engine runs
		expect(upRuns).toBe(4)
		expect(blocked()).toMatchObject({ terminal: false, atExtensionVersion: "0.0.1-next", backstopRuns: 0, gestureRuns: 0 })
	})

	test("a gesture spent on a FREE failure (nothing recorded) re-arms the token", async () => {
		const { local, boot } = makeWorld()
		await boot() // attempt 1 → blocked, gestureRuns 0
		local.data.set(SCHEMA_RETRY_REQUESTED_KEY, { requestedAt: 0 })
		// The gesture-authorized run dies BEFORE any counted work: the engine's
		// journal-arming write throws → run()'s outer catch → spentAttempt:false.
		local.armSetFailure("nulo:schema:running")
		await boot()
		expect(upRuns).toBe(1) // up never executed — a genuinely free failure
		// The tap must not be stranded (gestureRuns > 0 disables the backstop):
		// the token is re-armed, and the next ambient wake retries under it.
		expect(local.data.has(SCHEMA_RETRY_REQUESTED_KEY)).toBe(true)
		await boot()
		expect(upRuns).toBe(2)
	})

	test("a gate read failure fails CLOSED — no engine run this boot", async () => {
		const { local, boot } = makeWorld()
		await boot()
		local.armGetFailure()
		expect(await boot()).toMatch(/migration gate unreadable/)
		expect(upRuns).toBe(1)
	})

	test("an undecodable blocked blob is treated as absent — the engine runs and rewrites a valid status", async () => {
		const { local, boot, blocked } = makeWorld()
		local.data.set(SCHEMA_BLOCKED_KEY, { garbage: true })
		await boot()
		expect(upRuns).toBe(1)
		expect(blocked()).toMatchObject({ terminal: false, atExtensionVersion: "0.0.0-test" })
	})

	test("a malformed timestamp cannot void a valid same-version terminal verdict", async () => {
		const { local, boot } = makeWorld()
		local.data.set(SCHEMA_BLOCKED_KEY, {
			kind: "failed",
			detail: "x",
			terminal: true,
			atExtensionVersion: "0.0.0-test",
			lastAttemptAt: Number.NaN,
			backstopRuns: "junk",
			gestureRuns: 0,
		})
		expect(await boot()).toMatch(/storage migration blocked/)
		expect(upRuns).toBe(0) // terminal gated engineless despite the malformed fields
	})
})
