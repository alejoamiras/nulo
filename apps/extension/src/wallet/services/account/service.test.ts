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
import { accountRowId } from "./spec"

const mkAccount = (address: string, over: Record<string, unknown> = {}) =>
	({ profileId: "p1", chainId: 1, address, index: 0, type: 0, l1ChainId: 1, name: "A", visible: true, ...over }) as never

describe("AccountService.restore — validation + provenance (P3)", () => {
	let accountService: AccountService
	let api: FakeBrowserApi

	beforeEach(async () => {
		api = new FakeBrowserApi()
		api.reset()
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, { onProfileDeleted: new EventHandler() }))
		services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {}, getL1ChainIdStored: async () => 1 }))
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

	test("(P3/H) rejects an out-of-bound account index — negative / fractional / NaN / Infinity / >= 2^53", async () => {
		const badIndices: Array<[string, unknown]> = [
			["neg", -1],
			["frac", 1.5],
			["nan", Number.NaN],
			["inf", Number.POSITIVE_INFINITY],
			["unsafe", Number.MAX_SAFE_INTEGER],
		]
		for (const [label, index] of badIndices) {
			const [res] = await accountService.restore([mkAccount(`0xidx-${label}`, { index })])
			expect(res.restoreError, `index=${String(index)} must be rejected`).toBeDefined()
		}
		const raw = await api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.startsWith("nulo:core:accounts@"))).toBe(false)
	})

	test("(P3) accepts the largest safe index (2^53 - 2) — the bound is < MAX_SAFE_INTEGER, not tighter", async () => {
		const [res] = await accountService.restore([mkAccount("0xbig", { index: Number.MAX_SAFE_INTEGER - 1 })])
		expect(res.restoreError).toBeUndefined()
	})

	test("a well-formed unique account restores cleanly", async () => {
		const [res] = await accountService.restore([mkAccount("0x111")])
		expect(res.restoreError).toBeUndefined()
		const raw = await api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.includes("0x111"))).toBe(true)
	})

	test("(H4) two concurrent restores of the SAME account — the lock lets exactly ONE win", async () => {
		// Without the restore lock both would pass the (empty-store) intersection
		// check and both write the same row (ownership flip). The lock serialises
		// them → the 2nd sees the 1st's write → throws Duplicate.
		const results = await Promise.allSettled([
			accountService.restore([mkAccount("0xrace")]),
			accountService.restore([mkAccount("0xrace")]),
		])
		const fulfilled = results.filter((r) => r.status === "fulfilled")
		const rejected = results.filter((r) => r.status === "rejected")
		expect(fulfilled).toHaveLength(1)
		expect(rejected).toHaveLength(1)
		expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ message: expect.stringContaining("Duplicate account") })
	})

	test("the same address in two different profiles restores into two independent rows", async () => {
		// Same mnemonic imported twice derives one address per profile; each profile
		// owns its own row, so neither restore can take the other's account away.
		const [first] = await accountService.restore([mkAccount("0xshared", { profileId: "p1", name: "P1" })])
		const [second] = await accountService.restore([mkAccount("0xshared", { profileId: "p2", name: "P2" })])

		expect(first?.restoreError).toBeUndefined()
		expect(second?.restoreError).toBeUndefined()
		expect(await accountService.getAccount("p1", 1, "0xshared")).toMatchObject({ profileId: "p1", name: "P1" })
		expect(await accountService.getAccount("p2", 1, "0xshared")).toMatchObject({ profileId: "p2", name: "P2" })
	})

	test("(F-B23) purgeForProfile removes a MALFORMED row the profile owns; spares another profile's malformed row", async () => {
		await api.storage.local.set({
			"nulo:core:accounts@junk-p1": JSON.stringify({ profileId: "p1", junk: 1 }),
			"nulo:core:accounts@junk-p2": JSON.stringify({ profileId: "p2", junk: 1 }),
		})

		await accountService.purgeForProfile("p1")

		const raw = await api.storage.local.get(null)
		expect(raw["nulo:core:accounts@junk-p1"]).toBeUndefined()
		expect(raw["nulo:core:accounts@junk-p2"]).toBeDefined()
	})

	test("(F-B23) KEY ownership beats the value's claim — a malformed row at ANOTHER profile's canonical key is never deleted", async () => {
		// Deterministic, no race needed: whatever the bytes claim, a row at p2's
		// canonical key is p2's junk. Deleting it here is exactly the aliased-key
		// hazard (a concurrent p2 create/restore legitimately targets this key);
		// it is erased when p2 itself is deleted.
		const p2Key = `nulo:core:accounts@${accountRowId("p2", 1, "0xalias")}`
		await api.storage.local.set({ [p2Key]: JSON.stringify({ profileId: "p1", junk: 1 }) })

		await accountService.purgeForProfile("p1")

		expect((await api.storage.local.get(p2Key))[p2Key]).toBeDefined()
	})

	test("(F-B23) a row at the DELETED profile's canonical key IS deleted even when its bytes claim another profile", async () => {
		const p1Key = `nulo:core:accounts@${accountRowId("p1", 1, "0xmine")}`
		await api.storage.local.set({ [p1Key]: JSON.stringify({ profileId: "p9", junk: 1 }) })

		await accountService.purgeForProfile("p1")

		expect((await api.storage.local.get(p1Key))[p1Key]).toBeUndefined()
	})

	test("(F-B23) a concurrent restore of ANOTHER profile survives the purge's raw pass (key-attribution + restoreLock)", async () => {
		// End-state guard for the aliased-key hazard under real concurrency: the
		// malformed bytes claim p1 but sit at the canonical key p2's restore
		// legitimately writes. Key-attribution means the purge never targets p2's
		// key at all; p2's fresh valid row must survive either interleaving.
		await api.storage.local.set({
			[`nulo:core:accounts@${accountRowId("p2", 1, "0xalias")}`]: JSON.stringify({ profileId: "p1", junk: 1 }),
		})

		await Promise.all([accountService.purgeForProfile("p1"), accountService.restore([mkAccount("0xalias", { profileId: "p2" })])])

		expect(await accountService.getAccount("p2", 1, "0xalias")).toMatchObject({ profileId: "p2", address: "0xalias" })
	})

	test("(F-B23) rawAddressesForProfile harvests identity from canonical KEYS only — a foreign key's value claim donates nothing", async () => {
		await api.storage.local.set({
			// p1-keyed, malformed value (even the claim disagrees): address comes from the KEY.
			[`nulo:core:accounts@${accountRowId("p1", 1, "0xfromkey")}`]: JSON.stringify({ profileId: "p9", junk: 1 }),
			// p1-keyed, syntax-broken value: still attributable by key.
			[`nulo:core:accounts@${accountRowId("p1", 1, "0xbroken")}`]: "{not json",
			// p2-keyed bytes claiming p1 with a stealable address: must NOT donate
			// p2's address to p1's cascade (it would purge p2's authwits/txs).
			[`nulo:core:accounts@${accountRowId("p2", 1, "0xsteal")}`]: JSON.stringify({ profileId: "p1", address: "0xsteal" }),
			// Non-canonical key claiming p1: no trustworthy identity — not harvested.
			"nulo:core:accounts@legacy": JSON.stringify({ profileId: "p1", address: "0xlegacy" }),
		})

		expect((await accountService.rawAddressesForProfile("p1")).sort()).toEqual(["0xbroken", "0xfromkey"])
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

describe("AccountService.sweepOrphanImportedKeys (N-06 / F-B23)", () => {
	// The sweep runs awaited inside init(), so each case seeds raw storage FIRST
	// and then boots a fresh service — survival/deletion after start() is the
	// assertion. The live-set must come from the PHYSICAL key space: a codec-
	// hidden (or even non-string-valued) account row still counts as occupied,
	// so a data-integrity failure can never cascade into deleting the sealed
	// imported signing key behind it.
	const ACCOUNT_KEY = (address: string) => `nulo:core:accounts@${accountRowId("p1", 1, address)}`
	const IMPORTED_KEY = (address: string) => `nulo:core:imported-account-keys@${accountRowId("p1", 1, address)}`

	const boot = async (api: FakeBrowserApi) => {
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, { onProfileDeleted: new EventHandler() }))
		services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {}, getL1ChainIdStored: async () => 1 }))
		services.add(new AccountService(new LoggerStore(new ConfigStore()), api))
		await services.start()
	}

	test("a TRUE orphan key row (no account key at all) is reaped — proves the sweep ran", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		await api.storage.local.set({ [IMPORTED_KEY("0xorphan")]: JSON.stringify({ sealed: "AAAA" }) })
		await boot(api)
		const raw = await api.storage.local.get(null)
		expect(raw[IMPORTED_KEY("0xorphan")]).toBeUndefined()
	})

	test("a codec-hidden (malformed string) account row keeps its imported-key row alive", async () => {
		const api = new FakeBrowserApi()
		api.reset()
		await api.storage.local.set({
			[ACCOUNT_KEY("0xhidden")]: "{ not json at all",
			[IMPORTED_KEY("0xhidden")]: JSON.stringify({ sealed: "AAAA" }),
			[IMPORTED_KEY("0xorphan")]: JSON.stringify({ sealed: "BBBB" }), // control: sweep still reaps
		})
		await boot(api)
		const raw = await api.storage.local.get(null)
		expect(raw[IMPORTED_KEY("0xhidden")]).toBeDefined() // survived
		expect(raw[IMPORTED_KEY("0xorphan")]).toBeUndefined() // control reaped
	})

	test("a non-string-VALUED account row keeps its imported-key row alive (the getKeys discriminator)", async () => {
		// rawStringEntries skips non-string values — only the physical key space
		// (getKeys) sees this row. A live-set built any narrower deletes the key.
		const api = new FakeBrowserApi()
		api.reset()
		await api.storage.local.set({
			[ACCOUNT_KEY("0xobj")]: { not: "a string" },
			[IMPORTED_KEY("0xobj")]: JSON.stringify({ sealed: "AAAA" }),
		})
		await boot(api)
		const raw = await api.storage.local.get(null)
		expect(raw[IMPORTED_KEY("0xobj")]).toBeDefined()
	})
})
