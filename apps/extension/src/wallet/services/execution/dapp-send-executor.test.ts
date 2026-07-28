/**
 * `DappSendExecutor` — facade-parity pins for the transplanted dApp-send
 * flows. The coordinator pipeline and the lane implementations are
 * mocked (their contracts are pinned in `execution-coordinator.test.ts`,
 * `execution-mutex.test.ts`, and `claim-helper.test.ts`); these tests
 * pin the executor's own choreography:
 *
 *   - slot-before-claim ordering and slot release on every exit path
 *   - the NO_FROM three-site scope rule (discovery WITHOUT the account,
 *     real simulation + prove WITH it, both hex-deduped)
 *   - the chain-identity rebind before authwit hash construction (V-01)
 *   - sentinel passthrough vs failed-journal shaping in the catch
 *
 * The feeSettings trust-boundary invariants live in
 * `feesettings-invariant.test.ts`.
 */

import { describe, expect, test, vi } from "vitest"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/spec"
import { DappSendExecutor, type DappSendExecutorDeps } from "./dapp-send-executor"

const collectOffchainEffectsMock = vi.hoisted(() => vi.fn(() => [] as Array<{ data: unknown[]; contractAddress: unknown }>))
vi.mock("@aztec/stdlib/tx", async (importOriginal) => ({
	...(await importOriginal<object>()),
	collectOffchainEffects: collectOffchainEffectsMock,
}))

const assertLiveChainIdentityMock = vi.hoisted(() => vi.fn())
vi.mock("@nulo/aztec-runtime/utils", async (importOriginal) => ({
	...(await importOriginal<object>()),
	assertLiveChainIdentity: assertLiveChainIdentityMock,
}))

// Gas-limit shaping is pinned by the structural fee fixtures; no-op here
// so plain-object txRequest fakes survive the NO_FROM path.
vi.mock("./fee/fee-strategy", async (importOriginal) => ({
	...(await importOriginal<object>()),
	suggestGasLimits: vi.fn(),
	finalizeGasLimits: vi.fn(async () => {}),
}))
vi.mock("./fee/embedded-fpc-cap", () => ({ applyEmbeddedFpcGasCap: vi.fn(async () => {}) }))

const ORIGIN: LocalTxOrigin = { type: OriginType.DAPP, name: "test-dapp" }

function makeTxRequest() {
	return {
		authWitnesses: [] as unknown[],
		txContext: {
			gasSettings: {
				gasLimits: { daGas: 100, l2Gas: 200 },
				teardownGasLimits: { daGas: 10, l2Gas: 20 },
				maxFeesPerGas: { feePerDaGas: 2n, feePerL2Gas: 3n },
			},
		},
	} as never
}

function addr(hex: string) {
	return { toString: () => hex } as never
}

function makeHarness(overrides: Partial<DappSendExecutorDeps> = {}) {
	const network = {
		id: "net-1",
		profileId: "p1",
		chainId: 7,
		name: "N",
		primaryEndpointId: "ep1",
		endpoints: [{ id: "ep1", rpcUrl: "https://rpc.submit" }],
	} as never
	const node = {
		getNodeInfo: vi.fn(async () => ({ l1ChainId: 1, rollupVersion: 2 })),
		getTxReceipt: vi.fn(async () => ({ status: "success" })),
	}
	const account = { address: addr("0xacct"), createAuthWit: vi.fn(async () => ({ kind: "authwit" })) }
	const pxe = { simulateTx: vi.fn(async () => ({ privateExecutionResult: {} })) }
	const built = {
		txRequest: makeTxRequest(),
		node,
		pxe,
		account,
		network,
		nonce: { toString: () => "42" },
		txCalls: [{ contract: "0xc", method: "dapp_method", args: [] }],
		feePaymentMethod: { kind: "fee_juice" },
		pendingPublicAuthwits: [],
	}
	const releaseSlot = vi.fn()
	const proveAndSend = vi.fn(async (ctx: { recordTransaction: (h: string) => Promise<unknown> }) => {
		await ctx.recordTransaction("0xhash")
		return { txHash: { toString: () => "0xhash" }, offchainOutput: {} }
	})
	const deps: DappSendExecutorDeps = {
		planner: {
			processAztecJsPayload: vi.fn(async () => ({
				actions: [{ kind: "call", method: "dapp_method" }],
				feePaymentMethod: undefined,
				feeOptions: {},
			})),
		} as never,
		authwit: { discoverPrivateAuthwits: vi.fn(async () => []) } as never,
		txBuilder: {
			buildStandard: vi.fn(async () => built),
			buildNoFrom: vi.fn(async () => built),
		} as never,
		coordinator: { proveAndSend, simulateTxTask: vi.fn(async () => ({})) } as never,
		lane: {
			registerController: vi.fn(),
			deleteController: vi.fn(),
			acquireSlot: vi.fn(async () => ({ release: releaseSlot, preController: undefined })),
			claimOrCreateJournal: vi.fn(async () => ({ journalId: "j1", controller: new AbortController() })),
			beginJournal: vi.fn(async () => "j1"),
			markJournal: vi.fn(async () => {}),
		},
		buildAndEstimate: vi.fn(async () => built as never),
		addTransaction: vi.fn(async () => ({}) as never),
		recordPendingAuthwits: vi.fn(async () => {}),
		logDebug: vi.fn(),
		...overrides,
	}
	return { deps, built, node, pxe, account, releaseSlot, proveAndSend, executor: new DappSendExecutor(deps) }
}

function makeAztecOp(overrides: Record<string, unknown> = {}) {
	return {
		kind: "aztec_sendTx",
		networkId: "net-1",
		accountAddress: "0xacct",
		feeSettings: { paymentMethod: { kind: "fj" } },
		exec: { calls: [{ name: "dapp_method" }] },
		opts: { from: addr("0xacct"), additionalScopes: [], wait: "NO_WAIT" },
		...overrides,
	} as never
}

describe("DappSendExecutor.executeSendTransaction", () => {
	test("happy path: journal begin → simulating → build → proveAndSend(scopes=[account]) → record from txCalls", async () => {
		const { executor, deps, proveAndSend, built } = makeHarness()
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [{ kind: "call", method: "dapp_method" }],
		} as never
		const result = await executor.executeSendTransaction(op, ORIGIN)

		expect(result).toBe("0xhash")
		// Fifth arg: the authorization-time fence (none captured in this harness).
		expect(deps.lane.beginJournal).toHaveBeenCalledWith("net-1", "0xacct", ORIGIN, [{ method: "dapp_method" }], undefined)
		expect(deps.lane.markJournal).toHaveBeenCalledWith("j1", { stage: "simulating" })
		const ctx = (proveAndSend.mock.calls[0] as unknown[])[0] as { scopes: unknown[] }
		expect(ctx.scopes).toEqual([built.account.address])
		// Activity record uses the build's txCalls verbatim (dApp shape, not transfer shape).
		const txArgs = (deps.addTransaction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(txArgs[2]).toBe("0xacct")
		expect(txArgs[3]).toBe(built.txCalls)
		expect(txArgs[4]).toBe("42")
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})

	test("records the SUBMITTING network's primary endpoint URL (C3 recording-site pin)", async () => {
		// addTransaction's submittedEndpointUrl (arg 7) must come from the network the
		// executor built+submitted against — NOT re-derived from active-profile state,
		// which a mid-prove TTL auto-lock / profile switch would corrupt and route the
		// pending-tx poll to the active profile's RPC (cross-profile leak).
		const { executor, deps } = makeHarness()
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [{ kind: "call", method: "dapp_method" }],
		} as never
		await executor.executeSendTransaction(op, ORIGIN)

		const txArgs = (deps.addTransaction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(txArgs[7]).toBe("https://rpc.submit")
	})

	test("failure: journal → failed with dapp_execute-normalized error, error rethrown", async () => {
		const { executor, deps } = makeHarness({ buildAndEstimate: vi.fn(async () => Promise.reject(new Error("build broke"))) })
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [],
		} as never
		await expect(executor.executeSendTransaction(op, ORIGIN)).rejects.toThrow("build broke")
		expect(deps.lane.markJournal).toHaveBeenCalledWith(
			"j1",
			{ stage: "failed" },
			expect.objectContaining({ message: expect.stringContaining("build broke") }),
		)
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})
})

describe("DappSendExecutor — public-authwit recording (Phase 5 trust-point)", () => {
	const grant = { account: "0xacct", hash: "0xgrant", content: { kind: "call" } as never }
	const grantOp = {
		kind: "send_transaction",
		networkId: "net-1",
		accountAddress: "0xacct",
		feeSettings: { paymentMethod: { kind: "fj" } },
		actions: [{ kind: "add_public_authwit", content: { kind: "call" } }],
	} as never

	test("records a built public authwit ONCE at the post-send tail, tx-linked", async () => {
		const { executor, deps, built } = makeHarness({
			buildAndEstimate: vi.fn(async () => ({ ...built, pendingPublicAuthwits: [grant] }) as never),
		})
		await executor.executeSendTransaction(grantOp, ORIGIN)
		const rec = deps.recordPendingAuthwits as ReturnType<typeof vi.fn>
		expect(rec).toHaveBeenCalledTimes(1)
		const args = rec.mock.calls[0] as unknown[]
		expect(args[1]).toEqual([grant]) // the pending items
		expect(args[2]).toBe("0xhash") // keyed by the tx that wrote them
	})

	test("ESTIMATE records nothing (build is pure; no send → no recording)", async () => {
		const { executor, deps, built } = makeHarness({
			buildAndEstimate: vi.fn(async () => ({ ...built, pendingPublicAuthwits: [grant] }) as never),
		})
		await executor.estimateOperationFee(grantOp, { paymentMethod: { kind: "fj" } } as never)
		expect(deps.recordPendingAuthwits).not.toHaveBeenCalled()
	})

	test("SEND-FAILURE records nothing (the closure runs only after a successful send)", async () => {
		const { executor, deps, built } = makeHarness({
			buildAndEstimate: vi.fn(async () => ({ ...built, pendingPublicAuthwits: [grant] }) as never),
			coordinator: {
				proveAndSend: vi.fn(async () => {
					throw new Error("send broke")
				}),
				simulateTxTask: vi.fn(async () => ({})),
			} as never,
		})
		await expect(executor.executeSendTransaction(grantOp, ORIGIN)).rejects.toThrow("send broke")
		expect(deps.recordPendingAuthwits).not.toHaveBeenCalled()
	})
})

describe("DappSendExecutor.executeAztecSendTx (standard path)", () => {
	test("slot acquired BEFORE journal claim; release fires in finally on success", async () => {
		const { executor, deps, releaseSlot } = makeHarness()
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN)

		const acquireOrder = (deps.lane.acquireSlot as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
		const claimOrder = (deps.lane.claimOrCreateJournal as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
		expect(acquireOrder).toBeLessThan(claimOrder)
		expect(releaseSlot).toHaveBeenCalledTimes(1)
	})

	test("opts.from mismatch: frozen error, failed journal, slot still released", async () => {
		const { executor, deps, releaseSlot } = makeHarness()
		const op = makeAztecOp({ opts: { from: addr("0xother"), additionalScopes: [], wait: "NO_WAIT" } })
		await expect(executor.executeAztecSendTx(op, ORIGIN)).rejects.toThrow("Invalid `opts.from`")
		expect(deps.lane.markJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, expect.anything())
		expect(releaseSlot).toHaveBeenCalledTimes(1)
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})

	test("cancel during claim: sentinel passes through raw — no failed transition, slot released", async () => {
		const aborted = new AbortController()
		aborted.abort()
		const { executor, deps, releaseSlot } = makeHarness({
			lane: {
				registerController: vi.fn(),
				deleteController: vi.fn(),
				acquireSlot: vi.fn(async () => ({ release: vi.fn(), preController: undefined })),
				claimOrCreateJournal: vi.fn(async () => ({ journalId: "j1", controller: aborted })),
				beginJournal: vi.fn(),
				markJournal: vi.fn(async () => {}),
			},
		})
		await expect(executor.executeAztecSendTx(makeAztecOp(), ORIGIN)).rejects.toBeInstanceOf(JobCancelledSentinel)
		const stages = (deps.lane.markJournal as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[1] as { stage: string }).stage)
		expect(stages).not.toContain("failed")
		// This harness's release spy is local to the lane override.
		expect(releaseSlot).not.toHaveBeenCalled()
		expect((deps.lane.acquireSlot as ReturnType<typeof vi.fn>).mock.results.length).toBe(1)
	})

	test("embedded fee payment skips authwit discovery; non-embedded runs it", async () => {
		const embedded = makeHarness({
			planner: {
				processAztecJsPayload: vi.fn(async () => ({
					actions: [],
					feePaymentMethod: undefined,
					feeOptions: { embeddedFeePayment: "dapp" },
				})),
			} as never,
		})
		await embedded.executor.executeAztecSendTx(makeAztecOp(), ORIGIN)
		expect(embedded.deps.authwit.discoverPrivateAuthwits).not.toHaveBeenCalled()

		const standard = makeHarness()
		await standard.executor.executeAztecSendTx(makeAztecOp(), ORIGIN)
		expect(standard.deps.authwit.discoverPrivateAuthwits).toHaveBeenCalledTimes(1)
	})

	test("scopes = [account.address, ...additionalScopes]; NO_WAIT returns txHash, wait returns receipt", async () => {
		const extra = addr("0xextra")
		const noWait = makeHarness()
		const res1 = (await noWait.executor.executeAztecSendTx(
			makeAztecOp({ opts: { from: addr("0xacct"), additionalScopes: [extra], wait: "NO_WAIT" } }),
			ORIGIN,
		)) as { txHash?: unknown; receipt?: unknown }
		const ctx = (noWait.proveAndSend.mock.calls[0] as unknown[])[0] as { scopes: unknown[] }
		expect(ctx.scopes).toEqual([noWait.built.account.address, extra])
		expect(res1.txHash).toBeDefined()
		expect(res1.receipt).toBeUndefined()

		const waits = makeHarness()
		const res2 = (await waits.executor.executeAztecSendTx(
			makeAztecOp({ opts: { from: addr("0xacct"), additionalScopes: [], wait: undefined } }),
			ORIGIN,
		)) as { receipt?: unknown }
		expect(waits.node.getTxReceipt).toHaveBeenCalledTimes(1)
		expect(res2.receipt).toEqual({ status: "success" })
	})
})

describe("DappSendExecutor.executeNoFromSendTx (via default_entrypoint)", () => {
	function makeNoFromOp(overrides: Record<string, unknown> = {}) {
		return makeAztecOp({
			executionMode: "default_entrypoint",
			feeSettings: { paymentMethod: { kind: "embedded" } },
			...overrides,
		})
	}

	test("non-embedded fee payment rejected before any slot work", async () => {
		const { executor, deps } = makeHarness()
		const op = makeNoFromOp({ feeSettings: { paymentMethod: { kind: "fj" } } })
		await expect(executor.executeAztecSendTx(op, ORIGIN)).rejects.toThrow(
			"DefaultEntrypoint transactions must use embedded fee payment",
		)
		expect(deps.lane.acquireSlot).not.toHaveBeenCalled()
	})

	test("three-site scope rule: discovery WITHOUT account (deduped), real sim + prove WITH account", async () => {
		collectOffchainEffectsMock.mockReturnValue([])
		const scopeA = addr("0xscopeA")
		const scopeB = addr("0xscopeB")
		const scopeADup = addr("0xscopeA")
		const { executor, deps, pxe, built, proveAndSend } = makeHarness()
		await executor.executeAztecSendTx(
			makeNoFromOp({ opts: { from: addr("0xacct"), additionalScopes: [scopeA, scopeB, scopeADup], wait: "NO_WAIT" } }),
			ORIGIN,
		)

		// Site 1 — kernelless discovery: dApp scopes only (hex-deduped, the
		// LAST duplicate instance wins per Map.set), the account stubbed via
		// msgSender, NOT in scopes.
		const discovery = pxe.simulateTx.mock.calls[0] as unknown[]
		expect((discovery[1] as { scopes: unknown[] }).scopes).toEqual([scopeADup, scopeB])
		expect((discovery[1] as { scopes: unknown[] }).scopes).toHaveLength(2)
		expect(discovery[2]).toEqual(["0xacct"])
		// Site 2 — real simulation: account first, then deduped dApp scopes.
		const simCall = (deps.coordinator.simulateTxTask as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect((simCall[2] as { scopes: unknown[] }).scopes).toEqual([built.account.address, scopeADup, scopeB])
		// Site 3 — prove: same scopesWithAccount.
		const proveCtx = (proveAndSend.mock.calls[0] as unknown[])[0] as { scopes: unknown[] }
		expect(proveCtx.scopes).toEqual([built.account.address, scopeADup, scopeB])
	})

	test("chain identity rebind (V-01): asserted against live nodeInfo before authwit hashing; skipped when no effects", async () => {
		assertLiveChainIdentityMock.mockClear()
		collectOffchainEffectsMock.mockReturnValue([{ data: [], contractAddress: addr("0xconsumer") }])
		const withEffects = makeHarness()
		await withEffects.executor.executeAztecSendTx(makeNoFromOp(), ORIGIN)
		expect(withEffects.node.getNodeInfo).toHaveBeenCalledTimes(1)
		expect(assertLiveChainIdentityMock).toHaveBeenCalledWith(withEffects.built.network, { l1ChainId: 1, rollupVersion: 2 })

		assertLiveChainIdentityMock.mockClear()
		collectOffchainEffectsMock.mockReturnValue([])
		const noEffects = makeHarness()
		await noEffects.executor.executeAztecSendTx(makeNoFromOp(), ORIGIN)
		expect(noEffects.node.getNodeInfo).not.toHaveBeenCalled()
		expect(assertLiveChainIdentityMock).not.toHaveBeenCalled()
	})

	test("history record: nonce Fr.ZERO, feePaymentMethod EXTERNAL", async () => {
		collectOffchainEffectsMock.mockReturnValue([])
		const { executor, deps } = makeHarness()
		await executor.executeAztecSendTx(makeNoFromOp(), ORIGIN)
		const txArgs = (deps.addTransaction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(txArgs[4]).toBe("0x0000000000000000000000000000000000000000000000000000000000000000")
		expect(txArgs[5]).toBe(AccountFeePaymentMethodOptions.EXTERNAL)
	})
})

describe("DappSendExecutor.estimateOperationFee", () => {
	test("non-send kinds rejected with the frozen message", async () => {
		const { executor } = makeHarness()
		await expect(executor.estimateOperationFee({ kind: "register_token" } as never, {} as never)).rejects.toThrow(
			"Only send_transaction and aztec_sendTx operations support fee estimation",
		)
	})

	test("send_transaction: discovered authwits appended to a CLONE — caller's actions untouched, no estimateId", async () => {
		const extraAction = { kind: "call", method: "authwit_action" }
		const { executor, deps } = makeHarness({
			authwit: { discoverPrivateAuthwits: vi.fn(async () => [extraAction]) } as never,
		})
		const originalActions = [{ kind: "call", method: "dapp_method" }]
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: originalActions,
		} as never
		const result = await executor.estimateOperationFee(op, { paymentMethod: { kind: "fj" } } as never)

		expect(originalActions).toHaveLength(1)
		const builtOp = ((deps.buildAndEstimate as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as { actions: unknown[] }
		expect(builtOp.actions).toEqual([...originalActions, extraAction])
		expect(result.maxFee).toBe("880")
		expect("estimateId" in result && result.estimateId).toBeFalsy()
	})
})

/**
 * P17 slot-scaffold oracle — pins the EXACT choreography the future
 * `runInSlot` extraction must preserve byte-for-byte. Added BEFORE the
 * refactor against the current inline scaffold; kept UNEDITED across it.
 * Complements the real-lane FIFO/cancel pins in `execution-lane.test.ts`
 * (the mutex concurrency `runInSlot` delegates to, not reimplements).
 * The invariant under guard: on EVERY post-acquire exit the slot is
 * released and the controller cleaned — a missed release wedges the
 * (profileId, chainId) lane until SW restart.
 */
describe("DappSendExecutor — P17 slot-scaffold oracle (ordering + no-leak on every throw)", () => {
	const order = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]

	function makeNoFromOp(overrides: Record<string, unknown> = {}) {
		return makeAztecOp({ executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } }, ...overrides })
	}

	test("standard path order: acquireSlot < claim < markJournal(simulating) < proveAndSend < deleteController < releaseSlot", async () => {
		const { executor, deps, releaseSlot, proveAndSend } = makeHarness()
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN)
		expect(order(deps.lane.acquireSlot)).toBeLessThan(order(deps.lane.claimOrCreateJournal))
		expect(order(deps.lane.claimOrCreateJournal)).toBeLessThan(order(deps.lane.markJournal))
		expect(order(deps.lane.markJournal)).toBeLessThan(order(proveAndSend))
		expect(order(proveAndSend)).toBeLessThan(order(deps.lane.deleteController))
		expect(order(deps.lane.deleteController)).toBeLessThan(order(releaseSlot))
		// The FIRST markJournal is the simulating checkpoint — it must NOT precede the claim.
		expect((deps.lane.markJournal as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({ stage: "simulating" })
	})

	test("NO_FROM path order: acquireSlot < claim < markJournal(simulating) < proveAndSend < deleteController < releaseSlot", async () => {
		collectOffchainEffectsMock.mockReturnValue([])
		const { executor, deps, releaseSlot, proveAndSend } = makeHarness()
		await executor.executeAztecSendTx(makeNoFromOp(), ORIGIN)
		expect(order(deps.lane.acquireSlot)).toBeLessThan(order(deps.lane.claimOrCreateJournal))
		expect(order(deps.lane.claimOrCreateJournal)).toBeLessThan(order(deps.lane.markJournal))
		expect(order(deps.lane.markJournal)).toBeLessThan(order(proveAndSend))
		expect(order(proveAndSend)).toBeLessThan(order(deps.lane.deleteController))
		expect(order(deps.lane.deleteController)).toBeLessThan(order(releaseSlot))
		expect((deps.lane.markJournal as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({ stage: "simulating" })
	})

	test("standard path: proveAndSend throws → failed journal + deleteController + releaseSlot (no leak)", async () => {
		const { executor, deps, releaseSlot } = makeHarness({
			coordinator: {
				proveAndSend: vi.fn(async () => {
					throw new Error("prove broke")
				}),
				simulateTxTask: vi.fn(async () => ({})),
			} as never,
		})
		await expect(executor.executeAztecSendTx(makeAztecOp(), ORIGIN)).rejects.toThrow("prove broke")
		expect(deps.lane.markJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, expect.anything())
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
		expect(releaseSlot).toHaveBeenCalledTimes(1)
	})

	test("standard path: recordTransaction throws (post-send) → deleteController + releaseSlot (no leak)", async () => {
		// The real coordinator awaits recordTransaction inside proveAndSend, so a throw
		// there rejects the send — the finally must STILL release the slot.
		const { executor, deps, releaseSlot } = makeHarness({
			addTransaction: vi.fn(async () => {
				throw new Error("record broke")
			}) as never,
		})
		await expect(executor.executeAztecSendTx(makeAztecOp(), ORIGIN)).rejects.toThrow("record broke")
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
		expect(releaseSlot).toHaveBeenCalledTimes(1)
	})

	test("standard path: claim throws (no journalId yet) → releaseSlot still fires, deleteController NOT called", async () => {
		const releaseLocal = vi.fn()
		const { executor, deps } = makeHarness({
			lane: {
				registerController: vi.fn(),
				deleteController: vi.fn(),
				acquireSlot: vi.fn(async () => ({ release: releaseLocal, preController: undefined })),
				claimOrCreateJournal: vi.fn(async () => {
					throw new Error("claim broke")
				}),
				beginJournal: vi.fn(),
				markJournal: vi.fn(async () => {}),
			},
		})
		await expect(executor.executeAztecSendTx(makeAztecOp(), ORIGIN)).rejects.toThrow("claim broke")
		expect(releaseLocal).toHaveBeenCalledTimes(1)
		expect(deps.lane.deleteController).not.toHaveBeenCalled()
	})

	test("NO_FROM path: proveAndSend throws → failed journal + deleteController + releaseSlot (no leak)", async () => {
		collectOffchainEffectsMock.mockReturnValue([])
		const { executor, deps, releaseSlot } = makeHarness({
			coordinator: {
				proveAndSend: vi.fn(async () => {
					throw new Error("prove broke")
				}),
				simulateTxTask: vi.fn(async () => ({})),
			} as never,
		})
		await expect(executor.executeAztecSendTx(makeNoFromOp(), ORIGIN)).rejects.toThrow("prove broke")
		expect(deps.lane.markJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, expect.anything())
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
		expect(releaseSlot).toHaveBeenCalledTimes(1)
	})

	test("primaryMethod extraction runs AFTER acquireSlot (inside the protected region)", async () => {
		// A throwing `exec.calls` getter stands in for large/adversarial calls: the
		// extraction must run inside runInSlot's try — AFTER acquireSlot — so the FIFO
		// enqueue isn't delayed by it and a throw is caught + the slot released. If it
		// moved back before acquire, acquireSlot would never be called (0 vs 1).
		const { executor, deps, releaseSlot } = makeHarness()
		const op = makeAztecOp() as { exec: { calls?: unknown } }
		Object.defineProperty(op.exec, "calls", {
			configurable: true,
			get() {
				throw new Error("calls boom")
			},
		})
		await expect(executor.executeAztecSendTx(op as never, ORIGIN)).rejects.toThrow("calls boom")
		expect(deps.lane.acquireSlot).toHaveBeenCalledTimes(1)
		expect(releaseSlot).toHaveBeenCalledTimes(1)
	})
})
