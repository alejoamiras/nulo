/**
 * Unit pins for the Phase 5 trust-point primitives on `AuthRegistryService`:
 * `recordPendingAuthwits` / `reconcileAuthwits` / `isAtCap`. These touch only the
 * `authwits` EntityStorage + the internal lock, so the service is constructed
 * directly (no `init()`/deps) over an in-memory `chrome.storage.local` stub.
 *
 * The end-to-end recording + reconcile path is covered by the `authwit-lifecycle`
 * network e2e; these pin the unit behavior the e2e can't isolate (dedup, the
 * mined→confirm / dropped→remove transitions, the per-account ceiling).
 */
import { beforeEach, describe, expect, test } from "vitest"
import type { AuthwitContent } from "@/wallet/services/execution/spec"
import { AuthRegistryService, MAX_TRACKED_AUTHWITS_PER_ACCOUNT } from "./service"

const noopLogger = { log: () => {} }
const A = "0xowner"
const content = { kind: "call" } as unknown as AuthwitContent

function fakeStorageLocal() {
	const m = new Map<string, string>()
	return {
		get: async (key?: string | string[] | null) => {
			if (key === undefined || key === null) return Object.fromEntries(m)
			const keys = Array.isArray(key) ? key : [key]
			const out: Record<string, unknown> = {}
			for (const k of keys) if (m.has(k)) out[k] = m.get(k)
			return out
		},
		set: async (obj: Record<string, string>) => {
			for (const [k, v] of Object.entries(obj)) m.set(k, v)
		},
		remove: async (key: string | string[]) => {
			for (const k of Array.isArray(key) ? key : [key]) m.delete(k)
		},
		clear: async () => m.clear(),
	}
}

function makeService(): AuthRegistryService {
	// vitest.setup stubs `chrome` (with runtime); add a functional in-memory `storage.local`
	// without clobbering runtime, then construct the service (binds its EntityStorage to it).
	;(globalThis.chrome as unknown as { storage: unknown }).storage = { local: fakeStorageLocal() }
	return new AuthRegistryService(noopLogger as never)
}

describe("AuthRegistryService — pending/reconcile/cap (Phase 5)", () => {
	let svc: AuthRegistryService
	beforeEach(() => {
		svc = makeService()
	})

	test("recordPendingAuthwits writes pending, tx-linked rows", async () => {
		await svc.recordPendingAuthwits(A, [{ hash: "0xh1", content }], "0xtx1")
		const rows = await svc.getAuthwits(A)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ account: A, hash: "0xh1", pending: true, txHash: "0xtx1" })
	})

	test("recordPendingAuthwits is idempotent on account+hash (no duplicate on retry)", async () => {
		await svc.recordPendingAuthwits(A, [{ hash: "0xh1", content }], "0xtx1")
		await svc.recordPendingAuthwits(A, [{ hash: "0xh1", content }], "0xtx1")
		expect(await svc.getAuthwits(A)).toHaveLength(1)
	})

	test("reconcileAuthwits('mined') clears pending → confirmed (durable, kept)", async () => {
		await svc.recordPendingAuthwits(A, [{ hash: "0xh1", content }], "0xtx1")
		await svc.reconcileAuthwits("0xtx1", "mined")
		const rows = await svc.getAuthwits(A)
		expect(rows).toHaveLength(1)
		expect(rows[0].pending).toBe(false)
	})

	test("reconcileAuthwits('dropped') removes the pending row (grant never landed)", async () => {
		await svc.recordPendingAuthwits(A, [{ hash: "0xh1", content }], "0xtx1")
		await svc.reconcileAuthwits("0xtx1", "dropped")
		expect(await svc.getAuthwits(A)).toHaveLength(0)
	})

	test("reconcileAuthwits only touches rows for the matching txHash", async () => {
		await svc.recordPendingAuthwits(A, [{ hash: "0xh1", content }], "0xtx1")
		await svc.recordPendingAuthwits(A, [{ hash: "0xh2", content }], "0xtx2")
		await svc.reconcileAuthwits("0xtx1", "dropped")
		const rows = await svc.getAuthwits(A)
		expect(rows).toHaveLength(1)
		expect(rows[0].hash).toBe("0xh2")
	})

	test("isAtCap is false below the ceiling, true at it", async () => {
		expect(await svc.isAtCap(A)).toBe(false)
		const items = Array.from({ length: MAX_TRACKED_AUTHWITS_PER_ACCOUNT }, (_, i) => ({ hash: `0xh${i}`, content }))
		await svc.recordPendingAuthwits(A, items, "0xtxbulk")
		expect(await svc.getAuthwits(A)).toHaveLength(MAX_TRACKED_AUTHWITS_PER_ACCOUNT)
		expect(await svc.isAtCap(A)).toBe(true)
	})

	test("assertWithinCap blocks pre-send: existing + unique-new over the ceiling throws (per-build, deduped)", async () => {
		const existing = Array.from({ length: MAX_TRACKED_AUTHWITS_PER_ACCOUNT - 1 }, (_, i) => ({ hash: `0xe${i}`, content }))
		await svc.recordPendingAuthwits(A, existing, "0xtxe") // 255 tracked
		// 255 existing + 2 unique-new = 257 > 256 ⇒ blocked (the per-action bug would pass this).
		await expect(svc.assertWithinCap(A, ["0xnew1", "0xnew2"])).rejects.toThrow(/exceed the .* tracked public-authwit limit/)
		// 255 existing + 1 unique-new ("0xe0" is already tracked → deduped) = 256 ≤ 256 ⇒ ok.
		await expect(svc.assertWithinCap(A, ["0xe0", "0xnew1"])).resolves.toBeUndefined()
	})
})
