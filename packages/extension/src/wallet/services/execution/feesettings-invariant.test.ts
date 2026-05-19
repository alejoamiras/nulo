/**
 * Phase 2 follow-up: SW boundary invariant for feeSettings on send-like
 * operations.
 *
 * `approveInteraction()` (`dapp-interaction/service.ts:82-94`) is a JS-context
 * trust boundary — it ships popup-built operations straight through to
 * `executionService.executeOperations()` with no further validation. If
 * the popup ever leaks a draft op with `feeSettings === undefined` (the
 * pre-Phase-2-followup bug class), downstream code would dereference
 * `feeSettings.priorityLevel` / `feeSettings.paymentMethod.kind` and crash
 * with a confusing `TypeError`. The invariant added at the entry of each
 * execute method surfaces a clear, attributable error instead.
 *
 * Tests bypass the full service-collection init by setting the protected
 * `initialized` flag directly — the feeSettings check is positioned
 * right after `ensureInitialized()` so we don't need any of the injected
 * services to reach (or NOT reach) the check.
 */

import { describe, expect, test } from "vitest"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import type { AztecSendTxOperation, SendTransactionOperation } from "@nulo/wallet-bridge"
import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/spec"
import { ExecutionService } from "./service"

function makeService(): ExecutionService {
	const logger = new LoggerStore(new ConfigStore())
	const service = new ExecutionService(logger)
	// Skip ServiceCollection.start() — the feeSettings invariant fires
	// before any injected dependency is touched.
	;(service as unknown as { initialized: boolean }).initialized = true
	return service
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

describe("ExecutionService.executeAztecSendTx: feeSettings invariant", () => {
	test("undefined feeSettings on standard path → throws with attributable message", async () => {
		const service = makeService()
		const op = makeAztecSendTx({ executionMode: "account" })
		await expect(service["executeAztecSendTx"](op, ORIGIN)).rejects.toThrow(/feeSettings is required/i)
	})

	test("undefined executionMode (standard path) is also gated by the invariant", async () => {
		const service = makeService()
		// executionMode left undefined — same standard-path behavior.
		const op = makeAztecSendTx()
		await expect(service["executeAztecSendTx"](op, ORIGIN)).rejects.toThrow(/feeSettings is required/i)
	})

	test("executionMode=default_entrypoint bypasses the invariant and routes to executeNoFromSendTx", async () => {
		const service = makeService()
		const op = makeAztecSendTx({ executionMode: "default_entrypoint" })
		// default_entrypoint goes through executeNoFromSendTx which tolerates
		// missing feeSettings by design (the dApp handles fee payment). We
		// only assert the invariant DIDN'T fire — downstream failure beyond
		// the invariant is expected with our stub data and not the contract
		// we're pinning here.
		try {
			await service["executeAztecSendTx"](op, ORIGIN)
		} catch (err) {
			expect((err as Error).message).not.toMatch(/feeSettings is required for the standard execution path/)
		}
	})
})

describe("ExecutionService.executeSendTransaction: feeSettings invariant", () => {
	test("undefined feeSettings → throws with attributable message", async () => {
		const service = makeService()
		const op = makeSendTransaction()
		await expect(service.executeSendTransaction(op, ORIGIN)).rejects.toThrow(/feeSettings is required/i)
	})
})
