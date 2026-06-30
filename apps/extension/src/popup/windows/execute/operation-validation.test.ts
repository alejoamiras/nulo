/**
 * Phase 2 follow-up: tests for the popup-side Operation validation helpers.
 *
 * Pinning:
 *  - `requiresFeeSelection` correctly distinguishes "user must pick"
 *    from "dApp already chose embedded" across both send-like kinds.
 *  - `assertExecutableOperation` throws with attributable error when an
 *    op leaves the popup with feeSettings undefined.
 */

import { describe, expect, test } from "vitest"
import type { AztecSendTxOperation, FeeSettings, SendTransactionOperation } from "@nulo/wallet-bridge"
import { assertExecutableOperation, requiresFeeSelection } from "./operation-validation"
import type { DraftAztecSendTxOperation, DraftOperation, DraftSendTransactionOperation } from "./types"

const FJ: FeeSettings = { paymentMethod: { kind: "fj" }, priorityLevel: "normal" }
const EMBEDDED: FeeSettings = { paymentMethod: { kind: "embedded" } }

function draftSendTx(overrides: Partial<DraftSendTransactionOperation> = {}): DraftSendTransactionOperation {
	return {
		kind: "send_transaction",
		networkId: "net-1",
		accountAddress: "0xabc",
		actions: [],
		...overrides,
	}
}

function draftAztecSendTx(overrides: Partial<DraftAztecSendTxOperation> = {}): DraftAztecSendTxOperation {
	return {
		kind: "aztec_sendTx",
		networkId: "net-1",
		accountAddress: "0xabc",
		exec: { calls: [] } as unknown as AztecSendTxOperation["exec"],
		opts: {} as unknown as AztecSendTxOperation["opts"],
		...overrides,
	}
}

describe("requiresFeeSelection", () => {
	test("send_transaction with no feeSettings and no embedded fee → requires", () => {
		const op = draftSendTx()
		expect(requiresFeeSelection(op)).toBe(true)
	})

	test("send_transaction with feeSettings present → does not require", () => {
		const op = draftSendTx({ feeSettings: FJ })
		expect(requiresFeeSelection(op)).toBe(false)
	})

	test("send_transaction with no feeSettings but op.fee.embeddedFeePayment set → does not require", () => {
		const op = draftSendTx({ fee: { embeddedFeePayment: "fpc" } as SendTransactionOperation["fee"] })
		expect(requiresFeeSelection(op)).toBe(false)
	})

	test("aztec_sendTx with feeSettings present → does not require", () => {
		const op = draftAztecSendTx({ feeSettings: EMBEDDED })
		expect(requiresFeeSelection(op)).toBe(false)
	})

	test("aztec_sendTx with no feeSettings + default_entrypoint → does not require (dApp handles fee)", () => {
		const op = draftAztecSendTx({ executionMode: "default_entrypoint" })
		expect(requiresFeeSelection(op)).toBe(false)
	})

	test("aztec_sendTx with no feeSettings + exec.feePayer set → does not require (dApp embedded)", () => {
		const op = draftAztecSendTx({
			exec: { calls: [], feePayer: "0xfee" } as unknown as AztecSendTxOperation["exec"],
		})
		expect(requiresFeeSelection(op)).toBe(false)
	})

	test("aztec_sendTx with no feeSettings, no default_entrypoint, no feePayer → requires", () => {
		const op = draftAztecSendTx()
		expect(requiresFeeSelection(op)).toBe(true)
	})

	test("non-send kinds never require fee selection", () => {
		const nonSends: DraftOperation[] = [
			{
				kind: "aztec_simulateTx",
				networkId: "net-1",
				accountAddress: "0xabc",
				exec: { calls: [] },
				opts: {},
			} as unknown as DraftOperation,
			{
				kind: "register_contract",
				networkId: "net-1",
				instance: {},
				artifact: {},
			} as unknown as DraftOperation,
			{
				kind: "register_token",
				networkId: "net-1",
				accountAddress: "0xabc",
				contractAddress: "0xdef",
			} as unknown as DraftOperation,
		]
		for (const op of nonSends) {
			expect(requiresFeeSelection(op)).toBe(false)
		}
	})
})

describe("assertExecutableOperation", () => {
	test("send_transaction with feeSettings → no throw", () => {
		const op = draftSendTx({ feeSettings: FJ })
		expect(() => assertExecutableOperation(op)).not.toThrow()
	})

	test("send_transaction without feeSettings → throws with attributable message", () => {
		const op = draftSendTx()
		expect(() => assertExecutableOperation(op)).toThrow(/send_transaction.*missing feeSettings/)
	})

	test("aztec_sendTx with feeSettings → no throw", () => {
		const op = draftAztecSendTx({ feeSettings: EMBEDDED })
		expect(() => assertExecutableOperation(op)).not.toThrow()
	})

	test("aztec_sendTx without feeSettings → throws", () => {
		const op = draftAztecSendTx()
		expect(() => assertExecutableOperation(op)).toThrow(/aztec_sendTx.*missing feeSettings/)
	})

	test("non-send kind without feeSettings → no throw (irrelevant for those)", () => {
		const op = {
			kind: "register_contract",
			networkId: "net-1",
			instance: {},
			artifact: {},
		} as unknown as DraftOperation
		expect(() => assertExecutableOperation(op)).not.toThrow()
	})
})
