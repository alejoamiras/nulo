/**
 * Unit pins for the Phase 5 trust-point primitives on `AuthRegistryService`:
 * `recordPendingAuthwits` / `reconcileAuthwits` / `assertWithinCap`. These touch only the
 * `authwits` EntityStorage + the internal lock, so the service is constructed
 * directly (no `init()`/deps) over an in-memory `FakeBrowserApi`.
 *
 * The end-to-end recording + reconcile path is covered by the `authwit-lifecycle`
 * network e2e; these pin the unit behavior the e2e can't isolate (dedup, the
 * mined→confirm / dropped→remove transitions, the per-account ceiling).
 */
import { beforeEach, describe, expect, test } from "vitest"
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
import { TASK_SERVICE_NAME } from "@/wallet/services/task/spec"
import { TRANSACTION_SERVICE_NAME, TxExecutionResult, TxStatus } from "@/wallet/services/transaction/spec"
import { svc } from "../composition-harness"
import { AuthRegistryService, MAX_TRACKED_AUTHWITS_PER_ACCOUNT } from "./service"
import type { Authwit } from "./spec"

const noopLogger = { log: () => {} }
const A = "0xowner"
const content = { kind: "call" } as unknown as AuthwitContent

function makeService(): AuthRegistryService {
	// AuthRegistryService binds its two EntityStorage tables to the injected
	// browserApi port; FakeBrowserApi provides an in-memory storage.local.
	// reset() clears the global fake-browser backing between tests.
	const api = new FakeBrowserApi()
	api.reset()
	return new AuthRegistryService(noopLogger as never, api)
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

	test("assertWithinCap blocks pre-send: existing + unique-new over the ceiling throws (per-build, deduped)", async () => {
		const existing = Array.from({ length: MAX_TRACKED_AUTHWITS_PER_ACCOUNT - 1 }, (_, i) => ({ hash: `0xe${i}`, content }))
		await svc.recordPendingAuthwits(A, existing, "0xtxe") // 255 tracked
		// 255 existing + 2 unique-new = 257 > 256 ⇒ blocked (the per-action bug would pass this).
		await expect(svc.assertWithinCap(A, ["0xnew1", "0xnew2"])).rejects.toThrow(/exceed the .* tracked public-authwit limit/)
		// 255 existing + 1 unique-new ("0xe0" is already tracked → deduped) = 256 ≤ 256 ⇒ ok.
		await expect(svc.assertWithinCap(A, ["0xe0", "0xnew1"])).resolves.toBeUndefined()
	})
})

describe("AuthRegistryService.reconcileFromTx — dropped is non-destructive", () => {
	let service: AuthRegistryService
	let txUpdated: EventHandler<unknown>

	beforeEach(async () => {
		const api = new FakeBrowserApi()
		api.reset()
		txUpdated = new EventHandler()
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, {}))
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(svc(ACCOUNT_SERVICE_NAME, { onAccountDeleted: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: txUpdated }))
		services.add(svc(TASK_SERVICE_NAME, {}))
		service = new AuthRegistryService(new LoggerStore(new ConfigStore()) as never, api)
		services.add(service)
		await services.start()
		await service.recordPendingAuthwits(A, [{ hash: "0xh1", content }], "0xtx1")
	})

	// reconcileFromTx is fired void'd off the event; give its storage ops a beat.
	const emitTx = async (tx: Record<string, unknown>) => {
		txUpdated.invoke(tx)
		await new Promise((r) => setTimeout(r, 10))
	}

	test("a Dropped tx does NOT remove pending rows — dropped is reversible (resurrection); sync reconciles", async () => {
		await emitTx({ hash: "0xtx1", status: TxStatus.Dropped, updatedAt: Date.now() })
		expect(await service.getAuthwits(A)).toHaveLength(1)
	})

	test("a settled reverted tx removes the pending row (genuinely terminal)", async () => {
		await emitTx({ hash: "0xtx1", status: TxStatus.Proven, executionResult: TxExecutionResult.AppLogicReverted, updatedAt: Date.now() })
		expect(await service.getAuthwits(A)).toHaveLength(0)
	})

	test("Proven + Success confirms the pending row (kept, no longer pending)", async () => {
		await emitTx({ hash: "0xtx1", status: TxStatus.Proven, executionResult: TxExecutionResult.Success, updatedAt: Date.now() })
		const rows = await service.getAuthwits(A)
		expect(rows).toHaveLength(1)
		expect(rows[0].pending).toBeFalsy()
	})
})

describe("AuthRegistryService.restore — hostile-row validation (P1)", () => {
	let service: AuthRegistryService
	let api: FakeBrowserApi
	beforeEach(async () => {
		// restore() gates on ensureInitialized(); run the real lifecycle over stub
		// peers (init only subscribes to onAccountDeleted + onTransactionUpdated).
		api = new FakeBrowserApi()
		api.reset()
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, {}))
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(svc(ACCOUNT_SERVICE_NAME, { onAccountDeleted: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(TASK_SERVICE_NAME, {}))
		service = new AuthRegistryService(new LoggerStore(new ConfigStore()) as never, api)
		services.add(service)
		await services.start()
	})

	const authwit = (account: string, hash: string): Authwit => ({ id: 0, account, hash, content })

	test("records a schema-invalid row (content not an object) as restoreError, never writes it", async () => {
		// content must be a non-null object; a hostile backup authwit with content:null
		// would pass EntityStorage's write but be codec-hidden on read. restore() must
		// parse-reject it up front so it never reaches storage.
		const bad = { id: 0, account: A, hash: "0xh", content: null } as unknown as Authwit

		const [restored] = await service.restore([bad])

		expect(restored.restoreError).toBeTruthy()
		expect(await service.getAuthwits(A)).toHaveLength(0)
	})

	test("a malformed row (non-string hash) does not abort the batch — the valid sibling lands", async () => {
		const bad = { id: 0, account: A, hash: 123, content } as unknown as Authwit

		const restored = await service.restore([bad, authwit(A, "0xgood")])

		expect(restored[0].restoreError).toBeTruthy()
		expect(restored[1].restoreError).toBeUndefined()
		expect((await service.getAuthwits(A)).map((r) => r.hash)).toEqual(["0xgood"])
	})

	/** Codex r3: the journal is keyed BY the embedded numeric id — an aliased copy of row 5
	 *  under key 9 must read as absent, so revoke(9) refuses instead of touching row 5. */
	test("an id-aliased row (5 copied under key 9) reads as absent — revoke(9) refuses", async () => {
		// revokeAuthwits gates on ensureInitialized(); run the real lifecycle over stub peers.
		const api = new FakeBrowserApi()
		api.reset()
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, {}))
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		services.add(svc(ACCOUNT_SERVICE_NAME, { onAccountDeleted: new EventHandler() }))
		services.add(svc(EXECUTION_SERVICE_NAME, {}))
		services.add(svc(TRANSACTION_SERVICE_NAME, { onTransactionUpdated: new EventHandler() }))
		services.add(svc(TASK_SERVICE_NAME, {}))
		const service = new AuthRegistryService(new LoggerStore(new ConfigStore()) as never, api)
		services.add(service)
		await services.start()
		// Five rows so the journal holds an honest row at key @5 (ids mint sequentially).
		await service.recordPendingAuthwits(
			A,
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

		await expect(service.revokeAuthwits("network-1", A, [9], undefined as never)).rejects.toThrow(/doesn't exist/)
		// The original row is untouched and still lists.
		expect((await service.getAuthwits(A)).map((r) => r.hash)).toEqual(["0xh1", "0xh2", "0xh3", "0xh4", "0xh5"])
	}, 15_000)

	// N-24 pins — restore dedupes on the compound (account, hash), matching the
	// live-write path's invariant. Duplicates from a cloned/re-imported backup
	// otherwise each mint a fresh id and silently burn per-account cap headroom.

	test("(N-24) an intra-batch duplicate (account, hash) is restoreError-tagged; the first lands", async () => {
		const restored = await service.restore([authwit(A, "0xdup"), authwit(A, "0xdup")])
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toBeTruthy()
		expect(await service.getAuthwits(A)).toHaveLength(1)
	})

	test("(N-24) a pair already in storage (live-recorded) blocks its restore", async () => {
		await service.recordPendingAuthwits(A, [{ hash: "0xlive", content }], "0xtx")
		const [restored] = await service.restore([authwit(A, "0xlive")])
		expect(restored.restoreError).toBeTruthy()
		expect(await service.getAuthwits(A)).toHaveLength(1)
	})

	test("(N-24) the same hash under TWO accounts restores clean — the key is compound, not bare-hash", async () => {
		const restored = await service.restore([authwit("0xalice", "0xshared"), authwit("0xbob", "0xshared")])
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toBeUndefined()
		expect(await service.getAuthwits("0xalice")).toHaveLength(1)
		expect(await service.getAuthwits("0xbob")).toHaveLength(1)
	})

	test("(N-24) delimiter-forged pairs are distinct — ('a::b','c') and ('a','b::c') both land", async () => {
		// An in-band string delimiter would collapse these two identities; the
		// JSON-array encoding keeps them injective.
		const restored = await service.restore([authwit("a::b", "c"), authwit("a", "b::c")])
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toBeUndefined()
	})

	test("(N-24) a hostile decodable row at MAX_SAFE_INTEGER fails the ROW — no hang, no hidden write", async () => {
		// Past MAX_SAFE_INTEGER the float cursor stops advancing (id++ is a
		// no-op): an unguarded skip loop spins forever under the service lock,
		// and an unguarded write lands key-identity-hidden on read. Both
		// boundary keys are seeded so the loop's own guard (not just the
		// post-loop check) is what exits.
		const max = Number.MAX_SAFE_INTEGER
		await api.storage.local.set({
			[`nulo:core:auth-registry@${max}`]: JSON.stringify({ id: max, account: A, hash: "0xmax", content: {} }),
			[`nulo:core:auth-registry@${max + 1}`]: JSON.stringify({ junk: true }),
		})
		const restored = await service.restore([authwit(A, "0xnew1"), authwit(A, "0xnew2")])
		expect(restored[0].restoreError).toBeTruthy()
		expect(restored[1].restoreError).toBeTruthy()
		// Nothing landed at (or past) the unsafe boundary beyond the seeds.
		const raw = await api.storage.local.get(null)
		const authKeys = Object.keys(raw).filter((k) => k.startsWith("nulo:core:auth-registry@"))
		expect(authKeys).toHaveLength(2)
	}, 10_000)

	test("(N-24) a codec-hidden raw row's pair still blocks its duplicate, and its key is never overwritten", async () => {
		// Seed a raw row that carries a valid (account, hash) but a codec-breaking
		// content — decoded reads hide it, yet its identity must still dedupe and
		// its numeric key must stay occupied.
		await api.storage.local.set({
			"nulo:core:auth-registry@1": JSON.stringify({ id: 1, account: A, hash: "0xhidden", content: null }),
		})
		const restored = await service.restore([authwit(A, "0xhidden"), authwit(A, "0xnew")])
		expect(restored[0].restoreError).toBeTruthy() // hidden pair blocks its duplicate
		expect(restored[1].restoreError).toBeUndefined()
		// The hidden row's raw bytes are intact (key @1 not clobbered by the cursor).
		const raw = (await api.storage.local.get("nulo:core:auth-registry@1"))["nulo:core:auth-registry@1"]
		expect(JSON.parse(raw as string)).toMatchObject({ id: 1, hash: "0xhidden", content: null })
	})
})
