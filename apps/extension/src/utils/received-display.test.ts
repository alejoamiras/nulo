import { PRIVATE_ADDRESS_MAGIC_VALUE } from "@nulo/aztec-runtime/pxe/public-events"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { describe, expect, test, vi } from "vitest"
import type { IncomingNoteRecord, IncomingPublicEventRecord } from "@/wallet/services/incoming-transfer/spec"
import type { TokenInfo } from "@/wallet/services/token/spec"
import { buildIncomingCardProps, receivedLabel, resolveFromDisplay, resolveReceivedType, tokenForReceipt } from "./received-display"

const ZERO = AztecAddress.ZERO.toString()
const REAL = AztecAddress.fromBigIntUnsafe(0xabcn).toString()

const noteRec = (): IncomingNoteRecord => ({
	kind: "note",
	id: "note:p1|n1|0xsn",
	siloedNullifier: "0xsn",
	noteHash: "0xnh",
	owner: "0xa",
	profileId: "p1",
	networkId: "n1",
	accountAddress: "0xa",
	contract: "0xc",
	tokenId: 1,
	amountRaw: "100",
	txHash: "0xtx",
	l2BlockNumber: 1,
	txIndexInBlock: 0,
	indexInTx: 0,
	hidden: false,
	discoveredAt: 0,
})

const pubRec = (from: string): IncomingPublicEventRecord => ({
	kind: "public-event",
	id: "pub:p1|n1|0xtx|0",
	from,
	blockHash: "0xbh",
	profileId: "p1",
	networkId: "n1",
	accountAddress: "0xa",
	contract: "0xc",
	tokenId: 1,
	amountRaw: "100",
	txHash: "0xtx",
	l2BlockNumber: 1,
	txIndexInBlock: 0,
	indexInTx: 0,
	hidden: false,
	discoveredAt: 0,
})

describe("resolveReceivedType + receivedLabel", () => {
	test("note kind → Received privately", () => {
		expect(resolveReceivedType(noteRec())).toBe("received-privately")
		expect(receivedLabel(resolveReceivedType(noteRec()))).toBe("Received privately")
	})
	test("public real sender → Public → Public", () => {
		expect(receivedLabel(resolveReceivedType(pubRec(REAL)))).toBe("Public → Public")
	})
	test("public from MAGIC → Private → Public", () => {
		expect(receivedLabel(resolveReceivedType(pubRec(PRIVATE_ADDRESS_MAGIC_VALUE)))).toBe("Private → Public")
	})
	test("public from zero → Minted", () => {
		expect(receivedLabel(resolveReceivedType(pubRec(ZERO)))).toBe("Minted")
	})
})

describe("resolveFromDisplay", () => {
	test("note kind → redacted (sender not disclosed)", () => {
		expect(resolveFromDisplay(noteRec())).toEqual({ kind: "redacted" })
	})
	test("public real sender → address", () => {
		expect(resolveFromDisplay(pubRec(REAL))).toEqual({ kind: "address", address: REAL })
	})
	test("public MAGIC → private (never renders the MAGIC sentinel raw)", () => {
		expect(resolveFromDisplay(pubRec(PRIVATE_ADDRESS_MAGIC_VALUE))).toEqual({ kind: "private" })
	})
	test("public zero → mint (never renders the zero sentinel raw)", () => {
		expect(resolveFromDisplay(pubRec(ZERO))).toEqual({ kind: "mint" })
	})
})

describe("tokenForReceipt + buildIncomingCardProps", () => {
	const token = (over: Partial<TokenInfo>): TokenInfo => ({
		id: 1,
		chainId: 1,
		contract: "0xc",
		name: "Test",
		symbol: "TST",
		decimals: 18,
		hasDecimals: true,
		hasPublicBalances: true,
		hasPublicTransfers: true,
		hasPublicToPrivateTransfers: true,
		hasPrivateBalances: true,
		hasPrivateTransfers: true,
		hasPrivateToPublicTransfers: true,
		...over,
	})
	const fiatLabel = vi.fn((_token: TokenInfo, raw: bigint) => `≈ ${raw}`)

	test("a known token gives the row its symbol, its decimals and a dollar value for the amount", () => {
		const props = buildIncomingCardProps(noteRec(), [token({ decimals: 6 })], fiatLabel)
		expect(props).toMatchObject({ tokenSymbol: "TST", amountRaw: "100", tokenDecimals: 6, amountFiat: "≈ 100", txHash: "0xtx" })
	})

	test("no token: no decimals, so the card draws no amount, and no dollar value", () => {
		fiatLabel.mockClear()
		const props = buildIncomingCardProps(noteRec(), [token({ id: 2, contract: "0xother" })], fiatLabel)
		expect(props).toMatchObject({ tokenSymbol: "Token", tokenDecimals: null, amountFiat: null })
		expect(fiatLabel).not.toHaveBeenCalled()
	})

	test("a tokenId gone stale (the token removed and re-added) matches by contract", () => {
		const readded = token({ id: 12 })
		expect(tokenForReceipt([readded], noteRec())).toBe(readded)
		expect(buildIncomingCardProps(noteRec(), [readded], fiatLabel).tokenSymbol).toBe("TST")
	})

	test("the tokenId wins over another row with the receipt's contract", () => {
		const byContract = token({ id: 5, symbol: "OLD" })
		const byId = token({ id: 1, contract: "0xnew", symbol: "NEW" })
		expect(tokenForReceipt([byContract, byId], noteRec())).toBe(byId)
	})
})
