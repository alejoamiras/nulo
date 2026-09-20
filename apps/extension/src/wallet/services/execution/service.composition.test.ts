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
 * The session cases run the same graph under a ProfileService fake whose
 * `setActive` starts a new session, as a lock, a switch or a re-unlock does:
 * dApp sends park at their slot-key lookup, transfers at the proof gate.
 *
 * FAKE_IPXE_BUNDLE_MARKER — the fakes live in this `*.test.ts`, so they are
 * never in the production bundle (Phase-2 gate greps `dist/` for this marker;
 * it must be absent).
 */
import { describe, expect, test, vi } from "vitest"
import { Gas } from "@aztec/stdlib/gas"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { JobCancelledError, SessionEndedError } from "@nulo/extension-messaging/errors"
import { EventHandler } from "@nulo/wallet-core/utils"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { ProfileService } from "@/wallet/services/profile/service"
import { type ExecutionFence, ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { ContactService } from "@/wallet/services/contact/service"
import { TokenService } from "@/wallet/services/token/service"
import { PriceService } from "@/wallet/services/price/service"
import { FpcService } from "@/wallet/services/fpc/service"
import { TransactionService, TransferType } from "@/wallet/services/transaction/service"
import { OriginType } from "@/wallet/services/transaction/spec"
import { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { LegalAcceptanceService } from "@/wallet/services/legal/service"
import { TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"
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
import type { OperationEstimateReuse } from "./operation-estimate-reuse"
import { fingerprintOperation } from "./operation-fingerprint"
import type { OperationPlanner } from "./operation-planner"
import type { PreviewSnapshots } from "./preview-snapshots"
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
	const proveTx = vi.fn(async () => ({ toTx }))
	const fakeIPXE = { proveTx } as unknown as ReturnType<PxeServiceClient["getPXE"]>
	const fakePxeClient = { getPXE: () => fakeIPXE, onProvePhase: { add: () => {} } } as unknown as PxeServiceClient

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
	/** Parks the first journal write that stores a record matching `match`, until released. */
	const parkJournalWrite = (match: (record: { progress: { stage: string } }) => boolean) => {
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		let parked = false
		const area = api.storage.local
		const write = area.set.bind(area)
		vi.spyOn(area, "set").mockImplementation(async (entries) => {
			const hit = Object.entries(entries).some(
				([key, value]) => key.startsWith("nulo:journal@") && typeof value === "string" && match(JSON.parse(value)),
			)
			if (hit && !parked) {
				parked = true
				await gate
			}
			return write(entries)
		})
		return { isParked: () => parked, release: () => release() }
	}

	const legalAssertCurrent = vi.fn(async () => {})
	const collection = new ServiceCollection()
	// One shared ProfileDeletionState so Execution's captureFence + Transaction's
	// addTransaction assert against the SAME epoch map (D13 fence wiring).
	const deletionState = new ProfileDeletionState()
	// Real handler so the facade's profile-switch invalidation (D12) is both
	// subscribable by the service and firable by tests.
	const profileChanged = new EventHandler<unknown>()
	// The published session. Every `setActive` starts a new one with a fresh serial, as a lock, a
	// switch or a re-unlock does; `fireChanged` is separate so a checkpoint case can run without
	// the change subscribers.
	let lastSerial = 1
	let live: { profileId: string; serial: number } | undefined = { profileId: "p1", serial: lastSerial }
	const captureExecutionFence = async (): Promise<ExecutionFence> => {
		if (!live) throw new Error("Wallet locked")
		return { profileId: live.profileId, epoch: deletionState.capture(live.profileId), session: live.serial }
	}
	const session = {
		setActive: (profileId: string | undefined) => {
			lastSerial += 1
			live = profileId ? { profileId, serial: lastSerial } : undefined
		},
		fireChanged: () => profileChanged.invoke(live ? { id: live.profileId } : undefined),
	}
	let expiryDeferral: ((profileId: string) => Promise<boolean>) | undefined
	collection.add(
		svc(ProfileService.name, {
			getActiveProfile: async () => (live ? { id: live.profileId } : undefined),
			// The journal's create fence checks membership here — the fake must
			// list the profile the flow files under or every create is refused.
			getProfiles: async () => [{ id: "p1" }, { id: "p2" }],
			getDeletionState: () => deletionState,
			captureExecutionFence,
			assertFence: async (fence: ExecutionFence) => {
				if (live?.serial !== fence.session || live.profileId !== fence.profileId) throw new SessionEndedError()
				deletionState.assertCurrent(fence.profileId, fence.epoch)
			},
			isFenceLive: (fence: ExecutionFence) =>
				live?.serial === fence.session &&
				live.profileId === fence.profileId &&
				deletionState.isCurrent(fence.profileId, fence.epoch),
			peekLiveSerial: () => live?.serial,
			setExpiryDeferral: (predicate: (profileId: string) => Promise<boolean>) => {
				expiryDeferral = predicate
			},
			onActiveProfileChanged: profileChanged,
		}),
	)
	const getNetwork = vi.fn(async () => NETWORK)
	collection.add(svc(NetworkService.name, { getNetwork, getNode: async () => fakeNode }))
	// The profiles that hold ACCOUNT; a lookup under any other profile misses.
	const accountOwners = new Set(["p1"])
	const getAccountContract = vi.fn(async (profileId: string) => {
		if (!accountOwners.has(profileId)) throw new Error(`no such account under ${profileId}`)
		return { address: ACCOUNT }
	})
	collection.add(svc(AccountService.name, { getAccountContract }))
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
	collection.add(svc(LegalAcceptanceService.name, { assertCurrent: legalAssertCurrent }))
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
		txRequest: {
			txContext: {
				gasSettings: {
					teardownGas: new Gas(1, 1),
					gasLimits: { daGas: 100, l2Gas: 200 },
					teardownGasLimits: { daGas: 10, l2Gas: 20 },
					maxFeesPerGas: { feePerDaGas: 2n, feePerL2Gas: 3n },
				},
			},
		} as never,
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
		captureExecutionFence,
		session,
		getNetwork,
		accountOwners,
		getAccountContract,
		proveTx,
		parkJournalWrite,
		legalAssertCurrent,
		lane: (service as unknown as { lane: ExecutionLane }).lane,
		expiryDeferral: () => expiryDeferral,
	}
}

type Harness = Awaited<ReturnType<typeof makeHarness>>

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
		const { service, journal, captureExecutionFence } = await makeHarness()
		const fence = await captureExecutionFence()
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
		const held = await lane.acquireSlot(NETWORK.id, undefined, fence)

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
		const p2 = service.executeOperations([aztecSendOp], origin, undefined, { queuedJournalId: queuedId }, undefined, fence)

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
		const held2 = await lane.acquireSlot(NETWORK.id, undefined, fence)
		held2.release()
	}, 15_000)

	// (B-02 forwarding-seam PIN) executeOperations must thread `hooks` (incl.
	// originKey) all the way to DappSendExecutor.executeSendTransaction for the
	// send_transaction kind — otherwise grants collapse into the __no_origin__
	// slot bucket. The DappSendExecutor unit test injects hooks directly, so it
	// can't catch a dropped forward at either ExecutionService hop.
	test("send_transaction forwards hooks.originKey through executeOperations → executeSendTransaction → DappSendExecutor", async () => {
		const { service, captureExecutionFence } = await makeHarness()
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
		await service.executeOperations(
			[sendTxOp],
			origin,
			undefined,
			{ originKey: "https://dapp.example" } as never,
			undefined,
			await captureExecutionFence(),
		)

		// 5th positional arg of DappSendExecutor.executeSendTransaction is `hooks`.
		const hooks = spy.mock.calls[0]?.[4] as { originKey?: string } | undefined
		expect(hooks?.originKey).toBe("https://dapp.example")
	}, 15_000)
})

const DAPP_ORIGIN = { type: OriginType.DAPP, name: "dapp" } as never
const dappSend = () =>
	({
		kind: "aztec_sendTx",
		networkId: NETWORK.id,
		accountAddress: ACCOUNT.toString(),
		feeSettings: { paymentMethod: { kind: "fpc" } },
	}) as never
const transfer = (h: Harness, estimateId: string | undefined = h.estimateId) =>
	h.service
		.executeTransfer(
			h.req.networkId,
			h.req.accountAddress,
			h.req.tokenId,
			h.req.transferType,
			h.req.recipientAddress,
			h.req.amount,
			h.req.feeSettings,
			estimateId,
		)
		.catch((error: unknown) => error)

/** Parks the next `getNetwork`: the slot-key lookup a dApp send awaits before its claim. */
function parkNextNetworkLookup(h: Harness) {
	let release: () => void = () => {}
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	let entered = false
	h.getNetwork.mockImplementationOnce(async () => {
		entered = true
		await gate
		return NETWORK
	})
	return { isEntered: () => entered, release: () => release() }
}

async function expectEndedUnder(h: Harness, journalId: string, profileId: string) {
	const record = await h.journal.getOperation(journalId)
	expect(record?.progress.stage).toBe("failed")
	expect(record?.error?.kind).toBe("session_ended")
	expect(record?.profileId).toBe(profileId)
}

describe("ExecutionService composition — work runs only while the session that authorized it lives", () => {
	test.each([
		{ label: "a switch to another profile", next: "p2" },
		{ label: "a lock", next: undefined },
	])(
		"a dApp send parked at its slot-key lookup, then $label: refused, failed/session_ended under p1, never proved",
		async ({ next }) => {
			const h = await makeHarness()
			const fence = await h.captureExecutionFence()
			const lookup = parkNextNetworkLookup(h)
			const run = h.service.executeOperations([dappSend()], DAPP_ORIGIN, undefined, undefined, undefined, fence)
			await waitFor(lookup.isEntered)
			h.session.setActive(next)
			lookup.release()

			expect(await run).toEqual([expect.objectContaining({ status: "failed", code: "SESSION_ENDED" })])
			await expectEndedUnder(h, h.getJournalId(), "p1")
			expect(h.proveTx).not.toHaveBeenCalled()
		},
		15_000,
	)

	test.each([
		{ label: "a switch to another profile", next: "p2" },
		{ label: "a lock", next: undefined },
		{ label: "a re-unlock of the same profile", next: "p1" },
	])(
		"a transfer parked at prove, then $label: proved but never sent, failed/session_ended under p1",
		async ({ next }) => {
			const h = await makeHarness()
			const run = transfer(h)
			await waitFor(() => h.ctrl.entered && h.stages.includes("proving"))
			h.session.setActive(next)
			h.ctrl.release()

			expect(await run).toBeInstanceOf(SessionEndedError)
			expect(h.proveTx).toHaveBeenCalledTimes(1)
			expect(h.toTx).not.toHaveBeenCalled()
			expect(h.sendTx).not.toHaveBeenCalled()
			await expectEndedUnder(h, h.getJournalId(), "p1")
		},
		15_000,
	)

	test("a transfer parked at prove while the next profile holds the same address: the fence stops it, not a lookup miss", async () => {
		const h = await makeHarness()
		h.accountOwners.add("p2")
		const run = transfer(h)
		await waitFor(() => h.ctrl.entered && h.stages.includes("proving"))
		h.session.setActive("p2")
		h.ctrl.release()

		expect(await run).toBeInstanceOf(SessionEndedError)
		expect(h.sendTx).not.toHaveBeenCalled()
		expect(h.getAccountContract.mock.calls.map(([profileId]) => profileId)).toEqual(["p1"])
		await expectEndedUnder(h, h.getJournalId(), "p1")
	}, 15_000)

	test("a transfer parked inside its account lookup, then a re-unlock of the same profile: refused before proving", async () => {
		const h = await makeHarness()
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		let entered = false
		h.getAccountContract.mockImplementationOnce(async () => {
			entered = true
			await gate
			return { address: ACCOUNT }
		})
		const run = transfer(h)
		await waitFor(() => entered)
		h.session.setActive("p1")
		release()

		expect(await run).toBeInstanceOf(SessionEndedError)
		expect(h.proveTx).not.toHaveBeenCalled()
		await expectEndedUnder(h, h.getJournalId(), "p1")
	}, 15_000)

	test("a UI send with no fence captures one at entry, and a switch while it waits refuses it the same way", async () => {
		const h = await makeHarness()
		const lookup = parkNextNetworkLookup(h)
		const uiSend = {
			kind: "send_transaction",
			networkId: NETWORK.id,
			accountAddress: ACCOUNT.toString(),
			feeSettings: { paymentMethod: { kind: "fj" } },
			actions: [],
		} as never
		const run = h.service.executeSendTransaction(uiSend, { type: OriginType.UI }).catch((error: unknown) => error)
		await waitFor(lookup.isEntered)
		h.session.setActive("p2")
		lookup.release()

		expect(await run).toBeInstanceOf(SessionEndedError)
		await expectEndedUnder(h, h.getJournalId(), "p1")
		expect(h.proveTx).not.toHaveBeenCalled()
	}, 15_000)

	test("an operation estimate stashed under p1 and confirmed under p2 is refused before any build", async () => {
		const h = await makeHarness()
		const feeSettings = { paymentMethod: { kind: "fj" } } as unknown as FeeSettings
		const op = {
			kind: "aztec_sendTx",
			networkId: NETWORK.id,
			accountAddress: ACCOUNT.toString(),
			feeSettings,
			exec: { calls: [] },
			opts: { from: ACCOUNT },
		}
		const internals = h.service as unknown as {
			planner: OperationPlanner
			operationEstimateReuse: OperationEstimateReuse
			previewSnapshots: PreviewSnapshots
		}
		const { actions, feeOptions } = await internals.planner.processAztecJsPayload(op.exec as never, op.opts as never)
		const fingerprint = fingerprintOperation({
			networkId: op.networkId,
			accountAddress: op.accountAddress,
			executionMode: "standard",
			from: ACCOUNT.toString(),
			actions,
			fee: feeOptions,
			feeSettings,
		})
		internals.operationEstimateReuse.stash("est-op", { fingerprint, profileId: "p1", builtAt: Date.now() } as never)
		internals.previewSnapshots.stash("est-op", { interactionId: "i-1", index: 0, fingerprint, discoveredHashes: [] })

		h.session.setActive("p2")
		const approval = { interactionId: "i-1", index: 0, estimateId: "est-op", previewId: "est-op" }
		const fence = await h.captureExecutionFence()
		const results = await h.service.executeOperations([op as never], DAPP_ORIGIN, undefined, undefined, [approval], fence)

		expect(results).toEqual([expect.objectContaining({ status: "failed", code: "SESSION_ENDED" })])
		expect(h.getAccountContract).not.toHaveBeenCalled()
		expect(h.proveTx).not.toHaveBeenCalled()
		await expectEndedUnder(h, h.getJournalId(), "p2")
	}, 15_000)

	test("a transfer estimate stashed under p1 and confirmed under p2 is refused before any build", async () => {
		const h = await makeHarness()
		h.session.setActive("p2")

		expect(await transfer(h)).toBeInstanceOf(SessionEndedError)
		expect(h.getAccountContract).not.toHaveBeenCalled()
		expect(h.proveTx).not.toHaveBeenCalled()
		await expectEndedUnder(h, h.getJournalId(), "p2")
	}, 15_000)

	test("a silent send whose record is already pending is failed at the slot, not stranded, and holds nothing", async () => {
		const h = await makeHarness()
		const fence = await h.captureExecutionFence()
		const queued = await h.journal.createOperation({
			kind: "dapp_execute",
			origin: "dapp",
			profileId: "p1",
			sessionId: "sess-1",
			initialStage: { stage: "queued" },
		})
		await h.journal.transitionOperation(queued.id, { stage: "pending" })
		h.session.setActive(undefined)
		h.getNetwork.mockClear()

		const results = await h.service.executeOperations(
			[dappSend()],
			DAPP_ORIGIN,
			undefined,
			{ queuedJournalId: queued.id },
			undefined,
			fence,
		)

		expect(results).toEqual([expect.objectContaining({ status: "failed", code: "SESSION_ENDED" })])
		await expectEndedUnder(h, queued.id, "p1")
		expect(h.getNetwork).not.toHaveBeenCalled()
		expect(h.proveTx).not.toHaveBeenCalled()
		h.session.setActive("p1")
		const granted = await Promise.race([
			h.lane.acquireSlot(NETWORK.id, undefined, await h.captureExecutionFence()),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
		])
		expect(granted).not.toBeNull()
		granted?.release()
	}, 15_000)

	test("a cancel holding the journal lock when the send reaches `submitting` commits first; the send stops at its cancel check", async () => {
		const h = await makeHarness()
		const cancelWrite = h.parkJournalWrite((record) => record.progress.stage === "cancelled")
		const transitions = vi.spyOn(h.journal, "transitionOperation")
		h.toTx.mockImplementationOnce(async () => {
			void h.service.cancelJob(h.getJournalId())
			await waitFor(cancelWrite.isParked)
			return { getTxHash: () => ({ toString: () => "0xhash" }) }
		})
		const run = transfer(h)
		await waitFor(() => h.ctrl.entered)
		h.ctrl.release()
		// The `submitting` transition is queued behind the parked cancel on the transition lock.
		await waitFor(() => transitions.mock.calls.some(([, progress]) => progress.stage === "submitting"))
		cancelWrite.release()

		expect(await run).toBeInstanceOf(JobCancelledError)
		expect((await h.journal.getOperation(h.getJournalId()))?.progress.stage).toBe("cancelled")
		expect(h.stages).not.toContain("submitting")
		expect(h.proveTx).toHaveBeenCalledTimes(1)
		expect(h.sendTx).not.toHaveBeenCalled()
	}, 15_000)

	test("a session that ends while `node.sendTx` is pending does not undo the send: the record succeeds", async () => {
		const h = await makeHarness()
		let finishSend: () => void = () => {}
		h.sendTx.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishSend = resolve
				}),
		)
		const run = transfer(h)
		await waitFor(() => h.ctrl.entered)
		h.ctrl.release()
		await waitFor(() => h.sendTx.mock.calls.length === 1)
		h.session.setActive(undefined)
		finishSend()

		expect(await run).toBe("0xhash")
		expect((await h.journal.getOperation(h.getJournalId()))?.progress.stage).toBe("succeeded")
		expect(h.proveTx).toHaveBeenCalledTimes(1)
	}, 15_000)
})

const stageOf = async (h: Harness, journalId: string) => (await h.journal.getOperation(journalId))?.progress.stage

describe("ExecutionService composition — a session change sweeps the work of the session that ended", () => {
	test.each([
		{ label: "A switch to another profile", next: "p2" },
		{ label: "A lock", next: undefined },
	])(
		"$label cancels a transfer parked at prove before the proof returns; it is never sent",
		async ({ next }) => {
			const h = await makeHarness()
			const run = transfer(h)
			await waitFor(() => h.ctrl.entered && h.stages.includes("proving"))
			h.session.setActive(next)
			h.session.fireChanged()
			await waitFor(() => h.stages.includes("cancelled"))

			h.ctrl.release()
			expect(await run).toBeInstanceOf(JobCancelledError)
			expect(await stageOf(h, h.getJournalId())).toBe("cancelled")
			expect(h.toTx).not.toHaveBeenCalled()
			expect(h.sendTx).not.toHaveBeenCalled()
		},
		15_000,
	)

	test("a record at `submitting` is left alone: the send completes and the record succeeds", async () => {
		const h = await makeHarness()
		let finishSend: () => void = () => {}
		h.sendTx.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishSend = resolve
				}),
		)
		const sweep = vi.spyOn(h.lane, "abandonDeadSessions")
		const run = transfer(h)
		await waitFor(() => h.ctrl.entered)
		h.ctrl.release()
		await waitFor(() => h.sendTx.mock.calls.length === 1)
		h.session.setActive(undefined)
		h.session.fireChanged()
		await sweep.mock.results[0]?.value
		expect(await stageOf(h, h.getJournalId())).toBe("submitting")
		finishSend()

		expect(await run).toBe("0xhash")
		expect(await stageOf(h, h.getJournalId())).toBe("succeeded")
	}, 15_000)

	test("a sweep started by a lock spares a job registered by a session that opens before the sweep reaches it", async () => {
		const h = await makeHarness()
		const nextJob = await h.journal.createOperation({
			kind: "dapp_execute",
			origin: "dapp",
			profileId: "p1",
			sessionId: "sess-2",
			initialStage: { stage: "queued" },
		})
		const run = transfer(h)
		await waitFor(() => h.ctrl.entered && h.stages.includes("proving"))
		const cancelWrite = h.parkJournalWrite((record) => record.progress.stage === "cancelled")
		const sweep = vi.spyOn(h.lane, "abandonDeadSessions")
		h.session.setActive(undefined)
		h.session.fireChanged()
		expect(sweep).toHaveBeenCalledTimes(1)
		// The handler has returned; the sweep is still awaiting the old job's cancel.
		await waitFor(cancelWrite.isParked)

		h.session.setActive("p1")
		const nextController = new AbortController()
		const { session } = await h.captureExecutionFence()
		expect(h.lane.registerInFlight(nextJob.id, session, nextController)).toEqual({ live: true })
		cancelWrite.release()
		await sweep.mock.results[0]?.value

		expect(await stageOf(h, h.getJournalId())).toBe("cancelled")
		expect(await stageOf(h, nextJob.id)).toBe("queued")
		expect(nextController.signal.aborted).toBe(false)
		h.ctrl.release()
		expect(await run).toBeInstanceOf(JobCancelledError)
	}, 15_000)

	test("a transfer that registers after the sweep ran is refused at registration: failed/session_ended, never proved", async () => {
		const h = await makeHarness()
		// A transfer's first journal write is its create, which precedes its registration.
		const create = h.parkJournalWrite(() => true)
		const sweep = vi.spyOn(h.lane, "abandonDeadSessions")
		const run = transfer(h)
		await waitFor(create.isParked)
		h.session.setActive(undefined)
		h.session.fireChanged()
		await sweep.mock.results[0]?.value
		create.release()

		expect(await run).toBeInstanceOf(SessionEndedError)
		await expectEndedUnder(h, h.getJournalId(), "p1")
		expect(h.ctrl.entered).toBe(false)
		expect(h.proveTx).not.toHaveBeenCalled()
	}, 15_000)

	test("a journal failure during the sweep is logged and settles quietly; the send still stops at its authorization check", async () => {
		const h = await makeHarness()
		const run = transfer(h)
		await waitFor(() => h.ctrl.entered && h.stages.includes("proving"))
		vi.spyOn(h.journal, "transitionIfStage").mockRejectedValueOnce(new Error("storage down"))
		const logError = vi.spyOn(h.service as unknown as { logError: (...args: unknown[]) => void }, "logError")
		const sweep = vi.spyOn(h.lane, "abandonDeadSessions")
		h.session.setActive("p2")
		h.session.fireChanged()
		await expect(sweep.mock.results[0]?.value).resolves.toBeUndefined()
		expect(logError).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ journalId: h.getJournalId() }))

		h.ctrl.release()
		expect(await run).toBeInstanceOf(SessionEndedError)
		await expectEndedUnder(h, h.getJournalId(), "p1")
		expect(h.sendTx).not.toHaveBeenCalled()
	}, 15_000)
})

describe("ExecutionService composition — the auto-lock deferral", () => {
	test("init registers it over the real journal: an approved send defers its own profile's lock until it settles", async () => {
		const h = await makeHarness()
		const shouldDefer = h.expiryDeferral()
		await h.journal.createOperation({
			kind: "dapp_execute",
			origin: "dapp",
			profileId: "p1",
			sessionId: "sess-1",
			initialStage: { stage: "queued" },
		})
		expect(await shouldDefer?.("p1")).toBe(false)

		const run = transfer(h)
		await waitFor(() => h.ctrl.entered && h.stages.includes("proving"))
		expect(await shouldDefer?.("p1")).toBe(true)
		expect(await shouldDefer?.("p2")).toBe(false)

		h.ctrl.release()
		expect(await run).toBe("0xhash")
		expect(await shouldDefer?.("p1")).toBe(false)
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

		h.session.fireChanged()

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
		h.session.fireChanged() // switch lands while the compute is parked
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

describe("ExecutionService composition — nothing is broadcast without a current Terms acceptance", () => {
	const transfer = (h: Harness) =>
		h.service
			.executeTransfer(
				h.req.networkId,
				h.req.accountAddress,
				h.req.tokenId,
				h.req.transferType,
				h.req.recipientAddress,
				h.req.amount,
				h.req.feeSettings,
				h.estimateId,
			)
			.catch((e) => e)

	test("no acceptance at entry: refused before a journal row, a proof or a send exists", async () => {
		const h = await makeHarness()
		h.legalAssertCurrent.mockRejectedValue(new TermsAcceptanceRequiredError())

		expect(await transfer(h)).toBeInstanceOf(TermsAcceptanceRequiredError)

		expect(h.getJournalId()).toBe("")
		expect(h.proveTx).not.toHaveBeenCalled()
		expect(h.sendTx).not.toHaveBeenCalled()
	})

	test("acceptance lost while proving: the proof is made, the send is not, and the record settles failed", async () => {
		const h = await makeHarness()
		const p = transfer(h)
		await waitFor(() => h.ctrl.entered && h.stages.includes("proving"))

		h.legalAssertCurrent.mockRejectedValue(new TermsAcceptanceRequiredError())
		h.ctrl.release()

		expect(await p).toBeInstanceOf(TermsAcceptanceRequiredError)
		expect(h.proveTx).toHaveBeenCalledTimes(1)
		expect(h.sendTx).not.toHaveBeenCalled()
		expect(h.stages).not.toContain("succeeded")
		expect((await h.journal.getOperation(h.getJournalId()))?.progress.stage).toBe("failed")
	})
})
