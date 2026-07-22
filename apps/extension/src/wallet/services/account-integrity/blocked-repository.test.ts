import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test } from "vitest"
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
