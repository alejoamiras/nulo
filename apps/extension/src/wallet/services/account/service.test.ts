/**
 * Unit tests for `AccountService.restore` validation + provenance hardening
 * (Phase 3) using `FakeBrowserApi` + `svc` dependency stubs. Real service
 * lifecycle via `ServiceCollection`.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { Fr } from "@aztec/foundation/curves/bn254"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
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

// The N-03 fence pins exercise createAccountInternal's ORDERING, not the real
// key derivation — bb.js WASM does not run in this vitest env (std::bad_cast).
vi.mock("@nulo/wallet-crypto", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	deriveAccountSeed: async () => new Fr(7n),
	unsealImportedSigningKeyV2: async () => new Uint8Array(32),
	sealImportedSigningKeyV2: async () => "sealed-under-destination",
}))
vi.mock("@nulo/aztec-runtime/account", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	NuloAccount: { new: async () => ({ address: { toString: () => "0xderived-addr" } }) },
}))

describe("AccountService.createAccount — deletion fence (N-03)", () => {
	function _deferred<T>() {
		let resolve!: (v: T) => void
		const promise = new Promise<T>((res) => {
			resolve = res
		})
		return { promise, resolve }
	}

	async function makeHarness(over: { secret?: Promise<unknown>; probe?: Promise<number> } = {}) {
		const api = new FakeBrowserApi()
		api.reset()
		const deletion = new ProfileDeletionState()
		const master = new Fr(42n)
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onProfileDeleted: new EventHandler(),
				getDeletionState: () => deletion,
				getProfileSecret: () => over.secret ?? Promise.resolve(master),
			}),
		)
		services.add(
			svc(NETWORK_SERVICE_NAME, {
				registerChainPurgeSubscriber: () => {},
				resolveVerifiedL1ChainId: () => over.probe ?? Promise.resolve(1),
			}),
		)
		const service = new AccountService(new LoggerStore(new ConfigStore()), api)
		services.add(service)
		await services.start()
		return { api, deletion, master, service }
	}

	async function accountRowCount(api: FakeBrowserApi): Promise<number> {
		const raw = await api.storage.local.get(null)
		return Object.keys(raw).filter((k) => k.startsWith("nulo:core:accounts@")).length
	}

	test("a deletion completing DURING the secret await still rejects the write (capture-order pin)", async () => {
		// Discriminates capture-BEFORE-the-secret-await from capture-after: the
		// deletion begins AND fully releases while the secret promise is parked,
		// so a post-await capture would observe the settled post-bump epoch and
		// pass the pre-write assert — landing the orphan row.
		const gate = _deferred<unknown>()
		const h = await makeHarness({ secret: gate.promise })
		const run = h.service.createAccount("p1", 1, 0, "A")
		await new Promise((r) => setTimeout(r, 0)) // the run captures its fence, then parks on the secret
		h.deletion.beginDeletion("p1")
		h.deletion.release("p1") // deletion fully completed — reservation gone, epoch settled
		gate.resolve(h.master)
		await expect(run).rejects.toThrow(/deleted|unauthorized/)
		expect(await accountRowCount(h.api)).toBe(0)
	})

	test("a deletion beginning during the network probe rejects the write", async () => {
		const gate = _deferred<number>()
		const h = await makeHarness({ probe: gate.promise })
		const run = h.service.createAccount("p1", 1, 0, "A")
		await new Promise((r) => setTimeout(r, 0)) // let the run park on the probe
		h.deletion.beginDeletion("p1")
		gate.resolve(1)
		await expect(run).rejects.toThrow(/deleted/)
		expect(await accountRowCount(h.api)).toBe(0)
	})

	test("positive control: no deletion → the account row lands", async () => {
		const h = await makeHarness()
		const account = await h.service.createAccount("p1", 1, 0, "A")
		expect(account.address.length).toBeGreaterThan(0)
		expect(await accountRowCount(h.api)).toBe(1)
	})
})

describe("AccountService restore writers — deletion fence (N-14)", () => {
	async function makeHarness() {
		const api = new FakeBrowserApi()
		api.reset()
		const deletion = new ProfileDeletionState()
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onProfileDeleted: new EventHandler(),
				getDeletionState: () => deletion,
				consumeDekRewrapContext: async () => ({ sourceDek: {} as never, destinationDek: {} as never }),
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {}, getL1ChainIdStored: async () => 1 }))
		const service = new AccountService(new LoggerStore(new ConfigStore()), api)
		services.add(service)
		await services.start()
		return { api, deletion, service }
	}

	function armDeletionOnFirstWrite(api: FakeBrowserApi, deletion: ProfileDeletionState) {
		const origSet = api.storage.local.set.bind(api.storage.local)
		let fired = false
		api.storage.local.set = async (items: Record<string, unknown>) => {
			await origSet(items)
			if (!fired) {
				fired = true
				deletion.beginDeletion("p1")
			}
		}
	}

	test("restore: a deleteProfile beginning DURING the batch rejects every later row write", async () => {
		const h = await makeHarness()
		armDeletionOnFirstWrite(h.api, h.deletion)
		const restored = await h.service.restore([mkAccount("0xr1"), mkAccount("0xr2")])
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toMatch(/deleted/)
		const raw = await h.api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.includes("0xr2"))).toBe(false)
	})

	test("restoreImportedKeys: a deleteProfile beginning DURING the batch rejects every later rewrap write", async () => {
		const h = await makeHarness()
		armDeletionOnFirstWrite(h.api, h.deletion)
		const mkKey = (address: string) => ({ profileId: "p1", chainId: 1, address, encryptedSigningKey: "sealed-src" })
		const restored = await h.service.restoreImportedKeys([mkKey("0xk1"), mkKey("0xk2")])
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toMatch(/deleted/)
		const raw = await h.api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.includes("0xk2"))).toBe(false)
	})

	test("a hostile null row is a per-row restoreError, never a whole-slice abort", async () => {
		// The collision precheck extracts keys from every row — a raw null must be
		// excluded there (it would TypeError and abort the slice) yet still flow
		// to restoreRows for its own per-row error.
		const h = await makeHarness()
		const restored = await h.service.restore([mkAccount("0xr1"), null as never])
		expect(restored[0].restoreError).toBeUndefined()
		expect(typeof restored[1].restoreError).toBe("string")
	})

	test("positive control: no deletion → all rows land through both writers", async () => {
		const h = await makeHarness()
		const accounts = await h.service.restore([mkAccount("0xr1"), mkAccount("0xr2")])
		expect(accounts.every((r) => r.restoreError === undefined)).toBe(true)
		const keys = await h.service.restoreImportedKeys([
			{ profileId: "p1", chainId: 1, address: "0xk1", encryptedSigningKey: "sealed-src" },
		])
		expect(keys[0].restoreError).toBeUndefined()
	})
})

describe("AccountService.restore — validation + provenance (P3)", () => {
	let accountService: AccountService
	let api: FakeBrowserApi

	beforeEach(async () => {
		api = new FakeBrowserApi()
		api.reset()
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, { onProfileDeleted: new EventHandler(), getDeletionState: () => new ProfileDeletionState() }),
		)
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
		services.add(
			svc(PROFILE_SERVICE_NAME, { onProfileDeleted: new EventHandler(), getDeletionState: () => new ProfileDeletionState() }),
		)
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
