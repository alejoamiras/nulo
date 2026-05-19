import { describe, expect, test } from "vitest"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { OriginType } from "@/wallet/services/transaction/client"
import { buildGasBreakdown, computeFeeSavings, describeFeePaymentMethod } from "./tx-detail-helpers"

describe("tx-detail-helpers/buildGasBreakdown", () => {
	test("returns null when gas details are missing", () => {
		expect(buildGasBreakdown(null)).toBeNull()
		expect(buildGasBreakdown(undefined)).toBeNull()
	})

	test("computes L2 + DA costs", () => {
		const result = buildGasBreakdown({
			feePerL2Gas: 10n,
			feePerDaGas: 20n,
			l2GasLimit: 100,
			daGasLimit: 50,
			teardownL2GasLimit: 0,
			teardownDaGasLimit: 0,
		})
		expect(result?.hasTeardown).toBe(false)
		expect(result?.l2Cost).toBeTruthy()
		expect(result?.daCost).toBeTruthy()
	})

	test("flags hasTeardown when either teardown limit is non-zero", () => {
		const result = buildGasBreakdown({
			feePerL2Gas: 1n,
			feePerDaGas: 1n,
			l2GasLimit: 1,
			daGasLimit: 1,
			teardownL2GasLimit: 5,
			teardownDaGasLimit: 0,
		})
		expect(result?.hasTeardown).toBe(true)
	})
})

describe("tx-detail-helpers/computeFeeSavings", () => {
	test("returns null when either fee is missing", () => {
		expect(computeFeeSavings(undefined, 100n)).toBeNull()
		expect(computeFeeSavings(100n, undefined)).toBeNull()
	})

	test("returns null when estimated fee is zero", () => {
		expect(computeFeeSavings(100n, 0n)).toBeNull()
	})

	test("returns null when actual >= estimated", () => {
		expect(computeFeeSavings(100n, 100n)).toBeNull()
		expect(computeFeeSavings(150n, 100n)).toBeNull()
	})

	test("returns formatted percentage savings when actual < estimated", () => {
		expect(computeFeeSavings(50n, 100n)).toBe("50% less than estimate")
		expect(computeFeeSavings(80n, 100n)).toBe("20% less than estimate")
	})

	test("accepts string inputs", () => {
		expect(computeFeeSavings("50", "100")).toBe("50% less than estimate")
	})
})

describe("tx-detail-helpers/describeFeePaymentMethod", () => {
	test("null tx returns null", () => {
		expect(describeFeePaymentMethod(null)).toBeNull()
	})

	test("FeeJuice → 'Public Fee Juice'", () => {
		expect(describeFeePaymentMethod({ feePaymentMethod: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE })).toBe(
			"Public Fee Juice",
		)
	})

	test("FeeJuiceWithClaim → 'Public Fee Juice (with claim)'", () => {
		expect(describeFeePaymentMethod({ feePaymentMethod: AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM })).toBe(
			"Public Fee Juice (with claim)",
		)
	})

	test("External + sponsor_unconditionally → 'Sponsored'", () => {
		expect(
			describeFeePaymentMethod({
				feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
				calls: [{ method: "sponsor_unconditionally" }],
			}),
		).toBe("Sponsored")
	})

	test("External + fee_entrypoint_private → 'Private Fee Juice'", () => {
		expect(
			describeFeePaymentMethod({
				feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
				calls: [{ method: "fee_entrypoint_private" }],
			}),
		).toBe("Private Fee Juice")
	})

	test("External + DAPP origin → 'Set by {name}'", () => {
		expect(
			describeFeePaymentMethod({
				feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
				calls: [],
				origin: { type: OriginType.DAPP, name: "Foo" },
			}),
		).toBe("Set by Foo")
	})

	test("External + DAPP origin without name → 'Set by the app'", () => {
		expect(
			describeFeePaymentMethod({
				feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
				calls: [],
				origin: { type: OriginType.DAPP },
			}),
		).toBe("Set by the app")
	})

	test("External fallback → 'External FPC'", () => {
		expect(
			describeFeePaymentMethod({
				feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL,
				calls: [],
				origin: { type: OriginType.UI },
			}),
		).toBe("External FPC")
	})
})
