import { describe, expect, test } from "vitest"
import { parseTransferIntent, projectArgument } from "./transfer-intent"

const FROM = `0x${"a".repeat(64)}`
const TO = `0x${"b".repeat(64)}`
const ATTACKER = `0x${"c".repeat(64)}`
const ZERO_NONCE = `0x${"0".repeat(64)}`

describe("parseTransferIntent", () => {
	test("transfer(to, amount) is a transfer without a sender", () => {
		expect(parseTransferIntent({ name: "transfer", args: [TO, 100n] })).toEqual({ kind: "transfer", to: TO, amount: "100" })
	})

	test("transfer(from, to, amount, nonce) is a full intent; the same name accepts both shapes", () => {
		expect(parseTransferIntent({ method: "transfer", args: [FROM, TO, 100n, ZERO_NONCE] })).toEqual({
			kind: "transfer",
			from: FROM,
			to: TO,
			amount: "100",
			nonce: ZERO_NONCE,
		})
	})

	test("transfer_in_private(from, to, amount, nonce) reads the nonce by parameter name", () => {
		expect(parseTransferIntent({ method: "transfer_in_private", args: [FROM, TO, 7n, 42n] })).toEqual({
			kind: "transfer",
			from: FROM,
			to: TO,
			amount: "7",
			nonce: "42",
		})
	})

	test("the legacy 3-argument shape and any other wrong arity are unverified", () => {
		expect(parseTransferIntent({ method: "transfer_in_private", args: [FROM, TO, 100n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer_in_public", args: [TO, 1n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer", args: [FROM, TO, 1n, 0n, 0n] })).toEqual({ kind: "unverified" })
	})

	test("mints and unknown names are unverified (no descriptor, no guess)", () => {
		expect(parseTransferIntent({ method: "mint_to_private", args: [TO, 500n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "stealFunds", args: [FROM, ATTACKER, 1000n, 0n] })).toEqual({ kind: "unverified" })
	})

	test("missing args or no call is unverified", () => {
		expect(parseTransferIntent(undefined)).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer" })).toEqual({ kind: "unverified" })
	})

	test("a custom toString() returning UI text cannot enter a structured row (A-02)", () => {
		const evilAddr = { toString: () => "<<EVIL UI INJECTION>>" }
		const evilAmount = { toString: () => "phishing-1000" }
		expect(parseTransferIntent({ method: "transfer", args: [evilAddr, 1n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer", args: [TO, evilAmount] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer", args: [evilAddr, TO, 1n, 0n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer", args: [FROM, TO, 1n, evilAmount] })).toEqual({ kind: "unverified" })
	})

	test("addresses must be canonical 32-byte hex; amounts must be canonical decimal or hex", () => {
		expect(parseTransferIntent({ method: "transfer", args: ["0x1234", 1n] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer", args: [TO, "1e10"] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer", args: [TO, "1.5"] })).toEqual({ kind: "unverified" })
		expect(parseTransferIntent({ method: "transfer", args: [TO, "0x1f"] })).toEqual({ kind: "transfer", to: TO, amount: "0x1f" })
	})

	test("AztecAddress-like objects whose toString returns canonical hex are accepted", () => {
		expect(parseTransferIntent({ method: "transfer", args: [{ toString: () => TO }, 1n] })).toEqual({
			kind: "transfer",
			to: TO,
			amount: "1",
		})
	})
})

describe("projectArgument (the raw-argument fallback's projection)", () => {
	test("canonical addresses, canonical text, bigints and primitives project; the rest is opaque", () => {
		expect(projectArgument(TO)).toEqual({ kind: "address", value: TO })
		expect(projectArgument({ toString: () => TO })).toEqual({ kind: "address", value: TO })
		expect(projectArgument(12n)).toEqual({ kind: "text", value: "12" })
		expect(projectArgument(3)).toEqual({ kind: "text", value: "3" })
		expect(projectArgument("hello")).toEqual({ kind: "text", value: "hello" })
		expect(projectArgument({ toString: () => "<<EVIL>>" })).toEqual({ kind: "text", value: "<<EVIL>>" })
		expect(projectArgument({})).toEqual({ kind: "opaque" })
		expect(projectArgument({ toString: 1 })).toEqual({ kind: "opaque" })
		expect(projectArgument(null)).toEqual({ kind: "opaque" })
		expect(projectArgument(undefined)).toEqual({ kind: "opaque" })
	})
})
