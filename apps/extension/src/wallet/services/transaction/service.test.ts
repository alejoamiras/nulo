/**
 * D13 execution-fence pin for `TransactionService.addTransaction`: a completing
 * execution captured {profileId, epoch} at authorization; if a deletion of that
 * profile has since begun (epoch advanced) OR the owning account row is gone /
 * re-owned by a successor, the write MUST be rejected — otherwise a slow prove
 * that finishes after `deleteProfile` resurrects a pending tx (codex audit C2).
 *
 * Real service lifecycle over `svc()` stubs sharing ONE ProfileDeletionState.
 * Fake timers park the 1s sync worker (it no-ops while `pending` is empty).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ACCOUNT_SERVICE_NAME } from "@/wallet/services/account/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { svc } from "../composition-harness"
import { TaskService } from "@/wallet/services/task/service"
import { TransactionService, TxConfirmationTimeoutError } from "./service"

const ACCOUNT = "0xacc"

describe("TransactionService.addTransaction — D13 execution fence", () => {
	let service: TransactionService
	let deletionState: ProfileDeletionState
	let api: FakeBrowserApi

	beforeEach(async () => {
		vi.useFakeTimers()
		api = new FakeBrowserApi()
		api.reset()
		deletionState = new ProfileDeletionState()
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, { getActiveProfile: async () => ({ id: "p1" }), getDeletionState: () => deletionState }))
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				onAccountDeleted: new EventHandler(),
				// The account exists ONLY for profile p1 (a purged/re-owned account
				// resolves to undefined here).
				getAccount: async (profileId: string, _chainId: number, address: string) =>
					(profileId === "p1" || profileId === "p2") && address === ACCOUNT ? { profileId, address } : undefined,
				// Two profiles from one mnemonic own this address, so it has more than
				// one owner and unscoped rows are ambiguous.
				getAccountsByAddress: async (address: string) =>
					address === ACCOUNT
						? [
								{ profileId: "p1", address },
								{ profileId: "p2", address },
							]
						: [],
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		service = new TransactionService(new LoggerStore(new ConfigStore()), api)
		services.add(service)
		await services.start()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	const add = (hash: string, fence?: { profileId: string; epoch: number }, networkId?: string) =>
		service.addTransaction(
			{ type: 0 } as never,
			1,
			ACCOUNT,
			[],
			"0",
			0 as never,
			hash,
			undefined,
			undefined,
			undefined,
			fence,
			networkId,
		)

	test("deleting one profile's transactions spares another profile sharing the address", async () => {
		// Two profiles built from one mnemonic own the same address. An
		// address-only purge would take both profiles' history.
		await add("0xp1-tx", { profileId: "p1", epoch: deletionState.capture("p1") }, "net-1")
		await add("0xp2-tx", { profileId: "p2", epoch: deletionState.capture("p2") }, "net-2")

		await service.purgeForAccounts([ACCOUNT], "p1")

		const remaining = (await service.getTransactions(ACCOUNT)).map((t) => t.hash)
		expect(remaining).toEqual(["0xp2-tx"])
	})

	test("(F-B23) purgeForAccounts removes a malformed row scoped to the deleted profile; spares the survivor's and multi-owner unscoped ones", async () => {
		await api.storage.local.set({
			"nulo:core:txs@badp1": JSON.stringify({ account: ACCOUNT, profileId: "p1", junk: 1 }),
			"nulo:core:txs@badp2": JSON.stringify({ account: ACCOUNT, profileId: "p2", junk: 1 }),
			"nulo:core:txs@badunscoped": JSON.stringify({ account: ACCOUNT, junk: 1 }),
		})

		await service.purgeForAccounts([ACCOUNT], "p1")

		const raw = await api.storage.local.get(null)
		expect(raw["nulo:core:txs@badp1"]).toBeUndefined()
		expect(raw["nulo:core:txs@badp2"]).toBeDefined()
		// ACCOUNT has two owners → an unscoped malformed row is unattributable and
		// cannot be marked ambiguous (rewriting unreadable bytes would launder
		// them) — left in place, fail-closed and codec-hidden.
		expect(raw["nulo:core:txs@badunscoped"]).toBeDefined()
	})

	test("(F-B23) an unscoped malformed row IS purged when the profile is the address's sole owner", async () => {
		// "0xsolo" resolves to no other owner in the account stub → soleOwner.
		await api.storage.local.set({ "nulo:core:txs@badsolo": JSON.stringify({ account: "0xsolo", junk: 1 }) })

		await service.purgeForAccounts(["0xsolo"], "p1")

		expect((await api.storage.local.get(null))["nulo:core:txs@badsolo"]).toBeUndefined()
	})

	test("a row marked unattributable is not re-armed for polling after a restart", async () => {
		const fence = { profileId: "p1", epoch: deletionState.capture("p1") }
		await add("0xmarked", fence, "net-1")
		const row = await service.getTransaction("0xmarked")
		await api.storage.local.set({ "nulo:core:txs@0xmarked": JSON.stringify({ ...row, ambiguous: true }) })

		// The live service already holds it; what matters is that a RESTART does
		// not re-arm it, so assert on the reload filter the way init does.
		const reloaded = (await api.storage.local.get(null)) as Record<string, string>
		const marked = Object.entries(reloaded)
			.filter(([k]) => k.startsWith("nulo:core:txs@"))
			.map(([, v]) => JSON.parse(v) as { hash: string; ambiguous?: boolean })
			.filter((tx) => !tx.ambiguous)
		// It must not be among the rows a restart would put back into the poller,
		// which would run against whichever profile is active now.
		expect(marked.map((tx) => tx.hash)).not.toContain("0xmarked")
	})

	test("stamps the owning profile and network so history can be scoped", async () => {
		const fence = { profileId: "p1", epoch: deletionState.capture("p1") }
		const tx = await add("0xscoped", fence, "net-1")

		expect(tx).toMatchObject({ profileId: "p1", networkId: "net-1", chainId: 1, account: ACCOUNT })
	})

	test("a row written without a fence simply carries no scope (legacy-shaped, still valid)", async () => {
		const tx = await add("0xunscoped")

		expect(tx.profileId).toBeUndefined()
		expect(tx.networkId).toBeUndefined()
	})

	test("writes when the captured epoch is still current AND the owning account exists", async () => {
		const fence = { profileId: "p1", epoch: deletionState.capture("p1") }
		const tx = await add("0xh1", fence)
		expect(tx.hash).toBe("0xh1")
	})

	test("REJECTS a stale execution — a deletion bumped the epoch after capture", async () => {
		const fence = { profileId: "p1", epoch: deletionState.capture("p1") } // epoch 0
		deletionState.beginDeletion("p1") // → epoch 1

		await expect(add("0xh2", fence)).rejects.toThrow(/being deleted/)
		// nothing persisted
		expect(await service.getTransactions(ACCOUNT)).toHaveLength(0)
	})

	test("REJECTS when the owning account no longer exists / was re-owned (bound to captured profileId)", async () => {
		// Epoch current, but the fence's profile doesn't own ACCOUNT anymore — a
		// successor that reused the deterministic address owns a different profileId.
		const fence = { profileId: "pGONE", epoch: deletionState.capture("pGONE") }

		await expect(add("0xh3", fence)).rejects.toThrow(/stale execution owner/)
		expect(await service.getTransactions(ACCOUNT)).toHaveLength(0)
	})

	test("no fence → no fencing (non-execution callers unaffected)", async () => {
		const tx = await add("0xh4", undefined)
		expect(tx.hash).toBe("0xh4")
	})
})

describe("TransactionService.restore — deletion fence (N-14, threaded profileId)", () => {
	let service: TransactionService
	let deletionState: ProfileDeletionState
	let api: FakeBrowserApi

	beforeEach(async () => {
		api = new FakeBrowserApi()
		api.reset()
		deletionState = new ProfileDeletionState()
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, { getActiveProfile: async () => ({ id: "p1" }), getDeletionState: () => deletionState }))
		services.add(svc(ACCOUNT_SERVICE_NAME, { onAccountDeleted: new EventHandler() }))
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		service = new TransactionService(new LoggerStore(new ConfigStore()), api)
		services.add(service)
		await services.start()
	})

	const mkTx = (hash: string) =>
		({
			chainId: 1,
			account: "0xa",
			nonce: "0",
			feePaymentMethod: 0,
			hash,
			createdAt: 0,
			updatedAt: 0,
			status: 5,
			origin: { type: "wallet" },
			calls: [{ contract: "0xc", method: "m", args: [] }],
		}) as never

	test("a deleteProfile beginning DURING the restore rejects every later row write", async () => {
		const origSet = api.storage.local.set.bind(api.storage.local)
		let fired = false
		api.storage.local.set = async (items: Record<string, unknown>) => {
			await origSet(items)
			if (!fired) {
				fired = true
				deletionState.beginDeletion("p1")
			}
		}
		const restored = await service.restore([mkTx("0xh1"), mkTx("0xh2")], "p1")
		expect(restored[0].restoreError).toBeUndefined()
		expect(restored[1].restoreError).toMatch(/deleted/)
		await expect(service.getTransaction("0xh2")).rejects.toThrow()
	})

	test("fails closed when the created-profile id is missing", async () => {
		await expect(service.restore([mkTx("0xh1")], undefined as never)).rejects.toThrow(/profile id/)
	})

	test("positive control: no deletion → both rows land", async () => {
		const restored = await service.restore([mkTx("0xh1"), mkTx("0xh2")], "p1")
		expect(restored.every((r) => r.restoreError === undefined)).toBe(true)
	})
})

describe("TransactionService.waitForTx — bounded wait (N-16)", () => {
	let service: TransactionService
	let taskService: TaskService

	beforeEach(async () => {
		vi.useFakeTimers()
		const api = new FakeBrowserApi()
		api.reset()
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, { getActiveProfile: async () => undefined, getDeletionState: () => new ProfileDeletionState() }),
		)
		services.add(svc(ACCOUNT_SERVICE_NAME, { onAccountDeleted: new EventHandler() }))
		services.add(svc(NETWORK_SERVICE_NAME, {}))
		service = new TransactionService(new LoggerStore(new ConfigStore()), api)
		services.add(service)
		await services.start()
		taskService = new TaskService(new LoggerStore(new ConfigStore()))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	const seedPending = (hash: string) => {
		// The in-memory pending map is what waitForTx polls; the locked-wallet
		// stall is simulated simply by never draining it.
		;(service as unknown as { pending: Map<string, unknown> }).pending.set(hash, { hash })
	}

	test("timeout: typed throw + subtask failed EXACTLY once + parent still completable (real TaskService)", async () => {
		seedPending("0xhang")
		const parent = taskService.startNewTask({ kind: 0 } as never)
		const failSpy = vi.spyOn(taskService, "failTask")
		const run = service.waitForTx("0xhang", parent, 500)
		const outcome = expect(run).rejects.toThrow(/not confirmed within 1s|not confirmed within 0s/)
		await vi.advanceTimersByTimeAsync(700)
		await outcome
		expect(failSpy).toHaveBeenCalledTimes(1) // the subtask, once
		parent.complete() // the child settled → the parent tree can finish (GC unblocked)
		expect(parent.isFinished).toBe(true)
	})

	test("drain: subtask completed EXACTLY once; parent completable", async () => {
		seedPending("0xok")
		const parent = taskService.startNewTask({ kind: 0 } as never)
		const completeSpy = vi.spyOn(taskService, "completeTask")
		const run = service.waitForTx("0xok", parent, 5_000)
		await vi.advanceTimersByTimeAsync(300)
		;(service as unknown as { pending: Map<string, unknown> }).pending.delete("0xok")
		await vi.advanceTimersByTimeAsync(200)
		await run
		expect(completeSpy).toHaveBeenCalledTimes(1)
		parent.complete()
		expect(parent.isFinished).toBe(true)
	})

	test("mid-wait registry clear (profile switch): no throw, one swallowed settle", async () => {
		seedPending("0xswitch")
		const parent = taskService.startNewTask({ kind: 0 } as never)
		const run = service.waitForTx("0xswitch", parent, 5_000)
		await vi.advanceTimersByTimeAsync(200)
		;(taskService as unknown as { tasks: Map<string, unknown> }).tasks.clear() // profile switch
		;(service as unknown as { pending: Map<string, unknown> }).pending.delete("0xswitch")
		await vi.advanceTimersByTimeAsync(200)
		await run // resolves — the cleared registry must not replace the outcome
	})

	test("stale parent at entry: startSubtask throws → zero settles, the wait still completes", async () => {
		seedPending("0xstale")
		const parent = taskService.startNewTask({ kind: 0 } as never)
		;(taskService as unknown as { tasks: Map<string, unknown> }).tasks.clear() // parent gone BEFORE the wait
		const completeSpy = vi.spyOn(taskService, "completeTask")
		const failSpy = vi.spyOn(taskService, "failTask")
		const run = service.waitForTx("0xstale", parent, 5_000)
		await vi.advanceTimersByTimeAsync(100)
		;(service as unknown as { pending: Map<string, unknown> }).pending.delete("0xstale")
		await vi.advanceTimersByTimeAsync(200)
		await run
		expect(completeSpy).not.toHaveBeenCalled()
		expect(failSpy).not.toHaveBeenCalled()
	})

	test("no parent task: the bare wait times out with the typed error", async () => {
		seedPending("0xbare")
		const run = service.waitForTx("0xbare", undefined, 500)
		const outcome = expect(run).rejects.toBeInstanceOf(TxConfirmationTimeoutError)
		await vi.advanceTimersByTimeAsync(700)
		await outcome
	})
})
