import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test } from "vitest"
import { IncomingTransferRepository, recordKey, trustKey } from "./repository"
import type { IncomingTransferRecord } from "./spec"

describe("IncomingTransferRepository — trustKey", () => {
	test("composes profile|network|contract", () => {
		expect(trustKey("p1", "net-1", "0xabc")).toBe("p1|net-1|0xabc")
	})
	test("different contracts on the same (profile, network) get distinct keys", () => {
		expect(trustKey("p1", "net-1", "0xa")).not.toBe(trustKey("p1", "net-1", "0xb"))
	})
	test("same contract on different networks gets distinct keys", () => {
		expect(trustKey("p1", "net-1", "0xa")).not.toBe(trustKey("p1", "net-2", "0xa"))
	})
	test("same contract on different profiles gets distinct keys", () => {
		expect(trustKey("p1", "net-1", "0xa")).not.toBe(trustKey("p2", "net-1", "0xa"))
	})
})

/**
 * A siloed nullifier is unique within ONE rollup tree, not across them, so the
 * nullifier alone cannot be the row key: the same value observed on two
 * networks would collide on a single row and one of them would disappear.
 */
describe("IncomingTransferRepository — record identity", () => {
	const NULLIFIER = "0xnull"
	let repo: IncomingTransferRepository

	const record = (over: Partial<IncomingTransferRecord> = {}) =>
		({
			siloedNullifier: NULLIFIER,
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			owner: "0xa",
			contract: "0xtoken",
			tokenId: 1,
			amountRaw: "1000",
			noteHash: "0xnote",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			noteIndexInTx: 0,
			discoveredAt: 0,
			hidden: false,
			...over,
		}) as IncomingTransferRecord

	beforeEach(() => {
		const api = new FakeBrowserApi()
		api.reset()
		repo = new IncomingTransferRepository(api)
	})

	test("the same nullifier on two networks is two independent records", async () => {
		const onN1 = record({ networkId: "n1", amountRaw: "1000" })
		const onN2 = record({ networkId: "n2", amountRaw: "2000" })

		await repo.upsertRecord(onN1)
		await repo.upsertRecord(onN2)

		expect(await repo.listRecords()).toHaveLength(2)
		expect((await repo.getRecord(onN1, NULLIFIER))?.amountRaw).toBe("1000")
		expect((await repo.getRecord(onN2, NULLIFIER))?.amountRaw).toBe("2000")
	})

	test("the same nullifier under another account or profile stays distinct", async () => {
		for (const row of [record(), record({ accountAddress: "0xb" }), record({ profileId: "p2" })]) {
			await repo.upsertRecord(row)
		}
		expect(await repo.listRecords()).toHaveLength(3)
	})

	test("deleting one scope's record leaves the colliding one intact", async () => {
		const onN1 = record({ networkId: "n1" })
		const onN2 = record({ networkId: "n2" })
		await repo.upsertRecord(onN1)
		await repo.upsertRecord(onN2)

		await repo.deleteRecord(onN1, NULLIFIER)

		expect(await repo.getRecord(onN1, NULLIFIER)).toBeUndefined()
		expect(await repo.getRecord(onN2, NULLIFIER)).toBeDefined()
	})

	test("re-upserting the same record replaces it rather than duplicating", async () => {
		await repo.upsertRecord(record({ amountRaw: "1" }))
		await repo.upsertRecord(record({ amountRaw: "2" }))

		expect(await repo.listRecords()).toHaveLength(1)
		expect((await repo.getRecord(record(), NULLIFIER))?.amountRaw).toBe("2")
	})

	test("a lookup from the wrong scope finds nothing", async () => {
		await repo.upsertRecord(record({ networkId: "n1" }))

		expect(await repo.getRecord(record({ networkId: "n2" }), NULLIFIER)).toBeUndefined()
		expect(await repo.hasRecord(record({ profileId: "p2" }), NULLIFIER)).toBe(false)
	})

	test("a separator inside an identifier cannot forge another scope's key", () => {
		const sneaky = recordKey({ profileId: 'p1","n1', networkId: "x", accountAddress: "0xa" }, NULLIFIER)
		expect(sneaky).not.toBe(recordKey({ profileId: "p1", networkId: "n1", accountAddress: "0xa" }, NULLIFIER))
	})
})
