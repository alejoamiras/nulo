/**
 * Composition test (integration-test spike, Phases 2+3): drives the REAL
 * ExecutionService → coordinator → lane graph + the REAL OperationJournalService
 * FSM in-process, with NO Aztec sandbox / offscreen worker / proving / browser.
 * Proves the cancel-mid-prove contract through the real executeTransfer +
 * cancelJob public API (codex condition).
 *
 * SCOPE (narrow, on purpose): this exercises the REUSED-prepared-tx cancel path.
 * It seeds `estimateReuse` so executeTransfer takes the fast path and SKIPS
 * buildStandard (whose deep chain — node chain-identity, contract resolution,
 * account-contract request-building — would be "a second wallet" to fake). The
 * FRESH-build path is NOT covered here; it's the heavy boundary deferred to the
 * rollout — see lessons/phase-2.md.
 *
 * FAKE_IPXE_BUNDLE_MARKER — the fakes live in this `*.test.ts`, so they are
 * never in the production bundle (Phase-2 gate greps `dist/` for this marker;
 * it must be absent).
 */
import { describe, expect, test, vi } from "vitest"
import { Gas } from "@aztec/stdlib/gas"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { EventHandler } from "@nulo/wallet-core/utils"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { ProfileService } from "@/wallet/services/profile/service"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { ContactService } from "@/wallet/services/contact/service"
import { TokenService } from "@/wallet/services/token/service"
import { PriceService } from "@/wallet/services/price/service"
import { FpcService } from "@/wallet/services/fpc/service"
import { TransactionService, TransferType } from "@/wallet/services/transaction/service"
import { OriginType } from "@/wallet/services/transaction/spec"
import { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { TaskService } from "@/wallet/services/task/service"
import type { PxeServiceClient } from "@/wallet/services/pxe/client"
import type { ProofGate } from "@/e2e/proof-gate"
import type { ExecutionLane } from "./execution-lane"
import { DEFAULT_FEE_MULTIPLIER } from "./fee/fee-strategy"
import { EmbeddedStrategy } from "./fee/embedded-strategy"
import { FeeJuiceStrategy } from "./fee/fee-juice-strategy"
import { FeeJuiceWithClaimStrategy } from "./fee/fee-juice-with-claim-strategy"
import { FpcStrategy } from "./fee/fpc-strategy"
import {
	fingerprintBaseFee,
	fingerprintFeeSettings,
	type TransferEstimateReuse,
	type TransferEstimateReuseEntry,
} from "./transfer-estimate-reuse"
import { ExecutionService } from "./service"
import type { FeeSettings } from "./models"

// ── Controllable proof gate: holds proveTxTask until release() ──────────────
function makeControllableGate() {
	let resolveGate: () => void = () => {}
	let entered = false
	const gate: ProofGate = {
		wait: () => {
			entered = true
			return new Promise<void>((r) => {
				resolveGate = r
			})
		},
	}
	return {
		gate,
		release: () => resolveGate(),
		get entered() {
			return entered
		},
	}
}

const MIN_FEES = { feePerDaGas: 1n, feePerL2Gas: 1n }
const ACCOUNT = AztecAddress.fromNumberUnsafe(0x1234)
const NETWORK = {
	id: "net1",
	chainId: 1,
	primaryEndpointId: "ep1",
	endpoints: [{ id: "ep1", rpcUrl: "http://fake" }],
}

function svc(name: string, methods: Record<string, unknown>) {
	return { name, dependencies: [], async start() {}, ...methods } as never
}

async function makeHarness() {
	// Per-harness state — no module-level mutable singletons, so the rollout can
	// call makeHarness() in many tests without cross-contamination.
	const stages: string[] = []
	const sendTx = vi.fn(async () => {})
	// proveTx returns a stub TxProvingResult whose `toTx` is spied: the post-prove
	// cancel checkpoint must drop the proof BEFORE `toTx`, so `toTx` proves submission.
	const toTx = vi.fn(async () => ({ getTxHash: () => ({ toString: () => "0xhash" }) }))
	const fakeNode = { getCurrentMinFees: async () => MIN_FEES, sendTx } as unknown as never
	const fakeIPXE = { proveTx: vi.fn(async () => ({ toTx })) } as unknown as ReturnType<PxeServiceClient["getPXE"]>
	const fakePxeClient = { getPXE: () => fakeIPXE } as unknown as PxeServiceClient

	const logger = new LoggerStore(new ConfigStore())
	const ctrl = makeControllableGate()

	// REAL journal (FakeBrowserApi-backed) so the actual FSM + transition lock run.
	const api = new FakeBrowserApi()
	api.reset()
	const journal = new OperationJournalService(logger, api)
	let journalId = ""
	journal.onOperationAdded.add((rec) => {
		journalId = rec.id
	})
	journal.onOperationUpdated.add((rec) => stages.push(rec.progress.stage))

	const collection = new ServiceCollection()
	// One shared ProfileDeletionState so Execution's captureFence + Transaction's
	// addTransaction assert against the SAME epoch map (D13 fence wiring).
	const deletionState = new ProfileDeletionState()
	// Real handler so the facade's profile-switch invalidation (D12) is both
	// subscribable by the service and firable by tests.
	const profileChanged = new EventHandler<unknown>()
	collection.add(
		svc(ProfileService.name, {
			getActiveProfile: async () => ({ id: "p1" }),
			// The journal's create fence checks membership here — the fake must
			// list the profile the flow files under or every create is refused.
			getProfiles: async () => [{ id: "p1" }],
			getDeletionState: () => deletionState,
			captureExecutionFence: async () => ({ profileId: "p1", epoch: deletionState.capture("p1") }),
			onActiveProfileChanged: profileChanged,
		}),
	)
	const getNetwork = vi.fn(async () => NETWORK)
	collection.add(svc(NetworkService.name, { getNetwork, getNode: async () => fakeNode }))
	collection.add(svc(AccountService.name, { getAccountContract: async () => ({ address: ACCOUNT }) }))
	collection.add(
		svc(TransactionService.name, {
			getPendingForAccount: () => [],
			addTransaction: vi.fn(),
			onTransactionUpdated: { add: () => {} },
		}),
	)
	collection.add(svc(TokenService.name, {}))
	collection.add(svc(FpcService.name, { onFpcUpdated: { add: () => {} }, onFpcDeleted: { add: () => {} } }))
	collection.add(svc(ContactService.name, {}))
	collection.add(svc(AuthRegistryService.name, { assertWithinCap: async () => {} }))
	collection.add(journal)
	// `cancel` is part of the real WrappedTask surface — classifyOperationCatch
	// calls task.cancel() on a user-cancel before returning the cancelled result.
	const fakeTask = { complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), startSubtask: vi.fn() }
	fakeTask.startSubtask.mockReturnValue(fakeTask)
	collection.add(svc(TaskService.name, { startNewTask: () => fakeTask }))
	collection.add(svc(PriceService.name, { getUsableQuote: async () => undefined }))

	const service = new ExecutionService(logger, ctrl.gate, () => fakePxeClient)
	collection.add(service)
	await collection.start()

	// Seed the reuse cache so executeTransfer takes the fast path (skips build).
	const feeSettings = { paymentMethod: { kind: "fpc" } } as unknown as FeeSettings
	const req = {
		networkId: NETWORK.id,
		accountAddress: ACCOUNT.toString(),
		tokenId: 1,
		transferType: TransferType.Public,
		recipientAddress: AztecAddress.fromNumberUnsafe(0x5678).toString(),
		amount: 10n,
		feeSettings,
	}
	const entry: TransferEstimateReuseEntry = {
		networkId: req.networkId,
		initializesAccount: false,
		accountAddress: req.accountAddress,
		tokenId: req.tokenId,
		transferType: req.transferType,
		recipientAddress: req.recipientAddress,
		amount: req.amount,
		feeSettingsHash: fingerprintFeeSettings(feeSettings),
		profileId: "p1",
		baseFeeFingerprint: fingerprintBaseFee({
			feePerDaGas: MIN_FEES.feePerDaGas * BigInt(DEFAULT_FEE_MULTIPLIER),
			feePerL2Gas: MIN_FEES.feePerL2Gas * BigInt(DEFAULT_FEE_MULTIPLIER),
		}),
		primaryEndpointId: "ep1",
		primaryEndpointUrl: "http://fake",
		pendingHashes: [],
		txRequest: { txContext: { gasSettings: { teardownGas: new Gas(1, 1) } } } as never,
		nonce: { toString: () => "0" },
		feePaymentMethod: "EXTERNAL" as never,
		token: { contract: "0xtok", name: "Tok", symbol: "TOK", decimals: 18 },
		fnName: "transfer_public_to_public",
		args: [],
		builtAt: Date.now(),
	}
	const reuse = (service as unknown as { estimateReuse: TransferEstimateReuse }).estimateReuse
	reuse.stash("estimate-1", entry)

	return {
		service,
		ctrl,
		req,
		estimateId: "estimate-1",
		journal,
		stages,
		sendTx,
		toTx,
		getJournalId: () => journalId,
		profileChanged,
		getNetwork,
	}
}

const waitFor = async (pred: () => boolean, timeoutMs = 2000) => {
	const deadline = Date.now() + timeoutMs
	while (!pred()) {
		if (Date.now() > deadline) throw new Error("waitFor timeout")
		await new Promise((r) => setTimeout(r, 5))
	}
}

describe("ExecutionService composition — cancel-mid-prove (in-process, no sandbox)", () => {
	test("cancel while proving: real journal → cancelled, proof dropped before submit, never sent", async () => {
		const { service, ctrl, req, estimateId, journal, stages, sendTx, toTx, getJournalId } = await makeHarness()

		const p = service
			.executeTransfer(
				req.networkId,
				req.accountAddress,
				req.tokenId,
				req.transferType,
				req.recipientAddress,
				req.amount,
				req.feeSettings,
				estimateId,
			)
			.catch((e) => e)

		// Wait until the real journal recorded `proving` and the coordinator parked on the gate.
		await waitFor(() => ctrl.entered && stages.includes("proving"))

		// Cancel while held at prove, then release so prove finishes → post-prove checkpoint fires.
		await service.cancelJob(getJournalId())
		ctrl.release()
		await p

		// Real FSM: the op is terminally `cancelled`, and NEVER advanced past prove.
		const final = await journal.getOperation(getJournalId())
		expect(final?.progress.stage).toBe("cancelled")
		expect(stages).not.toContain("submitting")
		expect(stages).not.toContain("succeeded")
		// Proof artifact dropped at the post-PROVE checkpoint — never converted to a tx, never sent.
		expect(toTx).not.toHaveBeenCalled()
		expect(sendTx).not.toHaveBeenCalled()
	})
})

// Q23 close-out (both models' recommended risk-reducer, in lieu of the rejected
// QueuedClaimHandle seam): the cancel-during-QUEUED-WAIT race through the real
// graph. A queued dapp-send job parked on the held execution slot, cancelled
// mid-wait, must end terminally `cancelled` WITHOUT ever advancing to
// simulating/proving/submitting — and must not wedge the slot for the next job.
//
// The slot holder is acquired directly via `lane.acquireSlot` — the SAME
// primitive a live dapp-send holds while simulating/proving. `executeTransfer`
// can't stand in: only the dapp-send path (dapp-send-executor.ts) touches the
// per-(profile, chain) execution mutex, so a transfer never contends this slot.
describe("ExecutionService composition — cancel during queued-wait (in-process)", () => {
	test("cancel a queued dapp-send waiting on the held slot → cancelled, never advances, slot not wedged", async () => {
		const { service, journal } = await makeHarness()
		// executeOperations takes the dapp LocalTxOrigin object; the journal record's
		// `origin` is the OperationOrigin string enum ("dapp"). Different types.
		const origin = { type: OriginType.DAPP, name: "test-dapp" } as never
		const lane = (service as unknown as { lane: ExecutionLane }).lane
		// `activeControllers` is private — observe it to know job2 has pre-registered
		// its controller (acquireSlot:230) and is parked on the mutex (acquireSlot:246).
		const controllers = (lane as unknown as { activeControllers: Map<string, unknown> }).activeControllers

		// Pre-allocate a QUEUED dapp_execute record (what background.ts allocates on
		// message arrival, before the silent/popup path claims it). queued is gated on
		// kind=dapp_execute + origin="dapp" + non-empty sessionId (NewOperationInputSchema).
		const queued = await journal.createOperation({
			kind: "dapp_execute",
			origin: "dapp",
			profileId: "p1",
			sessionId: "sess-1",
			initialStage: { stage: "queued" },
		})
		const queuedId = queued.id
		const queuedStages: string[] = []
		journal.onOperationUpdated.add((rec) => {
			if (rec.id === queuedId) queuedStages.push(rec.progress.stage)
		})

		// Occupy the (p1, net1) execution slot directly — same primitive a live
		// dapp-send holds while in flight. Job 2 must wait behind this.
		const held = await lane.acquireSlot(NETWORK.id, undefined)

		// Job 2 (dapp-send) with the queued record → acquireSlot pre-registers its
		// controller under queuedId, then WAITS on the held slot. The minimal op
		// only needs networkId (for the slot) + truthy feeSettings (standard-path
		// guard); the cancel fires while parked at acquireSlot, long before the
		// opts.from / payload validation downstream.
		const aztecSendOp = {
			kind: "aztec_sendTx",
			networkId: NETWORK.id,
			accountAddress: ACCOUNT.toString(),
			feeSettings: { paymentMethod: { kind: "fpc" } },
		} as never
		// executeOperations catches JobCancelledSentinel internally (classifyOperationCatch)
		// and RETURNS a results array — it never throws here, so no .catch is needed.
		const p2 = service.executeOperations([aztecSendOp], origin, undefined, { queuedJournalId: queuedId })

		// Wait until job2 has pre-registered its controller and is parked on the slot.
		await waitFor(() => controllers.has(queuedId))

		// Cancel job2 while it waits: cancelJob transitions the queued record FIRST
		// (queued→cancelled via the journal transition lock), then aborts the
		// pre-registered controller → job2's acquire-wait aborts (JobCancelledSentinel).
		await service.cancelJob(queuedId)
		const r2 = await p2

		// The queued record is terminally cancelled and NEVER advanced past the wait.
		const finalQ = await journal.getOperation(queuedId)
		expect(finalQ?.progress.stage).toBe("cancelled")
		expect(queuedStages).not.toContain("simulating")
		expect(queuedStages).not.toContain("proving")
		expect(queuedStages).not.toContain("submitting")
		// Job 2 surfaced as a user-cancel (NOT a downstream fail) at the result layer.
		expect(r2[0]?.status).toBe("cancelled")

		// The slot is NOT wedged: after releasing the holder, a fresh acquire grants
		// promptly (would hang past the test timeout if job2's abort corrupted the FIFO).
		held.release()
		const held2 = await lane.acquireSlot(NETWORK.id, undefined)
		held2.release()
	}, 15_000)

	// (B-02 forwarding-seam PIN) executeOperations must thread `hooks` (incl.
	// originKey) all the way to DappSendExecutor.executeSendTransaction for the
	// send_transaction kind — otherwise grants collapse into the __no_origin__
	// slot bucket. The DappSendExecutor unit test injects hooks directly, so it
	// can't catch a dropped forward at either ExecutionService hop.
	test("send_transaction forwards hooks.originKey through executeOperations → executeSendTransaction → DappSendExecutor", async () => {
		const { service } = await makeHarness()
		const dse = (service as unknown as { dappSendExecutor: { executeSendTransaction: (...a: unknown[]) => Promise<string> } })
			.dappSendExecutor
		const spy = vi.spyOn(dse, "executeSendTransaction").mockResolvedValue("0xhash")

		const sendTxOp = {
			kind: "send_transaction",
			networkId: NETWORK.id,
			accountAddress: ACCOUNT.toString(),
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [{ kind: "call", contract: "0xc", method: "m", args: [] }],
		} as never
		const origin = { type: OriginType.DAPP, name: "dapp" } as never
		await service.executeOperations([sendTxOp], origin, undefined, { originKey: "https://dapp.example" } as never)

		// 5th positional arg of DappSendExecutor.executeSendTransaction is `hooks`.
		const hooks = spy.mock.calls[0]?.[4] as { originKey?: string } | undefined
		expect(hooks?.originKey).toBe("https://dapp.example")
	}, 15_000)
})

describe("ExecutionService composition — profile-switch gas-cache invalidation (D12)", () => {
	test("active-profile change EVICTS cached gas balances: peek goes cold, the next read recomputes", async () => {
		const h = await makeHarness()
		// Prime the reader's cache (the compute path degrades to null balances
		// against these shallow fakes, so the snapshot lands already-stale but
		// PEEKABLE — the WIRING is under test, discriminated via peek: a mere
		// stale-marking keeps the last-known peekable, only the profile-switch
		// EVICTION clears it).
		await h.service.getGasBalances(NETWORK.id, ACCOUNT.toString())
		const afterPrime = h.getNetwork.mock.calls.length
		expect(await h.service.peekGasBalances(NETWORK.id, ACCOUNT.toString())).not.toBeNull()

		h.profileChanged.invoke(undefined)

		// Evicted outright — the new profile must not see the old profile's
		// figures even dimmed. (Stale-marked entries would still peek here.)
		expect(await h.service.peekGasBalances(NETWORK.id, ACCOUNT.toString())).toBeNull()
		await h.service.getGasBalances(NETWORK.id, ACCOUNT.toString())
		expect(h.getNetwork.mock.calls.length).toBeGreaterThan(afterPrime) // cold → recompute
	}, 15_000)

	test("a compute in flight across the profile switch neither caches nor peeks — the new profile starts cold", async () => {
		// The reader's unit suite pins this against a mocked view layer; this
		// runs it through the REAL facade wiring: eviction mid-compute must
		// suppress the write-back (a stale-marked re-insert would paint the old
		// profile's figures dimmed under the new one via peek).
		const h = await makeHarness()
		// Park the compute at its SECOND network dependency (the view-deps
		// resolution, AFTER the profile context is acquired) — parking on the
		// first would fence before any old-profile context existed, proving
		// only the wiring, not the dangerous old-context write-back.
		let releaseNet: (() => void) | undefined
		h.getNetwork
			.mockImplementationOnce(async () => NETWORK)
			.mockImplementationOnce(
				() =>
					new Promise((r) => {
						releaseNet = () => r(NETWORK)
					}),
			)
		const inFlight = h.service.getGasBalances(NETWORK.id, ACCOUNT.toString())
		// Yield until the compute reaches the deferred dependency.
		for (let i = 0; i < 50 && !releaseNet; i++) await new Promise((r) => setTimeout(r, 0))
		if (!releaseNet) throw new Error("compute never reached its second getNetwork call")
		h.profileChanged.invoke(undefined) // switch lands while the compute is parked
		releaseNet()
		await inFlight // the pre-switch caller still receives its value

		expect(await h.service.peekGasBalances(NETWORK.id, ACCOUNT.toString())).toBeNull()
		const before = h.getNetwork.mock.calls.length
		await h.service.getGasBalances(NETWORK.id, ACCOUNT.toString())
		expect(h.getNetwork.mock.calls.length).toBeGreaterThan(before) // cold → recompute
	}, 15_000)
})

describe("ExecutionService composition — fee-strategy map through real init (Q-04 pilot pins)", () => {
	// Characterization pins written BEFORE the buildFeeStrategies extraction.
	// Nothing else in the repo pins this field: the reuse fast paths and
	// executor mocks bypass the dispatch, so an init that never assigned
	// `feeStrategies` passed every prior test.
	test("init builds the four-kind strategy map in insertion order, each kind paired to its class", async () => {
		const { service } = await makeHarness()
		const map = (service as unknown as { feeStrategies: Map<string, unknown> }).feeStrategies
		expect([...map.keys()]).toEqual(["fj", "fjwc", "fpc", "embedded"])
		expect(map.get("fj")).toBeInstanceOf(FeeJuiceStrategy)
		expect(map.get("fjwc")).toBeInstanceOf(FeeJuiceWithClaimStrategy)
		expect(map.get("fpc")).toBeInstanceOf(FpcStrategy)
		expect(map.get("embedded")).toBeInstanceOf(EmbeddedStrategy)
	})

	test("an unknown payment-method kind rejects with 'Invalid fee payment method' at the map lookup", async () => {
		const { service } = await makeHarness()
		const dispatch = service as unknown as {
			buildAndEstimateTxRequest: (op: unknown, feeSettings: unknown) => Promise<unknown>
		}

		await expect(
			dispatch.buildAndEstimateTxRequest(
				{ networkId: NETWORK.id, accountAddress: ACCOUNT.toString(), actions: [] },
				{ paymentMethod: { kind: "bogus" } },
			),
		).rejects.toThrow("Invalid fee payment method")
	})

	test("a known kind dispatches to ITS strategy with a CLONED op (spy on the initialized 'fj' entry)", async () => {
		const { service } = await makeHarness()
		const map = (service as unknown as { feeStrategies: Map<string, { buildAndEstimate: (ctx: { op: unknown }) => Promise<unknown> }> })
			.feeStrategies
		const fj = map.get("fj")
		if (!fj) throw new Error("fj strategy missing")
		const spy = vi.spyOn(fj, "buildAndEstimate").mockResolvedValue({ marker: "dispatched" } as never)
		const dispatch = service as unknown as {
			buildAndEstimateTxRequest: (op: unknown, feeSettings: unknown) => Promise<unknown>
		}

		const inputOp = { networkId: NETWORK.id, accountAddress: ACCOUNT.toString(), actions: [] }
		const result = await dispatch.buildAndEstimateTxRequest(inputOp, { paymentMethod: { kind: "fj" } })

		expect(result).toEqual({ marker: "dispatched" })
		expect(spy).toHaveBeenCalledTimes(1)
		// The dispatcher clones op + actions before handing them to a strategy
		// (fjwc/fpc mutate op.actions; a leaked reference breaks repeat estimates).
		const ctxOp = spy.mock.calls[0][0].op as { actions: unknown[] }
		expect(ctxOp).not.toBe(inputOp)
		expect(ctxOp.actions).not.toBe(inputOp.actions)
	})
})
