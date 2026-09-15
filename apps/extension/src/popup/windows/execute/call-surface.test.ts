import { describe, expect, test } from "vitest"
import { trimAddress } from "@/utils/string"
import type { TokenInfo } from "@/wallet/services/token/client"
import { amountLabel, callName, callSurface, paramText, rawRows, valueText } from "./call-surface"

const OWNER = `0x${"a".repeat(64)}`
const TO = `0x${"b".repeat(64)}`
const TOKEN = `0x${"c".repeat(64)}`
const field = (n: bigint): string => `0x${n.toString(16).padStart(64, "0")}`
const ctx = { accountAddress: OWNER, noFrom: false }
const USDC = { id: 1, chainId: 1, contract: TOKEN, name: "USD Coin", symbol: "USDC", decimals: 6 } as TokenInfo
const BEL = String.fromCharCode(7)
const RLO = String.fromCharCode(0x202e)

describe("callSurface", () => {
	test("the vocabulary wins immediately and names the sender the call omits", () => {
		expect(callSurface(ctx, { name: "transfer", args: [TO, field(5n)] }, undefined)).toEqual({
			kind: "transfer",
			to: TO,
			amount: "5",
			sender: { kind: "account", address: OWNER },
		})
		expect(callSurface({ ...ctx, noFrom: true }, { name: "transfer", args: [TO, field(5n)] }, undefined)).toMatchObject({
			sender: { kind: "none" },
		})
		expect(callSurface(ctx, { name: "transfer_in_private", args: [OWNER, TO, field(5n), field(3n)] }, undefined)).toEqual({
			kind: "transfer",
			to: TO,
			amount: "5",
			sender: { kind: "explicit", address: OWNER },
			nonce: "3",
		})
		expect(callSurface(ctx, { name: "mint_to_public", args: [TO, field(5n)] }, undefined)).toEqual({
			kind: "mint",
			to: TO,
			amount: "5",
		})
	})

	test("a hidden msg_sender or a missing caller context falls through instead of claiming a sender", () => {
		const call = { name: "transfer", args: [TO, field(5n)], hideMsgSender: true }
		expect(callSurface(ctx, call, undefined)).toEqual({ kind: "pending" })
		expect(callSurface(undefined, { name: "transfer", args: [TO, field(5n)] }, undefined)).toEqual({ kind: "pending" })
		expect(callSurface(undefined, { name: "transfer_in_private", args: [OWNER, TO, field(5n), field(0n)] }, undefined)).toMatchObject({
			kind: "transfer",
			sender: { kind: "explicit", address: OWNER },
		})
	})

	test("without a vocabulary match: pending, then the decode, then the raw fields with the reason", () => {
		const call = { name: "claim", args: [TO, field(500n)] }
		expect(callSurface(ctx, call, undefined)).toEqual({ kind: "pending" })
		const decoded = { kind: "decoded" as const, contract: "Hub", fn: "claim_private", params: [] }
		expect(callSurface(ctx, call, decoded)).toEqual({ kind: "decoded", fn: "claim_private", params: [] })
		expect(callSurface(ctx, call, { kind: "undecoded", reason: "arguments" })).toEqual({
			kind: "raw",
			reason: "arguments",
			rows: [
				{ kind: "field", short: trimAddress(TO, 10, 6), full: TO, decimal: undefined },
				{ kind: "field", short: trimAddress(field(500n), 10, 6), full: field(500n), decimal: "500" },
			],
			hidden: 0,
		})
	})

	test("callName prefers the ABI's name once decoded", () => {
		const call = { name: "claim_lie", selector: "0x11223344", args: [] }
		expect(callName(call, { kind: "pending" })).toBe(callName({ name: "claim_lie", args: [] }, { kind: "pending" }))
		expect(callName(call, { kind: "decoded", fn: "claim_private", params: [] })).not.toContain("lie")
	})
})

describe("rawRows, amountLabel, valueText, paramText", () => {
	test("rows cap at 32 and count the rest; text is sanitized; objects without toString are opaque", () => {
		const { rows, hidden } = rawRows([...Array.from({ length: 33 }, (_, i) => field(BigInt(i))), "x"])
		expect(rows).toHaveLength(32)
		expect(hidden).toBe(2)
		expect(rawRows([`a${RLO}b`, {}]).rows).toEqual([{ kind: "text", value: "ab" }, { kind: "opaque" }])
	})

	test("an amount carries the known token's units and symbol; an unknown contract keeps the raw integer", () => {
		expect(amountLabel([USDC], 1, TOKEN, "5000000")).toEqual({ text: "5", symbol: "USDC" })
		expect(amountLabel([USDC], 1, TOKEN.toUpperCase().replace("0X", "0x"), "1500000")).toEqual({ text: "1.5", symbol: "USDC" })
		expect(amountLabel([USDC], 2, TOKEN, "5000000")).toEqual({ text: "5000000" })
		expect(amountLabel(undefined, 1, TOKEN, "7")).toEqual({ text: "7" })
	})

	test("values read on one line, nested shapes summarized", () => {
		expect(valueText({ kind: "integer", value: "5" })).toBe("5")
		expect(valueText({ kind: "boolean", value: false })).toBe("false")
		expect(valueText({ kind: "field", value: TO })).toBe(trimAddress(TO, 10, 6))
		expect(valueText({ kind: "address", value: TO })).toBe(trimAddress(TO))
		expect(valueText({ kind: "string", value: `hi${BEL}` })).toBe("hi")
		expect(valueText({ kind: "none" })).toBe("none")
		expect(
			valueText({
				kind: "array",
				items: [
					{ kind: "integer", value: "1" },
					{ kind: "integer", value: "2" },
				],
				hidden: 3,
			}),
		).toBe("[1, 2, +3 more]")
		expect(valueText({ kind: "struct", fields: [{ name: "a", value: { kind: "boolean", value: true } }] })).toBe("{ a: true }")
		expect(paramText([USDC], 1, TOKEN, { name: "amount", value: { kind: "integer", value: "2500000" } })).toBe("2.5 USDC")
		expect(paramText([USDC], 1, TOKEN, { name: "fee", value: { kind: "integer", value: "2500000" } })).toBe("2500000")
	})
})
