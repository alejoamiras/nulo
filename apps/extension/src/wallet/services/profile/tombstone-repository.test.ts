import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { PROFILE_TOMBSTONE_ROOT, type Tombstone, TombstoneRepository } from "./tombstone-repository"

const mk = (profileId: string, over: Partial<Tombstone> = {}): Tombstone => ({
	profileId,
	addresses: [],
	tokenIds: [],
	networkIds: [],
	epoch: 1,
	pxeGeneration: "gen-test",
	...over,
})

function make() {
	const api = new FakeBrowserApi()
	api.reset()
	return { api, repo: new TombstoneRepository(api.storage.local) }
}

describe("TombstoneRepository — fail-closed id reservation (D11/D15)", () => {
	test("write + get + validPayloads + reservedIds round-trip", async () => {
		const { repo } = make()
		await repo.write(mk("p1", { addresses: ["0xa"], tokenIds: [1], networkIds: ["n1"], epoch: 3 }))
		expect(await repo.get("p1")).toMatchObject({ profileId: "p1", epoch: 3, addresses: ["0xa"] })
		expect(await repo.validPayloads()).toHaveLength(1)
		expect(await repo.reservedIds()).toEqual(new Set(["p1"]))
	})

	test("a CORRUPT tombstone STILL reserves its id, is NOT a valid payload, and is NEVER removed", async () => {
		const { api, repo } = make()
		// A syntactically-broken value written directly under the tombstone key —
		// the exact case EntityStorage.decodeRow would auto-DELETE (fail-open).
		await api.storage.local.set({ [`${PROFILE_TOMBSTONE_ROOT}@pX`]: "{not json" })

		// reservedIds derives ids from RAW keys → still reserved (fail-CLOSED).
		expect(await repo.reservedIds()).toEqual(new Set(["pX"]))
		// validPayloads skips it (can't drive cleanup) but does NOT remove it...
		expect(await repo.validPayloads()).toEqual([])
		expect(await repo.get("pX")).toBeUndefined()
		// ...and it survives on disk (unlike EntityStorage.decodeRow).
		const still = await api.storage.local.get(`${PROFILE_TOMBSTONE_ROOT}@pX`)
		expect(still[`${PROFILE_TOMBSTONE_ROOT}@pX`]).toBe("{not json")
	})

	test("corruptIds surfaces a reserved-but-undecodable tombstone for TELEMETRY (never repairs/drops)", async () => {
		const { api, repo } = make()
		await repo.write(mk("good1"))
		await api.storage.local.set({ [`${PROFILE_TOMBSTONE_ROOT}@bad1`]: "{not json" })

		// telemetry lists ONLY the corrupt id (the valid one is not "corrupt").
		expect(await repo.corruptIds()).toEqual(["bad1"])
		// …and it stays reserved + on disk (surface for manual recovery, NEVER dropped).
		expect(await repo.reservedIds()).toEqual(new Set(["good1", "bad1"]))
		const still = await api.storage.local.get(`${PROFILE_TOMBSTONE_ROOT}@bad1`)
		expect(still[`${PROFILE_TOMBSTONE_ROOT}@bad1`]).toBe("{not json")
	})

	test("clearIfSame only clears when the epoch matches (a re-deletion's marker survives)", async () => {
		const { repo } = make()
		await repo.write(mk("p1", { epoch: 2 }))
		await repo.clearIfSame("p1", 1) // stale epoch → no clear
		expect(await repo.get("p1")).toBeDefined()
		await repo.clearIfSame("p1", 2) // matching → cleared
		expect(await repo.get("p1")).toBeUndefined()
	})
})
