import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { AccountIntegrityBlockedRepository } from "./blocked-repository"
import { ACCOUNT_INTEGRITY_BLOCKED_ROOT, type AccountIntegrityBlocked } from "./types"

const RECORD: AccountIntegrityBlocked = {
	profileId: "p1",
	chainId: 0,
	accountIndex: 0,
	storedAddress: "0xstored",
	derivedAddress: "0xderived",
	regimeId: "nulo-v5",
	walletVersion: "0.26.0",
	detectedAt: 123,
}

describe("AccountIntegrityBlockedRepository", () => {
	let api: FakeBrowserApi
	let repo: AccountIntegrityBlockedRepository

	beforeEach(() => {
		api = new FakeBrowserApi()
		api.reset()
		repo = new AccountIntegrityBlockedRepository(api.storage.local)
	})

	test("get and isBlocked each read their key exactly once; a corrupt row blocks but does not decode", async () => {
		await api.storage.local.set({ [`${ACCOUNT_INTEGRITY_BLOCKED_ROOT}@p1`]: "{broken" })
		const get = vi.spyOn(api.storage.local, "get")
		expect(await repo.get("p1")).toBeUndefined()
		expect(await repo.isBlocked("p1")).toBe(true)
		expect(get).toHaveBeenCalledTimes(2)
		for (const call of get.mock.calls) expect(call[0]).toBe(`${ACCOUNT_INTEGRITY_BLOCKED_ROOT}@p1`)
	})

	test("set → get round-trips; isBlocked flips; clear removes", async () => {
		expect(await repo.isBlocked("p1")).toBe(false)
		await repo.set(RECORD)
		expect(await repo.isBlocked("p1")).toBe(true)
		expect(await repo.get("p1")).toEqual(RECORD)
		await repo.clear("p1")
		expect(await repo.isBlocked("p1")).toBe(false)
		expect(await repo.get("p1")).toBeUndefined()
	})

	test("a CORRUPT record still blocks (fail-closed), even though get() yields undefined", async () => {
		await api.storage.local.set({ [`${ACCOUNT_INTEGRITY_BLOCKED_ROOT}@p1`]: "{truncated" })
		expect(await repo.isBlocked("p1")).toBe(true)
		expect(await repo.get("p1")).toBeUndefined()
	})

	test("records are per-profile — one profile's block never bleeds into another", async () => {
		await repo.set(RECORD)
		expect(await repo.isBlocked("other")).toBe(false)
	})
})
