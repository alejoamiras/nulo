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
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { Gas, GasFees, GasSettings } from "@aztec-labs/stdlib/gas"
import { JobCancelledError, JournaledRejection, OperationNotRecordedError, SessionEndedError } from "@nulo/extension-messaging/errors"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { OriginType, TransferType } from "@/wallet/services/transaction/service"
import type { ProveAndSendContext } from "./execution-coordinator"
import type { TransferRequest } from "./operation-planner"
import { TransferExecutor, type TransferExecutorDeps } from "./transfer-executor"

// The balance slot's poseidon2 runs Barretenberg WASM, which crashes under jsdom; the slot itself is
// pinned in fee-juice-balance.test.ts.
vi.mock("@aztec-labs/protocol-contracts/fee-juice", async (importOriginal) => {
	const { Fr } = await import("@aztec-labs/foundation/curves/bn254")
	return { ...(await importOriginal<object>()), computeFeePayerBalanceStorageSlot: vi.fn(async () => new Fr(0x51n)) }
})

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
		readPublicStorageOnce: vi.fn(async () => new Fr(0n)),
		...overrides,
	}
	return { deps, task, built, proveAndSend, executor: new TransferExecutor(deps) }
}

const RECORD_FIELDS = [
	"origin",
	"chainId",
	"account",
	"calls",
	"nonce",
	"feePaymentMethod",
	"hash",
	"submittedEndpointUrl",
	"estimatedFee",
	"gasDetails",
	"fence",
	"networkId",
] as const

/** The activity record `addTransaction` received, by field name. */
function recordedTx(deps: TransferExecutorDeps): Record<(typeof RECORD_FIELDS)[number], unknown> {
	const args = (deps.addTransaction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
	expect(args).toHaveLength(1)
	const input = args[0] as Record<(typeof RECORD_FIELDS)[number], unknown>
	// Key order is evaluation order: the literal must read its values in the field order.
	expect(Object.keys(input)).toEqual([...RECORD_FIELDS])
	return input
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
		const record = recordedTx(deps)
		expect((record.calls as Array<{ method: string }>)[0].method).toBe("transfer_private")
		expect(record.nonce).toBe("42")
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
		expect(recordedTx(deps).nonce).toBe("99")
	})

	test("journal creation throwing: the transfer is refused before any build", async () => {
		const { executor, deps, task, proveAndSend } = makeHarness({
			createJournalOperation: vi.fn(async () => {
				throw new Error("journal write failed")
			}),
		})
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toBeInstanceOf(OperationNotRecordedError)
		expect(deps.logError).toHaveBeenCalledWith("Failed to create journal operation", expect.any(Error))

		expect(deps.lane.registerInFlight).not.toHaveBeenCalled()
		expect(deps.buildAndEstimate).not.toHaveBeenCalled()
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.transitionJournal).not.toHaveBeenCalled()
		expect(task.complete).not.toHaveBeenCalled()
		expect(task.fail).toHaveBeenCalledTimes(1)
	})

	test("a typed wallet error from journal creation keeps its class", async () => {
		const { executor, proveAndSend } = makeHarness({
			createJournalOperation: vi.fn(async () => {
				throw new SessionEndedError()
			}),
		})
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toBeInstanceOf(SessionEndedError)
		expect(proveAndSend).not.toHaveBeenCalled()
	})

	test("a journal record with no id: the transfer is refused before any build", async () => {
		const { executor, deps, task, proveAndSend } = makeHarness({
			createJournalOperation: vi.fn(async () => ({}) as never),
		})
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toBeInstanceOf(OperationNotRecordedError)

		expect(deps.lane.registerInFlight).not.toHaveBeenCalled()
		expect(deps.buildAndEstimate).not.toHaveBeenCalled()
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.transitionJournal).not.toHaveBeenCalled()
		expect(task.fail).toHaveBeenCalledTimes(1)
	})

	test("build failure: journal → failed with normalized error, task.fail, controller cleanup", async () => {
		const boom = new Error("estimate blew up")
		const { executor, deps, task, proveAndSend } = makeHarness({ buildAndEstimate: vi.fn(async () => Promise.reject(boom)) })
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toStrictEqual(new JournaledRejection(boom, "j1"))

		expect(deps.transitionJournal).toHaveBeenCalledWith(
			"j1",
			{ stage: "failed" },
			expect.objectContaining({ message: expect.stringContaining("estimate blew up") }),
		)
		expect(task.fail).toHaveBeenCalledWith(boom)
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
		expect(proveAndSend).not.toHaveBeenCalled()
	})

	test("the node refusing an unfunded fee payer: journal → failed as a transfer, the rejection names the record", async () => {
		// A 5.2.0 node's words: `Invalid tx: ` and its gas validator's reason.
		const refusal = new Error("Invalid tx: Insufficient fee payer balance (required=880, available=0)")
		const { executor, deps, proveAndSend } = makeHarness()
		proveAndSend.mockRejectedValueOnce(refusal)
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toStrictEqual(new JournaledRejection(refusal, "j1"))
		expect(deps.transitionJournal).toHaveBeenCalledWith(
			"j1",
			{ stage: "failed" },
			expect.objectContaining({ kind: "transfer", message: expect.stringContaining("Insufficient fee payer balance") }),
		)
	})

	test("submitting is committed on the record with the primary endpoint, and a refused write rejects", async () => {
		const refused = new Error("storage write failed")
		const { executor, deps, proveAndSend } = makeHarness({
			transitionJournal: vi.fn(async (_id: string, progress: { stage: string }) => {
				if (progress.stage === "submitting") throw refused
				return {}
			}) as never,
		})
		proveAndSend.mockImplementationOnce(async (ctx) => {
			const bound = ctx as unknown as ProveAndSendContext
			expect(bound.submittedEndpointUrl).toBe("http://primary")
			await bound.commitSubmitting({ txHash: "0xhash", submittedEndpointUrl: bound.submittedEndpointUrl })
			throw new Error("unreachable: the refused write must reject")
		})
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toStrictEqual(new JournaledRejection(refused, "j1"))
		expect(deps.transitionJournal).toHaveBeenCalledWith("j1", {
			stage: "submitting",
			txHash: "0xhash",
			submittedEndpointUrl: "http://primary",
		})
		expect(deps.logError).not.toHaveBeenCalledWith("Failed to update journal operation", refused)
	})

	test("recording the activity failing after the send: journal → failed as a transfer", async () => {
		const lost = new Error("activity write failed")
		const { executor, deps } = makeHarness({ addTransaction: vi.fn(async () => Promise.reject(lost)) })
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toStrictEqual(new JournaledRejection(lost, "j1"))
		expect(deps.transitionJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, expect.objectContaining({ kind: "transfer" }))
	})

	test("a failure the record could not take is thrown alone, naming no record", async () => {
		const boom = new Error("estimate blew up")
		const { executor, deps } = makeHarness({
			buildAndEstimate: vi.fn(async () => Promise.reject(boom)),
			transitionJournal: vi.fn(async (_id: string, progress: { stage: string }) => {
				if (progress.stage === "failed") throw new Error("storage down")
				return {}
			}) as never,
		})
		await expect(executor.execute(makeReq(), undefined, FENCE)).rejects.toBe(boom)
		expect(deps.logError).toHaveBeenCalledWith("Failed to update journal operation", expect.any(Error))
	})

	test("two identical sends failing in reverse order each name their own record; one refused before its record names none", async () => {
		let created = 0
		const builds: Array<(error: Error) => void> = []
		const createJournalOperation = vi.fn(async (input) => ({ id: `j${++created}`, ...input }) as never)
		const { executor } = makeHarness({
			createJournalOperation,
			buildAndEstimate: vi.fn(
				() =>
					new Promise<never>((_resolve, reject) => {
						builds.push(reject)
					}),
			),
		})
		const first = executor.execute(makeReq(), undefined, FENCE).catch((error: unknown) => error)
		const second = executor.execute(makeReq(), undefined, FENCE).catch((error: unknown) => error)
		await vi.waitFor(() => expect(builds).toHaveLength(2))
		createJournalOperation.mockRejectedValueOnce(new Error("journal write failed"))
		const refused = await executor.execute(makeReq(), undefined, FENCE).catch((error: unknown) => error)

		const secondError = new Error("the second send fails first")
		builds[1]?.(secondError)
		expect(await second).toStrictEqual(new JournaledRejection(secondError, "j2"))
		const firstError = new Error("the first send fails last")
		builds[0]?.(firstError)
		expect(await first).toStrictEqual(new JournaledRejection(firstError, "j1"))
		expect(refused).toBeInstanceOf(OperationNotRecordedError)
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
		await expect(executor.execute(makeReq(), "est-1", fence)).rejects.toStrictEqual(
			new JournaledRejection(expect.any(SessionEndedError), "j1"),
		)

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

	test("a session that ends while the reused arm resolves its account: no send, failed/session_ended", async () => {
		const isFenceLive = vi.fn(() => true)
		const { executor, deps, proveAndSend } = makeHarness({
			estimateReuse: { tryConsume: vi.fn(async () => snapshot()), stash: vi.fn() } as never,
			isFenceLive,
			getAccountContract: vi.fn(async () => {
				isFenceLive.mockReturnValue(false)
				return {} as never
			}),
		})
		await expect(executor.execute(makeReq(), "est-1", fence)).rejects.toStrictEqual(
			new JournaledRejection(expect.any(SessionEndedError), "j1"),
		)

		expect(isFenceLive).toHaveBeenCalledWith(fence)
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.transitionJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, sessionEnded)
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
		await expect(executor.execute(makeReq(), "est-1", fence)).rejects.toStrictEqual(
			new JournaledRejection(expect.any(SessionEndedError), "j1"),
		)

		expect(deps.planner.buildTransferOperation).not.toHaveBeenCalled()
		expect(deps.buildAndEstimate).not.toHaveBeenCalled()
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.transitionJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, sessionEnded)
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

describe("TransferExecutor.estimateFee sponsor funding", () => {
	const SPONSOR = AztecAddress.fromNumberUnsafe(0x5f)
	const FPC_SETTINGS = { paymentMethod: { kind: "fpc", fpcId: "fpc-9" } } as never

	/** A sponsor-paid build with a real `GasSettings` (fee limit 2 × 100 + 3 × 200 = 800) and a
	 *  node whose storage read must never be the probe's. */
	function sponsorHarness(opts: { named?: boolean; balance?: bigint | Error } = {}) {
		const readPublicStorageOnce = vi.fn(async () => {
			if (opts.balance instanceof Error) throw opts.balance
			return new Fr(opts.balance ?? 799n)
		})
		const h = makeHarness({ readPublicStorageOnce })
		const node = { getPublicStorageAt: vi.fn() }
		const gasSettings = new GasSettings(new Gas(100, 200), new Gas(10, 20), new GasFees(2n, 3n), new GasFees(0n, 0n))
		Object.assign(h.built, {
			node,
			txRequest: { txContext: { gasSettings } },
			...(opts.named === false ? {} : { sponsor: { fpcId: "fpc-9", address: SPONSOR } }),
		})
		return { ...h, readPublicStorageOnce, node }
	}

	test("a build naming a sponsor carries the probe's verdict, read through the one-shot reader", async () => {
		const { executor, deps, built, readPublicStorageOnce, node } = sponsorHarness({ balance: 799n })

		const result = await executor.estimateFee(makeReq({ feeSettings: FPC_SETTINGS }))

		expect(result.sponsorFunding).toEqual({ fpcId: "fpc-9", address: SPONSOR.toString(), funded: false })
		expect(result.maxFee).toBe("880")
		expect(result.estimateId).toBeDefined()
		expect(readPublicStorageOnce).toHaveBeenCalledTimes(1)
		expect((readPublicStorageOnce.mock.calls[0] as unknown[])[0]).toBe(built.network)
		expect(node.getPublicStorageAt).not.toHaveBeenCalled()
		expect(deps.logDebug).toHaveBeenCalledWith("sponsor probe", { outcome: "short" })
	})

	test.each([
		{ build: "a build naming no sponsor", named: false, balance: 0n, reads: 0 },
		{ build: "a failed read", named: true, balance: new Error("Request to https://rpc.example timed out"), reads: 1 },
	])("$build: no sponsorFunding key, the estimate otherwise whole", async ({ named, balance, reads }) => {
		const { executor, readPublicStorageOnce } = sponsorHarness({ named, balance })

		const result = await executor.estimateFee(makeReq({ feeSettings: FPC_SETTINGS }))

		expect(result).not.toHaveProperty("sponsorFunding")
		expect(result.maxFee).toBe("880")
		expect(result.estimateId).toBeDefined()
		expect(readPublicStorageOnce).toHaveBeenCalledTimes(reads)
	})

	test("a cancel landing during the probe rejects and stashes nothing", async () => {
		const controller = new AbortController()
		const { executor, deps, readPublicStorageOnce } = sponsorHarness()
		readPublicStorageOnce.mockImplementation(async () => {
			controller.abort()
			return new Fr(800n)
		})

		await expect(executor.estimateFee(makeReq({ feeSettings: FPC_SETTINGS }), controller.signal)).rejects.toThrow(JobCancelledSentinel)
		expect(deps.estimateReuse.stash).not.toHaveBeenCalled()
	})
})

describe("TransferExecutor: the activity record, field by field", () => {
	const GAS_DETAILS = {
		l2GasLimit: 200,
		daGasLimit: 100,
		teardownL2GasLimit: 20,
		teardownDaGasLimit: 10,
		feePerL2Gas: "3",
		feePerDaGas: "2",
	}
	const CALLS = [
		{
			contract: "0xtoken",
			method: "transfer_private",
			args: ["0xme", "0xyou", "5"],
			transfers: [
				{
					token: { name: "Test", symbol: "TST", decimals: 18 },
					type: TransferType.Private,
					from: "0xme",
					to: "0xyou",
					amount: "5",
				},
			],
		},
	]

	test("a fresh build records the transfer shape and the built network's id", async () => {
		const h = makeHarness()
		Object.assign(h.built, {
			network: { id: "net-built", chainId: 7, primaryEndpointId: "e1", endpoints: [{ id: "e1", rpcUrl: "http://submitted" }] },
		})
		await h.executor.execute(makeReq(), undefined, FENCE)
		expect(recordedTx(h.deps)).toStrictEqual({
			origin: { type: OriginType.UI },
			chainId: 7,
			account: "0xme",
			calls: CALLS,
			nonce: "42",
			feePaymentMethod: { kind: "fee_juice" },
			hash: "0xhash",
			submittedEndpointUrl: "http://submitted",
			estimatedFee: "880",
			gasDetails: GAS_DETAILS,
			fence: FENCE,
			networkId: "net-built",
		})
	})

	test("a reused estimate records the entry's provenance and the re-resolved network's id", async () => {
		const reusedNetwork = { id: "net-live", chainId: 9, primaryEndpointId: "e1", endpoints: [{ id: "e1", rpcUrl: "http://live" }] }
		const h = makeHarness({
			getNetwork: vi.fn(async () => reusedNetwork as never),
			estimateReuse: {
				tryConsume: vi.fn(async () => ({
					txRequest: makeTxRequest(),
					initializesAccount: false,
					nonce: { toString: () => "99" },
					feePaymentMethod: { kind: "reused" },
					token: TOKEN,
					fnName: "transfer_private",
					args: ["0xme", "0xyou", 5n],
				})),
				stash: vi.fn(),
			} as never,
		})
		await h.executor.execute(makeReq(), "est-1", FENCE)
		expect(recordedTx(h.deps)).toStrictEqual({
			origin: { type: OriginType.UI },
			chainId: 9,
			account: "0xme",
			calls: CALLS,
			nonce: "99",
			feePaymentMethod: { kind: "reused" },
			hash: "0xhash",
			submittedEndpointUrl: "http://live",
			estimatedFee: "880",
			gasDetails: GAS_DETAILS,
			fence: FENCE,
			networkId: "net-live",
		})
	})
})

describe("TransferExecutor.estimateFee: the reuse snapshot", () => {
	const NOW = 1_700_000_000_000
	const PRIMARY_SECOND = {
		id: "net-1",
		chainId: 7,
		primaryEndpointId: "e2",
		endpoints: [
			{ id: "e1", rpcUrl: "http://first" },
			{ id: "e2", rpcUrl: "http://primary" },
		],
	}

	function snapshotHarness(overrides: Partial<TransferExecutorDeps> = {}, network: object = PRIMARY_SECOND) {
		const h = makeHarness({ getActiveProfile: vi.fn(async () => ({ id: "p-active" }) as never), ...overrides })
		const txRequest = makeTxRequest() as { txContext: { gasSettings: { maxFeesPerGas: object } } }
		txRequest.txContext.gasSettings.maxFeesPerGas = { feePerDaGas: 7n, feePerL2Gas: 11n }
		Object.assign(h.built, { network, txRequest })
		return h
	}

	const stashed = (deps: TransferExecutorDeps) => (deps.estimateReuse.stash as ReturnType<typeof vi.fn>).mock.calls as unknown[][]

	test("the entry: the built fee, the primary by id, the active profile, the pending set, the build", async () => {
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] })
		try {
			const { executor, deps, built } = snapshotHarness()
			const result = await executor.estimateFee(makeReq())
			expect(stashed(deps)).toStrictEqual([
				[
					result.estimateId,
					{
						networkId: "net-1",
						accountAddress: "0xme",
						tokenId: 1,
						transferType: TransferType.Private,
						recipientAddress: "0xyou",
						amount: 5n,
						feeSettingsHash: "fj|default",
						// The active profile at stash time, not the fence's p1.
						profileId: "p-active",
						// The built request's maxFeesPerGas; the node is never asked.
						baseFeeFingerprint: "7:11",
						primaryEndpointId: "e2",
						primaryEndpointUrl: "http://primary",
						pendingHashes: ["0xpending"],
						txRequest: built.txRequest,
						initializesAccount: true,
						nonce: built.nonce,
						feePaymentMethod: built.feePaymentMethod,
						token: TOKEN,
						fnName: "transfer_private",
						args: ["0xme", "0xyou", 5n],
						builtAt: NOW,
					},
				],
			])
			expect(deps.getNode).not.toHaveBeenCalled()
		} finally {
			vi.useRealTimers()
		}
	})

	test("a pending tx that lands during the profile read is in the snapshot", async () => {
		const pending = [{ hash: "0xpending" }]
		const { executor, deps } = snapshotHarness({
			getPendingForAccount: vi.fn(() => [...pending] as never),
			getActiveProfile: vi.fn(async () => {
				pending.push({ hash: "0xraced" })
				return { id: "p-active" } as never
			}),
		})
		await executor.estimateFee(makeReq())
		expect((stashed(deps)[0][1] as { pendingHashes: string[] }).pendingHashes).toEqual(["0xpending", "0xraced"])
	})

	test.each([
		["a dangling primaryEndpointId", { ...PRIMARY_SECOND, primaryEndpointId: "e9" }],
		["no endpoints array", { id: "net-1", chainId: 7, primaryEndpointId: "e2" }],
	])("%s: no estimateId, the fee still returned", async (_label, network) => {
		const { executor, deps } = snapshotHarness({}, network)
		const result = await executor.estimateFee(makeReq())
		expect(result.estimateId).toBeUndefined()
		expect(result.maxFee).toBeDefined()
		expect(deps.estimateReuse.stash).not.toHaveBeenCalled()
	})

	test("no endpoints array: the skip line carries the lookup's TypeError", async () => {
		const { executor, deps } = snapshotHarness({}, { id: "net-1", chainId: 7, primaryEndpointId: "e2" })
		await executor.estimateFee(makeReq())
		expect(deps.logDebug).toHaveBeenCalledWith("estimateTransferFee: cache write skipped", expect.any(TypeError))
	})

	test("a locked wallet at stash time: no estimateId, the skip line carries Wallet locked", async () => {
		const { executor, deps } = snapshotHarness({ getActiveProfile: vi.fn(async () => undefined) })
		const result = await executor.estimateFee(makeReq())
		expect(result.estimateId).toBeUndefined()
		expect(deps.estimateReuse.stash).not.toHaveBeenCalled()
		expect(deps.logDebug).toHaveBeenCalledWith("estimateTransferFee: cache write skipped", new Error("Wallet locked"))
	})

	test.each(["fjwc", "embedded"])("%s: not eligible, no stash and no profile read", async (kind) => {
		const { executor, deps } = snapshotHarness()
		const feeSettings = {
			paymentMethod: kind === "fjwc" ? { kind, claimAmount: "1", claimSecret: "s", messageLeafIndex: "0" } : { kind },
		}
		const result = await executor.estimateFee(makeReq({ feeSettings: feeSettings as never }))
		expect(result.estimateId).toBeUndefined()
		expect(deps.estimateReuse.stash).not.toHaveBeenCalled()
		expect(deps.getActiveProfile).not.toHaveBeenCalled()
	})

	test("eligibility control: fpc stashes", async () => {
		const { executor, deps } = snapshotHarness()
		const result = await executor.estimateFee(makeReq({ feeSettings: { paymentMethod: { kind: "fpc", fpcId: "f" } } as never }))
		expect(result.estimateId).toBeDefined()
		expect(deps.estimateReuse.stash).toHaveBeenCalledTimes(1)
	})
})

describe("TransferExecutor.estimateFee: each cancel checkpoint", () => {
	test.each([
		["before planning", "pre", "buildTransferOperation"],
		["during planning", "buildTransferOperation", "buildAndEstimate"],
		["during the build", "buildAndEstimate", "readPublicStorageOnce"],
	] as const)("an abort %s rejects with the journal-less sentinel and runs nothing after", async (_label, abortIn, notCalled) => {
		const controller = new AbortController()
		const { executor, deps, built } = makeHarness()
		// A build naming a sponsor, so the step after the build's checkpoint (the probe) reads storage.
		const gasSettings = new GasSettings(new Gas(100, 200), new Gas(10, 20), new GasFees(2n, 3n), new GasFees(0n, 0n))
		Object.assign(built, {
			txRequest: { txContext: { gasSettings } },
			sponsor: { fpcId: "fpc-9", address: AztecAddress.fromNumberUnsafe(0x5f) },
		})
		if (abortIn === "pre") controller.abort()
		if (abortIn === "buildTransferOperation") {
			const plan = deps.planner.buildTransferOperation as ReturnType<typeof vi.fn>
			const original = plan.getMockImplementation() as (req: TransferRequest) => Promise<unknown>
			plan.mockImplementation(async (req: TransferRequest) => {
				controller.abort()
				return original(req)
			})
		}
		if (abortIn === "buildAndEstimate") {
			;(deps.buildAndEstimate as ReturnType<typeof vi.fn>).mockImplementation(async () => {
				controller.abort()
				return built as never
			})
		}
		const fpc = { paymentMethod: { kind: "fpc", fpcId: "fpc-9" } } as never
		const error = await executor.estimateFee(makeReq({ feeSettings: fpc }), controller.signal).catch((e: unknown) => e)
		expect(error).toBeInstanceOf(JobCancelledSentinel)
		expect((error as JobCancelledSentinel).jobId).toBe("")
		const target = notCalled === "buildTransferOperation" ? deps.planner.buildTransferOperation : deps[notCalled]
		expect(target).not.toHaveBeenCalled()
		expect(deps.estimateReuse.stash).not.toHaveBeenCalled()
	})
})
