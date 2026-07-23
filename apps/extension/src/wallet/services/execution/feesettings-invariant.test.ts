/**
 * SW boundary invariant for feeSettings on send-like operations.
 *
 * `approveInteraction()` (`dapp-interaction/service.ts:82-94`) is a JS-context
 * trust boundary — it ships popup-built operations straight through to
 * `executionService.executeOperations()` with no further validation. If
 * the popup ever leaks a draft op with `feeSettings === undefined`,
 * downstream code would dereference `feeSettings.priorityLevel` /
 * `feeSettings.paymentMethod.kind` and crash with a confusing
 * `TypeError`. The invariant at the entry of each execute method
 * surfaces a clear, attributable error instead.
 *
 * The checks live on `DappSendExecutor` (the facade methods are thin
 * delegates), positioned before any dep is touched — so the executor is
 * constructed with stub deps that are never reached on these paths.
 */

import { describe, expect, test } from "vitest"
import type { AztecSendTxOperation, SendTransactionOperation } from "@nulo/wallet-bridge"
import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/spec"
import { DappSendExecutor, type DappSendExecutorDeps } from "./dapp-send-executor"

function makeExecutor(): DappSendExecutor {
	// Every dep access beyond the invariant is a test bug — fail loudly.
	const unreachable = () => {
		throw new Error("stub dep reached")
	}
	return new DappSendExecutor({
		planner: { processAztecJsPayload: unreachable } as never,
		authwit: { discoverPrivateAuthwits: unreachable } as never,
		txBuilder: { buildStandard: unreachable, buildNoFrom: unreachable } as never,
		coordinator: { proveAndSend: unreachable, simulateTxTask: unreachable } as never,
		lane: {
			registerController: unreachable,
			deleteController: unreachable,
			acquireSlot: async () => {
				throw new Error("stub slot")
			},
			claimOrCreateJournal: unreachable as never,
			beginJournal: unreachable as never,
			markJournal: unreachable as never,
			stampCorrelation: unreachable as never,
		},
		buildAndEstimate: unreachable as never,
		addTransaction: unreachable as never,
		recordPendingAuthwits: unreachable as never,
		logDebug: () => {},
	} satisfies DappSendExecutorDeps)
}

const ORIGIN: LocalTxOrigin = { type: OriginType.DAPP, name: "test" }

// Build a minimal AztecSendTxOperation with feeSettings missing. The fields
// not touched by the invariant check (exec, opts, etc.) are stubbed loosely
// because the check throws before they're read.
function makeAztecSendTx(overrides: Partial<AztecSendTxOperation> = {}): AztecSendTxOperation {
	return {
		kind: "aztec_sendTx",
		networkId: "net-1",
		accountAddress: "0xabc",
		feeSettings: undefined as unknown as AztecSendTxOperation["feeSettings"],
		exec: { calls: [] } as unknown as AztecSendTxOperation["exec"],
		opts: { from: { toString: () => "0xabc" } } as unknown as AztecSendTxOperation["opts"],
		...overrides,
	}
}

function makeSendTransaction(overrides: Partial<SendTransactionOperation> = {}): SendTransactionOperation {
	return {
		kind: "send_transaction",
		networkId: "net-1",
		accountAddress: "0xabc",
		feeSettings: undefined as unknown as SendTransactionOperation["feeSettings"],
		actions: [],
		...overrides,
	}
}

describe("DappSendExecutor.executeAztecSendTx: feeSettings invariant", () => {
	test("undefined feeSettings on standard path → throws with attributable message", async () => {
		const executor = makeExecutor()
		const op = makeAztecSendTx({ executionMode: "account" })
		await expect(executor.executeAztecSendTx(op, ORIGIN)).rejects.toThrow(/feeSettings is required/i)
	})

	test("undefined executionMode (standard path) is also gated by the invariant", async () => {
		const executor = makeExecutor()
		// executionMode left undefined — same standard-path behavior.
		const op = makeAztecSendTx()
		await expect(executor.executeAztecSendTx(op, ORIGIN)).rejects.toThrow(/feeSettings is required/i)
	})

	test("executionMode=default_entrypoint bypasses the invariant and routes to executeNoFromSendTx", async () => {
		const executor = makeExecutor()
		const op = makeAztecSendTx({ executionMode: "default_entrypoint" })
		// default_entrypoint goes through executeNoFromSendTx which tolerates
		// missing feeSettings by design (the dApp handles fee payment). We
		// only assert the invariant DIDN'T fire — downstream failure beyond
		// the invariant is expected with our stub deps and not the contract
		// we're pinning here.
		try {
			await executor.executeAztecSendTx(op, ORIGIN)
		} catch (err) {
			expect((err as Error).message).not.toMatch(/feeSettings is required for the standard execution path/)
		}
	})
})

describe("DappSendExecutor.executeSendTransaction: feeSettings invariant", () => {
	test("undefined feeSettings → throws with attributable message", async () => {
		const executor = makeExecutor()
		const op = makeSendTransaction()
		await expect(executor.executeSendTransaction(op, ORIGIN)).rejects.toThrow(/feeSettings is required/i)
	})
})
