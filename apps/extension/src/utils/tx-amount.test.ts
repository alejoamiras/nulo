import { describe, expect, test } from "vitest"
import { TransferType, type TxCall } from "@/wallet/services/transaction/spec"
import { txAmount } from "./tx-amount"

const field = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`
const TOKEN = `0x${"0a".repeat(32)}`
const OTHER = `0x${"0b".repeat(32)}`
const RECIPIENT = `0x${"0c".repeat(32)}`
const FEE_JUICE = `0x${"0d".repeat(32)}`
const FPC = `0x${"0e".repeat(32)}`
const ONE = field(10n ** 18n)
const LARGE = field(10n ** 30n)
const BIDI_OVERRIDE = String.fromCodePoint(0x202e)
const ZERO_WIDTH = String.fromCodePoint(0x200b)

const listed = { contract: TOKEN, decimals: 18, symbol: "TST", hasDecimals: true }
const other = { contract: OTHER, decimals: 18, symbol: "OTH", hasDecimals: true }
const mint = (args: unknown[], method = "mint_to_public", contract = TOKEN): TxCall => ({ contract, method, args })
const feePayload: TxCall[] = [
	{ contract: FEE_JUICE, method: "claim", args: [FPC, LARGE, field(7n), LARGE] },
	{ contract: FPC, method: "mint_and_pay_fee", args: [RECIPIENT, LARGE] },
]
const uiTransfer = (decimals: number, amount: string): TxCall => ({
	contract: TOKEN,
	method: "transfer_private_to_private",
	args: [RECIPIENT, RECIPIENT, amount, "0"],
	transfers: [{ token: { name: "Test", symbol: "TST", decimals }, type: TransferType.Private, from: RECIPIENT, to: RECIPIENT, amount }],
})
const tst = { units: 10n ** 18n, decimals: 18, symbol: "TST" }

describe("txAmount", () => {
	test.each([
		["a standard mint of a listed 18-decimal token", [mint([RECIPIENT, ONE])], [listed], tst],
		["the same mint behind a fee payload with large last arguments", [...feePayload, mint([RECIPIENT, ONE])], [listed], tst],
		["an unlisted token", [mint([RECIPIENT, ONE])], [other], null],
		["a token without a decimals getter", [mint([RECIPIENT, ONE])], [{ ...listed, decimals: 0, hasDecimals: false }], null],
		["decimals 255", [mint([RECIPIENT, ONE])], [{ ...listed, decimals: 255 }], null],
		["a three-argument mint_to_public", [mint([RECIPIENT, ONE, ONE])], [listed], null],
		[
			"a second mint call on another contract",
			[mint([RECIPIENT, ONE]), mint([RECIPIENT, ONE], "mint_to_private", OTHER)],
			[listed, other],
			null,
		],
		["an amount of 2^128", [mint([RECIPIENT, field(2n ** 128n)])], [listed], null],
		["an amount that is neither digits nor hex", [mint([RECIPIENT, "1e18"])], [listed], null],
		[
			"a dApp transfer, which records no transfers",
			[{ contract: TOKEN, method: "transfer_private_to_public", args: [RECIPIENT, RECIPIENT, ONE, "0x00"] }],
			[listed],
			null,
		],
		[
			"a genuine 0-decimal token",
			[mint([RECIPIENT, "0x5"])],
			[{ ...listed, decimals: 0, symbol: "ZRO" }],
			{ units: 5n, decimals: 0, symbol: "ZRO" },
		],
		["a wallet transfer in its record's decimals, with the list empty", [uiTransfer(18, (10n ** 18n).toString())], [], tst],
		["a wallet transfer whose record's decimals are unusable", [uiTransfer(255, "1")], [listed], null],
		[
			"a symbol carrying bidi and zero-width characters",
			[mint([RECIPIENT, ONE])],
			[{ ...listed, symbol: `US${BIDI_OVERRIDE}DC${ZERO_WIDTH}` }],
			{ ...tst, symbol: "USDC" },
		],
	])("%s", (_name, calls, tokens, expected) => {
		expect(txAmount(calls, tokens)).toEqual(expected)
	})
})
