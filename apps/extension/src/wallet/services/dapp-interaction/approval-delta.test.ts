import { describe, expect, test } from "vitest"
import { applyFeeSelection } from "./approval-delta"

const OWNER = "0xowner"
const fee = (op: unknown) => (op as { feeSettings?: unknown }).feeSettings
const sendTx = (exec: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
	({ kind: "aztec_sendTx", networkId: "n", accountAddress: OWNER, exec, opts: { from: OWNER }, ...extra }) as never

describe("applyFeeSelection", () => {
	test("a selectable send accepts fj and fpc, never embedded", () => {
		const op = sendTx({ calls: [] })
		expect(fee(applyFeeSelection(op, { paymentMethod: { kind: "fj" } }))).toEqual({ paymentMethod: { kind: "fj" } })
		expect(fee(applyFeeSelection(op, { paymentMethod: { kind: "fpc", fpcId: "f" } }))).toEqual({
			paymentMethod: { kind: "fpc", fpcId: "f" },
		})
		expect(() => applyFeeSelection(op, { paymentMethod: { kind: "embedded" } })).toThrow("not selectable")
		expect(() => applyFeeSelection(op, undefined)).toThrow("Select a fee payment method")
	})

	test("a requested self-pay accepts only Fee Juice", () => {
		const op = sendTx({ calls: [{ name: "transfer" }], feePayer: OWNER })
		expect(fee(applyFeeSelection(op, { paymentMethod: { kind: "fj" } }))).toEqual({ paymentMethod: { kind: "fj" } })
		expect(() => applyFeeSelection(op, { paymentMethod: { kind: "fpc", fpcId: "f" } })).toThrow("Fee Juice")
	})

	test("an embedded fee path stays embedded whatever the delta says", () => {
		const op = sendTx({ calls: [], feePayer: "0xfpc" }, { feeSettings: { paymentMethod: { kind: "embedded" } } })
		expect(fee(applyFeeSelection(op, { paymentMethod: { kind: "fj" } }))).toEqual({ paymentMethod: { kind: "embedded" } })
		const noFrom = sendTx({ calls: [] }, { executionMode: "default_entrypoint", feeSettings: { paymentMethod: { kind: "embedded" } } })
		expect(fee(applyFeeSelection(noFrom, { paymentMethod: { kind: "fpc", fpcId: "f" } }))).toEqual({
			paymentMethod: { kind: "embedded" },
		})
	})

	test("non-send kinds ignore the delta and never gain a field", () => {
		const op = { kind: "register_token", networkId: "n", accountAddress: OWNER, address: "0xtok" } as never
		const out = applyFeeSelection(op, { paymentMethod: { kind: "fj" } })
		expect(out).toBe(op)
		expect("feeSettings" in out).toBe(false)
	})
})
