import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { SCAN_EPISODES_KEY, ScanEpisodeStore, parseStoredEpisode, scanEpisodeKey, scanEpisodeNetworkPrefix } from "./scan-episodes"
import { BACKOFF_CAP_MS } from "./scan-health"

const MIN = 60_000
const NOW = 1_000 * MIN
const KEY = scanEpisodeKey("p1", "n1", "0xc")
const N1 = scanEpisodeNetworkPrefix("p1", "n1")

let api: FakeBrowserApi
const stored = async () => (await api.storage.session.get(SCAN_EPISODES_KEY))[SCAN_EPISODES_KEY]
const makeStore = (onError = vi.fn()) => new ScanEpisodeStore(api.storage.session, onError)

beforeEach(() => {
	api = new FakeBrowserApi()
	api.reset()
})

describe("parseStoredEpisode", () => {
	test("a valid episode passes through", () => {
		const episode = { failures: 3, failingSince: NOW - MIN, nextAttemptAt: NOW + MIN }
		expect(parseStoredEpisode(episode, NOW)).toEqual(episode)
	})

	test.each([
		["not an object", 7],
		["null", null],
		["failures not an integer", { failures: 1.5, failingSince: NOW, nextAttemptAt: 0 }],
		["failures negative", { failures: -1, failingSince: NOW, nextAttemptAt: 0 }],
		["failures zero", { failures: 0, failingSince: NOW, nextAttemptAt: 0 }],
		["failures a string", { failures: "2", failingSince: NOW, nextAttemptAt: 0 }],
		["failingSince in the future", { failures: 2, failingSince: NOW + 1, nextAttemptAt: 0 }],
		["failingSince not finite", { failures: 2, failingSince: Number.NaN, nextAttemptAt: 0 }],
		["failingSince missing", { failures: 2, nextAttemptAt: 0 }],
	])("an untrustworthy streak is dropped: %s", (_label, raw) => {
		expect(parseStoredEpisode(raw, NOW)).toBeUndefined()
	})

	test("a bad gate is repaired without touching the streak: invalid → due now, far future → the backoff cap", () => {
		const streak = { failures: 4, failingSince: NOW - 20 * MIN }
		expect(parseStoredEpisode({ ...streak, nextAttemptAt: "soon" }, NOW)).toEqual({ ...streak, nextAttemptAt: 0 })
		expect(parseStoredEpisode({ ...streak, nextAttemptAt: NOW + 1_000 * MIN }, NOW)).toEqual({
			...streak,
			nextAttemptAt: NOW + BACKOFF_CAP_MS,
		})
	})
})

describe("ScanEpisodeStore", () => {
	test("a failure opens an episode; later failures extend the streak and the backoff, never the start", async () => {
		const store = makeStore()
		store.record(KEY, "failed", NOW)
		store.record(KEY, "no-progress", NOW + MIN)
		await store.settled()

		expect(await stored()).toEqual({ [KEY]: { failures: 2, failingSince: NOW, nextAttemptAt: NOW + MIN + 60_000 } })
		expect(store.isBackingOff(KEY, NOW + MIN + 59_999)).toBe(true)
		expect(store.isBackingOff(KEY, NOW + MIN + 60_000)).toBe(false)
	})

	test.each(["progress", "idle-at-tip", "ineligible"] as const)("%s ends the episode and removes the stored blob", async (outcome) => {
		const store = makeStore()
		store.record(KEY, "failed", NOW)
		store.record(KEY, outcome, NOW + MIN)
		await store.settled()

		expect(store.has(KEY)).toBe(false)
		expect(await stored()).toBeUndefined()
	})

	test("a restart mid-backoff keeps the streak, the start and the future gate", async () => {
		const first = makeStore()
		first.record(KEY, "failed", NOW)
		first.record(KEY, "failed", NOW + MIN)
		await first.settled()

		const restarted = makeStore()
		await restarted.hydrate(NOW + MIN + 1)

		expect(restarted.isBackingOff(KEY, NOW + MIN + 1)).toBe(true)
		restarted.record(KEY, "failed", NOW + 3 * MIN)
		await restarted.settled()
		expect(await stored()).toMatchObject({ [KEY]: { failures: 3, failingSince: NOW } })
	})

	test("hydrate keeps valid entries, drops hostile ones, and ignores a blob that is not a plain object", async () => {
		const good = { failures: 2, failingSince: NOW - MIN, nextAttemptAt: 0 }
		await api.storage.session.set({ [SCAN_EPISODES_KEY]: { [KEY]: good, "p1|n1|0xbad": { failures: "many" } } })
		const store = makeStore()
		await store.hydrate(NOW)
		expect(store.has(KEY)).toBe(true)
		expect(store.has("p1|n1|0xbad")).toBe(false)

		await api.storage.session.set({ [SCAN_EPISODES_KEY]: ["not", "a", "map"] })
		const other = makeStore()
		await other.hydrate(NOW)
		expect(other.has(KEY)).toBe(false)
	})

	test("health: stalled needs two failures and more than ten minutes; since is the oldest stalled start", () => {
		const store = makeStore()
		const other = scanEpisodeKey("p1", "n1", "0xd")
		store.record(KEY, "failed", NOW)
		store.record(other, "failed", NOW + MIN)
		expect(store.health(N1, NOW + 11 * MIN)).toEqual({ stalled: false, since: null })

		store.record(KEY, "failed", NOW + 2 * MIN)
		store.record(other, "failed", NOW + 3 * MIN)
		expect(store.health(N1, NOW + 10 * MIN)).toEqual({ stalled: false, since: null })
		expect(store.health(N1, NOW + 12 * MIN)).toEqual({ stalled: true, since: NOW })
	})

	test("two profiles sharing a network, and two networks of one profile, do not cross-talk", () => {
		const store = makeStore()
		store.record(scanEpisodeKey("p2", "n1", "0xc"), "failed", NOW)
		store.record(scanEpisodeKey("p2", "n1", "0xc"), "failed", NOW + MIN)
		store.record(scanEpisodeKey("p1", "n2", "0xc"), "failed", NOW)
		store.record(scanEpisodeKey("p1", "n2", "0xc"), "failed", NOW + MIN)

		expect(store.health(N1, NOW + 60 * MIN)).toEqual({ stalled: false, since: null })
		expect(store.health(scanEpisodeNetworkPrefix("p2", "n1"), NOW + 60 * MIN).stalled).toBe(true)
	})

	test("clearRetryGate opens the gate for its prefix only and keeps the streak", async () => {
		const store = makeStore()
		const foreign = scanEpisodeKey("p1", "n2", "0xc")
		store.record(KEY, "failed", NOW)
		store.record(foreign, "failed", NOW)
		store.clearRetryGate(N1)
		await store.settled()

		expect(store.isBackingOff(KEY, NOW)).toBe(false)
		expect(store.isBackingOff(foreign, NOW)).toBe(true)
		expect(await stored()).toMatchObject({ [KEY]: { failures: 1, failingSince: NOW, nextAttemptAt: 0 } })
	})

	test("a removal queued after a write always wins: the stored blob converges on memory", async () => {
		const store = makeStore()
		store.record(KEY, "failed", NOW)
		store.deleteWhere(() => true)
		await store.settled()
		expect(await stored()).toBeUndefined()
	})

	test("a storage failure is reported and never thrown; memory keeps working", async () => {
		const onError = vi.fn()
		const area = { ...api.storage.session, get: api.storage.session.get, set: vi.fn().mockRejectedValue(new Error("quota")) }
		const store = new ScanEpisodeStore(area as never, onError)
		store.record(KEY, "failed", NOW)
		await store.settled()

		expect(onError).toHaveBeenCalledTimes(1)
		expect(store.has(KEY)).toBe(true)
	})
})
