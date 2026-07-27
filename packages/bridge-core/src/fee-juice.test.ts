import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Fr } from "@aztec/aztec.js/fields"
import { FEE_JUICE_ADDRESS } from "@aztec/constants"
import { describe, expect, test } from "vitest"
import {
	DEPLOY_SEQUENCE_TX_COUNT,
	deploySequenceFeeBudget,
	feeJuiceAddress,
	feeJuiceClaimArgs,
	publicFeeJuicePayment,
	sponsoredFeePayment,
} from "./fee-juice"

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

	test("feeJuiceClaimArgs builds the FeeJuice claim tuple verbatim", () => {
		const to = AztecAddress.fromNumberUnsafe(0xbeef).toString()
		expect(feeJuiceClaimArgs(to, 1000n, "0x2a", 7n)).toEqual([to, 1000n, "0x2a", 7n])
	})

	// fable round-2 NEW-2: the fee-juice budget covers the WHOLE ~7-tx deploy sequence, not one claim.
	test("deploySequenceFeeBudget sizes the FULL sequence (7 txs by default) and fails closed on bad input", () => {
		expect(DEPLOY_SEQUENCE_TX_COUNT).toBe(7)
		expect(deploySequenceFeeBudget(10n ** 18n)).toBe(7n * 10n ** 18n)
		expect(deploySequenceFeeBudget(5n, 3)).toBe(15n)
		expect(() => deploySequenceFeeBudget(0n)).toThrow(/positive/)
		expect(() => deploySequenceFeeBudget(1n, 0)).toThrow(/positive integer/)
		expect(() => deploySequenceFeeBudget(1n, 1.5)).toThrow(/positive integer/)
	})
})
