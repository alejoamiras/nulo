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
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { ContactService } from "@/wallet/services/contact/service"
import { TokenService } from "@/wallet/services/token/service"
import { FpcService } from "@/wallet/services/fpc/service"
import { TransactionService, TransferType } from "@/wallet/services/transaction/service"
import { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { TaskService } from "@/wallet/services/task/service"
import type { PxeServiceClient } from "@/wallet/services/pxe/client"
import type { ProofGate } from "@/e2e/proof-gate"
import { DEFAULT_FEE_MULTIPLIER } from "./fee/fee-strategy"
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
const ACCOUNT = AztecAddress.fromNumber(0x1234)
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
	collection.add(svc(ProfileService.name, { getActiveProfile: async () => ({ id: "p1" }) }))
	collection.add(svc(NetworkService.name, { getNetwork: async () => NETWORK, getNode: async () => fakeNode }))
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
	const fakeTask = { complete: vi.fn(), fail: vi.fn(), startSubtask: vi.fn() }
	fakeTask.startSubtask.mockReturnValue(fakeTask)
	collection.add(svc(TaskService.name, { startNewTask: () => fakeTask }))

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
		recipientAddress: AztecAddress.fromNumber(0x5678).toString(),
		amount: 10n,
		feeSettings,
	}
	const entry: TransferEstimateReuseEntry = {
		networkId: req.networkId,
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

	return { service, ctrl, req, estimateId: "estimate-1", journal, stages, sendTx, toTx, getJournalId: () => journalId }
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
