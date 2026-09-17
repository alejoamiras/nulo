/**
 * `TokenSeeder`'s read model and recovery paths: status derivation over hostile
 * markers, the latched `ensureSeeding` kick, the self-scheduled continuation
 * (incl. resuming in a fresh instance — a restarted service worker), the fenced
 * `retry`, and the change-only status event.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { fakeBrowser } from "@webext-core/fake-browser"
import { LogLevel } from "@nulo/wallet-core/logger"
import { PinMismatchError, SEED_ATTEMPT_CAP, type SeedPreview, deriveSeedStatus } from "./seeder"
import { CHAIN_ID, CONTRACT, KEY, SEED, disposeSeeders, goodPreview, makeSeeder, readMarker, writeMarker } from "./seeder.harness"

const VERSION = "1.0.0"
const rpcDown = () =>
	vi.fn(async (): Promise<SeedPreview> => {
		throw new Error("rpc down")
	})
const fakeClock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
const entriesOf = async (seeder: { getStatus(): Promise<{ entries: { status: string }[] }> }) => (await seeder.getStatus()).entries
const statusOf = async (seeder: Parameters<typeof entriesOf>[0]) => (await entriesOf(seeder)).map((e) => e.status)

/** A preview that stays pending until `release` is called. */
function heldPreview() {
	let release: (value: SeedPreview | Error) => void = () => {}
	const preview = vi.fn(
		() =>
			new Promise<SeedPreview>((resolve, reject) => {
				release = (value) => (value instanceof Error ? reject(value) : resolve(value))
			}),
	)
	return { preview, release: (value: SeedPreview | Error) => release(value) }
}

beforeEach(async () => {
	await fakeBrowser.reset()
})

afterEach(() => {
	disposeSeeders()
	vi.useRealTimers()
})

describe("seed status — derivation", () => {
	test("maps each marker shape; the capping attempt reads `seeding`, not `failed`, while it runs", () => {
		expect(deriveSeedStatus({ attempts: 0 }, VERSION, false)).toBe("pending")
		expect(deriveSeedStatus({ attempts: 2, nextAttemptAt: 5 }, VERSION, false)).toBe("pending")
		expect(deriveSeedStatus({ attempts: 1 }, VERSION, true)).toBe("seeding")
		expect(deriveSeedStatus({ attempts: SEED_ATTEMPT_CAP, cappedAtVersion: VERSION }, VERSION, true)).toBe("seeding")
		expect(deriveSeedStatus({ attempts: SEED_ATTEMPT_CAP, cappedAtVersion: VERSION }, VERSION, false)).toBe("failed")
		expect(deriveSeedStatus({ attempts: SEED_ATTEMPT_CAP, cappedAtVersion: "0.9.0" }, VERSION, false)).toBe("pending")
		expect(deriveSeedStatus({ attempts: 1, rejectedAtVersion: VERSION }, VERSION, true)).toBe("rejected")
		expect(deriveSeedStatus({ attempts: 1, rejectedAtVersion: "0.9.0" }, VERSION, false)).toBe("pending")
		expect(deriveSeedStatus({ attempts: 1, outcome: "seeded" }, VERSION, false)).toBeUndefined()
		expect(deriveSeedStatus({ attempts: 0, outcome: "deleted" }, VERSION, false)).toBeUndefined()
	})

	test("getStatus carries the compiled-in literals and omits settled defaults", async () => {
		const { seeder } = makeSeeder()
		expect(await entriesOf(seeder)).toEqual([
			{ chainId: CHAIN_ID, contract: CONTRACT, symbol: "cUSD", displayName: "Compressed USD", status: "pending" },
		])
		await seeder.run()
		expect(await entriesOf(seeder)).toEqual([])
	})

	test("hostile marker fields drop the entry (→ pending) — except a tombstone, which always survives", async () => {
		const { seeder } = makeSeeder()
		const hostile = [
			{ attempts: -1, cappedAtVersion: VERSION },
			{ attempts: 3.5, cappedAtVersion: VERSION },
			{ attempts: Number.MAX_VALUE * 10, cappedAtVersion: VERSION },
			{ attempts: 3, cappedAtVersion: 7 },
			{ attempts: 1, rejectedAtVersion: {} },
			{ attempts: 3, cappedAtVersion: VERSION, outcome: "bogus" },
			{ attempts: 1, nextAttemptAt: "soon" },
		]
		for (const entry of hostile) {
			await writeMarker({ [KEY]: entry })
			expect(await statusOf(seeder)).toEqual(["pending"])
		}
		await writeMarker({ [KEY]: { attempts: "junk", nextAttemptAt: -5, outcome: "deleted" } })
		expect(await entriesOf(seeder)).toEqual([])
	})

	test("a far-future nextAttemptAt reads as due now: a fresh service worker's resume alone recovers it", async () => {
		fakeClock()
		const { seeder, deps } = makeSeeder()
		await writeMarker({ [KEY]: { attempts: 1, nextAttemptAt: Date.now() + 10 * 365 * 86_400_000 } })
		await seeder.resume()
		await vi.advanceTimersByTimeAsync(1_000)
		await vi.waitFor(() => expect(deps.persist).toHaveBeenCalledTimes(1))
	})

	test("the snapshot names the scope it was read for, and none without an active profile", async () => {
		const { seeder } = makeSeeder()
		expect((await seeder.getStatus()).scope).toEqual({ profileId: "p1", chainId: CHAIN_ID })
		// The caller may name a chain the active network has not followed to yet.
		expect(await seeder.getStatus(CHAIN_ID + 1)).toEqual({ scope: { profileId: "p1", chainId: CHAIN_ID + 1 }, entries: [] })
		expect((await seeder.getStatus(CHAIN_ID)).entries).toHaveLength(1)
		const locked = makeSeeder({ getActiveProfile: vi.fn(async () => undefined) })
		expect(await locked.seeder.getStatus()).toEqual({ scope: undefined, entries: [] })
	})

	test("reading never starts, retries or records anything", async () => {
		const { seeder, deps } = makeSeeder({ preview: rpcDown() })
		for (let i = 0; i < 5; i++) await seeder.getStatus()
		expect(deps.preview).not.toHaveBeenCalled()
		expect(await readMarker()).toEqual({})
	})
})

describe("ensureSeeding — latched recovery kick", () => {
	test("two consumers start ONE pass, and a later call in the same lifetime starts none", async () => {
		const { seeder, deps } = makeSeeder({ preview: rpcDown() })
		await Promise.all([seeder.ensureSeeding(), seeder.ensureSeeding()])
		await vi.waitFor(() => expect(deps.preview).toHaveBeenCalledTimes(1))
		await vi.waitFor(async () => expect((await readMarker())[KEY].attempts).toBe(1))
		await seeder.ensureSeeding()
		expect(deps.preview).toHaveBeenCalledTimes(1)
	})

	test("zero accounts: no pass and no latch — the kick still works once an account exists", async () => {
		const accounts: { address: string }[] = []
		const { seeder, deps } = makeSeeder({ getAccounts: vi.fn(async () => accounts) })
		await seeder.ensureSeeding()
		expect(deps.isTokenPresent).not.toHaveBeenCalled()
		accounts.push({ address: "0xacc1" })
		await seeder.ensureSeeding()
		await vi.waitFor(() => expect(deps.persist).toHaveBeenCalledTimes(1))
	})

	test("does nothing while a pass is in flight, and nothing when no default is pending", async () => {
		const held = heldPreview()
		const { seeder } = makeSeeder({ preview: held.preview })
		const pass = seeder.run()
		await vi.waitFor(() => expect(held.preview).toHaveBeenCalledTimes(1))
		await seeder.ensureSeeding()
		held.release(goodPreview())
		await pass
		await seeder.ensureSeeding()
		expect(held.preview).toHaveBeenCalledTimes(1)
	})
})

describe("continuation — a failed attempt retries by itself", () => {
	test("node down: 15 s, then 60 s, then `failed` — never stranded at pending, never past the cap", async () => {
		fakeClock()
		const { seeder, deps } = makeSeeder({ preview: rpcDown() })
		await seeder.run()
		expect(await statusOf(seeder)).toEqual(["pending"])
		expect((await readMarker())[KEY].nextAttemptAt).toBe(Date.now() + 15_000)

		await vi.advanceTimersByTimeAsync(14_000)
		expect(deps.preview).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(deps.preview).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(60_000)
		expect(deps.preview).toHaveBeenCalledTimes(SEED_ATTEMPT_CAP)
		expect(await statusOf(seeder)).toEqual(["failed"])
		expect((await readMarker())[KEY].nextAttemptAt).toBeUndefined()

		await vi.advanceTimersByTimeAsync(600_000)
		expect(deps.preview).toHaveBeenCalledTimes(SEED_ATTEMPT_CAP)
	})

	test("a trigger inside the wait does not spend an attempt; the status event's refetch never does", async () => {
		fakeClock()
		const { seeder, deps } = makeSeeder({ preview: rpcDown() })
		vi.mocked(deps.onStatusChanged).mockImplementation(() => void seeder.getStatus())
		await seeder.run()
		await seeder.run()
		await seeder.run()
		expect(deps.preview).toHaveBeenCalledTimes(1)
		expect((await readMarker())[KEY].attempts).toBe(1)
	})

	test("a restarted service worker resumes the persisted retry exactly once", async () => {
		fakeClock()
		const dead = makeSeeder({ preview: rpcDown() })
		await dead.seeder.run()
		dead.seeder.dispose()

		const fresh = makeSeeder({ preview: rpcDown() })
		// Boot fires the resume AND a session-restore trigger; together they must attempt once.
		await Promise.all([fresh.seeder.resume(), fresh.seeder.run()])
		expect(fresh.deps.preview).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(15_000)
		expect(fresh.deps.preview).toHaveBeenCalledTimes(1)
		expect((await readMarker())[KEY].attempts).toBe(2)
	})

	test("an attempt cut short by a dead service worker left its retry time behind", async () => {
		fakeClock()
		const held = heldPreview()
		const dead = makeSeeder({ preview: held.preview })
		void dead.seeder.run()
		await vi.waitFor(() => expect(held.preview).toHaveBeenCalledTimes(1))
		expect((await readMarker())[KEY]).toMatchObject({ attempts: 1, nextAttemptAt: expect.any(Number) })
	})

	test("a pass that throws before recording an attempt waits a minute, not a second, and logs a bounded category", async () => {
		fakeClock()
		const fault = new Error("row 0xabc balance 123")
		fault.name = "payload: 0xabc"
		const isTokenPresent = vi.fn(async (): Promise<boolean> => {
			throw fault
		})
		const { seeder, logger } = makeSeeder({ isTokenPresent })
		const logged = vi.spyOn(logger, "log")
		await writeMarker({ [KEY]: { attempts: 1, nextAttemptAt: Date.now() - 1 } })
		await seeder.run()
		expect(logged).toHaveBeenCalledWith("TokenSeeder", LogLevel.Warn, "seed pass threw", { category: "unknown" })

		await vi.advanceTimersByTimeAsync(59_000)
		expect(isTokenPresent).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1_000)
		expect(isTokenPresent).toHaveBeenCalledTimes(2)
	})

	test("a zero-account pass arms nothing — and neither does a marker that is due with no account", async () => {
		fakeClock()
		const { seeder, deps } = makeSeeder({ getAccounts: vi.fn(async () => []) })
		await seeder.run()
		await writeMarker({ [KEY]: { attempts: 1, nextAttemptAt: Date.now() - 1 } })
		await seeder.resume()
		await vi.advanceTimersByTimeAsync(600_000)
		expect(deps.isTokenPresent).toHaveBeenCalledTimes(1)
		expect(vi.getTimerCount()).toBe(0)
	})

	test("a purge cancels the armed retry; a profile switch retargets it", async () => {
		fakeClock()
		const purged = makeSeeder({ preview: rpcDown() })
		await purged.seeder.run()
		await purged.seeder.purgeForProfile("p1")
		await vi.advanceTimersByTimeAsync(600_000)
		expect(purged.deps.preview).toHaveBeenCalledTimes(1)
		expect(await readMarker()).toEqual({})

		let active = { id: "p1" }
		const switched = makeSeeder({ preview: rpcDown(), getActiveProfile: vi.fn(async () => active) })
		await switched.seeder.run()
		active = { id: "p2" }
		await vi.advanceTimersByTimeAsync(15_000)
		// The timer's pass re-derives the scope: p2's first attempt, never p1's second.
		expect((await readMarker())[KEY].attempts).toBe(1)
		expect(switched.deps.preview).toHaveBeenLastCalledWith("net1", "0xacc1", CONTRACT, SEED.expectedClassId)
		expect(switched.deps.preview).toHaveBeenCalledTimes(2)
	})
})

describe("rejection — a pin or bound failure is not retried under the same version", () => {
	test("pin mismatch: `rejected`, no continuation, fresh round on a new version", async () => {
		fakeClock()
		const preview = vi.fn(async (): Promise<SeedPreview> => {
			throw new PinMismatchError("class id differs")
		})
		let version = VERSION
		const { seeder } = makeSeeder({ preview, getVersion: () => version })
		await seeder.run()
		expect(await statusOf(seeder)).toEqual(["rejected"])
		expect((await readMarker())[KEY]).toMatchObject({ attempts: 1, rejectedAtVersion: VERSION })
		await vi.advanceTimersByTimeAsync(600_000)
		await seeder.run()
		expect(preview).toHaveBeenCalledTimes(1)
		expect(await seeder.retry(CHAIN_ID, CONTRACT)).toBe(false)

		version = "1.1.0"
		expect(await statusOf(seeder)).toEqual(["pending"])
		await seeder.run()
		expect(preview).toHaveBeenCalledTimes(2)
	})

	test("a purge landing during the rejected write cannot recreate the marker blob", async () => {
		let seederRef: { purgeForProfile(id: string): Promise<void> } | undefined
		const preview = vi.fn(async (): Promise<SeedPreview> => {
			// Bumps the epoch and queues the blob deletion AHEAD of the rejected write.
			void seederRef?.purgeForProfile("p1")
			return { ...goodPreview(), symbol: "WRONG" }
		})
		const { seeder } = makeSeeder({ preview })
		seederRef = seeder
		await seeder.run()
		expect(await readMarker()).toEqual({})
	})
})

describe("retry — a fresh round for a failed default", () => {
	const failedMarker = () => writeMarker({ [KEY]: { attempts: SEED_ATTEMPT_CAP, cappedAtVersion: VERSION } })

	test("accepted: counter reset, pass started, and the marker lock is not held across it", async () => {
		const { seeder, deps } = makeSeeder()
		await failedMarker()
		expect(await seeder.retry(CHAIN_ID, CONTRACT)).toBe(true)
		await vi.waitFor(() => expect(deps.persist).toHaveBeenCalledTimes(1))
		expect((await readMarker())[KEY]).toMatchObject({ attempts: 1, outcome: "seeded" })
	})

	test("refused: tombstone, seeded, pending, non-member, other chain — and nothing is written", async () => {
		const { seeder, deps } = makeSeeder()
		for (const entry of [{ attempts: 0, outcome: "deleted" }, { attempts: 1, outcome: "seeded" }, { attempts: 1 }]) {
			await writeMarker({ [KEY]: entry })
			expect(await seeder.retry(CHAIN_ID, CONTRACT)).toBe(false)
			expect((await readMarker())[KEY]).toEqual(entry)
		}
		await failedMarker()
		expect(await seeder.retry(CHAIN_ID, "0xdead")).toBe(false)
		expect(await seeder.retry(CHAIN_ID + 1, CONTRACT)).toBe(false)
		expect(deps.preview).not.toHaveBeenCalled()
	})

	test("refused while the capping attempt is still running — the counter is never reset under live work", async () => {
		const held = heldPreview()
		const { seeder } = makeSeeder({ preview: held.preview })
		await writeMarker({ [KEY]: { attempts: SEED_ATTEMPT_CAP - 1 } })
		const pass = seeder.run()
		await vi.waitFor(() => expect(held.preview).toHaveBeenCalledTimes(1))
		expect(await seeder.retry(CHAIN_ID, CONTRACT)).toBe(false)
		held.release(new Error("rpc down"))
		await pass
		expect((await readMarker())[KEY].attempts).toBe(SEED_ATTEMPT_CAP)
	})

	test("two simultaneous retries: exactly one accepted, one attempt made", async () => {
		const held = heldPreview()
		const { seeder } = makeSeeder({ preview: held.preview })
		await failedMarker()
		const verdicts = await Promise.all([seeder.retry(CHAIN_ID, CONTRACT), seeder.retry(CHAIN_ID, CONTRACT)])
		expect(verdicts.filter(Boolean)).toHaveLength(1)
		await vi.waitFor(() => expect(held.preview).toHaveBeenCalledTimes(1))
		expect((await readMarker())[KEY].attempts).toBe(1)
		held.release(goodPreview())
	})

	test("refused when a purge lands between the call and its turn on the marker lock", async () => {
		const { seeder } = makeSeeder()
		await failedMarker()
		const verdict = seeder.retry(CHAIN_ID, CONTRACT)
		void seeder.onChainPurged("p1", CHAIN_ID)
		expect(await verdict).toBe(false)
	})
})

describe("status event — change-only", () => {
	test("one event per transition: pending → seeding → settled; repeats are silent", async () => {
		const { seeder, deps } = makeSeeder()
		await seeder.run()
		await seeder.run()
		// seeding, then gone. The initial `pending` was never announced, so it is not a transition.
		expect(deps.onStatusChanged).toHaveBeenCalledTimes(2)
		expect(deps.onStatusChanged).toHaveBeenCalledWith({ profileId: "p1", chainId: CHAIN_ID })
	})

	test("a user deletion announces the default leaving the list", async () => {
		const { seeder, deps } = makeSeeder()
		await seeder.markDeletedByUser("p1", CHAIN_ID, CONTRACT)
		expect(deps.onStatusChanged).toHaveBeenCalledTimes(1)
		expect(await entriesOf(seeder)).toEqual([])
	})
})
