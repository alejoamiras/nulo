import { describe, expect, test } from "vitest"
import type { DraftOperation } from "./operation"
import { isEmbeddedFeePayment, requiresFeeSelection } from "./operation-validation"

type SendTxDraft = Extract<DraftOperation, { kind: "send_transaction" }>
type AztecSendTxDraft = Extract<DraftOperation, { kind: "aztec_sendTx" }>
const ACCOUNT = "0x00aa"
const sendTx = (extra: Record<string, unknown>) =>
	({ kind: "send_transaction", account: ACCOUNT, actions: [], ...extra }) as unknown as SendTxDraft
const aztecSendTx = (extra: Record<string, unknown>) =>
	({ kind: "aztec_sendTx", account: ACCOUNT, exec: { calls: [] }, opts: { from: ACCOUNT }, ...extra }) as unknown as AztecSendTxDraft

/** The popup pre-fills `feeSettings: embedded` exactly when the gate would not ask — one predicate, two callers. */
describe("isEmbeddedFeePayment ⇔ requiresFeeSelection", () => {
	const cases: DraftOperation[] = [
		sendTx({}),
		sendTx({ fee: { embeddedFeePayment: { kind: "x" } } }),
		aztecSendTx({}),
		aztecSendTx({ executionMode: "default_entrypoint" }),
		aztecSendTx({ exec: { calls: [], feePayer: "0x00bb" } }),
		aztecSendTx({ exec: { calls: [], feePayer: ACCOUNT } }),
		{ kind: "register_token", account: ACCOUNT } as unknown as DraftOperation,
	]
	test.each(cases.map((op) => [op.kind, op] as const))("%s", (_kind, op) => {
		const sendLike = op.kind === "send_transaction" || op.kind === "aztec_sendTx"
		expect(requiresFeeSelection(op)).toBe(sendLike && !isEmbeddedFeePayment(op))
		expect(requiresFeeSelection({ ...op, feeSettings: { paymentMethod: { kind: "embedded" } } } as DraftOperation)).toBe(false)
	})
	test("a requested self-pay is not embedded; a foreign payer is", () => {
		expect(isEmbeddedFeePayment(aztecSendTx({ exec: { calls: [], feePayer: ACCOUNT } }))).toBe(false)
		expect(isEmbeddedFeePayment(aztecSendTx({ exec: { calls: [], feePayer: "0x00bb" } }))).toBe(true)
		expect(isEmbeddedFeePayment(aztecSendTx({ executionMode: "default_entrypoint" }))).toBe(true)
	})
})
