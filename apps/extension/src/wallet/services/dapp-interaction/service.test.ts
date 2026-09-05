/**
 * DappInteractionService — execution-hook forwarding (v3 parallel popups).
 *
 * Contract: DappInteractionService FORWARDS the execution hooks bag to
 * `executeOperations` — it must NOT fire `onExecutionEnqueued` itself. The
 * baton release fires downstream in `ExecutionService.acquireExecutionSlot`,
 * once the request has enqueued on the execution mutex (which is what preserves
 * execution order across concurrent popups). These tests pin "hooks reach
 * executeOperations intact, and are not fired prematurely at the popup/silent
 * seam" — the field-name + threading half of the wiring whose drift left the
 * release dead pre-v3.
 *
 * Construction injects partial service mocks directly — standing up the full
 * six-service graph `init()` pulls would be far heavier than the seam under
 * test warrants. `chrome.*` is stubbed by tests/vitest.setup.ts.
 */

import type { ILogger } from "@/wallet/logger"
import { type LocalTxOrigin, OriginType } from "@/wallet/services/transaction/service"
import type { WindowManager } from "@/wallet/services/window-manager/window-manager"
import { describe, expect, test, vi } from "vitest"
import { JobCancelledError, UserRejectedError } from "@nulo/extension-messaging/errors"
import { DappInteractionService } from "./service"
import type { DappInteraction, ExecutionHooks } from "./spec"

const noopLogger: ILogger = { log: () => {} }

/** Resolve after the current microtask + macrotask turn so background async
 *  (executeAndResolve's await chain) runs before assertions. */
const flush = () => new Promise((r) => setTimeout(r, 0))

/** Structural view of the privates the tests inject/drive. */
type Internals = {
	storage: Map<string, DappInteraction>
	profileService: {
		refreshSession: () => Promise<void>
		getActiveProfile: () => Promise<{ id: string } | undefined>
		captureExecutionFence: () => Promise<{ profileId: string; epoch: number }>
	}
	executionService: { executeOperations: (...args: unknown[]) => Promise<unknown> }
	dappSessionService: { tryGetDappSession: (id: string) => Promise<{ profileId: string } | undefined> }
	silentInteraction: (payload: unknown, hooks?: ExecutionHooks) => Promise<unknown>
}

function makeService(overrides: {
	executeOperations?: (...args: unknown[]) => Promise<unknown>
	getActiveProfile?: () => Promise<{ id: string } | undefined>
	tryGetDappSession?: (id: string) => Promise<{ profileId: string } | undefined>
}) {
	const windowManager = { detach: vi.fn(), settle: vi.fn(), cancel: vi.fn() } as unknown as WindowManager
	const svc = new DappInteractionService(noopLogger, windowManager)
	const internals = svc as unknown as Internals
	internals.profileService = {
		refreshSession: vi.fn(async () => {}),
		getActiveProfile: overrides.getActiveProfile ?? (async () => ({ id: "p1" })),
		// Derived from the same override so a test's active-profile choice drives
		// both the silent path's id read and executeAndResolve's atomic capture.
		captureExecutionFence: async () => {
			const p = await internals.profileService.getActiveProfile()
			if (!p) throw new Error("Wallet locked")
			return { profileId: p.id, epoch: 0 }
		},
	}
	internals.executionService = { executeOperations: overrides.executeOperations ?? (async () => []) }
	// Live-by-default: executeAndResolve re-validates the session ROW at
	// approval; the default keeps the happy-path tests unchanged.
	internals.dappSessionService = {
		tryGetDappSession: overrides.tryGetDappSession ?? (async () => ({ profileId: "p1" })),
	}
	return { svc, internals }
}

// session.profileId matches makeService's default getActiveProfile ({ id: "p1" })
// so the executeAndResolve active-profile guard passes.
const emptyPayload = { params: { operations: [] }, session: { profileId: "p1" } } as unknown as DappInteraction["payload"]
const origin: LocalTxOrigin = { type: OriginType.DAPP, name: "test-dapp" }

describe("DappInteractionService forwards execution hooks (does not fire the baton release)", () => {
	test("approveInteraction (popup path) forwards the stored hooks to executeOperations", async () => {
		const releaseSpy = vi.fn()
		let observedHooks: ExecutionHooks | undefined
		const executeOperations = vi.fn(async (...args: unknown[]) => {
			observedHooks = args[3] as ExecutionHooks | undefined
			return []
		})
		const { svc, internals } = makeService({ executeOperations })

		const id = "interaction-1"
		internals.storage.set(id, {
			id,
			payload: emptyPayload,
			handleId: "handle-1",
			cancellationToken: id,
			hooks: { onExecutionEnqueued: releaseSpy, queuedJournalId: "q-1", originKey: "https://dapp.example" },
		})

		await svc.approveInteraction(id, [], origin)
		await flush()

		expect(executeOperations).toHaveBeenCalledTimes(1)
		expect(observedHooks?.onExecutionEnqueued).toBe(releaseSpy)
		expect(observedHooks?.queuedJournalId).toBe("q-1")
		// originKey rides the same bag through to executeOperations (→ the cap).
		expect(observedHooks?.originKey).toBe("https://dapp.example")
		// The release is NOT fired by DappInteractionService — ExecutionService
		// fires it once the request enqueues on the mutex.
		expect(releaseSpy).not.toHaveBeenCalled()
	})

	test("executeAndResolve threads the AUTHORIZATION capture into executeOperations (F11)", async () => {
		// The fence must be the capture made at the session re-validation —
		// upstream of the refreshSession park — so entry-asserting ops commit
		// against the authorization-time incarnation.
		let observedFence: unknown
		const executeOperations = vi.fn(async (...args: unknown[]) => {
			observedFence = args[5]
			return []
		})
		const { svc, internals } = makeService({ executeOperations })
		const id = "interaction-fence"
		internals.storage.set(id, {
			id,
			payload: emptyPayload,
			handleId: "handle-f",
			cancellationToken: id,
		} as unknown as DappInteraction)

		await svc.approveInteraction(id, [], origin)
		await flush()

		expect(executeOperations).toHaveBeenCalledTimes(1)
		expect(observedFence).toEqual({ profileId: "p1", epoch: 0 })
	})

	test("executeAndResolve aborts when the session ROW is gone — delete+re-import cannot ride an old approval", async () => {
		// The payload's session is a snapshot from interaction CREATION; a delete
		// + same-id re-import settling while the popup sat open makes the fence
		// capture observe the successor's epoch (it passes). The purged session
		// row is the discriminator: a re-import never resurrects it.
		const executeOperations = vi.fn(async () => [])
		const { svc, internals } = makeService({ executeOperations, tryGetDappSession: async () => undefined })
		const id = "interaction-dead-session"
		internals.storage.set(id, {
			id,
			payload: emptyPayload,
			handleId: "handle-d",
			cancellationToken: id,
		} as unknown as DappInteraction)

		await svc.approveInteraction(id, [], origin)
		await flush()

		expect(executeOperations).not.toHaveBeenCalled()
	})

	test("executeAndResolve aborts (no dispatch) when the capture's profile differs from the session's", async () => {
		const executeOperations = vi.fn(async () => [])
		const { svc, internals } = makeService({ executeOperations, getActiveProfile: async () => ({ id: "p2" }) })
		const id = "interaction-mismatch"
		internals.storage.set(id, {
			id,
			payload: emptyPayload,
			handleId: "handle-m",
			cancellationToken: id,
		} as unknown as DappInteraction)

		await svc.approveInteraction(id, [], origin)
		await flush()

		expect(executeOperations).not.toHaveBeenCalled()
	})

	test("silentInteraction forwards the hooks to executeOperations", async () => {
		const releaseSpy = vi.fn()
		let observedHooks: ExecutionHooks | undefined
		const executeOperations = vi.fn(async (...args: unknown[]) => {
			observedHooks = args[3] as ExecutionHooks | undefined
			return []
		})
		const { internals } = makeService({ executeOperations, getActiveProfile: async () => ({ id: "p1" }) })

		// No queuedJournalId → skip the queued→pending fast-forward (which would
		// touch operationJournal); the hook-forwarding contract is what we pin.
		const payload = { params: { operations: [] }, session: { profileId: "p1", dappMetadata: { name: "test-dapp" } } }
		const hooks: ExecutionHooks = { onExecutionEnqueued: releaseSpy, originKey: "https://dapp.example" }

		await internals.silentInteraction(payload, hooks)

		expect(executeOperations).toHaveBeenCalledTimes(1)
		expect(observedHooks?.onExecutionEnqueued).toBe(releaseSpy)
		expect(observedHooks?.originKey).toBe("https://dapp.example")
		expect(releaseSpy).not.toHaveBeenCalled()
	})

	// AUTHZ guard pin (Q19): silentInteraction's check is an IDENTITY guard
	// (`profile?.id !== session.profileId`), NOT a mere absence guard. The
	// requireActiveProfile sweep must NEVER collapse it to "profile exists" —
	// doing so would let a DIFFERENT still-unlocked profile execute a dApp
	// request approved under another profile. These two cases pin both arms.
	test('silentInteraction throws "Wallet locked" when the active profile DIFFERS from the session profile', async () => {
		const executeOperations = vi.fn(async () => [])
		const { internals } = makeService({ executeOperations, getActiveProfile: async () => ({ id: "p2" }) })
		const payload = { params: { operations: [] }, session: { profileId: "p1", dappMetadata: { name: "test-dapp" } } }

		await expect(internals.silentInteraction(payload)).rejects.toThrow("Wallet locked")
		expect(executeOperations).not.toHaveBeenCalled()
	})

	test('silentInteraction throws "Wallet locked" when the wallet is locked (no active profile)', async () => {
		const executeOperations = vi.fn(async () => [])
		const { internals } = makeService({ executeOperations, getActiveProfile: async () => undefined })
		const payload = { params: { operations: [] }, session: { profileId: "p1", dappMetadata: { name: "test-dapp" } } }

		await expect(internals.silentInteraction(payload)).rejects.toThrow("Wallet locked")
		expect(executeOperations).not.toHaveBeenCalled()
	})

	test("approveInteraction without hooks does not throw", async () => {
		const { svc, internals } = makeService({ executeOperations: async () => [] })
		const id = "interaction-3"
		internals.storage.set(id, { id, payload: emptyPayload, handleId: "handle-3", cancellationToken: id })
		await expect(svc.approveInteraction(id, [], origin)).resolves.toBeUndefined()
	})
})

describe("DappInteractionService cancellation linearization (first service claim wins)", () => {
	const seed = (internals: Internals, id: string) => {
		internals.storage.set(id, {
			id,
			payload: emptyPayload,
			handleId: `handle-${id}`,
			cancellationToken: id,
		})
	}

	test("cancel processed first → later approve throws JobCancelledError, execution never starts, record retained", async () => {
		const executeOperations = vi.fn(async () => [])
		const { svc, internals } = makeService({ executeOperations })
		seed(internals, "i-1")

		svc.cancelInteraction("i-1")
		await expect(svc.approveInteraction("i-1", [], origin)).rejects.toBeInstanceOf(JobCancelledError)
		await flush()
		expect(executeOperations).not.toHaveBeenCalled()
		// The record survives until window dismissal — overlay + cleanup rely on it.
		expect(internals.storage.has("i-1")).toBe(true)
		await expect(svc.isInteractionCancelled("i-1")).resolves.toBe(true)
	})

	test("rejectInteraction hands the window manager a UserRejectedError carrying the reason", async () => {
		const { svc, internals } = makeService({})
		seed(internals, "i-r")
		const cancel = (internals as unknown as { windowManager: { cancel: ReturnType<typeof vi.fn> } }).windowManager.cancel

		await svc.rejectInteraction("i-r", "User rejected")

		expect(cancel).toHaveBeenCalledTimes(1)
		const [handleId, reason] = cancel.mock.calls[0] as [string, unknown]
		expect(handleId).toBe("handle-i-r")
		expect(reason).toBeInstanceOf(UserRejectedError)
		expect((reason as UserRejectedError).message).toBe("User rejected")
		expect(internals.storage.has("i-r")).toBe(false)
	})

	test("approve claimed first → later cancel finds nothing, approval proceeds exactly once", async () => {
		const executeOperations = vi.fn(async () => [])
		const { svc, internals } = makeService({ executeOperations })
		seed(internals, "i-2")
		const cancelled: string[] = []
		svc.onInteractionCancelled.add((id) => cancelled.push(id))

		await svc.approveInteraction("i-2", [], origin)
		svc.cancelInteraction("i-2")
		await flush()
		expect(executeOperations).toHaveBeenCalledTimes(1)
		expect(cancelled).toEqual([])
	})

	test("resolveInteraction refuses a cancelled record too (capability/discovery parity)", async () => {
		const { svc, internals } = makeService({})
		seed(internals, "i-4")
		svc.cancelInteraction("i-4")
		await expect(svc.resolveInteraction("i-4", { approved: true })).rejects.toBeInstanceOf(JobCancelledError)
		expect(internals.storage.has("i-4")).toBe(true)
	})

	test("the cancelled flag is DURABLE before the broadcast — a late subscriber replays it", async () => {
		const { svc, internals } = makeService({})
		seed(internals, "i-3")
		// No subscriber attached when the cancel fires (the lost-event case).
		svc.cancelInteraction("i-3")
		await expect(svc.isInteractionCancelled("i-3")).resolves.toBe(true)
		// An unknown id reads false, never throws (replay must be safe pre-load).
		await expect(svc.isInteractionCancelled("missing")).resolves.toBe(false)
	})
})
