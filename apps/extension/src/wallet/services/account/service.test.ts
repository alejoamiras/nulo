/**
 * Unit tests for `AccountService.restore` validation + provenance hardening
 * (Phase 3) using `FakeBrowserApi` + `svc` dependency stubs. Real service
 * lifecycle via `ServiceCollection`.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection } from "@/wallet/base"
import { LoggerStore } from "@/wallet/logger"
import { ConfigStore } from "@/wallet/config"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { svc } from "../composition-harness"
import { AccountService } from "./service"

const mkAccount = (address: string, over: Record<string, unknown> = {}) =>
	({ profileId: "p1", chainId: 1, address, index: 0, type: 0, name: "A", visible: true, ...over }) as never

describe("AccountService.restore — validation + provenance (P3)", () => {
	let accountService: AccountService
	let api: FakeBrowserApi

	beforeEach(async () => {
		api = new FakeBrowserApi()
		api.reset()
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, { onProfileDeleted: new EventHandler() }))
		services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {} }))
		accountService = new AccountService(new LoggerStore(new ConfigStore()), api)
		services.add(accountService)
		await services.start()
	})

	test("(P3/F) rejects an empty/whitespace account address — never written", async () => {
		const [res] = await accountService.restore([mkAccount("   ")])
		expect(res.restoreError).toBeDefined()
		const raw = await api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.startsWith("nulo:core:accounts@"))).toBe(false)
	})

	test("(P3) dedupes an address repeated within the same restore batch", async () => {
		const [ok, dup] = await accountService.restore([mkAccount("0xabc"), mkAccount("0xabc")])
		expect(ok.restoreError).toBeUndefined()
		expect(dup.restoreError).toBeDefined()
	})

	test("(P3/H) rejects a schema-malformed account row — never written + codec-hidden", async () => {
		const [res] = await accountService.restore([mkAccount("0xdef", { visible: "yes" })])
		expect(res.restoreError).toBeDefined()
		const raw = await api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.includes("0xdef"))).toBe(false)
	})

	test("a well-formed unique account restores cleanly", async () => {
		const [res] = await accountService.restore([mkAccount("0x111")])
		expect(res.restoreError).toBeUndefined()
		const raw = await api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.includes("0x111"))).toBe(true)
	})

	test("(H4) two concurrent restores of the SAME address — the lock lets exactly ONE win", async () => {
		// Without the restore lock both would pass the (empty-store) intersection
		// check and both write the global address-keyed row (ownership flip). The
		// lock serialises them → the 2nd sees the 1st's write → throws Duplicate.
		const results = await Promise.allSettled([
			accountService.restore([mkAccount("0xrace")]),
			accountService.restore([mkAccount("0xrace")]),
		])
		const fulfilled = results.filter((r) => r.status === "fulfilled")
		const rejected = results.filter((r) => r.status === "rejected")
		expect(fulfilled).toHaveLength(1)
		expect(rejected).toHaveLength(1)
		expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ message: expect.stringContaining("Duplicate address") })
	})

	test("(H3) purgeForProfile removes rows but emits NO onAccountDeleted (coordinator awaits dependents directly)", async () => {
		await accountService.restore([mkAccount("0xp1a"), mkAccount("0xp1b")])
		const emit = vi.spyOn(accountService as unknown as { emit: (e: string, p: unknown) => void }, "emit")

		await accountService.purgeForProfile("p1")

		// Rows gone…
		const raw = await api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.startsWith("nulo:core:accounts@"))).toBe(false)
		// …but no fire-and-forget onAccountDeleted (its async consumers would run
		// after the coordinator releases the id and clobber a successor — audit H3).
		expect(emit.mock.calls.filter(([e]) => e === "onAccountDeleted")).toHaveLength(0)
	})

	test("getAccounts returns index-sorted regardless of restore/insertion order (import default-account fix)", async () => {
		// Restore in reverse-index order, exactly as a full-backup restore can insert rows: the resulting
		// storage/insertion order is NOT index order. Without the sort, getAccounts[0] would be index 2 →
		// the LAST account becomes the default active after import. It must return index 0 first.
		await accountService.restore([mkAccount("0xc", { index: 2 }), mkAccount("0xa", { index: 0 }), mkAccount("0xb", { index: 1 })])
		const accounts = await accountService.getAccounts("p1", 1, true)
		expect(accounts.map((a) => a.index)).toEqual([0, 1, 2])
		expect(accounts[0]!.address).toBe("0xa")
	})

	test("getAccounts is TOTALLY ordered — duplicate indices (hostile backup) break the tie by address, not insertion order", async () => {
		// Legitimate per-type indices are unique; a crafted backup could carry two rows at the same index.
		// The address tie-breaker keeps ordering deterministic instead of leaking insertion order.
		await accountService.restore([mkAccount("0xbbb", { index: 0 }), mkAccount("0xaaa", { index: 0 })])
		const accounts = await accountService.getAccounts("p1", 1, true)
		expect(accounts.map((a) => a.address)).toEqual(["0xaaa", "0xbbb"])
	})
})
