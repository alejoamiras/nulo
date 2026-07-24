import { PRIVATE_ADDRESS_MAGIC_VALUE } from "@nulo/aztec-runtime/pxe/public-events"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { describe, expect, test } from "vitest"
import type { IncomingNoteRecord, IncomingPublicEventRecord } from "@/wallet/services/incoming-transfer/spec"
import { receivedLabel, resolveFromDisplay, resolveReceivedType } from "./received-display"

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
