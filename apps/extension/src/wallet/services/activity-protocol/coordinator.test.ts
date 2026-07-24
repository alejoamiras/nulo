import type { ActivityScope } from "@nulo/wallet-core/activity"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test } from "vitest"
import { ActivityProtocolCoordinator } from "./coordinator"

const SCOPE: ActivityScope = { profileId: "p1", networkId: "n1", chainId: 1, accountAddress: "0xabc" }
const OTHER: ActivityScope = { ...SCOPE, profileId: "p2" }

describe("ActivityProtocolCoordinator", () => {
	let api: FakeBrowserApi
	let coordinator: ActivityProtocolCoordinator

	beforeEach(() => {
		api = new FakeBrowserApi()
		api.reset()
		coordinator = new ActivityProtocolCoordinator(api)
	})

	test("mints one incarnation per scope and keeps returning it", async () => {
		const first = await coordinator.currentIncarnation(SCOPE)
		const again = await coordinator.currentIncarnation(SCOPE)
		const other = await coordinator.currentIncarnation(OTHER)

		expect(again).toEqual(first)
		expect(first.generation).toBe("1")
		expect(first.nonce).toHaveLength(32)
		// A different scope is a different incarnation, never a shared one.
		expect(other.nonce).not.toBe(first.nonce)
	})

	test("allocation is monotonic and never repeats across a restart", async () => {
		const first = await coordinator.allocate(SCOPE, "transaction")
		const second = await coordinator.allocate(SCOPE, "transaction")
		expect([first, second]).toEqual(["1", "2"])

		// A fresh coordinator over the same storage continues the sequence.
		const revived = new ActivityProtocolCoordinator(api)
		expect(await revived.allocate(SCOPE, "transaction")).toBe("3")
	})

	test("sources and scopes each keep their own sequence", async () => {
		await coordinator.allocate(SCOPE, "transaction")
		await coordinator.allocate(SCOPE, "transaction")

		expect(await coordinator.allocate(SCOPE, "journal")).toBe("1")
		expect(await coordinator.allocate(OTHER, "transaction")).toBe("1")
	})

	test("the watermark only covers sequences that are actually accounted for", async () => {
		const one = await coordinator.allocate(SCOPE, "transaction")
		const two = await coordinator.allocate(SCOPE, "transaction")

		// Allocated but nothing written yet: publishing 2 here would claim
		// authority over rows that don't exist.
		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("0")

		await coordinator.settle(SCOPE, "transaction", one)
		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("1")

		await coordinator.settle(SCOPE, "transaction", two)
		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("2")
	})

	test("an out-of-order settle waits for the gap before the watermark moves", async () => {
		const one = await coordinator.allocate(SCOPE, "transaction")
		const two = await coordinator.allocate(SCOPE, "transaction")
		const three = await coordinator.allocate(SCOPE, "transaction")

		await coordinator.settle(SCOPE, "transaction", three)
		await coordinator.settle(SCOPE, "transaction", two)
		// 1 is still outstanding, so nothing above it may be claimed.
		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("0")

		await coordinator.settle(SCOPE, "transaction", one)
		// The whole run collapses at once.
		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("3")
	})

	test("an abandoned allocation does not wedge the watermark forever", async () => {
		const doomed = await coordinator.allocate(SCOPE, "transaction")
		const later = await coordinator.allocate(SCOPE, "transaction")

		// Its write failed and will never land.
		await coordinator.abandon(SCOPE, "transaction", doomed)
		await coordinator.settle(SCOPE, "transaction", later)

		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("2")
	})

	test("settling the same sequence twice is harmless", async () => {
		const seq = await coordinator.allocate(SCOPE, "transaction")
		await coordinator.settle(SCOPE, "transaction", seq)
		await coordinator.settle(SCOPE, "transaction", seq)
		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("1")
	})

	test("retiring a scope starts a new incarnation and restarts its sequences", async () => {
		const before = await coordinator.currentIncarnation(SCOPE)
		const seq = await coordinator.allocate(SCOPE, "transaction")
		await coordinator.settle(SCOPE, "transaction", seq)
		await coordinator.tombstone(SCOPE, "transaction", "gone", seq)

		const after = await coordinator.retireScope(SCOPE)

		expect(BigInt(after.generation)).toBeGreaterThan(BigInt(before.generation))
		expect(after.nonce).not.toBe(before.nonce)
		// The previous incarnation's bookkeeping has no meaning under the new one.
		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("0")
		expect(await coordinator.tombstonesFor(SCOPE, "transaction")).toEqual({})
		expect(await coordinator.allocate(SCOPE, "transaction")).toBe("1")
	})

	test("tombstones record the newest deletion and never move backwards", async () => {
		await coordinator.tombstone(SCOPE, "journal", "op-1", "5")
		await coordinator.tombstone(SCOPE, "journal", "op-1", "3")
		await coordinator.tombstone(SCOPE, "journal", "op-2", "9")

		expect(await coordinator.tombstonesFor(SCOPE, "journal")).toEqual({ "op-1": "5", "op-2": "9" })
		// Another source keeps its own set.
		expect(await coordinator.tombstonesFor(SCOPE, "transaction")).toEqual({})
	})

	test("purging a scope leaves every other scope untouched", async () => {
		await coordinator.currentIncarnation(SCOPE)
		await coordinator.settle(SCOPE, "transaction", await coordinator.allocate(SCOPE, "transaction"))
		const survivor = await coordinator.currentIncarnation(OTHER)
		await coordinator.settle(OTHER, "transaction", await coordinator.allocate(OTHER, "transaction"))

		await coordinator.purgeScope(SCOPE)

		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("0")
		expect(await coordinator.watermark(OTHER, "transaction")).toBe("1")
		expect(await coordinator.currentIncarnation(OTHER)).toEqual(survivor)
	})

	test("purging a profile clears all of its scopes and nothing else", async () => {
		const otherNetwork: ActivityScope = { ...SCOPE, networkId: "n2" }
		for (const scope of [SCOPE, otherNetwork, OTHER]) {
			await coordinator.currentIncarnation(scope)
			await coordinator.settle(scope, "transaction", await coordinator.allocate(scope, "transaction"))
		}

		await coordinator.purgeProfile("p1")

		expect(await coordinator.watermark(SCOPE, "transaction")).toBe("0")
		expect(await coordinator.watermark(otherNetwork, "transaction")).toBe("0")
		expect(await coordinator.watermark(OTHER, "transaction")).toBe("1")
	})

	test("concurrent allocations never hand out the same sequence", async () => {
		const seqs = await Promise.all(Array.from({ length: 25 }, () => coordinator.allocate(SCOPE, "transaction")))
		expect(new Set(seqs).size).toBe(25)
	})
})
