import { CLAIM_AND_END_SETUP, CLAIM_AND_END_SETUP_SELECTOR, FEE_JUICE_CONTRACT } from "@nulo/wallet-bridge"
import { describe, test, expect } from "vitest"
import { detectEmbeddedFeePayment, isNoFromRequest } from "./fee-detection"

const SENDER = "0x1a228350bbfa130d71aa1105c93e6432bd8c65476bc46ba579d2dc885e2873d1"
const CLAIM = [
	{
		name: CLAIM_AND_END_SETUP,
		to: FEE_JUICE_CONTRACT,
		selector: CLAIM_AND_END_SETUP_SELECTOR,
		type: "private",
		isStatic: false,
		hideMsgSender: false,
		args: [SENDER, "0x5", "0x7", "0x9"],
	},
]

describe("detectEmbeddedFeePayment", () => {
	test("returns undefined when feePayer is undefined or null", () => {
		expect(detectEmbeddedFeePayment(undefined, "0xabc")).toBeUndefined()
		expect(detectEmbeddedFeePayment(null, "0xabc")).toBeUndefined()
	})

	test('returns "fjwc" when feePayer equals from AND the payload claims Fee Juice in setup', () => {
		expect(detectEmbeddedFeePayment(SENDER, SENDER, CLAIM)).toBe("fjwc")
	})

	test("a sender payer with no fee call is a requested self-pay, not an embedded payment", () => {
		const addr = "0x1a228350bbfa130d71aa1105c93e6432bd8c65476bc46ba579d2dc885e2873d1"
		expect(detectEmbeddedFeePayment(addr, addr)).toBeUndefined()
		expect(detectEmbeddedFeePayment(addr, addr, [{ name: "transfer" }])).toBeUndefined()
		// The claim's NAME on a call to another contract is a label, not the claim.
		expect(detectEmbeddedFeePayment(addr, addr, [{ ...CLAIM[0], to: addr }])).toBeUndefined()
	})

	test('returns "fpc" when feePayer differs from from (external FPC)', () => {
		const feePayer = "0x2ef4be56d83d448d37909ede8ac3a4ac69daab309584a1bceebbc9f0639f825c"
		const from = "0x1a228350bbfa130d71aa1105c93e6432bd8c65476bc46ba579d2dc885e2873d1"
		expect(detectEmbeddedFeePayment(feePayer, from)).toBe("fpc")
	})

	test("coerces AztecAddress-like objects via String() for comparison", () => {
		const feePayer = { toString: () => "0xabc" }
		const from = { toString: () => "0xdef" }
		expect(detectEmbeddedFeePayment(feePayer, from)).toBe("fpc")
	})

	test("matches when feePayer is an object and from is a string with same value", () => {
		const feePayer = { toString: () => SENDER }
		expect(detectEmbeddedFeePayment(feePayer, SENDER, CLAIM)).toBe("fjwc")
	})

	test('treats empty string feePayer as defined (returns "fpc", not undefined)', () => {
		expect(detectEmbeddedFeePayment("", "0xabc")).toBe("fpc")
	})
})

describe("isNoFromRequest", () => {
	test('returns true for "NO_FROM"', () => {
		expect(isNoFromRequest("NO_FROM")).toBe(true)
	})

	test("returns false for a normal address", () => {
		expect(isNoFromRequest("0x1a228350bbfa130d71aa1105c93e6432bd8c65476bc46ba579d2dc885e2873d1")).toBe(false)
	})

	test("is case-sensitive", () => {
		expect(isNoFromRequest("no_from")).toBe(false)
	})
})
