import { describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import type { IncomingPublicEventRecord } from "./spec"
import { publicRecordId } from "./spec"
import { IncomingTransferRepository, trustKey } from "./repository"

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

const RECORDS_ROOT = "nulo:core:incoming-transfers"

function pubRec(profileId: string, networkId: string, txHash: string): IncomingPublicEventRecord {
	return {
		kind: "public-event",
		id: publicRecordId(profileId, networkId, txHash, 0),
		profileId,
		networkId,
		accountAddress: "0xacct",
		contract: "0xtok",
		tokenId: 1,
		from: "0xfrom",
		amountRaw: "100",
		txHash,
		l2BlockNumber: 5,
		blockHash: "0xbh",
		txIndexInBlock: 0,
		indexInTx: 0,
		hidden: false,
		discoveredAt: 0,
	}
}

describe("IncomingTransferRepository — clearProfile / clearChain fan-out (code-review #4)", () => {
	test("clearProfile deletes ONLY the target profile (p1 ≠ p11 prefix), incl. a codec-INVALID row", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const repo = new IncomingTransferRepository(api)
		await repo.upsertRecord(pubRec("p1", "n1", "0xa"))
		await repo.upsertRecord(pubRec("p11", "n1", "0xb")) // different profile whose id shares the "p1" prefix
		await repo.setTrust("p1", "n1", "0xtok", "trusted")
		await repo.setTrust("p11", "n1", "0xtok", "trusted")
		// A corrupt record row under p1 that FAILS codec validation — `get()` reads it as `undefined`,
		// so a value-predicate sweep would silently skip it; the key-prefix delete must still remove it.
		await api.storage.local.set({ [`${RECORDS_ROOT}@${publicRecordId("p1", "n1", "0xcorrupt", 0)}`]: "{}" })

		await repo.clearProfile("p1")

		const remaining = await repo.listRecords()
		expect(remaining.map((r) => r.profileId)).toEqual(["p11"]) // p1's valid record gone; p11 untouched
		expect((await repo.listTrust()).map((t) => t.profileId)).toEqual(["p11"])
		// The corrupt row is gone from the underlying store (its key no longer present).
		const rawKeys = Object.keys(await api.storage.local.get())
		expect(rawKeys.some((k) => k.includes("0xcorrupt"))).toBe(false)
	})

	test("clearChain deletes only (p1,n1), leaving (p1,n2) intact", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const repo = new IncomingTransferRepository(api)
		await repo.upsertRecord(pubRec("p1", "n1", "0xa"))
		await repo.upsertRecord(pubRec("p1", "n2", "0xb"))
		await repo.setTrust("p1", "n1", "0xtok", "trusted")
		await repo.setTrust("p1", "n2", "0xtok", "trusted")

		await repo.clearChain("p1", "n1")

		expect((await repo.listRecords()).map((r) => r.networkId)).toEqual(["n2"])
		expect((await repo.listTrust()).map((t) => t.networkId)).toEqual(["n2"])
	})
})

describe("IncomingTransferRepository — arrival floors and rows", () => {
	const freshRepo = () => {
		const api = new FakeBrowserApi()
		api.reset()
		return { api, repo: new IncomingTransferRepository(api) }
	}

	test("a trust state change keeps the stored arrival floor and its pending mark", async () => {
		const { repo } = freshRepo()
		await repo.setArrivalFloor(await repo.setTrust("p1", "n1", "0xtok", "trusted"), { arrivalFloor: 200, pending: true })

		await repo.setTrust("p1", "n1", "0xtok", "unknown")
		expect(await repo.getTrust("p1", "n1", "0xtok")).toMatchObject({ state: "unknown", arrivalFloor: 200, arrivalFloorPending: true })
		await repo.setTrust("p1", "n1", "0xtok", "pending")
		expect(await repo.getTrust("p1", "n1", "0xtok")).toMatchObject({ state: "pending", arrivalFloor: 200, arrivalFloorPending: true })

		const stored = await repo.getTrust("p1", "n1", "0xtok")
		if (!stored) throw new Error("trust row missing")
		await repo.setArrivalFloor(stored, { arrivalFloor: 250, pending: false })
		const cleared = await repo.getTrust("p1", "n1", "0xtok")
		expect(cleared).toMatchObject({ state: "pending", arrivalFloor: 250 })
		expect(cleared?.arrivalFloorPending).toBeUndefined()
	})

	test("an arrival row that fails to parse reads as missing", async () => {
		const { api, repo } = freshRepo()
		await api.storage.local.set({ "nulo:core:incoming-arrivals@p1|n1|0xacct": JSON.stringify({ sinceBlock: -1, played: [] }) })
		expect(await repo.getArrivalRow("p1", "n1", "0xacct")).toBeUndefined()
	})

	test("clearChain and clearProfile delete only their scope's arrival rows", async () => {
		const { repo } = freshRepo()
		const row = { sinceBlock: 1, played: [] }
		await repo.setArrivalRow("p1", "n1", "0xa", row)
		await repo.setArrivalRow("p1", "n2", "0xa", row)
		await repo.setArrivalRow("p11", "n1", "0xa", row)

		await repo.clearChain("p1", "n1")
		expect(await repo.getArrivalRow("p1", "n1", "0xa")).toBeUndefined()
		expect(await repo.getArrivalRow("p1", "n2", "0xa")).toEqual(row)

		await repo.clearProfile("p1")
		expect(await repo.getArrivalRow("p1", "n2", "0xa")).toBeUndefined()
		expect(await repo.getArrivalRow("p11", "n1", "0xa")).toEqual(row)
	})
})
