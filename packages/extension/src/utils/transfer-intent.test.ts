import { describe, expect, test } from "vitest"
import { parseTransferIntent } from "./transfer-intent"

const FROM = `0x${"a".repeat(64)}`
const TO = `0x${"b".repeat(64)}`
const ATTACKER = `0x${"c".repeat(64)}`

describe("parseTransferIntent (F-008 / Phase 7 + A-02)", () => {
	test("recognizes transfer_in_private with (from, to, amount) — exposes from", () => {
		expect(parseTransferIntent({ method: "transfer_in_private", args: [FROM, TO, 100n] })).toEqual({
			kind: "transfer",
			from: FROM,
			to: TO,
			amount: "100",
		})
	})

	test("recognizes transfer_in_public, transfer_to_private, transfer_to_public", () => {
		expect(parseTransferIntent({ method: "transfer_in_public", args: [FROM, TO, 1n] })).toEqual({
			kind: "transfer",
			from: FROM,
			to: TO,
			amount: "1",
		})
		expect(parseTransferIntent({ method: "transfer_to_private", args: [FROM, TO, 1n] })).toEqual({
			kind: "transfer",
			from: FROM,
			to: TO,
			amount: "1",
		})
		expect(parseTransferIntent({ method: "transfer_to_public", args: [FROM, TO, 1n] })).toEqual({
			kind: "transfer",
			from: FROM,
			to: TO,
			amount: "1",
		})
	})

	test("recognizes mint_to_private and mint_to_public with (to, amount)", () => {
		expect(parseTransferIntent({ method: "mint_to_private", args: [TO, 500n] })).toEqual({
			kind: "mint",
			to: TO,
			amount: "500",
		})
		expect(parseTransferIntent({ name: "mint_to_public", args: [TO, 500n] })).toEqual({
			kind: "mint",
			to: TO,
			amount: "500",
		})
	})

	test("returns unverified for unknown method names (do not guess semantically)", () => {
		expect(parseTransferIntent({ method: "stealFunds", args: [FROM, ATTACKER, 1000n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "unknown", args: [TO, 1n] })).toEqual({ kind: "unverified" })
	})

	test("returns unverified for known method with wrong arity (signature drift defense)", () => {
		expect(parseTransferIntent({ method: "transfer_in_private", args: [TO, 1n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "mint_to_private", args: [TO] })).toEqual({ kind: "unverified" })
	})

	test("returns unverified for missing args / no call", () => {
		expect(parseTransferIntent(undefined)).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer_in_private" })).toEqual({ kind: "unverified" })
	})

	test("rejects custom toString() that returns attacker-controlled UI text (A-02)", () => {
		// Codex post-impl A-02: a malicious dApp could send a non-canonical
		// object with a custom toString() returning arbitrary phishing text.
		// We require the projected string to match a canonical address /
		// amount regex; anything else falls back to unverified.
		const evilAddr = { toString: () => "<<EVIL UI INJECTION>>" }
		const evilAmount = { toString: () => "phishing-1000" }
		expect(parseTransferIntent({ method: "transfer_in_private", args: [evilAddr, TO, 1n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer_in_private", args: [FROM, TO, evilAmount] })).toEqual({
			kind: "unverified",
		})
		expect(parseTransferIntent({ method: "mint_to_private", args: [evilAddr, 1n] })).toEqual({ kind: "unverified" })
	})

	test("rejects non-32-byte hex addresses (canonical-shape defense)", () => {
		// Short hex / decimal / non-hex chars must NOT pass as an address.
		expect(parseTransferIntent({ method: "transfer_in_private", args: ["0x1234", TO, 1n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer_in_private", args: ["not hex", TO, 1n] })).toEqual({
			kind: "unverified",
		})
	})

	test("accepts AztecAddress-like objects whose toString returns canonical hex", () => {
		const addrObj = { toString: () => FROM }
		const toObj = { toString: () => TO }
		expect(parseTransferIntent({ method: "transfer_in_private", args: [addrObj, toObj, 1n] })).toEqual({
			kind: "transfer",
			from: FROM,
			to: TO,
			amount: "1",
		})
	})

	test("rejects amount with non-canonical string (e.g. scientific notation)", () => {
		expect(parseTransferIntent({ method: "transfer_in_private", args: [FROM, TO, "1e10"] })).toEqual({
			kind: "unverified",
		})
		expect(parseTransferIntent({ method: "transfer_in_private", args: [FROM, TO, "1.5"] })).toEqual({
			kind: "unverified",
		})
	})
})
