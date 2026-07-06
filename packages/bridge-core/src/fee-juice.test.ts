import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { FEE_JUICE_ADDRESS } from "@aztec/constants"
import { describe, expect, test } from "vitest"
import { feeJuiceAddress, feeJuiceClaimArgs, publicFeeJuicePayment, sponsoredFeePayment } from "./fee-juice"

describe("fee-juice", () => {
	test("feeJuiceAddress is the canonical protocol Fee Juice address", () => {
		expect(feeJuiceAddress).toMatch(/^0x[0-9a-f]{64}$/)
		expect(feeJuiceAddress).not.toBe(`0x${"0".repeat(64)}`)
		// Derived from the protocol constant — pins the wiring, not a hand-typed literal.
		expect(feeJuiceAddress).toBe(AztecAddress.fromNumberUnsafe(FEE_JUICE_ADDRESS).toString())
	})

	test("publicFeeJuicePayment pays from the sender, in fee juice", async () => {
		const sender = AztecAddress.fromNumberUnsafe(0x1234)
		const claim = { claimAmount: 1000n, claimSecret: Fr.fromString("0x2a"), messageLeafIndex: 7n }
		const method = publicFeeJuicePayment(sender, claim)
		expect((await method.getFeePayer()).toString()).toBe(sender.toString())
		expect((await method.getAsset()).toString()).toBe(feeJuiceAddress)
	})

	test("sponsoredFeePayment routes the fee through the given FPC", async () => {
		const fpc = AztecAddress.fromNumberUnsafe(0xf9c)
		const method = sponsoredFeePayment(fpc)
		expect((await method.getFeePayer()).toString()).toBe(fpc.toString())
	})

	test("feeJuiceClaimArgs builds the claim_and_end_setup tuple verbatim", () => {
		const to = AztecAddress.fromNumberUnsafe(0xbeef).toString()
		expect(feeJuiceClaimArgs(to, 1000n, "0x2a", 7n)).toEqual([to, 1000n, "0x2a", 7n])
	})
})
