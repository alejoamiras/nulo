/**
 * DappInteractionService — approval-seam baton release (v3 activation).
 *
 * Pins the behavior the previously-dead hook never delivered: the session
 * FIFO baton is released at the APPROVAL seam, not at execution completion.
 * Two seams must fire `onInteractionApproved`:
 *   - `approveInteraction` — the user approves the popup.
 *   - `silentInteraction`  — a no-popup (self-paid) request begins executing.
 * Both must fire while execution is still in flight, so the next pending dApp
 * message's popup can open in parallel (on-chain ordering stays serialized
 * downstream by the execution mutex).
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

/** Structural view of the privates the seam tests inject/drive. */
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
	const windowManager = {
		detach: vi.fn(),
		settle: vi.fn(),
		cancel: vi.fn(),
	} as unknown as WindowManager
	const svc = new DappInteractionService(noopLogger, windowManager)
	const internals = svc as unknown as Internals
	internals.profileService = {
		refreshSession: vi.fn(async () => {}),
		getActiveProfile: overrides.getActiveProfile ?? (async () => ({ id: "p1" })),
	}
	internals.executionService = {
		executeOperations: overrides.executeOperations ?? (async () => []),
	}
	return { svc, internals, windowManager }
}

const emptyPayload = { params: { operations: [] }, session: {} } as unknown as DappInteraction["payload"]
const origin: LocalTxOrigin = { type: OriginType.DAPP, name: "test-dapp" }

describe("DappInteractionService approval-seam baton release", () => {
	test("approveInteraction fires onInteractionApproved at approval, not gated on execution completion", async () => {
		const releaseSpy = vi.fn()
		// executeOperations never resolves: settle() only runs once it does, so
		// "settle not called" proves the release did NOT wait for execution.
		const executeOperations = vi.fn(() => new Promise<unknown>(() => {}))
		const { svc, internals, windowManager } = makeService({ executeOperations })

		const id = "interaction-1"
		internals.storage.set(id, {
			id,
			payload: emptyPayload,
			handleId: "handle-1",
			cancellationToken: id,
			hooks: { onInteractionApproved: releaseSpy },
		})

		await svc.approveInteraction(id, [], origin)

		// Released on approval.
		expect(releaseSpy).toHaveBeenCalledTimes(1)

		// Execution kicks off in the background and stays pending forever; the
		// popup is never settled. The release already fired exactly once — it is
		// not coupled to execution finishing.
		await flush()
		expect(executeOperations).toHaveBeenCalledTimes(1)
		expect(releaseSpy).toHaveBeenCalledTimes(1)
		expect(windowManager.settle).not.toHaveBeenCalled()
	})

	test("approveInteraction without hooks does not throw (no-op release)", async () => {
		const { svc, internals } = makeService({ executeOperations: async () => [] })
		const id = "interaction-2"
		internals.storage.set(id, {
			id,
			payload: emptyPayload,
			handleId: "handle-2",
			cancellationToken: id,
		})
		await expect(svc.approveInteraction(id, [], origin)).resolves.toBeUndefined()
	})

	test("silentInteraction fires onInteractionApproved before executeOperations resolves", async () => {
		const releaseSpy = vi.fn()
		const executeOperations = vi.fn(() => new Promise<unknown>(() => {}))
		const { internals } = makeService({ executeOperations, getActiveProfile: async () => ({ id: "p1" }) })

		const payload = {
			params: { operations: [] },
			session: { profileId: "p1", dappMetadata: { name: "test-dapp" } },
		}
		const hooks: ExecutionHooks = { onInteractionApproved: releaseSpy }

		// Don't await: executeOperations hangs by design. Drive microtasks instead.
		void internals.silentInteraction(payload, hooks)
		await flush()

		expect(releaseSpy).toHaveBeenCalledTimes(1)
		expect(executeOperations).toHaveBeenCalledTimes(1)
	})
})
