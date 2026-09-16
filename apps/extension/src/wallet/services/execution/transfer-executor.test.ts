/**
 * `TransferExecutor` — facade-parity pins for the transplanted transfer
 * flow. The coordinator pipeline is mocked (its contract is pinned in
 * `execution-coordinator.test.ts`); these tests pin the executor's own
 * choreography: journal lifecycle, controller registry usage, the
 * estimate-reuse fast path vs the rebuild path, the transfer-only
 * activity-record shape, the stash-eligibility ladder, and the authorizing
 * fence every stage answers to.
 */

import { describe, expect, test, vi } from "vitest"
import { JobCancelledError, SessionEndedError } from "@nulo/extension-messaging/errors"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { TransferType } from "@/wallet/services/transaction/service"
import type { TransferRequest } from "./operation-planner"
import { TransferExecutor, type TransferExecutorDeps } from "./transfer-executor"

const TOKEN = { contract: "0xtoken", name: "Test", symbol: "TST", decimals: 18 }
const FEE_SETTINGS = { paymentMethod: { kind: "fj" } } as never
const FENCE = { profileId: "p1", epoch: 0, session: 1 }

function makeTxRequest() {
	return {
		txContext: {
			gasSettings: {
				gasLimits: { daGas: 100, l2Gas: 200 },
				teardownGasLimits: { daGas: 10, l2Gas: 20 },
				maxFeesPerGas: { feePerDaGas: 2n, feePerL2Gas: 3n },
			},
		},
	} as never
}
// maxFee for the fixture: (100+10)*2 + (200+20)*3 = 880.

function makeReq(overrides: Partial<TransferRequest> = {}): TransferRequest {
	return {
		networkId: "net-1",
		accountAddress: "0xme",
		tokenId: 1,
		transferType: TransferType.Private,
		recipientAddress: "0xyou",
		amount: 5n,
		feeSettings: FEE_SETTINGS,
		...overrides,
	}
}

function makeHarness(overrides: Partial<TransferExecutorDeps> = {}) {
	const task = { complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
	const network = {
		chainId: 7,
		endpoints: [{ id: "e1", rpcUrl: "http://primary" }],
		primaryEndpointId: "e1",
	} as never
	const built = {
		txRequest: makeTxRequest(),
		initializesAccount: true,
		node: { kind: "node" },
		pxe: { kind: "pxe" },
		account: { address: "0xacct-addr" },
		network,
		nonce: { toString: () => "42" },
		feePaymentMethod: { kind: "fee_juice" },
	}
	const proveAndSend = vi.fn(async (ctx: { recordTransaction: (h: string) => Promise<unknown> }) => {
		await ctx.recordTransaction("0xhash")
		return { txHash: { toString: () => "0xhash" }, offchainOutput: undefined }
	})
	const deps: TransferExecutorDeps = {
		tasks: { startNewTask: vi.fn(() => task) } as never,
		planner: {
			buildTransferOperation: vi.fn(async (req: TransferRequest) => ({
				op: { networkId: req.networkId, accountAddress: req.accountAddress, actions: [], feeSettings: req.feeSettings },
				token: TOKEN,
				fn: { name: "transfer_private" },
				args: ["0xme", "0xyou", 5n],
			})),
		} as never,
		estimateReuse: { tryConsume: vi.fn(async () => undefined), stash: vi.fn() } as never,
		coordinator: { proveAndSend } as never,
		lane: { registerInFlight: vi.fn(() => ({ live: true })), deleteController: vi.fn() },
		getActiveProfile: vi.fn(async () => ({ id: "p1" }) as never),
		captureExecutionFence: vi.fn(async () => FENCE),
		assertFence: vi.fn(async () => {}),
		isFenceLive: vi.fn(() => true),
		getNetwork: vi.fn(async () => network),
		getNode: vi.fn(async () => ({ kind: "node" }) as never),
		getPXE: vi.fn(() => ({ kind: "pxe" }) as never),
		getAccountContract: vi.fn(async () => ({ address: "0xacct-addr" }) as never),
		getPendingForAccount: vi.fn(() => [{ hash: "0xpending" }] as never),
		addTransaction: vi.fn(async () => ({}) as never),
		buildAndEstimate: vi.fn(async () => built as never),
		createJournalOperation: vi.fn(async (input) => ({ id: "j1", ...input }) as never),
		transitionJournal: vi.fn(async () => ({})),
		logDebug: vi.fn(),
		logError: vi.fn(),
		...overrides,
	}
	return { deps, task, built, proveAndSend, executor: new TransferExecutor(deps) }
}

describe("TransferExecutor.execute", () => {
	test("the task's TransferContent is stamped with the request's networkId", async () => {
		// The producer stamp is what lets the activity view scope transfer tasks
		// per network — a UI test supplying the field manually cannot see it vanish.
		const { executor, deps } = makeHarness()
		await executor.execute(makeReq(), undefined, FENCE)
		const content = (deps.tasks.startNewTask as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
			networkId?: string
		}
		expect(content.networkId).toBe("net-1")
	})

	test("rebuild path: planner + buildAndEstimate, transfer-only activity record, scopes = [account.address]", async () => {
		const { executor, deps, task, proveAndSend } = makeHarness()
		const result = await executor.execute(makeReq(), undefined, FENCE)

		expect(result).toBe("0xhash")
		expect(deps.planner.buildTransferOperation).toHaveBeenCalledTimes(1)
		expect(deps.buildAndEstimate).toHaveBeenCalledTimes(1)
		// Journal record carries the transfer metadata for terminal cards.
		expect(deps.createJournalOperation).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "transfer", origin: "popup", amountRaw: "5", recipientAddress: "0xyou" }),
		)
		// `simulating` entered before the pipeline runs.
		expect(deps.transitionJournal).toHaveBeenCalledWith("j1", { stage: "simulating" }, undefined)
		const ctx = (proveAndSend.mock.calls[0] as unknown[])[0] as { scopes: unknown[] }
		expect(ctx.scopes).toEqual(["0xacct-addr"])
		// Activity record stays transfer-only: planner's fn/token, never txCalls.
		const txCallArgs = (deps.addTransaction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect((txCallArgs[3] as Array<{ method: string }>)[0].method).toBe("transfer_private")
		expect(txCallArgs[4]).toBe("42")
		expect(task.complete).toHaveBeenCalledTimes(1)
		// Controller registered under journalId, removed in finally.
		expect(deps.lane.registerInFlight).toHaveBeenCalledWith("j1", FENCE.session, expect.any(AbortController))
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})

	test("reuse path: snapshot consumed, planner + buildAndEstimate skipped, snapshot shapes the record", async () => {
		const snapshot = {
			txRequest: makeTxRequest(),
			nonce: { toString: () => "99" },
			feePaymentMethod: { kind: "fee_juice" },
			token: TOKEN,
			fnName: "transfer_private",
			args: ["0xme", "0xyou", 5n],
		}
		const { executor, deps, proveAndSend } = makeHarness({
			estimateReuse: { tryConsume: vi.fn(async () => ({ ...snapshot, initializesAccount: true })), stash: vi.fn() } as never,
		})
		const result = await executor.execute(makeReq(), "est-1", FENCE)

		expect(result).toBe("0xhash")
		expect(deps.planner.buildTransferOperation).not.toHaveBeenCalled()
		expect(deps.buildAndEstimate).not.toHaveBeenCalled()
		// (N-15) the cached build's provenance reaches the send context — a
		// dropped executor assignment would classify a real init race generic.
		const reuseCtx = (proveAndSend.mock.calls[0] as unknown[])[0] as { initializesAccount?: boolean }
		expect(reuseCtx.initializesAccount).toBe(true)
		// Reuse path resolves its own network/node/pxe/account bindings.
		expect(deps.getNetwork).toHaveBeenCalledWith("net-1")
		expect(deps.getAccountContract).toHaveBeenCalledWith("p1", 7, "0xme")
		const txCallArgs = (deps.addTransaction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(txCallArgs[4]).toBe("99")
	})

	test("journal creation failing: no journal, no controller, flow still completes", async () => {
		const { executor, deps, task } = makeHarness({
			createJournalOperation: vi.fn(async () => {
				throw new Error("journal write failed")
			}),
		})
		const result = await executor.execute(makeReq(), undefined, FENCE)

		expect(result).toBe("0xhash")
		expect(deps.lane.registerInFlight).not.toHaveBeenCalled()
		expect(deps.transitionJournal).not.toHaveBeenCalled()
		expect(task.complete).toHaveBeenCalledTimes(1)
	})

	test("build failure: journal → failed with normalized error, task.fail, controller cleanup", async () => {
		const boom = new Error("estimate blew up")
		const { executor, deps, task } = makeHarness({ buildAndEstimate: vi.fn(async () => Promise.reject(boom)) })
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toThrow("estimate blew up")

		expect(deps.transitionJournal).toHaveBeenCalledWith(
			"j1",
			{ stage: "failed" },
			expect.objectContaining({ message: expect.stringContaining("estimate blew up") }),
		)
		expect(task.fail).toHaveBeenCalledWith(boom)
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})

	test("cancel before pipeline: JobCancelledError surfaces, NO failed transition, task.cancel fires", async () => {
		const { executor, deps, task } = makeHarness({
			lane: {
				// Abort immediately on registration: the first checkCancelled()
				// after `simulating` short-circuits with the sentinel.
				registerInFlight: vi.fn((_id: string, _serial: number, controller: AbortController) => {
					controller.abort()
					return { live: true }
				}),
				deleteController: vi.fn(),
			},
		})
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toBeInstanceOf(JobCancelledError)

		const stages = (deps.transitionJournal as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { stage: string }).stage)
		expect(stages).not.toContain("failed")
		expect(task.cancel).toHaveBeenCalledTimes(1)
		expect(task.fail).not.toHaveBeenCalled()
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})
})

describe("TransferExecutor: the authorizing session", () => {
	const fence = { profileId: "p-fence", epoch: 3, session: 4 }
	const sessionEnded = expect.objectContaining({ kind: "session_ended" })
	const firstCall = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
	const order = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
	const snapshot = () => ({
		txRequest: makeTxRequest(),
		initializesAccount: false,
		nonce: { toString: () => "99" },
		feePaymentMethod: { kind: "fee_juice" },
		token: TOKEN,
		fnName: "transfer_private",
		args: [],
	})

	test("journal, controller, build and send checks answer to the fence, never the active profile", async () => {
		const { executor, deps, proveAndSend } = makeHarness({ getActiveProfile: vi.fn(async () => ({ id: "p-active" }) as never) })
		await executor.execute(makeReq(), undefined, fence)

		expect(deps.createJournalOperation).toHaveBeenCalledWith(expect.objectContaining({ profileId: "p-fence", profileEpoch: 3 }))
		expect(deps.lane.registerInFlight).toHaveBeenCalledWith("j1", 4, expect.any(AbortController))
		expect(firstCall(deps.buildAndEstimate)[2]).toBe(fence)
		expect(deps.getActiveProfile).not.toHaveBeenCalled()
		const ctx = firstCall(proveAndSend)[0] as { assertAuthorization: () => Promise<void>; assertLive: () => void }
		await ctx.assertAuthorization()
		expect(deps.assertFence).toHaveBeenLastCalledWith(fence)
		;(deps.isFenceLive as ReturnType<typeof vi.fn>).mockReturnValue(false)
		expect(() => ctx.assertLive()).toThrow(SessionEndedError)
		expect(deps.isFenceLive).toHaveBeenLastCalledWith(fence)
	})

	test("a dead registration: nothing registered, no reuse, no build, no send, failed/session_ended", async () => {
		const { executor, deps, task, proveAndSend } = makeHarness({
			lane: { registerInFlight: vi.fn(() => ({ live: false })), deleteController: vi.fn() },
			estimateReuse: { tryConsume: vi.fn(async () => snapshot()), stash: vi.fn() } as never,
		})
		await expect(executor.execute(makeReq(), "est-1", fence)).rejects.toBeInstanceOf(SessionEndedError)

		expect(deps.estimateReuse.tryConsume).not.toHaveBeenCalled()
		expect(deps.buildAndEstimate).not.toHaveBeenCalled()
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.transitionJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, sessionEnded)
		expect(task.fail).toHaveBeenCalledWith(expect.any(SessionEndedError))
	})

	test("reuse compares against the fence, and the reused arm asserts it before resolving the fence's account", async () => {
		const { executor, deps } = makeHarness({
			estimateReuse: { tryConsume: vi.fn(async () => snapshot()), stash: vi.fn() } as never,
		})
		const req = makeReq()
		await executor.execute(req, "est-1", fence)

		expect(deps.estimateReuse.tryConsume).toHaveBeenCalledWith("est-1", req, fence)
		expect(deps.getAccountContract).toHaveBeenCalledWith("p-fence", 7, "0xme")
		expect(order(deps.assertFence)).toBeLessThan(order(deps.getAccountContract))
	})

	test("tryConsume refusing another profile's entry: the fresh build is never attempted, failed/session_ended", async () => {
		const { executor, deps, proveAndSend } = makeHarness({
			estimateReuse: {
				tryConsume: vi.fn(async () => {
					throw new SessionEndedError()
				}),
				stash: vi.fn(),
			} as never,
		})
		await expect(executor.execute(makeReq(), "est-1", fence)).rejects.toBeInstanceOf(SessionEndedError)

		expect(deps.planner.buildTransferOperation).not.toHaveBeenCalled()
		expect(deps.buildAndEstimate).not.toHaveBeenCalled()
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.transitionJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, sessionEnded)
	})

	test("without a journal the transfer runs uncancellable, and a session end still stops it at the build's assert", async () => {
		const { executor, deps, task, proveAndSend } = makeHarness({
			createJournalOperation: vi.fn(async () => {
				throw new Error("journal write failed")
			}),
			buildAndEstimate: vi.fn(async () => {
				throw new SessionEndedError()
			}),
		})
		await expect(executor.execute(makeReq(), undefined, fence)).rejects.toBeInstanceOf(SessionEndedError)

		expect(deps.lane.registerInFlight).not.toHaveBeenCalled()
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.transitionJournal).not.toHaveBeenCalled()
		expect(task.fail).toHaveBeenCalledWith(expect.any(SessionEndedError))
	})

	test("estimateFee builds under the fence captured at its entry; a locked wallet plans nothing", async () => {
		const { executor, deps } = makeHarness()
		await executor.estimateFee(makeReq())
		expect(firstCall(deps.buildAndEstimate)[2]).toBe(FENCE)

		const locked = makeHarness({
			captureExecutionFence: vi.fn(async () => {
				throw new Error("Wallet locked")
			}),
		})
		await expect(locked.executor.estimateFee(makeReq())).rejects.toThrow("Wallet locked")
		expect(locked.deps.planner.buildTransferOperation).not.toHaveBeenCalled()
		expect(locked.deps.buildAndEstimate).not.toHaveBeenCalled()
	})
})

describe("TransferExecutor.estimateFee", () => {
	test("fj: stash written, estimateId returned, fee projected from finalized gas settings", async () => {
		const { executor, deps } = makeHarness()
		const result = await executor.estimateFee(makeReq())

		expect(result.maxFee).toBe("880")
		expect(result.estimateId).toBeDefined()
		expect(deps.estimateReuse.stash).toHaveBeenCalledTimes(1)
		const stashed = (deps.estimateReuse.stash as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(stashed[0]).toBe(result.estimateId)
		expect(stashed[1]).toMatchObject({
			profileId: "p1",
			primaryEndpointId: "e1",
			pendingHashes: ["0xpending"],
			baseFeeFingerprint: "2:3",
			// (N-15) the stash persists the BUILD's provenance (the harness build
			// sets true) — a hardcoded false here would strip classification
			// from every estimate→confirm transfer.
			initializesAccount: true,
			fnName: "transfer_private",
		})
	})

	test("embedded: reuse not offered — no stash, estimateId undefined", async () => {
		const { executor, deps } = makeHarness()
		const result = await executor.estimateFee(makeReq({ feeSettings: { paymentMethod: { kind: "embedded" } } as never }))

		expect(result.maxFee).toBe("880")
		expect(result.estimateId).toBeUndefined()
		expect(deps.estimateReuse.stash).not.toHaveBeenCalled()
	})

	test("stash failure is best-effort: estimate still returned, estimateId dropped", async () => {
		const { executor } = makeHarness({
			estimateReuse: {
				tryConsume: vi.fn(),
				stash: vi.fn(() => {
					throw new Error("cache write failed")
				}),
			} as never,
		})
		const result = await executor.estimateFee(makeReq())

		expect(result.maxFee).toBe("880")
		expect(result.estimateId).toBeUndefined()
	})
})

describe("TransferExecutor.estimateFee cancellation", () => {
	test("pre-aborted signal: sentinel thrown before any pipeline work, nothing stashed", async () => {
		const { executor, deps } = makeHarness()
		const controller = new AbortController()
		controller.abort()

		await expect(executor.estimateFee(makeReq(), controller.signal)).rejects.toThrow(JobCancelledSentinel)
		expect(deps.planner.buildTransferOperation).not.toHaveBeenCalled()
		expect(deps.buildAndEstimate).not.toHaveBeenCalled()
		expect(deps.estimateReuse.stash).not.toHaveBeenCalled()
	})

	test("cancel landing during the sim: estimate rejects and NO reuse entry is stashed", async () => {
		const controller = new AbortController()
		const { executor, deps, built } = makeHarness()
		// The abort arrives while buildAndEstimate (the simulation stage) is
		// in flight — the post-sim checkpoint must block the stash so a
		// cancelled estimate never leaves a signed request cached.
		;(deps.buildAndEstimate as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			controller.abort()
			return built as never
		})

		await expect(executor.estimateFee(makeReq(), controller.signal)).rejects.toThrow(JobCancelledSentinel)
		expect(deps.estimateReuse.stash).not.toHaveBeenCalled()
	})

	test("signal forwarded into buildAndEstimate so multi-pass strategies can bail between passes", async () => {
		const { executor, deps } = makeHarness()
		const controller = new AbortController()
		await executor.estimateFee(makeReq(), controller.signal)
		const call = (deps.buildAndEstimate as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(call[4]).toBe(controller.signal)
	})
})
