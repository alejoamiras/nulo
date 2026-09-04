import { describe, expect, test } from "vitest"
import { CLAIM_AND_END_SETUP, classifyFeePayer, isSelfPay } from "./fee-payer"

const SENDER = "0x1a228350bbfa130d71aa1105c93e6432bd8c65476bc46ba579d2dc885e2873d1"
const FPC = "0x2ef4be56d83d448d37909ede8ac3a4ac69daab309584a1bceebbc9f0639f825c"

describe("classifyFeePayer", () => {
	test("no payer named leaves the fee to the wallet", () => {
		expect(classifyFeePayer(undefined, SENDER, [])).toBeUndefined()
		expect(classifyFeePayer(null, SENDER, [{ name: CLAIM_AND_END_SETUP }])).toBeUndefined()
	})

	test("a payer other than the sender is an external fee payment contract, whatever its calls", () => {
		expect(classifyFeePayer(FPC, SENDER, [])).toBe("fpc")
		expect(classifyFeePayer(FPC, SENDER, [{ name: CLAIM_AND_END_SETUP }])).toBe("fpc")
		expect(classifyFeePayer("", SENDER, [])).toBe("fpc")
	})

	test("the sender with the setup-ending claim claims Fee Juice in setup", () => {
		expect(classifyFeePayer(SENDER, SENDER, [{ name: "transfer" }, { name: CLAIM_AND_END_SETUP }])).toBe("fjwc")
	})

	test("the sender with no fee call asks to pay from held Fee Juice", () => {
		expect(classifyFeePayer(SENDER, SENDER, [])).toBe("self-pay")
		expect(classifyFeePayer(SENDER, SENDER, [{ name: "transfer" }])).toBe("self-pay")
		expect(classifyFeePayer(SENDER, SENDER, undefined)).toBe("self-pay")
	})

	test("compares addresses by their string form", () => {
		expect(classifyFeePayer({ toString: () => SENDER }, SENDER, [])).toBe("self-pay")
		expect(classifyFeePayer({ toString: () => FPC }, { toString: () => SENDER }, [])).toBe("fpc")
	})
})

describe("isSelfPay", () => {
	test("reads the payload it is given", () => {
		expect(isSelfPay({ feePayer: SENDER, calls: [{ name: "claim_public" }] }, SENDER)).toBe(true)
		expect(isSelfPay({ feePayer: SENDER, calls: [{ name: CLAIM_AND_END_SETUP }, { name: "claim_public" }] }, SENDER)).toBe(false)
		expect(isSelfPay({ feePayer: FPC, calls: [] }, SENDER)).toBe(false)
		expect(isSelfPay({ calls: [] }, SENDER)).toBe(false)
		expect(isSelfPay(undefined, SENDER)).toBe(false)
	})
})
