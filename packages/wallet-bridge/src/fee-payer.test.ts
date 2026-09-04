import { AztecAddress } from "@aztec/aztec.js/addresses"
import { ProtocolContractAddress } from "@aztec/aztec.js/protocol"
import { FunctionSelector } from "@aztec/stdlib/abi"
import { describe, expect, test } from "vitest"
import {
	CLAIM_AND_END_SETUP,
	CLAIM_AND_END_SETUP_SELECTOR,
	FEE_JUICE_CONTRACT,
	classifyFeePayer,
	isClaimAndEndSetup,
	isSelfPay,
} from "./fee-payer"

const SENDER = "0x1a228350bbfa130d71aa1105c93e6432bd8c65476bc46ba579d2dc885e2873d1"
const FPC = "0x2ef4be56d83d448d37909ede8ac3a4ac69daab309584a1bceebbc9f0639f825c"

/** The call `FeeJuicePaymentMethodWithClaim` emits, field for field. */
const CLAIM = {
	name: CLAIM_AND_END_SETUP,
	to: FEE_JUICE_CONTRACT,
	selector: CLAIM_AND_END_SETUP_SELECTOR,
	type: "private",
	isStatic: false,
}

describe("the pinned Fee Juice claim", () => {
	test("address and selector match the protocol's", async () => {
		expect(ProtocolContractAddress.FeeJuice.toString()).toBe(FEE_JUICE_CONTRACT)
		// The selector is a poseidon hash of the signature. This package's own (node) runner computes
		// it; the extension's jsdom runner also collects this file but has no poseidon WASM there, and
		// a missing hasher must not pass as a matching one — so the pin runs wherever it can and
		// says so where it cannot.
		const computed = await FunctionSelector.fromSignature("claim_and_end_setup((Field),u128,Field,Field)").then(
			(selector) => selector.toString(),
			(e: unknown) => (/bad_cast|wasm|WebAssembly/i.test(String(e)) ? "no-hasher" : Promise.reject(e)),
		)
		if (computed !== "no-hasher") expect(computed).toBe(CLAIM_AND_END_SETUP_SELECTOR)
		expect(isClaimAndEndSetup(CLAIM)).toBe(true)
	})

	test("the name is never what identifies it: wrong address, selector, type or a static call are not the claim", () => {
		expect(isClaimAndEndSetup({ ...CLAIM, to: FPC })).toBe(false)
		expect(isClaimAndEndSetup({ ...CLAIM, selector: "0x00000001" })).toBe(false)
		expect(isClaimAndEndSetup({ ...CLAIM, type: "public" })).toBe(false)
		expect(isClaimAndEndSetup({ ...CLAIM, isStatic: true })).toBe(false)
		expect(isClaimAndEndSetup({ name: CLAIM_AND_END_SETUP })).toBe(false)
		// Address-like objects compare by their string form.
		expect(isClaimAndEndSetup({ ...CLAIM, to: AztecAddress.fromStringUnsafe(FEE_JUICE_CONTRACT) })).toBe(true)
	})
})

describe("classifyFeePayer", () => {
	test("no payer named leaves the fee to the wallet", () => {
		expect(classifyFeePayer(undefined, SENDER, [])).toBeUndefined()
		expect(classifyFeePayer(null, SENDER, [CLAIM])).toBeUndefined()
	})

	test("a payer other than the sender is an external fee payment contract, whatever its calls", () => {
		expect(classifyFeePayer(FPC, SENDER, [])).toBe("fpc")
		expect(classifyFeePayer(FPC, SENDER, [CLAIM])).toBe("fpc")
		expect(classifyFeePayer("", SENDER, [])).toBe("fpc")
	})

	test("the sender with the Fee Juice contract's setup-ending claim claims Fee Juice in setup", () => {
		expect(classifyFeePayer(SENDER, SENDER, [{ name: "transfer" }, CLAIM])).toBe("fjwc")
	})

	test("the sender with no such claim asks to pay from held Fee Juice - a claim-named call elsewhere included", () => {
		expect(classifyFeePayer(SENDER, SENDER, [])).toBe("self-pay")
		expect(classifyFeePayer(SENDER, SENDER, [{ name: "transfer" }])).toBe("self-pay")
		expect(classifyFeePayer(SENDER, SENDER, undefined)).toBe("self-pay")
		expect(classifyFeePayer(SENDER, SENDER, [{ ...CLAIM, to: FPC }])).toBe("self-pay")
		expect(classifyFeePayer(SENDER, SENDER, [{ ...CLAIM, type: "public" }])).toBe("self-pay")
	})

	test("compares addresses by their string form", () => {
		expect(classifyFeePayer({ toString: () => SENDER }, SENDER, [])).toBe("self-pay")
		expect(classifyFeePayer({ toString: () => FPC }, { toString: () => SENDER }, [])).toBe("fpc")
	})
})

describe("isSelfPay", () => {
	test("reads the payload it is given", () => {
		expect(isSelfPay({ feePayer: SENDER, calls: [{ name: "claim_public" }] }, SENDER)).toBe(true)
		expect(isSelfPay({ feePayer: SENDER, calls: [CLAIM, { name: "claim_public" }] }, SENDER)).toBe(false)
		expect(isSelfPay({ feePayer: FPC, calls: [] }, SENDER)).toBe(false)
		expect(isSelfPay({ calls: [] }, SENDER)).toBe(false)
		expect(isSelfPay(undefined, SENDER)).toBe(false)
	})
})
