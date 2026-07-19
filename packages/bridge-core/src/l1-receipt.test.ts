import { describe, expect, test } from "vitest"
import { awaitL1Receipt } from "./l1-receipt"

const HASH = "0xabc" as `0x${string}`
const RECEIPT = { status: "success" }
const noWait = () => Promise.resolve()

describe("awaitL1Receipt", () => {
	test("returns the receipt when the wait succeeds first try", async () => {
		const r = await awaitL1Receipt(
			{
				waitForTransactionReceipt: async () => RECEIPT,
				getTransactionReceipt: async () => {
					throw new Error("must not be called")
				},
			},
			HASH,
			{ waitMs: noWait },
		)
		expect(r).toBe(RECEIPT)
	})

	test("recovers a mined-despite-timeout receipt via the direct read (the stranding bug)", async () => {
		let waits = 0
		const r = await awaitL1Receipt(
			{
				waitForTransactionReceipt: async () => {
					waits++
					throw new Error("Timed out while waiting for transaction")
				},
				getTransactionReceipt: async () => RECEIPT,
			},
			HASH,
			{ waitMs: noWait },
		)
		expect(r).toBe(RECEIPT)
		expect(waits).toBe(1)
	})

	test("keeps retrying while unmined, narrates each round, then returns once mined", async () => {
		const seen: number[] = []
		let round = 0
		const r = await awaitL1Receipt(
			{
				waitForTransactionReceipt: async () => {
					round++
					if (round < 3) throw new Error("timeout")
					return RECEIPT
				},
				getTransactionReceipt: async () => {
					throw new Error("not found")
				},
			},
			HASH,
			{ waitMs: noWait, onStillWaiting: (a) => seen.push(a) },
		)
		expect(r).toBe(RECEIPT)
		expect(seen).toEqual([1, 2])
	})

	test("exhausted attempts throw the resumable-Pending message (never a bare viem timeout)", async () => {
		await expect(
			awaitL1Receipt(
				{
					waitForTransactionReceipt: async () => {
						throw new Error("timeout")
					},
					getTransactionReceipt: async () => {
						throw new Error("not found")
					},
				},
				HASH,
				{ attempts: 2, waitMs: noWait },
			),
		).rejects.toThrow(/stays in Pending.*Retry resumes/s)
	})
})
