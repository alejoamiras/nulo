/**
 * Composition test (integration-test spike, Phases 2+3): drives the REAL
 * ExecutionService → coordinator → journal/lane graph in-process against fakes,
 * with NO Aztec sandbox / offscreen worker / proving / browser. Proves the
 * cancel-mid-prove journal contract through the real executeTransfer + cancelJob
 * public API (codex condition).
 *
 * It uses the precomputed-estimate fast path (seed `estimateReuse`) to SKIP
 * buildStandard's deep chain (node chain-identity validation, contract
 * resolution, account-contract request-building). That fresh-build path is the
 * heavy boundary deferred to the rollout — see lessons/phase-2.md.
 *
 * FAKE_IPXE_BUNDLE_MARKER — the fakes live in this `*.test.ts`, so they are
 * never in the production bundle (Phase-2 gate greps `dist/` for this marker;
 * it must be absent).
 */
import { describe, expect, test, vi } from "vitest"
import { Gas } from "@aztec/stdlib/gas"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { ContactService } from "@/wallet/services/contact/service"
import { TokenService } from "@/wallet/services/token/service"
import { FpcService } from "@/wallet/services/fpc/service"
import { TransactionService } from "@/wallet/services/transaction/service"
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

// ── Dumb fakes (cast to the real surfaces — only the reuse-cancel path is hit) ─
const MIN_FEES = { feePerDaGas: 1n, feePerL2Gas: 1n }

// proveTx returns a stub TxProvingResult; the post-prove cancel checkpoint drops
// it before `toTx`, so contents don't matter.
const fakeIPXE = {
	proveTx: vi.fn(async () => ({ toTx: async () => ({ getTxHash: () => ({ toString: () => "0xhash" }) }) })),
} as unknown as ReturnType<PxeServiceClient["getPXE"]>
const fakePxeClient = { getPXE: () => fakeIPXE } as unknown as PxeServiceClient

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
	const transitions: { stage: string; error: unknown }[] = []
	const sendTx = vi.fn(async () => {})
	const fakeNode = { getCurrentMinFees: async () => MIN_FEES, sendTx } as unknown as never
	const logger = new LoggerStore(new ConfigStore())
	const ctrl = makeControllableGate()

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
	collection.add(
		svc(OperationJournalService.name, {
			createOperation: async () => ({ id: "op1" }),
			getOperation: async () => ({ id: "op1", profileId: "p1" }),
			transitionOperation: async (_id: string, progress: { stage: string }, error: unknown) => {
				transitions.push({ stage: progress.stage, error })
			},
		}),
	)
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
		transferType: "public_to_public",
		recipientAddress: AztecAddress.fromNumber(0x5678).toString(),
		amount: 10n,
		feeSettings,
	}
	const entry: TransferEstimateReuseEntry = {
		networkId: req.networkId,
		accountAddress: req.accountAddress,
		tokenId: req.tokenId,
		transferType: req.transferType as never,
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

	return { service, ctrl, req, estimateId: "estimate-1", transitions, sendTx }
}

const waitFor = async (pred: () => boolean, timeoutMs = 2000) => {
	const deadline = Date.now() + timeoutMs
	while (!pred()) {
		if (Date.now() > deadline) throw new Error("waitFor timeout")
		await new Promise((r) => setTimeout(r, 5))
	}
}

describe("ExecutionService composition — cancel-mid-prove (in-process, no sandbox)", () => {
	test("cancel while proving: journal → cancelled, proof dropped, never sent", async () => {
		const { service, ctrl, req, estimateId, transitions, sendTx } = await makeHarness()

		const p = service
			.executeTransfer(
				req.networkId,
				req.accountAddress,
				req.tokenId,
				req.transferType as never,
				req.recipientAddress,
				req.amount,
				req.feeSettings,
				estimateId,
			)
			.catch((e) => e)

		// Wait until the coordinator has journalled `proving` and parked on the gate.
		await waitFor(() => ctrl.entered && transitions.some((t) => t.stage === "proving"))

		// Cancel while held at prove, then let prove complete → post-prove checkpoint fires.
		await service.cancelJob("op1")
		ctrl.release()
		await p

		expect(transitions.map((t) => t.stage)).toContain("cancelled")
		expect(sendTx).not.toHaveBeenCalled()
	})
})
