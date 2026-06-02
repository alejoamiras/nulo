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
import { DappInteractionService } from "./service"
import type { DappInteraction, ExecutionHooks } from "./spec"

const noopLogger: ILogger = { log: () => {} }

/** Resolve after the current microtask + macrotask turn so background async
 *  (executeAndResolve's await chain) runs before assertions. */
const flush = () => new Promise((r) => setTimeout(r, 0))

/** Structural view of the privates the tests inject/drive. */
type Internals = {
	storage: Map<string, DappInteraction>
	profileService: { refreshSession: () => Promise<void>; getActiveProfile: () => Promise<{ id: string } | undefined> }
	executionService: { executeOperations: (...args: unknown[]) => Promise<unknown> }
	silentInteraction: (payload: unknown, hooks?: ExecutionHooks) => Promise<unknown>
}

function makeService(overrides: {
	executeOperations?: (...args: unknown[]) => Promise<unknown>
	getActiveProfile?: () => Promise<{ id: string } | undefined>
}) {
	const windowManager = { detach: vi.fn(), settle: vi.fn(), cancel: vi.fn() } as unknown as WindowManager
	const svc = new DappInteractionService(noopLogger, windowManager)
	const internals = svc as unknown as Internals
	internals.profileService = {
		refreshSession: vi.fn(async () => {}),
		getActiveProfile: overrides.getActiveProfile ?? (async () => ({ id: "p1" })),
	}
	internals.executionService = { executeOperations: overrides.executeOperations ?? (async () => []) }
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

	test("approveInteraction without hooks does not throw", async () => {
		const { svc, internals } = makeService({ executeOperations: async () => [] })
		const id = "interaction-3"
		internals.storage.set(id, { id, payload: emptyPayload, handleId: "handle-3", cancellationToken: id })
		await expect(svc.approveInteraction(id, [], origin)).resolves.toBeUndefined()
	})
})
