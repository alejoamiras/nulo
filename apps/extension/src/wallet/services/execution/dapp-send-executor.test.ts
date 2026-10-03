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
 *   - the authorizing fence: slot, journal, builds, reuse and the send checks
 *
 * The feeSettings trust-boundary invariants live in
 * `feesettings-invariant.test.ts`.
 */

import { describe, expect, test, vi } from "vitest"
import { AccountFeePaymentMethodOptions } from "@aztec-labs/entrypoints/account"
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { Gas, GasFees, GasSettings } from "@aztec-labs/stdlib/gas"
import { JobCancelledError, SessionEndedError } from "@nulo/extension-messaging/errors"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/spec"
import { DappSendExecutor, type DappSendExecutorDeps } from "./dapp-send-executor"
import { DiscoveryAwareEstimator } from "./discovery-aware-estimator"
import type { ProveAndSendContext } from "./execution-coordinator"
import { AUTHWITS_CHANGED_MESSAGE, ESTIMATE_INCOMPLETE_MESSAGE, PREVIEW_FOREIGN_MESSAGE, PreviewSnapshots } from "./preview-snapshots"
import { OperationEstimateReuse } from "./operation-estimate-reuse"
import { fingerprintOperation } from "./operation-fingerprint"
import { ExecutionService } from "./service"

// A pass-through spy: the extraction itself is aztec.js's; its arguments are the executor's.
const extractOffchainOutputSpy = vi.hoisted(() => vi.fn())
vi.mock("@aztec-labs/aztec.js/contracts", async (importOriginal) => {
	const original = await importOriginal<{ extractOffchainOutput: (...args: unknown[]) => unknown }>()
	extractOffchainOutputSpy.mockImplementation(original.extractOffchainOutput)
	return { ...original, extractOffchainOutput: extractOffchainOutputSpy }
})

const collectOffchainEffectsMock = vi.hoisted(() => vi.fn(() => [] as Array<{ data: unknown[]; contractAddress: unknown }>))
vi.mock("@aztec-labs/stdlib/tx", async (importOriginal) => ({
	...(await importOriginal<object>()),
	collectOffchainEffects: collectOffchainEffectsMock,
}))

// Real authwit decoding + hashing run Barretenberg WASM (e2e-only); the seam
// decodes a request from its first field and hashes deterministically.
vi.mock("@aztec-labs/aztec.js/authorization", async (importOriginal) => ({
	...(await importOriginal<object>()),
	CallAuthorizationRequest: {
		fromFields: async (data: unknown[]) => {
			if (!data.length) throw new Error("not a CallAuthorizationRequest")
			return { innerHash: `ih:${data[0]}`, msgSender: `caller:${data[0]}`, functionSelector: "0xsel", args: [`arg:${data[0]}`] }
		},
	},
	computeAuthWitMessageHash: async (intent: { innerHash: string }) => ({ toString: () => `mh:${intent.innerHash}` }),
}))

// Gas-limit shaping is pinned by the structural fee fixtures; no-op here
// so plain-object txRequest fakes survive the NO_FROM path.
vi.mock("./fee/fee-strategy", async (importOriginal) => ({
	...(await importOriginal<object>()),
	suggestGasLimits: vi.fn(),
	finalizeGasLimits: vi.fn(async () => {}),
}))
vi.mock("./fee/embedded-fpc-cap", () => ({ applyEmbeddedFpcGasCap: vi.fn(async () => {}) }))

// The balance slot's poseidon2 runs Barretenberg WASM, which crashes under jsdom; the slot itself is
// pinned in fee-juice-balance.test.ts.
vi.mock("@aztec-labs/protocol-contracts/fee-juice", async (importOriginal) => {
	const { Fr } = await import("@aztec-labs/foundation/curves/bn254")
	return { ...(await importOriginal<object>()), computeFeePayerBalanceStorageSlot: vi.fn(async () => new Fr(0x51n)) }
})

const ORIGIN: LocalTxOrigin = { type: OriginType.DAPP, name: "test-dapp" }
const FENCE = { profileId: "p1", epoch: 0, session: 1 }
/** A popup approval envelope carrying a reuse id; the producer mints `previewId = estimateId`
 *  for a bound standard estimate, so a real approval always pairs the two equal. */
const APPROVAL = (estimateId: string) => ({ interactionId: "i-1", index: 0, estimateId, previewId: estimateId })

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

function makeHarness(
	overrides: Partial<DappSendExecutorDeps> & {
		authwit?: { discoverPrivateAuthwits: ReturnType<typeof vi.fn> }
		buildAndEstimateValidated?: ReturnType<typeof vi.fn>
		buildAndEstimateFolded?: ReturnType<typeof vi.fn>
	} = {},
) {
	const network = {
		id: "net-1",
		profileId: "p1",
		// The live pair below matches it: (1 ^ 6) >>> 0 === 7, and the exact L1 is 1.
		chainId: 7,
		l1ChainId: 1,
		name: "N",
		primaryEndpointId: "ep1",
		endpoints: [{ id: "ep1", rpcUrl: "https://rpc.submit" }],
	} as never
	const node = {
		getNodeInfo: vi.fn(async () => ({ l1ChainId: 1, rollupVersion: 6 })),
		getTxReceipt: vi.fn(async () => ({ status: "success" })),
	}
	const account = { address: addr("0xacct"), createAuthWit: vi.fn(async () => ({ kind: "authwit" })) }
	const pxe = { simulateTx: vi.fn(async () => ({ privateExecutionResult: {} })) }
	const built = {
		txRequest: makeTxRequest(),
		initializesAccount: true,
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
	const authwit = overrides.authwit ?? {
		discoverPrivateAuthwits: vi.fn(async () => ({ actions: [] as unknown[], discovered: [] as unknown[] })),
	}
	const buildAndEstimateValidated = overrides.buildAndEstimateValidated ?? vi.fn(async () => built as never)
	const buildAndEstimateFolded = overrides.buildAndEstimateFolded ?? vi.fn(async () => built as never)
	const estimateWithDiscovery = new DiscoveryAwareEstimator({
		authwit: authwit as never,
		buildAndEstimateValidated: buildAndEstimateValidated as never,
		buildAndEstimateFolded: buildAndEstimateFolded as never,
		buildForDiscovery: (async () => built) as never,
	})
	const deps: DappSendExecutorDeps = {
		planner: {
			processAztecJsPayload: vi.fn(async () => ({
				actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
				feePaymentMethod: undefined,
				feeOptions: {},
			})),
		} as never,
		estimateWithDiscovery,
		txBuilder: {
			buildStandard: vi.fn(async () => built),
			buildNoFrom: vi.fn(async () => built),
		} as never,
		coordinator: { proveAndSend, simulateTxTask: vi.fn(async () => ({})) } as never,
		lane: {
			deleteController: vi.fn(),
			acquireSlot: vi.fn(async () => ({ release: releaseSlot, preController: undefined })),
			claimOrCreateJournal: vi.fn(async () => ({ journalId: "j1", controller: new AbortController() })),
			beginJournal: vi.fn(async () => "j1"),
			markJournal: vi.fn(async () => {}),
			commitJournal: vi.fn(async () => {}),
		},
		operationEstimateReuse: { tryConsume: vi.fn(async () => undefined), stash: vi.fn(), evict: vi.fn() } as never,
		previewSnapshots: new PreviewSnapshots(),
		getActiveProfile: vi.fn(async () => ({ id: "p1" })),
		captureExecutionFence: vi.fn(async () => FENCE),
		assertFence: vi.fn(async () => {}),
		isFenceLive: vi.fn(() => true),
		getNetwork: vi.fn(async () => network),
		getNode: vi.fn(async () => node as never),
		getPXE: vi.fn(() => pxe as never),
		getAccountContract: vi.fn(async () => account as never),
		getPendingForAccount: vi.fn(() => [] as { hash: string }[]),
		getFpcInfo: vi.fn(async () => ({ id: "fpc-1", type: 2, address: "0xfpc", chainId: 7, isProtocol: true }) as never),
		buildAndEstimateValidated,
		addTransaction: vi.fn(async () => ({}) as never),
		recordPendingAuthwits: vi.fn(async () => {}),
		logDebug: vi.fn(),
		readPublicStorageOnce: vi.fn(async () => new Fr(0n)),
		...overrides,
	}
	return {
		deps,
		built,
		node,
		pxe,
		account,
		releaseSlot,
		proveAndSend,
		authwit,
		buildAndEstimateValidated,
		buildAndEstimateFolded,
		executor: new DappSendExecutor(deps),
	}
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
function recordedTx(deps: DappSendExecutorDeps): Record<(typeof RECORD_FIELDS)[number], unknown> {
	const args = (deps.addTransaction as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
	expect(args).toHaveLength(1)
	const input = args[0] as Record<(typeof RECORD_FIELDS)[number], unknown>
	// Key order is evaluation order: the literal must read its values in the field order.
	expect(Object.keys(input)).toEqual([...RECORD_FIELDS])
	return input
}

describe("DappSendExecutor.executeSendTransaction", () => {
	test("happy path: journal begin → simulating → build → proveAndSend(scopes=[account]) → record from txCalls", async () => {
		const { executor, deps, proveAndSend, built } = makeHarness()
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
		} as never
		const result = await executor.executeSendTransaction(op, ORIGIN, undefined, FENCE)

		expect(result).toBe("0xhash")
		// B-02: send_transaction now takes the execution slot + journal scaffold
		// (runInSlot) like the other two dApp-send paths — claimOrCreateJournal, NOT
		// the old un-slotted beginJournal. Args: (networkId, account, origin, calls,
		// hooks, preController, fence).
		expect(deps.lane.acquireSlot).toHaveBeenCalledTimes(1)
		expect(deps.lane.claimOrCreateJournal).toHaveBeenCalledWith(
			"net-1",
			"0xacct",
			ORIGIN,
			[{ method: "dapp_method" }],
			undefined,
			undefined,
			FENCE,
		)
		expect(deps.lane.beginJournal).not.toHaveBeenCalled()
		expect(deps.lane.markJournal).toHaveBeenCalledWith("j1", { stage: "simulating" })
		const ctx = (proveAndSend.mock.calls[0] as unknown[])[0] as { scopes: unknown[] }
		expect(ctx.scopes).toEqual([built.account.address])
		// Activity record uses the build's txCalls verbatim (dApp shape, not transfer shape).
		const record = recordedTx(deps)
		expect(record.account).toBe("0xacct")
		expect(record.calls).toBe(built.txCalls)
		expect(record.nonce).toBe("42")
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})

	test("(B-02 PIN) forwards hooks.originKey to acquireSlot so the slot buckets per-origin", async () => {
		const { executor, deps } = makeHarness()
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
		} as never
		await executor.executeSendTransaction(op, ORIGIN, undefined, FENCE, { originKey: "https://dapp.example" } as never)

		// acquireSlot(networkId, queuedJournalId, fence, onExecutionEnqueued, originKey) —
		// the originKey (5th arg) must be the dApp's, not the __no_origin__ default.
		const call = (deps.lane.acquireSlot as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(call[4]).toBe("https://dapp.example")
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
			actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
		} as never
		await executor.executeSendTransaction(op, ORIGIN, undefined, FENCE)

		expect(recordedTx(deps).submittedEndpointUrl).toBe("https://rpc.submit")
	})

	test("failure: journal → failed with dapp_execute-normalized error, error rethrown", async () => {
		const { executor, deps } = makeHarness({ buildAndEstimateValidated: vi.fn(async () => Promise.reject(new Error("build broke"))) })
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [],
		} as never
		await expect(executor.executeSendTransaction(op, ORIGIN, undefined, FENCE)).rejects.toThrow("build broke")
		expect(deps.lane.markJournal).toHaveBeenCalledWith(
			"j1",
			{ stage: "failed" },
			expect.objectContaining({ message: expect.stringContaining("build broke") }),
		)
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})

	test("claim refusal (no journal record): slot released, no send, error rethrown", async () => {
		const { executor, deps, releaseSlot, proveAndSend } = makeHarness()
		deps.lane.claimOrCreateJournal = vi.fn(async () => {
			throw new Error("dApp send refused: the operation could not be recorded")
		})
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [],
		} as never
		await expect(executor.executeSendTransaction(op, ORIGIN, undefined, FENCE)).rejects.toThrow(/could not be recorded/)
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(releaseSlot).toHaveBeenCalledTimes(1)
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
			buildAndEstimateValidated: vi.fn(async () => ({ ...built, pendingPublicAuthwits: [grant] }) as never),
		})
		await executor.executeSendTransaction(grantOp, ORIGIN, undefined, FENCE)
		const rec = deps.recordPendingAuthwits as ReturnType<typeof vi.fn>
		expect(rec).toHaveBeenCalledTimes(1)
		const args = rec.mock.calls[0] as unknown[]
		// Scoped to the sending tx's (profileId, chainId, account) — never a bare account.
		expect(args[0]).toEqual({ profileId: "p1", chainId: 7, account: expect.any(String) })
		expect(args[1]).toEqual([grant]) // the pending items
		expect(args[2]).toBe("0xhash") // keyed by the tx that wrote them
	})

	test("ESTIMATE records nothing (build is pure; no send → no recording)", async () => {
		const { executor, deps, built } = makeHarness({
			buildAndEstimateValidated: vi.fn(async () => ({ ...built, pendingPublicAuthwits: [grant] }) as never),
		})
		await executor.estimateOperationFee(grantOp, { paymentMethod: { kind: "fj" } } as never)
		expect(deps.recordPendingAuthwits).not.toHaveBeenCalled()
	})

	test("SEND-FAILURE records nothing (the closure runs only after a successful send)", async () => {
		const { executor, deps, built } = makeHarness({
			buildAndEstimateValidated: vi.fn(async () => ({ ...built, pendingPublicAuthwits: [grant] }) as never),
			coordinator: {
				proveAndSend: vi.fn(async () => {
					throw new Error("send broke")
				}),
				simulateTxTask: vi.fn(async () => ({})),
			} as never,
		})
		await expect(executor.executeSendTransaction(grantOp, ORIGIN, undefined, FENCE)).rejects.toThrow("send broke")
		expect(deps.recordPendingAuthwits).not.toHaveBeenCalled()
	})
})

describe("DappSendExecutor.executeAztecSendTx (standard path)", () => {
	test("slot acquired BEFORE journal claim; release fires in finally on success", async () => {
		const { executor, deps, releaseSlot } = makeHarness()
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)

		const acquireOrder = (deps.lane.acquireSlot as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
		const claimOrder = (deps.lane.claimOrCreateJournal as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
		expect(acquireOrder).toBeLessThan(claimOrder)
		expect(releaseSlot).toHaveBeenCalledTimes(1)
	})

	test("opts.from mismatch: frozen error, failed journal, slot still released", async () => {
		const { executor, deps, releaseSlot } = makeHarness()
		const op = makeAztecOp({ opts: { from: addr("0xother"), additionalScopes: [], wait: "NO_WAIT" } })
		await expect(executor.executeAztecSendTx(op, ORIGIN, undefined, undefined, FENCE)).rejects.toThrow("Invalid `opts.from`")
		expect(deps.lane.markJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, expect.anything())
		expect(releaseSlot).toHaveBeenCalledTimes(1)
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
	})

	test("cancel during claim: sentinel passes through raw — no failed transition, slot released", async () => {
		const aborted = new AbortController()
		aborted.abort()
		const { executor, deps, releaseSlot } = makeHarness({
			lane: {
				deleteController: vi.fn(),
				acquireSlot: vi.fn(async () => ({ release: vi.fn(), preController: undefined })),
				claimOrCreateJournal: vi.fn(async () => ({ journalId: "j1", controller: aborted })),
				beginJournal: vi.fn(),
				markJournal: vi.fn(async () => {}),
				commitJournal: vi.fn(async () => {}),
			},
		})
		await expect(executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)).rejects.toBeInstanceOf(
			JobCancelledSentinel,
		)
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
		await embedded.executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)
		expect(embedded.authwit.discoverPrivateAuthwits).not.toHaveBeenCalled()

		const standard = makeHarness()
		await standard.executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)
		// fj folds: discovery happens INSIDE the probed pipeline (one stubbed
		// sim), never as a standalone discoverer call.
		expect(standard.authwit.discoverPrivateAuthwits).not.toHaveBeenCalled()
		expect(standard.buildAndEstimateFolded).toHaveBeenCalledTimes(1)
	})

	test("scopes = [account.address, ...additionalScopes]; NO_WAIT returns txHash, wait returns receipt", async () => {
		const extra = addr("0xextra")
		const noWait = makeHarness()
		const res1 = (await noWait.executor.executeAztecSendTx(
			makeAztecOp({ opts: { from: addr("0xacct"), additionalScopes: [extra], wait: "NO_WAIT" } }),
			ORIGIN,
			undefined,
			undefined,
			FENCE,
		)) as { txHash?: unknown; receipt?: unknown }
		const ctx = (noWait.proveAndSend.mock.calls[0] as unknown[])[0] as { scopes: unknown[] }
		expect(ctx.scopes).toEqual([noWait.built.account.address, extra])
		expect(res1.txHash).toBeDefined()
		expect(res1.receipt).toBeUndefined()

		const waits = makeHarness()
		const res2 = (await waits.executor.executeAztecSendTx(
			makeAztecOp({ opts: { from: addr("0xacct"), additionalScopes: [], wait: undefined } }),
			ORIGIN,
			undefined,
			undefined,
			FENCE,
		)) as { receipt?: unknown }
		expect(waits.node.getTxReceipt).toHaveBeenCalledTimes(1)
		expect(res2.receipt).toEqual({ status: "success" })
	})
})

describe("DappSendExecutor: the submitting commit", () => {
	const sendTransactionOp = {
		kind: "send_transaction",
		networkId: "net-1",
		accountAddress: "0xacct",
		feeSettings: { paymentMethod: { kind: "fj" } },
		actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
	} as never
	const noFromOp = () => makeAztecOp({ executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } } })

	test.each([
		["send_transaction", (e: DappSendExecutor) => e.executeSendTransaction(sendTransactionOp, ORIGIN, undefined, FENCE)],
		["aztec_sendTx", (e: DappSendExecutor) => e.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)],
		["default_entrypoint", (e: DappSendExecutor) => e.executeAztecSendTx(noFromOp(), ORIGIN, undefined, undefined, FENCE)],
	])("%s commits submitting on its record with the submitting network's endpoint", async (_path, run) => {
		collectOffchainEffectsMock.mockReturnValue([])
		const { executor, deps, proveAndSend } = makeHarness()
		proveAndSend.mockImplementationOnce(async (ctx) => {
			const bound = ctx as unknown as ProveAndSendContext
			await bound.commitSubmitting({ txHash: "0xhash", submittedEndpointUrl: bound.submittedEndpointUrl })
			return { txHash: { toString: () => "0xhash" }, offchainOutput: {} }
		})
		await run(executor)
		expect(deps.lane.commitJournal).toHaveBeenCalledWith("j1", {
			stage: "submitting",
			txHash: "0xhash",
			submittedEndpointUrl: "https://rpc.submit",
		})
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
		await expect(executor.executeAztecSendTx(op, ORIGIN, undefined, undefined, FENCE)).rejects.toThrow(
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
			undefined,
			undefined,
			FENCE,
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

	const authEffect = (tag: string) => ({ data: [tag], contractAddress: addr("0xconsumer") })

	test("chain identity rebind (V-01): with effects, the live pair is fetched once and a matching pair signs", async () => {
		collectOffchainEffectsMock.mockReturnValue([authEffect("n")])
		const { executor, node, account } = makeHarness()
		await executor.executeAztecSendTx(makeNoFromOp(), ORIGIN, undefined, undefined, FENCE)
		expect(node.getNodeInfo).toHaveBeenCalledTimes(1)
		expect(account.createAuthWit).toHaveBeenCalledTimes(1)
	})

	test("chain identity rebind (V-01): with effects, a drifted live pair is refused before any authwit or send", async () => {
		collectOffchainEffectsMock.mockReturnValue([authEffect("n")])
		const { executor, node, account, proveAndSend } = makeHarness()
		node.getNodeInfo.mockResolvedValue({ l1ChainId: 1, rollupVersion: 2 })
		let refused: unknown
		try {
			await executor.executeAztecSendTx(makeNoFromOp(), ORIGIN, undefined, undefined, FENCE)
		} catch (error) {
			refused = error
		}
		expect((refused as Error).constructor).toBe(Error)
		expect((refused as Error).message).toBe(
			"Chain identity mismatch: selected network has chainId=7 but live node reports composite=3 (l1ChainId=1, rollupVersion=2). Refusing to sign/prove against a drifted endpoint.",
		)
		expect(account.createAuthWit).not.toHaveBeenCalled()
		expect(proveAndSend).not.toHaveBeenCalled()
	})

	test("chain identity rebind (V-01): with no effects, the live pair is never fetched", async () => {
		collectOffchainEffectsMock.mockReturnValue([])
		const { executor, node } = makeHarness()
		await executor.executeAztecSendTx(makeNoFromOp(), ORIGIN, undefined, undefined, FENCE)
		expect(node.getNodeInfo).not.toHaveBeenCalled()
	})

	test("discovered authorizations are signed in effect order, a malformed effect between them skipped", async () => {
		collectOffchainEffectsMock.mockReturnValue([
			authEffect("first"),
			{ data: [], contractAddress: addr("0xconsumer") },
			authEffect("second"),
		])
		const { executor, account } = makeHarness()
		await executor.executeAztecSendTx(makeNoFromOp(), ORIGIN, undefined, undefined, FENCE)
		expect(account.createAuthWit.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual(["mh:ih:first", "mh:ih:second"])
	})

	test("history record: nonce Fr.ZERO, feePaymentMethod EXTERNAL", async () => {
		collectOffchainEffectsMock.mockReturnValue([])
		const { executor, deps } = makeHarness()
		await executor.executeAztecSendTx(makeNoFromOp(), ORIGIN, undefined, undefined, FENCE)
		const record = recordedTx(deps)
		expect(record.nonce).toBe("0x0000000000000000000000000000000000000000000000000000000000000000")
		expect(record.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.EXTERNAL)
	})
})

describe("DappSendExecutor.estimateOperationFee", () => {
	test("non-send kinds rejected with the frozen message", async () => {
		const { executor } = makeHarness()
		await expect(executor.estimateOperationFee({ kind: "register_token" } as never, {} as never)).rejects.toThrow(
			"Only send_transaction and aztec_sendTx operations support fee estimation",
		)
	})

	test("send_transaction (fj, FOLDED): probed pipeline gets a CLONE — caller's actions untouched, no estimateId", async () => {
		const { executor, buildAndEstimateFolded } = makeHarness()
		const originalActions = [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }]
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: originalActions,
		} as never
		const result = await executor.estimateOperationFee(op, { paymentMethod: { kind: "fj" } } as never)

		expect(originalActions).toHaveLength(1)
		expect(buildAndEstimateFolded).toHaveBeenCalledTimes(1)
		const foldedOp = (buildAndEstimateFolded.mock.calls[0] as unknown[])[0] as { actions: unknown[] }
		expect(foldedOp.actions).toEqual(originalActions)
		expect(foldedOp.actions).not.toBe(originalActions)
		expect(result.maxFee).toBe("880")
		expect("estimateId" in result && result.estimateId).toBeFalsy()
	})

	test("send_transaction (fjwc, CLASSIC): discovered authwits appended to the validated build's clone", async () => {
		const extraAction = { kind: "call", method: "authwit_action" }
		const { executor, deps } = makeHarness({
			authwit: { discoverPrivateAuthwits: vi.fn(async () => ({ actions: [extraAction], discovered: [] })) },
		})
		const originalActions = [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }]
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fjwc" } },
			actions: originalActions,
		} as never
		const result = await executor.estimateOperationFee(op, { paymentMethod: { kind: "fjwc" } } as never)

		expect(originalActions).toHaveLength(1)
		const builtOp = ((deps.buildAndEstimateValidated as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[])[0] as {
			actions: unknown[]
		}
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
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)
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
		await executor.executeAztecSendTx(makeNoFromOp(), ORIGIN, undefined, undefined, FENCE)
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
		await expect(executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)).rejects.toThrow("prove broke")
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
		await expect(executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)).rejects.toThrow("record broke")
		expect(deps.lane.deleteController).toHaveBeenCalledWith("j1")
		expect(releaseSlot).toHaveBeenCalledTimes(1)
	})

	test("standard path: claim throws (no journalId yet) → releaseSlot still fires, deleteController NOT called", async () => {
		const releaseLocal = vi.fn()
		const { executor, deps } = makeHarness({
			lane: {
				deleteController: vi.fn(),
				acquireSlot: vi.fn(async () => ({ release: releaseLocal, preController: undefined })),
				claimOrCreateJournal: vi.fn(async () => {
					throw new Error("claim broke")
				}),
				beginJournal: vi.fn(),
				markJournal: vi.fn(async () => {}),
				commitJournal: vi.fn(async () => {}),
			},
		})
		await expect(executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)).rejects.toThrow("claim broke")
		expect(releaseLocal).toHaveBeenCalledTimes(1)
		expect(deps.lane.deleteController).not.toHaveBeenCalled()
	})

	// Real-Map-backed lane mock (N-25): acquireSlot REGISTERS under the queued
	// id exactly as the production lane does, and deleteController deletes —
	// so the pins observe the Map, not just call choreography. The mock keeps
	// `preController` and the Map consistent (a queuedJournalId with an
	// undefined preController is a state production cannot reach).
	function makeRealMapLane(
		claimBehavior: (map: Map<string, AbortController>) => Promise<{ journalId: string; controller: AbortController }>,
	) {
		const map = new Map<string, AbortController>()
		const releaseLocal = vi.fn()
		const order: string[] = []
		const lane = {
			deleteController: vi.fn((id: string) => {
				order.push(`delete:${id}`)
				map.delete(id)
			}),
			acquireSlot: vi.fn(async (_net: string, queuedJournalId?: string) => {
				let preController: AbortController | undefined
				if (queuedJournalId) {
					preController = new AbortController()
					map.set(queuedJournalId, preController)
				}
				return {
					release: releaseLocal.mockImplementation(() => {
						order.push("release")
					}),
					preController,
				}
			}),
			claimOrCreateJournal: vi.fn(async () => claimBehavior(map)),
			beginJournal: vi.fn(),
			markJournal: vi.fn(async () => {}),
		}
		return { lane, map, releaseLocal, order }
	}

	test("(N-25) claim-throw WITH a queuedJournalId: the pre-registered controller is deleted — map empty, delete before release", async () => {
		const h = makeRealMapLane(async () => {
			throw new JobCancelledSentinel("q-1")
		})
		const { executor } = makeHarness({ lane: h.lane as never })
		await expect(
			executor.executeSendTransaction(
				{
					kind: "send_transaction",
					networkId: "net-1",
					accountAddress: "0xacct",
					feeSettings: { paymentMethod: { kind: "fj" } },
					actions: [{ kind: "call", contract: "0xc", method: "m", args: [] }],
				} as never,
				ORIGIN,
				undefined,
				FENCE,
				{ queuedJournalId: "q-1" } as never,
			),
		).rejects.toBeInstanceOf(JobCancelledSentinel)
		expect(h.map.size).toBe(0) // no entry survives the pre-claim throw
		// EVERY delete precedes the slot release (the P17 oracle checks only the first).
		const releaseIdx = h.order.indexOf("release")
		for (const [i, entry] of h.order.entries()) {
			if (entry.startsWith("delete:")) expect(i).toBeLessThan(releaseIdx)
		}
	})

	test("(N-25) fresh-id fallback: journalId !== queuedJournalId → NEITHER key survives", async () => {
		const h = makeRealMapLane(async (map) => {
			// The record-not-found fallback mints a fresh id and re-registers
			// under it (the stale queued key was deleted in-helper on THIS path,
			// but the finally must not depend on that coupling).
			const controller = new AbortController()
			map.set("fresh-9", controller)
			return { journalId: "fresh-9", controller }
		})
		const { executor, deps } = makeHarness({ lane: h.lane as never })
		await executor.executeSendTransaction(
			{
				kind: "send_transaction",
				networkId: "net-1",
				accountAddress: "0xacct",
				feeSettings: { paymentMethod: { kind: "fj" } },
				actions: [{ kind: "call", contract: "0xc", method: "m", args: [] }],
			} as never,
			ORIGIN,
			undefined,
			FENCE,
			{ queuedJournalId: "q-1" } as never,
		)
		expect(deps.lane).toBe(h.lane)
		expect(h.map.size).toBe(0) // both the queued key and the fresh key are gone
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
		await expect(executor.executeAztecSendTx(makeNoFromOp(), ORIGIN, undefined, undefined, FENCE)).rejects.toThrow("prove broke")
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
		await expect(executor.executeAztecSendTx(op as never, ORIGIN, undefined, undefined, FENCE)).rejects.toThrow("calls boom")
		expect(deps.lane.acquireSlot).toHaveBeenCalledTimes(1)
		expect(releaseSlot).toHaveBeenCalledTimes(1)
	})
})

describe("DappSendExecutor estimate→confirm reuse (aztec_sendTx)", () => {
	test("estimateOperationFee (aztec_sendTx, fj): stash written with bookkeeping fields, estimateId returned", async () => {
		const { executor, deps, built } = makeHarness()
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)

		expect(result.estimateId).toBeDefined()
		const stash = (deps.operationEstimateReuse.stash as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(stash[0]).toBe(result.estimateId)
		expect(stash[1]).toMatchObject({
			profileId: "p1",
			networkId: "net-1",
			accountAddress: "0xacct",
			primaryEndpointId: "ep1",
			pendingHashes: [],
			// (N-15) the stash persists the BUILD's provenance (harness build =
			// true) — a hardcoded false would strip estimate→confirm classification.
			initializesAccount: true,
			// Post-send bookkeeping rides the entry — the reuse-hit tail needs both.
			txCalls: built.txCalls,
			pendingPublicAuthwits: built.pendingPublicAuthwits,
		})
	})

	test("embedded payment method: no stash, estimateId undefined", async () => {
		const { executor, deps } = makeHarness()
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "embedded" } } as never)
		expect(result.estimateId).toBeUndefined()
		expect(deps.operationEstimateReuse.stash).not.toHaveBeenCalled()
	})

	test("dApp-supplied maxFeesPerGas: no stash (entry would always miss on base-fee drift)", async () => {
		const { executor, deps } = makeHarness({
			planner: {
				processAztecJsPayload: vi.fn(async () => ({
					actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
					feePaymentMethod: undefined,
					feeOptions: { maxFeesPerGas: { feePerDaGas: 5, feePerL2Gas: 6 } },
				})),
			} as never,
		})
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)
		expect(result.estimateId).toBeUndefined()
		expect(deps.operationEstimateReuse.stash).not.toHaveBeenCalled()
	})

	test("stash failure is best-effort: estimate still returned, estimateId dropped", async () => {
		const { executor } = makeHarness({
			operationEstimateReuse: {
				tryConsume: vi.fn(),
				stash: vi.fn(() => {
					throw new Error("cache write failed")
				}),
				evict: vi.fn(),
			} as never,
		})
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)
		expect(result.maxFee).toBeDefined()
		expect(result.estimateId).toBeUndefined()
	})

	test("CONSUME-HIT PIN: discovery + buildAndEstimate SKIPPED; addTransaction AND recordPendingAuthwits still run", async () => {
		const pendingPublicAuthwits = [{ account: "0xacct", hash: "0xph", content: { kind: "message_hash", messageHash: "0xm" } }]
		const entry = {
			txRequest: makeTxRequest(),
			initializesAccount: true,
			nonce: { toString: () => "77" },
			feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
			txCalls: [{ contract: "0xc", method: "reused_method", args: [] }],
			pendingPublicAuthwits,
			discoveredHashes: [],
		}
		const { executor, deps, authwit, proveAndSend } = makeHarness({
			operationEstimateReuse: { tryConsume: vi.fn(async () => entry), stash: vi.fn(), evict: vi.fn() } as never,
		})
		// Reuse is licensed only by an owned snapshot: the estimate that produced this reuse entry
		// stashed one under the same previewId (= estimateId). Its empty hash set ⊇ the reused build's.
		deps.previewSnapshots.stash("est-1", { interactionId: "i-1", index: 0, fingerprint: null, discoveredHashes: [] })

		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, APPROVAL("est-1"))

		expect(deps.operationEstimateReuse.tryConsume).toHaveBeenCalledWith(
			"est-1",
			expect.objectContaining({ accountAddress: "0xacct" }),
			FENCE,
		)
		expect(authwit.discoverPrivateAuthwits).not.toHaveBeenCalled()
		expect(deps.buildAndEstimateValidated).not.toHaveBeenCalled()
		// The auth-registry row must exist on a reuse hit — the silent-break
		// scenario: a missing auth-registry row after a reuse-hit grant.
		expect(deps.addTransaction).toHaveBeenCalledTimes(1)
		expect(deps.recordPendingAuthwits).toHaveBeenCalledWith(
			{ profileId: "p1", chainId: 7, account: "0xacct" },
			pendingPublicAuthwits,
			"0xhash",
		)
		// The reused nonce + payment method flow into the activity record.
		const record = recordedTx(deps)
		expect(record.nonce).toBe("77")
		expect(record.feePaymentMethod).toBe(AccountFeePaymentMethodOptions.EXTERNAL)
		// (N-15) the cached build's provenance reaches the send context — a
		// dropped executor assignment would classify a real init race generic.
		const reuseCtx = (proveAndSend.mock.calls[0] as unknown[])[0] as { initializesAccount?: boolean }
		expect(reuseCtx.initializesAccount).toBe(true)
	})

	test("owned snapshot but the reuse entry is gone (stale/drifted id): tryConsume misses, FULL pipeline (fj ⇒ folded)", async () => {
		const { executor, deps, authwit, buildAndEstimateFolded } = makeHarness()
		deps.previewSnapshots.stash("est-stale", { interactionId: "i-1", index: 0, fingerprint: null, discoveredHashes: [] })
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, APPROVAL("est-stale"))
		expect(deps.operationEstimateReuse.tryConsume).toHaveBeenCalledTimes(1)
		expect(authwit.discoverPrivateAuthwits).not.toHaveBeenCalled()
		expect(buildAndEstimateFolded).toHaveBeenCalledTimes(1)
	})

	test("no owned snapshot (forged id): reuse is never attempted — tryConsume untouched, FULL pipeline", async () => {
		const { executor, deps, buildAndEstimateFolded } = makeHarness()
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, APPROVAL("est-forged"))
		expect(deps.operationEstimateReuse.tryConsume).not.toHaveBeenCalled()
		expect(buildAndEstimateFolded).toHaveBeenCalledTimes(1)
	})

	test("two attempts: a foreign take pops A's snapshot, then estimateId = previewId = A cannot reuse A's build", async () => {
		const entry = {
			txRequest: makeTxRequest(),
			initializesAccount: false,
			nonce: { toString: () => "1" },
			feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
			txCalls: [{ contract: "0xc", method: "reused_method", args: [] }],
			pendingPublicAuthwits: [],
			discoveredHashes: [],
		}
		// tryConsume WOULD hit — the only thing standing between B and A's cached build is ownership.
		const { executor, deps, buildAndEstimateFolded } = makeHarness({
			operationEstimateReuse: { tryConsume: vi.fn(async () => entry), stash: vi.fn(), evict: vi.fn() } as never,
		})
		deps.previewSnapshots.stash("A", { interactionId: "i-A", index: 0, fingerprint: null, discoveredHashes: [] })

		// Attempt 1 — interaction C names A's previewId with no estimateId: refused as foreign, and
		// the single-shot take has consumed A's snapshot.
		await expect(
			executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, {
				interactionId: "i-C",
				index: 0,
				previewId: "A",
			}),
		).rejects.toThrow(PREVIEW_FOREIGN_MESSAGE)
		expect(deps.operationEstimateReuse.tryConsume).not.toHaveBeenCalled()

		// Attempt 2 — A's owner (equal ids, matching fingerprint) no longer holds a snapshot, so the
		// build is recomputed: the cached one is never consumed, whatever tryConsume would say.
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, {
			interactionId: "i-A",
			index: 0,
			estimateId: "A",
			previewId: "A",
		})
		expect(deps.operationEstimateReuse.tryConsume).not.toHaveBeenCalled()
		expect(buildAndEstimateFolded).toHaveBeenCalledTimes(1)
	})

	test("no estimateId: tryConsume never touched (fj ⇒ folded pipeline)", async () => {
		const { executor, deps, buildAndEstimateFolded } = makeHarness()
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)
		expect(deps.operationEstimateReuse.tryConsume).not.toHaveBeenCalled()
		expect(buildAndEstimateFolded).toHaveBeenCalledTimes(1)
	})
})

describe("DappSendExecutor — the authorizing session", () => {
	const order = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
	const noFromOp = () => makeAztecOp({ executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } } })
	const reusing = (tryConsume: ReturnType<typeof vi.fn>) =>
		({ tryConsume, stash: vi.fn(), evict: vi.fn() }) as unknown as DappSendExecutorDeps["operationEstimateReuse"]
	const entry = () => ({
		txRequest: makeTxRequest(),
		initializesAccount: false,
		nonce: { toString: () => "5" },
		feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
		txCalls: [],
		pendingPublicAuthwits: [],
		discoveredHashes: [],
	})
	const ownSnapshot = (deps: DappSendExecutorDeps) =>
		deps.previewSnapshots.stash("est-1", { interactionId: "i-1", index: 0, fingerprint: null, discoveredHashes: [] })
	const sessionEnded = expect.objectContaining({ kind: "session_ended" })

	test("a reused estimate asserts the fence, then resolves the fence's account, never the active profile's", async () => {
		const fence = { profileId: "p-fence", epoch: 0, session: 9 }
		const { executor, deps, proveAndSend } = makeHarness({
			operationEstimateReuse: reusing(vi.fn(async () => entry())),
			getActiveProfile: vi.fn(async () => ({ id: "p-active" })),
		})
		ownSnapshot(deps)
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, fence, APPROVAL("est-1"))
		expect(deps.operationEstimateReuse.tryConsume).toHaveBeenCalledWith("est-1", expect.anything(), fence)
		expect(deps.assertFence).toHaveBeenCalledWith(fence)
		expect(deps.getAccountContract).toHaveBeenCalledWith("p-fence", 7, "0xacct")
		expect(order(deps.assertFence)).toBeLessThan(order(deps.getAccountContract))
		expect(deps.getActiveProfile).not.toHaveBeenCalled()
		expect(proveAndSend).toHaveBeenCalledTimes(1)
	})

	test("the session ending before a reused build resolves its account: no lookup, no send, failed/session_ended", async () => {
		const { executor, deps, proveAndSend } = makeHarness({
			operationEstimateReuse: reusing(vi.fn(async () => entry())),
			assertFence: vi.fn(async () => {
				throw new SessionEndedError()
			}),
		})
		ownSnapshot(deps)
		await expect(
			executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, APPROVAL("est-1")),
		).rejects.toBeInstanceOf(SessionEndedError)
		expect(deps.getAccountContract).not.toHaveBeenCalled()
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.lane.markJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, sessionEnded)
	})

	test("the session ending while a reused build resolves its account: no send, failed/session_ended", async () => {
		const isFenceLive = vi.fn(() => true)
		const { executor, deps, proveAndSend } = makeHarness({
			operationEstimateReuse: reusing(vi.fn(async () => entry())),
			isFenceLive,
			getAccountContract: vi.fn(async () => {
				isFenceLive.mockReturnValue(false)
				return {} as never
			}),
		})
		ownSnapshot(deps)
		await expect(
			executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, APPROVAL("est-1")),
		).rejects.toBeInstanceOf(SessionEndedError)
		expect(isFenceLive).toHaveBeenCalledWith(FENCE)
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.lane.markJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, sessionEnded)
	})

	test("tryConsume refusing another profile's entry: the fresh build is never attempted, failed/session_ended", async () => {
		const { executor, deps, proveAndSend, buildAndEstimateFolded } = makeHarness({
			operationEstimateReuse: reusing(
				vi.fn(async () => {
					throw new SessionEndedError()
				}),
			),
		})
		ownSnapshot(deps)
		await expect(
			executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, APPROVAL("est-1")),
		).rejects.toBeInstanceOf(SessionEndedError)
		expect(buildAndEstimateFolded).not.toHaveBeenCalled()
		expect(deps.buildAndEstimateValidated).not.toHaveBeenCalled()
		expect(proveAndSend).not.toHaveBeenCalled()
		expect(deps.lane.markJournal).toHaveBeenCalledWith("j1", { stage: "failed" }, sessionEnded)
	})

	type Harness = ReturnType<typeof makeHarness>
	const firstCall = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
	const arms: Array<{ name: string; run: (h: Harness) => Promise<unknown>; builtUnder: (h: Harness) => unknown }> = [
		{
			name: "send_transaction",
			run: (h) =>
				h.executor.executeSendTransaction(
					{
						kind: "send_transaction",
						networkId: "net-1",
						accountAddress: "0xacct",
						feeSettings: { paymentMethod: { kind: "fj" } },
						actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
					} as never,
					ORIGIN,
					undefined,
					FENCE,
				),
			builtUnder: (h) => firstCall(h.buildAndEstimateValidated)[2],
		},
		{
			name: "aztec_sendTx standard",
			run: (h) => h.executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE),
			builtUnder: (h) => firstCall(h.buildAndEstimateFolded)[2],
		},
		{
			name: "aztec_sendTx NO_FROM",
			run: (h) => h.executor.executeAztecSendTx(noFromOp(), ORIGIN, undefined, undefined, FENCE),
			builtUnder: (h) => firstCall(h.deps.txBuilder.buildNoFrom)[1],
		},
	]

	test.each(arms)(
		"$name: slot, journal and build answer to the fence, and the send checks are bound to it",
		async ({ run, builtUnder }) => {
			collectOffchainEffectsMock.mockReturnValue([])
			const h = makeHarness()
			await run(h)
			expect(firstCall(h.deps.lane.acquireSlot)[2]).toBe(FENCE)
			expect(firstCall(h.deps.lane.claimOrCreateJournal)[6]).toBe(FENCE)
			expect(builtUnder(h)).toBe(FENCE)
			const ctx = firstCall(h.proveAndSend)[0] as { assertAuthorization: () => Promise<void>; assertLive: () => void }
			await ctx.assertAuthorization()
			expect(h.deps.assertFence).toHaveBeenLastCalledWith(FENCE)
			ctx.assertLive()
			;(h.deps.isFenceLive as ReturnType<typeof vi.fn>).mockReturnValue(false)
			expect(() => ctx.assertLive()).toThrow(SessionEndedError)
			expect(h.deps.isFenceLive).toHaveBeenLastCalledWith(FENCE)
		},
	)

	test("estimate and preview build under the fence captured at their entry; a locked wallet builds nothing", async () => {
		collectOffchainEffectsMock.mockReturnValue([])
		const h = makeHarness()
		await h.executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)
		expect(firstCall(h.buildAndEstimateFolded)[2]).toBe(FENCE)
		await h.executor.previewOperationAuthwits(noFromOp(), { interactionId: "i-1", index: 0 })
		expect(firstCall(h.deps.txBuilder.buildNoFrom)[1]).toBe(FENCE)

		const locked = makeHarness({
			captureExecutionFence: vi.fn(async () => {
				throw new Error("Wallet locked")
			}),
		})
		await expect(locked.executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)).rejects.toThrow(
			"Wallet locked",
		)
		await expect(locked.executor.previewOperationAuthwits(noFromOp(), { interactionId: "i-1", index: 0 })).rejects.toThrow(
			"Wallet locked",
		)
		expect(locked.deps.planner.processAztecJsPayload).not.toHaveBeenCalled()
		expect(locked.buildAndEstimateFolded).not.toHaveBeenCalled()
		expect(locked.deps.txBuilder.buildNoFrom).not.toHaveBeenCalled()
	})
})

describe("DappSendExecutor — discovered authwits, the preview snapshot and the confirm guard", () => {
	const CTX = { interactionId: "i-1", index: 0 }
	const identity = { ...CTX, fingerprint: null }
	const effect = (tag: string) => ({ data: [tag], contractAddress: addr("0xconsumer") })
	const record = (tag: string) => ({
		consumer: "0xconsumer",
		caller: `caller:${tag}`,
		selector: "0xsel",
		args: [`arg:${tag}`],
		innerHash: `ih:${tag}`,
		messageHash: `mh:ih:${tag}`,
	})
	/** A folded pipeline whose probe reports `tags` as discovered. */
	const foldedDiscovering = (tags: string[], built: unknown) =>
		vi.fn(async (...args: unknown[]) => {
			const probe = args[3] as { collected: unknown[]; discovered: unknown[] }
			for (const tag of tags) {
				probe.collected.push({ kind: "add_private_authwit", content: { kind: "message_hash", messageHash: `mh:ih:${tag}` } })
				probe.discovered.push(record(tag))
			}
			return built
		})
	const harnessDiscovering = (tags: string[], overrides: Parameters<typeof makeHarness>[0] = {}) => {
		const base = makeHarness()
		return makeHarness({ buildAndEstimateFolded: foldedDiscovering(tags, base.built), ...overrides })
	}
	const snapshots = (deps: DappSendExecutorDeps) => deps.previewSnapshots

	test("estimate (aztec_sendTx): returns the discovered list, previewId = estimateId, snapshot + stash carry the hashes", async () => {
		const { executor, deps } = harnessDiscovering(["a"])
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never, undefined, CTX)

		expect(result.discoveredAuthwits).toEqual([record("a")])
		expect(result.previewId).toBe(result.estimateId)
		expect(snapshots(deps).take(result.previewId, identity)).toEqual({
			kind: "found",
			snapshot: expect.objectContaining({ ...CTX, discoveredHashes: ["mh:ih:a"] }),
		})
		const stash = (deps.operationEstimateReuse.stash as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
		expect(stash[1]).toMatchObject({ discoveredHashes: ["mh:ih:a"] })
	})

	test("estimate without an interaction context writes no snapshot and mints no preview id", async () => {
		const { executor } = harnessDiscovering(["a"])
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)
		expect(result.previewId).toBeUndefined()
		expect(result.discoveredAuthwits).toEqual([record("a")])
	})

	test("estimate (send_transaction): NEVER lists discovered authwits nor a preview id — confirm adds none", async () => {
		const { executor } = harnessDiscovering(["a"])
		const op = {
			kind: "send_transaction",
			networkId: "net-1",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
		} as never
		const result = await executor.estimateOperationFee(op, { paymentMethod: { kind: "fj" } } as never, undefined, CTX)
		expect("discoveredAuthwits" in result).toBe(false)
		expect(result.previewId).toBeUndefined()
	})

	test("a reuse-INELIGIBLE estimate (embedded) still writes the snapshot under its own preview id", async () => {
		const { executor, deps } = makeHarness({
			planner: {
				processAztecJsPayload: vi.fn(async () => ({
					actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
					feePaymentMethod: undefined,
					feeOptions: { embeddedFeePayment: "fpc" },
				})),
			} as never,
			authwit: { discoverPrivateAuthwits: vi.fn(async () => ({ actions: [], discovered: [record("e")] })) },
		})
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "embedded" } } as never, undefined, CTX)
		expect(result.estimateId).toBeUndefined()
		expect(result.previewId).toBeDefined()
		expect(deps.operationEstimateReuse.stash).not.toHaveBeenCalled()
		expect(snapshots(deps).take(result.previewId, identity).kind).toBe("found")
	})

	test("confirm, reused estimate: the entry's hashes within the snapshot execute without re-discovery", async () => {
		const entry = {
			txRequest: makeTxRequest(),
			initializesAccount: true,
			nonce: { toString: () => "77" },
			feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
			txCalls: [],
			pendingPublicAuthwits: [],
			discoveredHashes: ["mh:ih:a"],
		}
		const { executor, deps, proveAndSend, buildAndEstimateFolded } = makeHarness({
			operationEstimateReuse: { tryConsume: vi.fn(async () => entry), stash: vi.fn(), evict: vi.fn() } as never,
		})
		snapshots(deps).stash("est-1", { ...identity, discoveredHashes: ["mh:ih:a"] })
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, {
			...CTX,
			estimateId: "est-1",
			previewId: "est-1",
		})
		expect(proveAndSend).toHaveBeenCalledTimes(1)
		expect(buildAndEstimateFolded).not.toHaveBeenCalled()
	})

	test("confirm, rebuilt: a set within the snapshot executes; a new hash aborts before the prove", async () => {
		const ok = harnessDiscovering(["a"])
		snapshots(ok.deps).stash("pv", { ...identity, discoveredHashes: ["mh:ih:a", "mh:ih:z"] })
		await ok.executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, { ...CTX, previewId: "pv" })
		expect(ok.proveAndSend).toHaveBeenCalledTimes(1)

		const changed = harnessDiscovering(["b"])
		snapshots(changed.deps).stash("pv", { ...identity, discoveredHashes: ["mh:ih:a"] })
		await expect(
			changed.executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, { ...CTX, previewId: "pv" }),
		).rejects.toThrow(AUTHWITS_CHANGED_MESSAGE)
		expect(changed.proveAndSend).not.toHaveBeenCalled()
	})

	test("a popup pairing one interaction's estimateId with another's previewId is refused before either id is consumed", async () => {
		const { executor, deps, proveAndSend } = harnessDiscovering(["a"])
		// A valid snapshot exists under previewId "pv"; the reuse cache would accept "est-A".
		snapshots(deps).stash("pv", { ...identity, discoveredHashes: ["mh:ih:a"] })
		await expect(
			executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, {
				...CTX,
				estimateId: "est-A",
				previewId: "pv",
			}),
		).rejects.toThrow(PREVIEW_FOREIGN_MESSAGE)
		expect(proveAndSend).not.toHaveBeenCalled()
		// The snapshot was NOT consumed by the refused attempt: a well-formed retry still finds it.
		expect(snapshots(deps).take("pv", identity).kind).toBe("found")
	})

	test("confirm with NO snapshot: a discovered hash asks for a retry; nothing discovered executes", async () => {
		const withHash = harnessDiscovering(["a"])
		await expect(withHash.executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, CTX)).rejects.toThrow(
			ESTIMATE_INCOMPLETE_MESSAGE,
		)
		expect(withHash.proveAndSend).not.toHaveBeenCalled()

		const clean = harnessDiscovering([])
		await clean.executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, CTX)
		expect(clean.proveAndSend).toHaveBeenCalledTimes(1)
	})

	test("a preview id minted for another (interactionId, index) is refused even with nothing discovered", async () => {
		const { executor, deps, proveAndSend } = harnessDiscovering([])
		snapshots(deps).stash("pv", { interactionId: "i-2", index: 0, fingerprint: null, discoveredHashes: [] })
		await expect(
			executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, { ...CTX, previewId: "pv" }),
		).rejects.toThrow(PREVIEW_FOREIGN_MESSAGE)
		expect(proveAndSend).not.toHaveBeenCalled()
	})

	test("the silent path (no envelope) is never held to a preview", async () => {
		const { executor, proveAndSend } = harnessDiscovering(["a"])
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)
		expect(proveAndSend).toHaveBeenCalledTimes(1)
	})

	describe("NO_FROM", () => {
		const noFromOp = () => makeAztecOp({ executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } } })

		test("preview discovers through the confirm's own path, returns the records, signs nothing, writes the snapshot", async () => {
			collectOffchainEffectsMock.mockReturnValue([effect("n"), effect("n")])
			const { executor, deps, account, pxe } = makeHarness()
			const preview = await executor.previewOperationAuthwits(noFromOp(), CTX)
			expect(preview.discoveredAuthwits).toEqual([record("n"), record("n")])
			expect(account.createAuthWit).not.toHaveBeenCalled()
			expect(pxe.simulateTx).toHaveBeenCalledTimes(1)
			expect(deps.coordinator.simulateTxTask).not.toHaveBeenCalled()
			expect(snapshots(deps).take(preview.previewId, identity)).toEqual({
				kind: "found",
				snapshot: expect.objectContaining({ ...CTX, discoveredHashes: ["mh:ih:n", "mh:ih:n"] }),
			})
			await expect(executor.previewOperationAuthwits(makeAztecOp(), CTX)).rejects.toThrow("default_entrypoint")
		})

		test("preview and confirm agree on the fingerprint: an unchanged request matches, a changed argument does not", async () => {
			collectOffchainEffectsMock.mockReturnValue([effect("n")])
			const same = makeHarness()
			const op = noFromOp()
			const preview = await same.executor.previewOperationAuthwits(op, CTX)
			await same.executor.executeAztecSendTx(op, ORIGIN, undefined, undefined, FENCE, { ...CTX, previewId: preview.previewId })
			expect(same.account.createAuthWit).toHaveBeenCalledTimes(1)
			expect(same.proveAndSend).toHaveBeenCalledTimes(1)

			const drifted = makeHarness()
			const previewed = await drifted.executor.previewOperationAuthwits(noFromOp(), CTX)
			const changed = makeAztecOp({
				executionMode: "default_entrypoint",
				feeSettings: { paymentMethod: { kind: "embedded" } },
				exec: { calls: [{ name: "dapp_method", args: ["0x1"] }] },
			})
			await expect(
				drifted.executor.executeAztecSendTx(changed, ORIGIN, undefined, undefined, FENCE, {
					...CTX,
					previewId: previewed.previewId,
				}),
			).rejects.toThrow(PREVIEW_FOREIGN_MESSAGE)
			expect(drifted.account.createAuthWit).not.toHaveBeenCalled()
		})

		test("an estimateId paired with another previewId is refused before the snapshot is consumed", async () => {
			collectOffchainEffectsMock.mockReturnValue([effect("n")])
			const { executor, deps, account, proveAndSend } = makeHarness()
			const preview = await executor.previewOperationAuthwits(noFromOp(), CTX)
			await expect(
				executor.executeAztecSendTx(noFromOp(), ORIGIN, undefined, undefined, FENCE, {
					...CTX,
					estimateId: "est-A",
					previewId: preview.previewId,
				}),
			).rejects.toThrow(PREVIEW_FOREIGN_MESSAGE)
			expect(account.createAuthWit).not.toHaveBeenCalled()
			expect(proveAndSend).not.toHaveBeenCalled()
			expect(snapshots(deps).take(preview.previewId, identity).kind).toBe("found")
		})

		test("an unseen hash aborts BEFORE any witness is created; the silent NO_FROM path still signs", async () => {
			collectOffchainEffectsMock.mockReturnValue([effect("n")])
			const guarded = makeHarness()
			snapshots(guarded.deps).stash("pv", { ...identity, discoveredHashes: ["mh:ih:other"] })
			await expect(
				guarded.executor.executeAztecSendTx(noFromOp(), ORIGIN, undefined, undefined, FENCE, { ...CTX, previewId: "pv" }),
			).rejects.toThrow(AUTHWITS_CHANGED_MESSAGE)
			expect(guarded.account.createAuthWit).not.toHaveBeenCalled()
			expect(guarded.proveAndSend).not.toHaveBeenCalled()

			const silent = makeHarness()
			await silent.executor.executeAztecSendTx(noFromOp(), ORIGIN, undefined, undefined, FENCE)
			expect(silent.account.createAuthWit).toHaveBeenCalledTimes(1)
		})

		test("ROUTED: a popup approval dispatched through executeOperations reaches the NO_FROM guard (no preview ⇒ retry)", async () => {
			collectOffchainEffectsMock.mockReturnValue([effect("n")])
			const { executor, account } = makeHarness()
			const task = { startSubtask: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
			// The real dispatch chain on a bare prototype instance: a dropped
			// envelope forwarding anywhere in it would execute instead of refusing.
			const self = Object.assign(Object.create(ExecutionService.prototype), {
				ensureInitialized: async () => {},
				planner: { extractPrimaryMethod: () => "dapp_method" },
				taskService: { startNewTask: () => task },
				profileService: { captureExecutionFence: async () => FENCE },
				dappSendExecutor: executor,
				legal: { assertCurrent: async () => {} },
				logDebug: () => {},
				logInfo: () => {},
				logError: () => {},
			}) as { executeOperations: (...args: unknown[]) => Promise<{ status: string; error?: unknown }[]> }
			const results = await self.executeOperations([noFromOp()], ORIGIN, undefined, undefined, [CTX], FENCE)
			expect(results[0]?.status).toBe("failed")
			expect(JSON.stringify(results[0])).toContain(ESTIMATE_INCOMPLETE_MESSAGE)
			expect(account.createAuthWit).not.toHaveBeenCalled()
		})
	})

	describe("NO_FROM preview cancellation through the service RPC (previewOperationAuthwits + cancelEstimate)", () => {
		const noFromOp = () => makeAztecOp({ executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } } })
		type Rpc = {
			previewOperationAuthwits(
				i: string,
				n: number,
				tok?: string,
				flow?: string,
			): Promise<{ previewId?: string; discoveredAuthwits?: unknown[] }>
			cancelEstimate(tok: string): Promise<void>
			previewSnapshots: PreviewSnapshots
			estimateCancel: { unsettledCount(p: string): number }
		}
		/** The real service methods on a bare prototype, over the real cancel registry + snapshot
		 *  wiring (`wireGasBalancesAndEstimateCaches`) and the harness's real executor. The executor
		 *  writes previews into the store the registry evicts from — one store, so an eviction the
		 *  RPC chain drops would be visible here. */
		const rpc = () => {
			const h = makeHarness()
			const self = Object.assign(Object.create(ExecutionService.prototype), {
				profileService: { getActiveProfile: async () => ({ id: "p1" }) },
				networkService: {},
				accountService: {},
				transactionService: {},
				fpcService: {},
				pxeService: {},
				resolver: {},
				logger: {},
				ensureInitialized: async () => {},
				services: { get: () => ({ materializeStoredOperation: async () => noFromOp() }) },
				dappSendExecutor: h.executor,
				logDebug: () => {},
				logError: () => {},
			})
			;(
				ExecutionService.prototype as unknown as { wireGasBalancesAndEstimateCaches: () => void }
			).wireGasBalancesAndEstimateCaches.call(self)
			// Point the service at the executor's store so the registry's `evictStash` reaches what the
			// RPC actually wrote (production wires both from the same field).
			;(self as { previewSnapshots: PreviewSnapshots }).previewSnapshots = h.deps.previewSnapshots
			return { self: self as unknown as Rpc, ...h }
		}

		test("a successful handoff preserves the snapshot the popup will confirm against", async () => {
			collectOffchainEffectsMock.mockReturnValue([effect("n")])
			const { self } = rpc()
			const result = await self.previewOperationAuthwits("i-1", 0, "tok-ok", "op")
			expect(result.discoveredAuthwits).toHaveLength(1)
			expect(self.estimateCancel.unsettledCount("p1")).toBe(0)
			expect(self.previewSnapshots.take(result.previewId, identity)).toMatchObject({
				kind: "found",
				snapshot: { interactionId: "i-1", index: 0, discoveredHashes: ["mh:ih:n"] },
			})
		})

		test("cancelling after the stash evicts the snapshot through the settled-token path", async () => {
			collectOffchainEffectsMock.mockReturnValue([effect("n")])
			const { self } = rpc()
			const result = await self.previewOperationAuthwits("i-1", 0, "tok-late", "op")
			await self.cancelEstimate("tok-late")
			expect(self.previewSnapshots.take(result.previewId, identity)).toEqual({ kind: "missing" })
		})

		test("cancelling during discovery aborts the RPC with the structured error and stashes nothing", async () => {
			collectOffchainEffectsMock.mockReturnValue([effect("n")])
			const { self, pxe, deps } = rpc()
			const stash = vi.spyOn(deps.previewSnapshots, "stash")
			let release: (v: { privateExecutionResult: object }) => void = () => {}
			pxe.simulateTx.mockImplementationOnce(() => new Promise((r) => (release = r)))
			const pending = self.previewOperationAuthwits("i-1", 0, "tok-mid", "op")
			// Let admission + prepare run up to the stalled discovery simulation.
			for (let i = 0; i < 50 && pxe.simulateTx.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 1))
			expect(pxe.simulateTx).toHaveBeenCalledTimes(1)
			expect(self.estimateCancel.unsettledCount("p1")).toBe(1)
			await self.cancelEstimate("tok-mid")
			release({ privateExecutionResult: {} })
			await expect(pending).rejects.toBeInstanceOf(JobCancelledError)
			expect(self.estimateCancel.unsettledCount("p1")).toBe(0)
			// The abort lands at the checkpoint after discovery returns and before the preview is
			// written: the store never receives a snapshot for this attempt.
			expect(stash).not.toHaveBeenCalled()
		})
	})
})

describe("DappSendExecutor.estimateOperationFee sponsor funding", () => {
	const SPONSOR = AztecAddress.fromNumberUnsafe(0x5f)
	const FPC_SETTINGS = { paymentMethod: { kind: "fpc", fpcId: "fpc-9" } } as never
	const FORGED = { fpcId: "fpc-9", address: SPONSOR.toString(), funded: true }

	/** A sponsor-paid build with a real `GasSettings` (fee limit 2 × 100 + 3 × 200 = 800) and a
	 *  node whose storage read must never be the probe's. */
	function sponsorHarness(opts: { named?: boolean; balance?: bigint | Error } = {}) {
		const readPublicStorageOnce = vi.fn(async () => {
			if (opts.balance instanceof Error) throw opts.balance
			return new Fr(opts.balance ?? 799n)
		})
		const h = makeHarness({
			readPublicStorageOnce,
			planner: {
				processAztecJsPayload: vi.fn(async () => ({
					actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
					feePaymentMethod: undefined,
					feeOptions: { sponsorFunding: FORGED },
				})),
			} as never,
		})
		const node = { ...h.node, getPublicStorageAt: vi.fn() }
		const gasSettings = new GasSettings(new Gas(100, 200), new Gas(10, 20), new GasFees(2n, 3n), new GasFees(0n, 0n))
		Object.assign(h.built, {
			node,
			txRequest: { authWitnesses: [], txContext: { gasSettings } },
			...(opts.named === false ? {} : { sponsor: { fpcId: "fpc-9", address: SPONSOR } }),
		})
		return { ...h, readPublicStorageOnce, node }
	}

	/** An operation whose own fields claim the sponsor is funded. */
	function forgingOp() {
		return makeAztecOp({
			feeSettings: FPC_SETTINGS,
			sponsorFunding: FORGED,
			opts: { from: addr("0xacct"), additionalScopes: [], wait: "NO_WAIT", sponsorFunding: FORGED },
		})
	}

	test("a build naming a sponsor carries the probe's verdict, never the dApp's, read through the one-shot reader", async () => {
		const { executor, deps, built, readPublicStorageOnce, node } = sponsorHarness({ balance: 0n })

		const result = await executor.estimateOperationFee(forgingOp(), FPC_SETTINGS)

		expect(result.sponsorFunding).toEqual({ fpcId: "fpc-9", address: SPONSOR.toString(), funded: false })
		expect(result.estimateId).toBeDefined()
		expect(readPublicStorageOnce).toHaveBeenCalledTimes(1)
		expect((readPublicStorageOnce.mock.calls[0] as unknown[])[0]).toBe(built.network)
		expect(node.getPublicStorageAt).not.toHaveBeenCalled()
		expect(deps.logDebug).toHaveBeenCalledWith("sponsor probe", { outcome: "short" })
	})

	test.each([
		{ build: "a build naming no sponsor", named: false, balance: 0n, reads: 0 },
		{ build: "a failed read", named: true, balance: new Error("Request to https://rpc.example timed out"), reads: 1 },
	])("$build: no sponsorFunding key, whatever the dApp's payload carries", async ({ named, balance, reads }) => {
		const { executor, readPublicStorageOnce } = sponsorHarness({ named, balance })

		const result = await executor.estimateOperationFee(forgingOp(), FPC_SETTINGS)

		expect(result).not.toHaveProperty("sponsorFunding")
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

		await expect(executor.estimateOperationFee(forgingOp(), FPC_SETTINGS, controller.signal)).rejects.toThrow(JobCancelledSentinel)
		expect(deps.operationEstimateReuse.stash).not.toHaveBeenCalled()
	})
})

describe("DappSendExecutor: the activity record, field by field", () => {
	const GAS_DETAILS = {
		l2GasLimit: 200,
		daGasLimit: 100,
		teardownL2GasLimit: 20,
		teardownDaGasLimit: 10,
		feePerL2Gas: "3",
		feePerDaGas: "2",
	}
	const NO_FROM = (overrides: Record<string, unknown> = {}) =>
		makeAztecOp({ executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } }, ...overrides })

	test("send_transaction: the build's calls, nonce and payment, the op's networkId", async () => {
		const { executor, deps, built } = makeHarness()
		const op = {
			kind: "send_transaction",
			networkId: "net-op",
			accountAddress: "0xacct",
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
		} as never
		await executor.executeSendTransaction(op, ORIGIN, undefined, FENCE)
		expect(recordedTx(deps)).toStrictEqual({
			origin: ORIGIN,
			chainId: 7,
			account: "0xacct",
			calls: built.txCalls,
			nonce: "42",
			feePaymentMethod: { kind: "fee_juice" },
			hash: "0xhash",
			submittedEndpointUrl: "https://rpc.submit",
			estimatedFee: "880",
			gasDetails: GAS_DETAILS,
			fence: FENCE,
			networkId: "net-op",
		})
	})

	test("aztec_sendTx, fresh build: the same shape", async () => {
		const { executor, deps, built } = makeHarness()
		await executor.executeAztecSendTx(makeAztecOp({ networkId: "net-op" }), ORIGIN, undefined, undefined, FENCE)
		expect(recordedTx(deps)).toStrictEqual({
			origin: ORIGIN,
			chainId: 7,
			account: "0xacct",
			calls: built.txCalls,
			nonce: "42",
			feePaymentMethod: { kind: "fee_juice" },
			hash: "0xhash",
			submittedEndpointUrl: "https://rpc.submit",
			estimatedFee: "880",
			gasDetails: GAS_DETAILS,
			fence: FENCE,
			networkId: "net-op",
		})
	})

	test("aztec_sendTx, reuse hit: the entry's provenance, the re-resolved network, the op's networkId", async () => {
		const live = { id: "net-live", chainId: 9, primaryEndpointId: "ep1", endpoints: [{ id: "ep1", rpcUrl: "https://rpc.live" }] }
		const txCalls = [{ contract: "0xc", method: "reused_method", args: [] }]
		const entry = {
			txRequest: makeTxRequest(),
			initializesAccount: false,
			nonce: { toString: () => "77" },
			feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
			txCalls,
			pendingPublicAuthwits: [],
			discoveredHashes: [],
		}
		const { executor, deps } = makeHarness({
			getNetwork: vi.fn(async () => live as never),
			operationEstimateReuse: { tryConsume: vi.fn(async () => entry), stash: vi.fn(), evict: vi.fn() } as never,
		})
		deps.previewSnapshots.stash("est-1", { interactionId: "i-1", index: 0, fingerprint: null, discoveredHashes: [] })
		await executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE, APPROVAL("est-1"))
		expect(recordedTx(deps)).toStrictEqual({
			origin: ORIGIN,
			chainId: 9,
			account: "0xacct",
			calls: txCalls,
			nonce: "77",
			feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
			hash: "0xhash",
			submittedEndpointUrl: "https://rpc.live",
			estimatedFee: "880",
			gasDetails: GAS_DETAILS,
			fence: FENCE,
			networkId: "net-1",
		})
	})

	test("NO_FROM: nonce zero, external payment, the op's networkId", async () => {
		collectOffchainEffectsMock.mockReturnValue([])
		const { executor, deps, built } = makeHarness()
		await executor.executeAztecSendTx(NO_FROM({ networkId: "net-op" }), ORIGIN, undefined, undefined, FENCE)
		expect(recordedTx(deps)).toStrictEqual({
			origin: ORIGIN,
			chainId: 7,
			account: "0xacct",
			calls: built.txCalls,
			nonce: Fr.ZERO.toString(),
			feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
			hash: "0xhash",
			submittedEndpointUrl: "https://rpc.submit",
			estimatedFee: "880",
			gasDetails: GAS_DETAILS,
			fence: FENCE,
			networkId: "net-op",
		})
	})

	test("the recorder awaits addTransaction before it writes the pending authwits", async () => {
		const authwits = [{ account: "0xacct", hash: "0xph", content: { kind: "message_hash", messageHash: "0xm" } }]
		let resolveAdd: (v: unknown) => void = () => {}
		const addTransaction = vi.fn(() => new Promise((r) => (resolveAdd = r)))
		const { executor, deps, built } = makeHarness({ addTransaction: addTransaction as never })
		Object.assign(built, { pendingPublicAuthwits: authwits })
		const sending = executor.executeAztecSendTx(makeAztecOp(), ORIGIN, undefined, undefined, FENCE)
		for (let i = 0; i < 50 && addTransaction.mock.calls.length === 0; i++) await Promise.resolve()
		expect(addTransaction).toHaveBeenCalledTimes(1)
		for (let i = 0; i < 20; i++) await Promise.resolve()
		expect(deps.recordPendingAuthwits).not.toHaveBeenCalled()
		resolveAdd({})
		await sending
		expect(deps.recordPendingAuthwits).toHaveBeenCalledTimes(1)
	})

	test.each([
		["the shared recorder resolves to nothing", false, undefined],
		["the NO_FROM recorder resolves to addTransaction's own value", true, "the-tx-row"],
	])("%s", async (_label, noFrom, expected) => {
		collectOffchainEffectsMock.mockReturnValue([])
		let recorded: unknown = "unset"
		const proveAndSend = vi.fn(async (ctx: { recordTransaction: (h: string) => Promise<unknown> }) => {
			recorded = await ctx.recordTransaction("0xhash")
			return { txHash: { toString: () => "0xhash" }, offchainOutput: {} }
		})
		const h = makeHarness({ addTransaction: vi.fn(async () => "the-tx-row" as never) })
		Object.assign(h.deps.coordinator, { proveAndSend })
		await h.executor.executeAztecSendTx(noFrom ? NO_FROM() : makeAztecOp(), ORIGIN, undefined, undefined, FENCE)
		expect(recorded).toBe(expected)
	})
})

describe("DappSendExecutor.estimateOperationFee: the reuse snapshot", () => {
	const NOW = 1_700_000_000_000
	const FPC_SETTINGS = { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } }
	const PRIMARY_SECOND = {
		id: "net-1",
		chainId: 7,
		primaryEndpointId: "ep2",
		endpoints: [
			{ id: "ep1", rpcUrl: "https://first" },
			{ id: "ep2", rpcUrl: "https://primary" },
		],
	}

	function snapshotHarness(overrides: Parameters<typeof makeHarness>[0] = {}, network: object = PRIMARY_SECOND) {
		const h = makeHarness({ getActiveProfile: vi.fn(async () => ({ id: "p-active" })), ...overrides })
		const txRequest = makeTxRequest() as { txContext: { gasSettings: { maxFeesPerGas: object } } }
		txRequest.txContext.gasSettings.maxFeesPerGas = { feePerDaGas: 7n, feePerL2Gas: 11n }
		Object.assign(h.built, { network, txRequest, chainIdentity: { l1ChainId: 1, rollupVersion: 6 } })
		return h
	}

	const stashed = (deps: DappSendExecutorDeps) =>
		(deps.operationEstimateReuse.stash as ReturnType<typeof vi.fn>).mock.calls as unknown[][]

	test("the entry: the built fee and chain pair, the primary by id, the active profile, the FPC row", async () => {
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] })
		try {
			const { executor, deps, built } = snapshotHarness()
			const result = await executor.estimateOperationFee(makeAztecOp(), FPC_SETTINGS as never)
			const fingerprint = fingerprintOperation({
				networkId: "net-1",
				accountAddress: "0xacct",
				executionMode: "standard",
				from: "0xacct",
				actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }],
				fee: {},
				feeSettings: FPC_SETTINGS as never,
			})
			expect(stashed(deps)).toStrictEqual([
				[
					result.estimateId,
					{
						fingerprint,
						accountAddress: "0xacct",
						networkId: "net-1",
						feeSettings: FPC_SETTINGS,
						profileId: "p-active",
						chainIdentity: { l1ChainId: 1, rollupVersion: 6 },
						baseFeeFingerprint: "7:11",
						primaryEndpointId: "ep2",
						primaryEndpointUrl: "https://primary",
						pendingHashes: [],
						fpcIdentity: { id: "fpc-1", type: 2, address: "0xfpc", chainId: 7, isProtocol: true },
						txRequest: built.txRequest,
						initializesAccount: true,
						nonce: built.nonce,
						feePaymentMethod: built.feePaymentMethod,
						txCalls: built.txCalls,
						pendingPublicAuthwits: built.pendingPublicAuthwits,
						discoveredHashes: [],
						builtAt: NOW,
					},
				],
			])
		} finally {
			vi.useRealTimers()
		}
	})

	test("an fpc entry: a pending tx that lands during the FPC read is in the snapshot", async () => {
		const pending: { hash: string }[] = [{ hash: "0xpending" }]
		const { executor, deps } = snapshotHarness({
			getPendingForAccount: vi.fn(() => [...pending]),
			getFpcInfo: vi.fn(async () => {
				pending.push({ hash: "0xraced" })
				return { id: "fpc-1", type: 2, address: "0xfpc", chainId: 7, isProtocol: true } as never
			}),
		})
		await executor.estimateOperationFee(makeAztecOp(), FPC_SETTINGS as never)
		expect((stashed(deps)[0][1] as { pendingHashes: string[] }).pendingHashes).toEqual(["0xpending", "0xraced"])
	})

	test("an fj entry reads no FPC row and carries no fpcIdentity", async () => {
		const { executor, deps } = snapshotHarness()
		await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)
		expect(deps.getFpcInfo).not.toHaveBeenCalled()
		expect((stashed(deps)[0][1] as { fpcIdentity?: unknown }).fpcIdentity).toBeUndefined()
	})

	const payload = (feeOptions: object, args: unknown[] = []) => ({
		planner: {
			processAztecJsPayload: vi.fn(async () => ({
				actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args }],
				feePaymentMethod: undefined,
				feeOptions,
			})),
		} as never,
	})

	test.each([
		["send_transaction", () => ({ kind: "send_transaction", networkId: "net-1", accountAddress: "0xacct", actions: [] }), {}, "fj"],
		["default_entrypoint (not embedded)", () => makeAztecOp({ executionMode: "default_entrypoint" }), {}, "fj"],
		["a detected embedded fee", () => makeAztecOp(), payload({ embeddedFeePayment: "fpc" }), "fj"],
		["a dApp maxFeesPerGas", () => makeAztecOp(), payload({ maxFeesPerGas: { feePerDaGas: 5, feePerL2Gas: 6 } }), "fj"],
		["the fjwc kind", () => makeAztecOp(), {}, "fjwc"],
		["the embedded kind", () => makeAztecOp(), {}, "embedded"],
		["a non-fingerprintable operation", () => makeAztecOp(), payload({}, [() => 1]), "fj"],
	])("%s: no stash, no profile read", async (_label, makeOp, overrides, kind) => {
		const { executor, deps } = snapshotHarness(overrides as never)
		const result = await executor.estimateOperationFee(makeOp() as never, { paymentMethod: { kind } } as never)
		expect(result.estimateId).toBeUndefined()
		expect(deps.operationEstimateReuse.stash).not.toHaveBeenCalled()
		expect(deps.getActiveProfile).not.toHaveBeenCalled()
	})

	test("eligibility control: a plain fj aztec_sendTx stashes", async () => {
		const { executor, deps } = snapshotHarness()
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)
		expect(result.estimateId).toBeDefined()
		expect(deps.operationEstimateReuse.stash).toHaveBeenCalledTimes(1)
	})

	test("a dangling primaryEndpointId: no stash, no profile read, nothing logged", async () => {
		const { executor, deps } = snapshotHarness({}, { ...PRIMARY_SECOND, primaryEndpointId: "ep9" })
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)
		expect(result.estimateId).toBeUndefined()
		expect(deps.getActiveProfile).not.toHaveBeenCalled()
		expect(deps.logDebug).not.toHaveBeenCalledWith("estimateOperationFee: cache write skipped", expect.anything())
	})

	test("no endpoints array: the skip line carries the lookup's TypeError", async () => {
		const { executor, deps } = snapshotHarness({}, { id: "net-1", chainId: 7, primaryEndpointId: "ep2" })
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)
		expect(result.estimateId).toBeUndefined()
		expect(deps.logDebug).toHaveBeenCalledWith("estimateOperationFee: cache write skipped", expect.any(TypeError))
	})

	test("no active profile: no stash and no log", async () => {
		const { executor, deps } = snapshotHarness({ getActiveProfile: vi.fn(async () => undefined) })
		const result = await executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never)
		expect(result.estimateId).toBeUndefined()
		expect(deps.operationEstimateReuse.stash).not.toHaveBeenCalled()
		expect(deps.logDebug).not.toHaveBeenCalledWith("estimateOperationFee: cache write skipped", expect.anything())
	})
})

describe("DappSendExecutor: the journal title thunk and the offchain output", () => {
	const NO_FROM = (overrides: Record<string, unknown> = {}) =>
		makeAztecOp({ executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } }, ...overrides })

	test.each([
		["standard", false],
		["NO_FROM", true],
	])("%s: the claimed title per call list", async (_label, noFrom) => {
		collectOffchainEffectsMock.mockReturnValue([])
		const cases: Array<[unknown, unknown]> = [
			[undefined, undefined],
			[[], undefined],
			[[{ name: "claim_and_end_setup" }, { name: "claim_public" }], [{ method: "claim_public" }]],
			[[{ name: "dapp_method" }], [{ method: "dapp_method" }]],
		]
		for (const [calls, expected] of cases) {
			const { executor, deps } = makeHarness()
			const exec = calls === undefined ? {} : { calls }
			const op = noFrom ? NO_FROM({ exec }) : makeAztecOp({ exec })
			await executor.executeAztecSendTx(op, ORIGIN, undefined, undefined, FENCE)
			expect((deps.lane.claimOrCreateJournal as ReturnType<typeof vi.fn>).mock.calls[0]?.[3]).toStrictEqual(expected)
		}
	})

	test.each([
		["standard", false, 0],
		["NO_FROM", true, 1],
	])("%s: the call list is read for the title only after acquireSlot", async (_label, noFrom, readsBeforeSlot) => {
		collectOffchainEffectsMock.mockReturnValue([])
		const trace: string[] = []
		const { executor, deps } = makeHarness()
		const acquire = deps.lane.acquireSlot as ReturnType<typeof vi.fn>
		const original = acquire.getMockImplementation() as (...a: unknown[]) => Promise<unknown>
		acquire.mockImplementation(async (...a: unknown[]) => {
			trace.push("acquireSlot")
			return original(...a)
		})
		const exec = {}
		Object.defineProperty(exec, "calls", {
			get() {
				trace.push("calls")
				return [{ name: "dapp_method" }]
			},
		})
		await executor.executeAztecSendTx(noFrom ? NO_FROM({ exec }) : makeAztecOp({ exec }), ORIGIN, undefined, undefined, FENCE)
		// NO_FROM's opening debug line counts the calls once before it enqueues.
		expect(trace.indexOf("acquireSlot")).toBe(readsBeforeSlot)
	})

	test.each([
		["standard", false],
		["NO_FROM", true],
	])("%s: the offchain output is extracted at the anchor timestamp, as a bigint", async (_label, noFrom) => {
		collectOffchainEffectsMock.mockReturnValue([])
		extractOffchainOutputSpy.mockClear()
		const effects: unknown[] = []
		const provedTx = {
			publicInputs: { constants: { anchorBlockHeader: { globalVariables: { timestamp: 5 } } } },
			getOffchainEffects: () => effects,
		}
		const proveAndSend = vi.fn(async (ctx: { wantOffchainOutput?: (p: unknown) => unknown }) => ({
			txHash: { toString: () => "0xhash" },
			offchainOutput: ctx.wantOffchainOutput?.(provedTx),
		}))
		const h = makeHarness()
		Object.assign(h.deps.coordinator, { proveAndSend })
		await h.executor.executeAztecSendTx(noFrom ? NO_FROM() : makeAztecOp(), ORIGIN, undefined, undefined, FENCE)
		expect(extractOffchainOutputSpy.mock.calls).toStrictEqual([[effects, 5n]])
	})
})

describe("DappSendExecutor: each estimate cancel checkpoint", () => {
	const expectCancelled = async (pending: Promise<unknown>) => {
		const error = await pending.catch((e: unknown) => e)
		expect(error).toBeInstanceOf(JobCancelledSentinel)
		expect((error as JobCancelledSentinel).jobId).toBe("")
	}

	test("operation estimate, pre-aborted: nothing runs", async () => {
		const { executor, deps } = makeHarness()
		const controller = new AbortController()
		controller.abort()
		await expectCancelled(executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never, controller.signal))
		expect(deps.captureExecutionFence).not.toHaveBeenCalled()
	})

	test("operation estimate, abort during the payload parse: no build", async () => {
		const controller = new AbortController()
		const { executor, buildAndEstimateFolded, buildAndEstimateValidated } = makeHarness({
			planner: {
				processAztecJsPayload: vi.fn(async () => {
					controller.abort()
					return { actions: [{ kind: "call", contract: "0xc", method: "dapp_method", args: [] }], feeOptions: {} }
				}),
			} as never,
		})
		await expectCancelled(executor.estimateOperationFee(makeAztecOp(), { paymentMethod: { kind: "fj" } } as never, controller.signal))
		expect(buildAndEstimateFolded).not.toHaveBeenCalled()
		expect(buildAndEstimateValidated).not.toHaveBeenCalled()
	})

	test("operation estimate, abort during the build: no sponsor probe, no stash", async () => {
		const controller = new AbortController()
		const { executor, deps, built, buildAndEstimateFolded } = makeHarness()
		const gasSettings = new GasSettings(new Gas(100, 200), new Gas(10, 20), new GasFees(2n, 3n), new GasFees(0n, 0n))
		Object.assign(built, {
			txRequest: { authWitnesses: [], txContext: { gasSettings } },
			sponsor: { fpcId: "fpc-9", address: AztecAddress.fromNumberUnsafe(0x5f) },
		})
		buildAndEstimateFolded.mockImplementation(async () => {
			controller.abort()
			return built
		})
		const fpc = { paymentMethod: { kind: "fpc", fpcId: "fpc-9" } } as never
		await expectCancelled(executor.estimateOperationFee(makeAztecOp({ feeSettings: fpc }), fpc, controller.signal))
		expect(deps.readPublicStorageOnce).not.toHaveBeenCalled()
		expect(deps.operationEstimateReuse.stash).not.toHaveBeenCalled()
	})

	test("discovery estimator, abort during discovery: no build", async () => {
		const controller = new AbortController()
		const { executor, deps } = makeHarness({
			authwit: {
				discoverPrivateAuthwits: vi.fn(async () => {
					controller.abort()
					return { actions: [], discovered: [] }
				}),
			},
		})
		const op = { kind: "send_transaction", networkId: "net-1", accountAddress: "0xacct", actions: [] } as never
		await expectCancelled(executor.estimateOperationFee(op, { paymentMethod: { kind: "fjwc" } } as never, controller.signal))
		expect(deps.buildAndEstimateValidated).not.toHaveBeenCalled()
	})

	const NO_FROM = () => makeAztecOp({ executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } } })
	const PREVIEW = { interactionId: "i-1", index: 0 }

	test("NO_FROM preview, pre-aborted: nothing runs", async () => {
		const { executor, deps } = makeHarness()
		const controller = new AbortController()
		controller.abort()
		await expectCancelled(executor.previewOperationAuthwits(NO_FROM(), PREVIEW as never, controller.signal))
		expect(deps.captureExecutionFence).not.toHaveBeenCalled()
	})

	test("NO_FROM preview, abort during the build: no discovery", async () => {
		const controller = new AbortController()
		const { executor, deps, built, pxe } = makeHarness()
		;(deps.txBuilder.buildNoFrom as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			controller.abort()
			return built
		})
		await expectCancelled(executor.previewOperationAuthwits(NO_FROM(), PREVIEW as never, controller.signal))
		expect(pxe.simulateTx).not.toHaveBeenCalled()
	})

	test("NO_FROM preview, abort during discovery: no snapshot", async () => {
		collectOffchainEffectsMock.mockReturnValue([])
		const controller = new AbortController()
		const { executor, deps, pxe } = makeHarness()
		const stash = vi.spyOn(deps.previewSnapshots, "stash")
		pxe.simulateTx.mockImplementationOnce(async () => {
			controller.abort()
			return { privateExecutionResult: {} }
		})
		await expectCancelled(executor.previewOperationAuthwits(NO_FROM(), PREVIEW as never, controller.signal))
		expect(stash).not.toHaveBeenCalled()
	})
})

describe("DappSendExecutor — a confirm whose reuse fee read fails", () => {
	const FPC_SETTINGS = { paymentMethod: { kind: "fpc", fpcId: "fpc-1" } }
	const PREVIEW = { interactionId: "i-1", index: 0 }

	/** A real reuse cache over the harness's own lookups, whose node's min-fee prediction rejects. The
	 *  folded pipeline (fpc's discovery) reports `0xa` at the estimate and `confirmDiscovered` on the rebuild. */
	function failingReadHarness(confirmDiscovered: string[]) {
		const reuseLog = vi.fn()
		const feeNode = {
			getPredictedMinFees: vi.fn(async () => {
				throw new Error("block not found")
			}),
			getCurrentMinFees: vi.fn(),
		}
		const deps: { current?: DappSendExecutorDeps } = {}
		const reuse = new OperationEstimateReuse({
			getNetwork: (id) => (deps.current as DappSendExecutorDeps).getNetwork(id),
			getNode: async () => feeNode as never,
			getLiveChainIdentity: async () => ({ l1ChainId: 1, rollupVersion: 6 }),
			getFpcInfo: (id) => (deps.current as DappSendExecutorDeps).getFpcInfo(id),
			getPendingForAccount: (account) => (deps.current as DappSendExecutorDeps).getPendingForAccount(account),
			logDebug: reuseLog,
		})
		const built: { current?: unknown } = {}
		const perBuild = [["0xa"], confirmDiscovered]
		const buildAndEstimateFolded = vi.fn(async (...args: unknown[]) => {
			const probe = args[3] as { collected: unknown[]; discovered: unknown[] }
			for (const messageHash of perBuild.shift() ?? []) {
				probe.collected.push({ kind: "add_private_authwit", content: { kind: "message_hash", messageHash } })
				probe.discovered.push({ messageHash })
			}
			return built.current
		})
		const h = makeHarness({ operationEstimateReuse: reuse, buildAndEstimateFolded })
		deps.current = h.deps
		built.current = Object.assign(h.built, { chainIdentity: { l1ChainId: 1, rollupVersion: 6 } })
		return { ...h, feeNode, reuseLog }
	}

	test("the read rejects: the reuse misses, and the confirm rebuilds through discovery and sends", async () => {
		const h = failingReadHarness(["0xa"])
		const op = () => makeAztecOp({ feeSettings: FPC_SETTINGS })
		const { estimateId } = await h.executor.estimateOperationFee(op(), FPC_SETTINGS as never, undefined, PREVIEW as never)
		expect(estimateId).toBeDefined()

		await h.executor.executeAztecSendTx(op(), ORIGIN, undefined, undefined, FENCE, APPROVAL(estimateId as string))

		expect(h.feeNode.getPredictedMinFees).toHaveBeenCalledTimes(1)
		expect(h.reuseLog.mock.calls).toEqual([["operation estimate reuse rejected: base fee fetch failed"]])
		expect(h.buildAndEstimateFolded).toHaveBeenCalledTimes(2)
		expect(h.proveAndSend).toHaveBeenCalledTimes(1)
		expect(h.deps.addTransaction).toHaveBeenCalledTimes(1)
	})

	test("the rebuild is held to the preview: an authorization the preview never showed is refused unsent", async () => {
		const h = failingReadHarness(["0xa", "0xb"])
		const op = () => makeAztecOp({ feeSettings: FPC_SETTINGS })
		const { estimateId } = await h.executor.estimateOperationFee(op(), FPC_SETTINGS as never, undefined, PREVIEW as never)

		await expect(
			h.executor.executeAztecSendTx(op(), ORIGIN, undefined, undefined, FENCE, APPROVAL(estimateId as string)),
		).rejects.toThrow(AUTHWITS_CHANGED_MESSAGE)

		expect(h.reuseLog.mock.calls).toEqual([["operation estimate reuse rejected: base fee fetch failed"]])
		expect(h.proveAndSend).not.toHaveBeenCalled()
		expect(h.deps.addTransaction).not.toHaveBeenCalled()
	})
})
