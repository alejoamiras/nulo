/**
 * Unit pins for the trust-point primitives on `AuthRegistryService`:
 * `recordPendingAuthwits` / `reconcileAuthwits` / `assertWithinCap` / the scoped sync +
 * reconcile paths / `restore`. These touch only the `authwits` EntityStorage + the internal
 * lock, so the service is constructed directly (no `init()`/deps) over an in-memory
 * `FakeBrowserApi`, or over stub peers where `ensureInitialized()` gates the call.
 *
 * The end-to-end recording + reconcile path is covered by the `authwit-lifecycle`
 * network e2e; these pin the unit behavior the e2e can't isolate (dedup, the
 * mined→confirm / dropped→remove transitions, the per-scope ceiling, the tuple scoping).
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ACCOUNT_SERVICE_NAME } from "@/wallet/services/account/spec"
import type { AuthwitContent } from "@/wallet/services/execution/spec"
import { EXECUTION_SERVICE_NAME } from "@/wallet/services/execution/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { TASK_SERVICE_NAME } from "@/wallet/services/task/spec"
import { TRANSACTION_SERVICE_NAME, TxExecutionResult, TxStatus } from "@/wallet/services/transaction/spec"
import { svc } from "../composition-harness"
import { AuthRegistryService, MAX_TRACKED_AUTHWITS_PER_ACCOUNT } from "./service"
import type { Authwit } from "./spec"

const noopLogger = { log: () => {} }
const A = "0xowner"
const P1 = { profileId: "p1", chainId: 1, account: A }
const content = { kind: "call" } as unknown as AuthwitContent

function makeService(): AuthRegistryService {
	// AuthRegistryService binds its two EntityStorage tables to the injected
	// browserApi port; FakeBrowserApi provides an in-memory storage.local.
	// reset() clears the global fake-browser backing between tests.
	const api = new FakeBrowserApi()
	api.reset()
	return new AuthRegistryService(noopLogger as never, api)
}

/** Direct-storage read (no active-profile gate) — the unit tests below construct the service
 *  without `init()`, so `getAuthwits` (which requires an active profile) is not reachable. */
const rowsOf = async (s: AuthRegistryService, scope = P1): Promise<Authwit[]> =>
	(await (s as unknown as { rowsForScope: (x: typeof P1) => Promise<Authwit[]> }).rowsForScope(scope)) ?? []

describe("AuthRegistryService — pending/reconcile/cap", () => {
	let svc: AuthRegistryService
	beforeEach(() => {
		svc = makeService()
	})

	test("recordPendingAuthwits writes pending, tx-linked rows stamped with the scope tuple", async () => {
		await svc.recordPendingAuthwits(P1, [{ hash: "0xh1", content }], "0xtx1")
		const rows = await rowsOf(svc)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ profileId: "p1", chainId: 1, account: A, hash: "0xh1", pending: true, txHash: "0xtx1" })
	})

	test("recordPendingAuthwits is idempotent on (scope, hash) (no duplicate on retry)", async () => {
		await svc.recordPendingAuthwits(P1, [{ hash: "0xh1", content }], "0xtx1")
		await svc.recordPendingAuthwits(P1, [{ hash: "0xh1", content }], "0xtx1")
		expect(await rowsOf(svc)).toHaveLength(1)
	})

	test("the same hash under another profile or chain is a distinct row, not a dedup hit", async () => {
		await svc.recordPendingAuthwits(P1, [{ hash: "0xh1", content }], "0xtx1")
		await svc.recordPendingAuthwits({ ...P1, profileId: "p2" }, [{ hash: "0xh1", content }], "0xtx2")
		await svc.recordPendingAuthwits({ ...P1, chainId: 2 }, [{ hash: "0xh1", content }], "0xtx3")
		expect(await rowsOf(svc)).toHaveLength(1)
		expect(await rowsOf(svc, { ...P1, profileId: "p2" })).toHaveLength(1)
		expect(await rowsOf(svc, { ...P1, chainId: 2 })).toHaveLength(1)
	})

	test("recordPendingAuthwits allocates ids over the PHYSICAL key space — a codec-hidden row is never overwritten", async () => {
		const api = new FakeBrowserApi()
		const s = new AuthRegistryService(noopLogger as never, api)
		await api.storage.local.set({ "nulo:core:auth-registry@1": JSON.stringify({ id: 1, account: A, hash: "0xhidden", content: null }) })
		await s.recordPendingAuthwits(P1, [{ hash: "0xnew", content }], "0xtx")
		const raw = (await api.storage.local.get(null)) as Record<string, string>
		expect(JSON.parse(raw["nulo:core:auth-registry@1"])).toMatchObject({ hash: "0xhidden", content: null })
		expect((await rowsOf(s)).map((r) => r.id)).toEqual([2])
	})

	test("reconcileAuthwits('mined') clears pending → confirmed (durable, kept)", async () => {
		await svc.recordPendingAuthwits(P1, [{ hash: "0xh1", content }], "0xtx1")
		await svc.reconcileAuthwits(P1, "0xtx1", "mined")
		const rows = await rowsOf(svc)
		expect(rows).toHaveLength(1)
		expect(rows[0].pending).toBe(false)
	})

	test("reconcileAuthwits('dropped') removes the pending row (grant never landed)", async () => {
		await svc.recordPendingAuthwits(P1, [{ hash: "0xh1", content }], "0xtx1")
		await svc.reconcileAuthwits(P1, "0xtx1", "dropped")
		expect(await rowsOf(svc)).toHaveLength(0)
	})

	test("reconcileAuthwits only touches rows for the matching txHash AND the tx's own scope tuple", async () => {
		await svc.recordPendingAuthwits(P1, [{ hash: "0xh1", content }], "0xtx1")
		await svc.recordPendingAuthwits(P1, [{ hash: "0xh2", content }], "0xtx2")
		// Equal hashes across profiles/chains: another profile's tx with the same txHash must not
		// confirm or drop this profile's rows.
		await svc.recordPendingAuthwits({ ...P1, profileId: "p2" }, [{ hash: "0xh1", content }], "0xtx1")
		await svc.recordPendingAuthwits({ ...P1, chainId: 2 }, [{ hash: "0xh1", content }], "0xtx1")
		await svc.reconcileAuthwits(P1, "0xtx1", "dropped")
		expect((await rowsOf(svc)).map((r) => r.hash)).toEqual(["0xh2"])
		expect(await rowsOf(svc, { ...P1, profileId: "p2" })).toHaveLength(1)
		expect(await rowsOf(svc, { ...P1, chainId: 2 })).toHaveLength(1)
	})

	test("assertWithinCap blocks pre-send: existing + unique-new over the ceiling throws (per-build, deduped, per scope)", async () => {
		const existing = Array.from({ length: MAX_TRACKED_AUTHWITS_PER_ACCOUNT - 1 }, (_, i) => ({ hash: `0xe${i}`, content }))
		await svc.recordPendingAuthwits(P1, existing, "0xtxe") // 255 tracked
		// 255 existing + 2 unique-new = 257 > 256 ⇒ blocked (the per-action bug would pass this).
		await expect(svc.assertWithinCap(P1, ["0xnew1", "0xnew2"])).rejects.toThrow(/exceed the .* tracked public-authwit limit/)
		// 255 existing + 1 unique-new ("0xe0" is already tracked → deduped) = 256 ≤ 256 ⇒ ok.
		await expect(svc.assertWithinCap(P1, ["0xe0", "0xnew1"])).resolves.toBeUndefined()
		// The ceiling is per scope: the same address on another profile/chain starts empty.
		await expect(svc.assertWithinCap({ ...P1, profileId: "p2" }, ["0xnew1", "0xnew2"])).resolves.toBeUndefined()
	})
})

/** Stub-peer harness: the real lifecycle over stubs (init registers the two purge subscribers
 *  + the tx listener). `network` is what `getNetwork` resolves — owned by p1 on chain 1. */
async function makeHarness(opts: { node?: unknown; activeProfile?: { id: string } | undefined } = {}) {
	const api = new FakeBrowserApi()
	api.reset()
	const deletionState = new ProfileDeletionState()
	const txUpdated = new EventHandler<unknown>()
	let active: { id: string } | undefined = "activeProfile" in opts ? opts.activeProfile : { id: "p1" }
	const network = { id: "net-1", profileId: "p1", chainId: 1, l1ChainId: 1, name: "N", endpoints: [], primaryEndpointId: "e" }
	const services = new ServiceCollection()
	services.add(svc(PROFILE_SERVICE_NAME, { getDeletionState: () => deletionState, getActiveProfile: async () => active }))
	services.add(
		svc(NETWORK_SERVICE_NAME, {
			getNetwork: async () => network,
			getNode: async () => opts.node,
			registerChainPurgeSubscriber: () => {},
		}),
	)
	services.add(svc(ACCOUNT_SERVICE_NAME, { registerAccountPurgeSubscriber: () => {} }))
	services.add(svc(EXECUTION_SERVICE_NAME, {}))
	services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: txUpdated }))
	const task = () => ({ complete() {}, fail() {}, startSubtask: task })
	services.add(svc(TASK_SERVICE_NAME, { startNewTask: task }))
	const service = new AuthRegistryService(new LoggerStore(new ConfigStore()) as never, api)
	services.add(service)
	await services.start()
	return { api, deletionState, service, txUpdated, setActive: (p: { id: string } | undefined) => (active = p) }
}

describe("AuthRegistryService.reconcileFromTx — scoped by the tx's provenance; dropped is non-destructive", () => {
	let h: Awaited<ReturnType<typeof makeHarness>>

	beforeEach(async () => {
		h = await makeHarness()
		await h.service.recordPendingAuthwits(P1, [{ hash: "0xh1", content }], "0xtx1")
	})

	// reconcileFromTx is fired void'd off the event; give its storage ops a beat.
	const emitTx = async (tx: Record<string, unknown>) => {
		h.txUpdated.invoke({ profileId: "p1", chainId: 1, account: A, ...tx })
		await new Promise((r) => setTimeout(r, 10))
	}

	test("a Dropped tx does NOT remove pending rows — dropped is reversible (resurrection); sync reconciles", async () => {
		await emitTx({ hash: "0xtx1", status: TxStatus.Dropped, updatedAt: Date.now() })
		expect(await h.service.getAuthwits(1, A)).toHaveLength(1)
	})

	test("a settled reverted tx removes the pending row (genuinely terminal)", async () => {
		await emitTx({ hash: "0xtx1", status: TxStatus.Proven, executionResult: TxExecutionResult.AppLogicReverted, updatedAt: Date.now() })
		expect(await h.service.getAuthwits(1, A)).toHaveLength(0)
	})

	test("Proven + Success confirms the pending row (kept, no longer pending)", async () => {
		await emitTx({ hash: "0xtx1", status: TxStatus.Proven, executionResult: TxExecutionResult.Success, updatedAt: Date.now() })
		const rows = await h.service.getAuthwits(1, A)
		expect(rows).toHaveLength(1)
		expect(rows[0].pending).toBeFalsy()
	})

	test("a settled tx from ANOTHER profile/chain with the same hash touches nothing; a tx without provenance is skipped", async () => {
		await emitTx({ hash: "0xtx1", profileId: "p2", status: TxStatus.Proven, executionResult: TxExecutionResult.AppLogicReverted })
		await emitTx({ hash: "0xtx1", chainId: 2, status: TxStatus.Proven, executionResult: TxExecutionResult.AppLogicReverted })
		await emitTx({ hash: "0xtx1", profileId: undefined, status: TxStatus.Proven, executionResult: TxExecutionResult.AppLogicReverted })
		const rows = await h.service.getAuthwits(1, A)
		expect(rows).toHaveLength(1)
		expect(rows[0].pending).toBe(true)
	})
})

describe("AuthRegistryService.syncRegistry — scoped sync with a re-read under the lock", () => {
	test("a node answering non-consumable for chain 1 deletes only that scope's CONFIRMED rows; pending + other scopes survive", async () => {
		const node = { getTxReceipt: vi.fn(), getChainTips: vi.fn() }
		const h = await makeHarness({ node })
		const util = await import("@/wallet/utils/auth-registry")
		vi.spyOn(util, "isAuthwitConsumable").mockResolvedValue(false)
		vi.spyOn(util, "isAuthRegistryEnabled").mockResolvedValue(true)

		await h.service.recordPendingAuthwits(P1, [{ hash: "0xconfirmed", content }], "0xtxa")
		await h.service.reconcileAuthwits(P1, "0xtxa", "mined")
		await h.service.recordPendingAuthwits(P1, [{ hash: "0xpending", content }], "0xtxb")
		await h.service.recordPendingAuthwits({ ...P1, chainId: 2 }, [{ hash: "0xother-chain", content }], "0xtxc")
		await h.service.reconcileAuthwits({ ...P1, chainId: 2 }, "0xtxc", "mined")
		await h.service.recordPendingAuthwits({ ...P1, profileId: "p2" }, [{ hash: "0xother-profile", content }], "0xtxd")
		await h.service.reconcileAuthwits({ ...P1, profileId: "p2" }, "0xtxd", "mined")

		await h.service.syncRegistry("net-1", A)

		expect((await h.service.getAuthwits(1, A)).map((r) => r.hash)).toEqual(["0xpending"])
		expect((await h.service.getAuthwits(2, A)).map((r) => r.hash)).toEqual(["0xother-chain"])
		h.setActive({ id: "p2" })
		expect((await h.service.getAuthwits(1, A)).map((r) => r.hash)).toEqual(["0xother-profile"])
		vi.restoreAllMocks()
	})

	test("a deferred node reply during which the row's id is replaced by a foreign-tuple row deletes NOTHING", async () => {
		const node = {}
		const h = await makeHarness({ node })
		const util = await import("@/wallet/utils/auth-registry")
		let release!: () => void
		const parked = new Promise<void>((r) => (release = r))
		vi.spyOn(util, "isAuthwitConsumable").mockImplementation(async () => {
			await parked
			return false
		})
		vi.spyOn(util, "isAuthRegistryEnabled").mockResolvedValue(true)

		await h.service.recordPendingAuthwits(P1, [{ hash: "0xconfirmed", content }], "0xtxa")
		await h.service.reconcileAuthwits(P1, "0xtxa", "mined")
		const [row] = await h.service.getAuthwits(1, A)

		const sync = h.service.syncRegistry("net-1", A)
		await new Promise((r) => setTimeout(r, 5))
		// Purge + restore during the await: the numeric id now holds a p2 row.
		await h.service.purgeForProfile("p1")
		await h.api.storage.local.set({
			[`nulo:core:auth-registry@${row.id}`]: JSON.stringify({ ...row, profileId: "p2", hash: "0xforeign", pending: false }),
		})
		release()
		await sync

		h.setActive({ id: "p2" })
		expect((await h.service.getAuthwits(1, A)).map((r) => r.hash)).toEqual(["0xforeign"])
		vi.restoreAllMocks()
	})
})

describe("AuthRegistryService.restore — hostile-row validation + scoped dedup", () => {
	let service: AuthRegistryService
	let api: FakeBrowserApi
	beforeEach(async () => {
		const h = await makeHarness()
		service = h.service
		api = h.api
	})

	const authwit = (account: string, hash: string, chainId = 1, profileId = "p1"): Authwit => ({
		id: 0,
		profileId,
		chainId,
		account,
		hash,
		content,
	})

	test("records a schema-invalid row (content not an object) as restoreError, never writes it", async () => {
		// content must be a non-null object; a hostile backup authwit with content:null
		// would pass EntityStorage's write but be codec-hidden on read. restore() must
		// parse-reject it up front so it never reaches storage.
		const bad = { id: 0, profileId: "p1", chainId: 1, account: A, hash: "0xh", content: null } as unknown as Authwit

		const [restored] = await service.restore([bad], "p1")

		expect(restored.restoreError).toBeTruthy()
		expect(await service.getAuthwits(1, A)).toHaveLength(0)
	})

	test("a malformed row (non-string hash) does not abort the batch — the valid sibling lands", async () => {
		const bad = { id: 0, profileId: "p1", chainId: 1, account: A, hash: 123, content } as unknown as Authwit

		const restored = await service.restore([bad, authwit(A, "0xgood")], "p1")

		expect(restored[0].restoreError).toBeTruthy()
		expect(restored[1].restoreError).toBeUndefined()
		expect((await service.getAuthwits(1, A)).map((r) => r.hash)).toEqual(["0xgood"])
	})

	test("a missing chainId is a restoreError (the scope tuple is required, never defaulted)", async () => {
		const bad = { id: 0, account: A, hash: "0xh", content } as unknown as Authwit
		const [restored] = await service.restore([bad], "p1")
		expect(restored.restoreError).toBeTruthy()
	})

	test("a foreign profileId on a backup row is FORCED to the threaded id — never trusted", async () => {
		const [restored] = await service.restore([authwit(A, "0xh", 1, "p-hostile")], "p1")
		expect(restored.restoreError).toBeUndefined()
		expect(restored.profileId).toBe("p1")
		expect((await service.getAuthwits(1, A)).map((r) => r.profileId)).toEqual(["p1"])
	})

	/** The journal is keyed BY the embedded numeric id — an aliased copy of row 5
	 *  under key 9 must read as absent, so revoke(9) refuses instead of touching row 5. */
	test("an id-aliased row (5 copied under key 9) reads as absent — revoke(9) refuses", async () => {
		// Five rows so the journal holds an honest row at key @5 (ids mint sequentially).
		await service.recordPendingAuthwits(
			P1,
			[
				{ hash: "0xh1", content },
				{ hash: "0xh2", content },
				{ hash: "0xh3", content },
				{ hash: "0xh4", content },
				{ hash: "0xh5", content },
			],
			"0xtx",
		)
		const all = await api.storage.local.get()
		const rowFiveKey = Object.keys(all).find((k) => k === "nulo:core:auth-registry@5")
		expect(rowFiveKey).toBeTruthy()
		// Copy row 5 VERBATIM (embedded id stays 5) under key 9.
		await api.storage.local.set({ "nulo:core:auth-registry@9": all[rowFiveKey!] })

		await expect(service.revokeAuthwits("net-1", A, [9], undefined as never)).rejects.toThrow(/doesn't exist/)
		// The original row is untouched and still lists.
		expect((await service.getAuthwits(1, A)).map((r) => r.hash)).toEqual(["0xh1", "0xh2", "0xh3", "0xh4", "0xh5"])
	}, 15_000)

	// Restore dedupes on the compound (profileId, chainId, account, hash), matching the
	// live-write path's invariant. Duplicates from a cloned/re-imported backup
	// otherwise each mint a fresh id and silently burn per-scope cap headroom.

	test("an intra-batch duplicate (chain, account, hash) is restoreError-tagged; the first lands", async () => {
		const restored = await service.restore([authwit(A, "0xdup"), authwit(A, "0xdup")], "p1")
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toBeTruthy()
		expect(await service.getAuthwits(1, A)).toHaveLength(1)
	})

	test("a tuple already in storage (live-recorded) blocks its restore", async () => {
		await service.recordPendingAuthwits(P1, [{ hash: "0xlive", content }], "0xtx")
		const [restored] = await service.restore([authwit(A, "0xlive")], "p1")
		expect(restored.restoreError).toBeTruthy()
		expect(await service.getAuthwits(1, A)).toHaveLength(1)
	})

	test("a same-address SIBLING profile's existing (account, hash) does NOT block this profile's restore", async () => {
		await service.recordPendingAuthwits({ ...P1, profileId: "p2" }, [{ hash: "0xshared", content }], "0xtx")
		const [restored] = await service.restore([authwit(A, "0xshared")], "p1")
		expect(restored.restoreError).toBeUndefined()
		expect(await service.getAuthwits(1, A)).toHaveLength(1)
	})

	test("the same hash under TWO accounts, or one account on TWO chains, restores clean — the key is the tuple, not bare-hash", async () => {
		const restored = await service.restore(
			[authwit("0xalice", "0xshared"), authwit("0xbob", "0xshared"), authwit("0xalice", "0xshared", 2)],
			"p1",
		)
		expect(restored.every((r) => r.restoreError === undefined)).toBe(true)
		expect(await service.getAuthwits(1, "0xalice")).toHaveLength(1)
		expect(await service.getAuthwits(1, "0xbob")).toHaveLength(1)
		expect(await service.getAuthwits(2, "0xalice")).toHaveLength(1)
	})

	test("delimiter-forged pairs are distinct — ('a::b','c') and ('a','b::c') both land", async () => {
		// An in-band string delimiter would collapse these two identities; the
		// JSON-array encoding keeps them injective.
		const restored = await service.restore([authwit("a::b", "c"), authwit("a", "b::c")], "p1")
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toBeUndefined()
	})

	test("a hostile decodable row at MAX_SAFE_INTEGER fails the ROW — no hang, no hidden write", async () => {
		// Past MAX_SAFE_INTEGER the float cursor stops advancing (id++ is a
		// no-op): an unguarded skip loop spins forever under the service lock,
		// and an unguarded write lands key-identity-hidden on read. Both
		// boundary keys are seeded so the loop's own guard (not just the
		// post-loop check) is what exits.
		const max = Number.MAX_SAFE_INTEGER
		await api.storage.local.set({
			[`nulo:core:auth-registry@${max}`]: JSON.stringify({
				id: max,
				profileId: "p1",
				chainId: 1,
				account: A,
				hash: "0xmax",
				content: {},
			}),
			[`nulo:core:auth-registry@${max + 1}`]: JSON.stringify({ junk: true }),
		})
		const restored = await service.restore([authwit(A, "0xnew1"), authwit(A, "0xnew2")], "p1")
		expect(restored[0].restoreError).toBeTruthy()
		expect(restored[1].restoreError).toBeTruthy()
		// Nothing landed at (or past) the unsafe boundary beyond the seeds.
		const raw = await api.storage.local.get(null)
		const authKeys = Object.keys(raw).filter((k) => k.startsWith("nulo:core:auth-registry@"))
		expect(authKeys).toHaveLength(2)
	}, 10_000)

	test("a codec-hidden raw row's tuple still blocks its duplicate, and its key is never overwritten", async () => {
		// Seed a raw row that carries a valid tuple but a codec-breaking content — decoded
		// reads hide it, yet its identity must still dedupe and its numeric key stay occupied.
		await api.storage.local.set({
			"nulo:core:auth-registry@1": JSON.stringify({
				id: 1,
				profileId: "p1",
				chainId: 1,
				account: A,
				hash: "0xhidden",
				content: null,
			}),
		})
		const restored = await service.restore([authwit(A, "0xhidden"), authwit(A, "0xnew")], "p1")
		expect(restored[0].restoreError).toBeTruthy() // hidden tuple blocks its duplicate
		expect(restored[1].restoreError).toBeUndefined()
		// The hidden row's raw bytes are intact (key @1 not clobbered by the cursor).
		const raw = (await api.storage.local.get("nulo:core:auth-registry@1"))["nulo:core:auth-registry@1"]
		expect(JSON.parse(raw as string)).toMatchObject({ id: 1, hash: "0xhidden", content: null })
	})

	test("legacy rows without provenance are codec-hidden (kept, never read, never purged by scope)", async () => {
		await api.storage.local.set({
			"nulo:core:auth-registry@3": JSON.stringify({ id: 3, account: A, hash: "0xlegacy", content }),
		})
		expect(await service.getAuthwits(1, A)).toHaveLength(0)
		await service.purgeForProfile("p1")
		expect("nulo:core:auth-registry@3" in ((await api.storage.local.get(null)) as Record<string, unknown>)).toBe(true)
	})
})

describe("AuthRegistryService.restore — deletion fence (threaded profileId)", () => {
	const rows = [
		{ id: 0, profileId: "p1", chainId: 1, account: "0xacc", hash: "0xh1", content },
		{ id: 0, profileId: "p1", chainId: 1, account: "0xacc", hash: "0xh2", content },
	]

	test("a deleteProfile beginning DURING the restore rejects every later row write", async () => {
		const h = await makeHarness()
		const origSet = h.api.storage.local.set.bind(h.api.storage.local)
		let fired = false
		h.api.storage.local.set = async (items: Record<string, unknown>) => {
			await origSet(items)
			if (!fired) {
				fired = true
				h.deletionState.beginDeletion("p1")
			}
		}
		const restored = await h.service.restore(rows, "p1")
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toMatch(/deleted/)
		expect(await h.service.getAuthwits(1, "0xacc")).toHaveLength(1)
	})

	test("fails closed when the created-profile id is missing", async () => {
		const h = await makeHarness()
		await expect(h.service.restore(rows, undefined as never)).rejects.toThrow(/profile id/)
		expect(await h.service.getAuthwits(1, "0xacc")).toHaveLength(0)
	})

	test("positive control: no deletion → both rows land", async () => {
		const h = await makeHarness()
		const restored = await h.service.restore(rows, "p1")
		expect(restored.every((r) => r.restoreError === undefined)).toBe(true)
	})
})
