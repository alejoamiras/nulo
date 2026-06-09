import { describe, expect, test } from "vitest"
import { parseTransferIntent } from "./transfer-intent"

describe("parseTransferIntent (F-008 / Phase 7)", () => {
	test("recognizes transfer_in_private with (from, to, amount)", () => {
		const call = { method: "transfer_in_private", args: ["0xfrom", "0xto", 100n] }
		expect(parseTransferIntent(call)).toEqual({ kind: "transfer", to: "0xto", amount: "100" })
	})

	test("recognizes transfer_in_public, transfer_to_private, transfer_to_public", () => {
		expect(parseTransferIntent({ method: "transfer_in_public", args: ["0xf", "0xt", 1n] })).toEqual({
			kind: "transfer",
			to: "0xt",
			amount: "1",
		})
		expect(parseTransferIntent({ method: "transfer_to_private", args: ["0xf", "0xt", 1n] })).toEqual({
			kind: "transfer",
			to: "0xt",
			amount: "1",
		})
		expect(parseTransferIntent({ method: "transfer_to_public", args: ["0xf", "0xt", 1n] })).toEqual({
			kind: "transfer",
			to: "0xt",
			amount: "1",
		})
	})

	test("recognizes mint_to_private and mint_to_public with (to, amount)", () => {
		expect(parseTransferIntent({ method: "mint_to_private", args: ["0xto", 500n] })).toEqual({
			kind: "mint",
			to: "0xto",
			amount: "500",
		})
		expect(parseTransferIntent({ name: "mint_to_public", args: ["0xto", 500n] })).toEqual({
			kind: "mint",
			to: "0xto",
			amount: "500",
		})
	})

	test("returns unverified for unknown method names (do not guess semantically)", () => {
		// Codex Round 1 S-2: a malicious dApp could craft a payload that LOOKS
		// transfer-like (3 args, address-shaped) but is a different method.
		// The parser must refuse to guess.
		expect(parseTransferIntent({ method: "stealFunds", args: ["0xf", "0xattacker", 1000n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "unknown", args: ["0xt", 1n] })).toEqual({ kind: "unverified" })
	})

	test("returns unverified for known method with wrong arity (signature drift defense)", () => {
		expect(parseTransferIntent({ method: "transfer_in_private", args: ["0xt", 1n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "mint_to_private", args: ["0xt"] })).toEqual({ kind: "unverified" })
	})

	test("returns unverified for missing args / no call", () => {
		expect(parseTransferIntent(undefined)).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer_in_private" })).toEqual({ kind: "unverified" })
	})

	test("returns unverified when args can't be stringified meaningfully", () => {
		// Object without a useful toString — the parser shouldn't guess.
		expect(parseTransferIntent({ method: "transfer_in_private", args: [{}, { weird: true }, null] })).toEqual({ kind: "unverified" })
	})
})
