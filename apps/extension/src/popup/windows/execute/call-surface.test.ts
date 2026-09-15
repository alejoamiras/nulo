import { describe, expect, test } from "vitest"
import { trimAddress } from "@/utils/string"
import type { DecodedValue } from "@/wallet/services/execution/client"
import type { TokenInfo } from "@/wallet/services/token/client"
import { amountLabel, callName, callSurface, rawRows, tokenAt, valueText, valueTitle } from "./call-surface"

const OWNER = `0x${"a".repeat(64)}`
const TO = `0x${"b".repeat(64)}`
const TOKEN = `0x${"c".repeat(64)}`
const field = (n: bigint): string => `0x${n.toString(16).padStart(64, "0")}`
const ctx = { accountAddress: OWNER, noFrom: false }
const USDC = { id: 1, chainId: 1, contract: TOKEN, name: "USD Coin", symbol: "USDC", decimals: 6 } as TokenInfo
const BEL = String.fromCharCode(7)
const RLO = String.fromCharCode(0x202e)

const value = (role: string): DecodedValue =>
	role === "amount"
		? { kind: "integer", value: "0" }
		: role === "authwit_nonce"
			? { kind: "field", value: field(0n) }
			: { kind: "address", value: TO }
/** A token ABI that spells the vocabulary's signature; the values are irrelevant to the reading. */
const abi = (fn: string, roles: string[]) => ({
	kind: "decoded" as const,
	contract: "Token",
	fn,
	params: roles.map((name) => ({ name, value: value(name) })),
})

describe("callSurface", () => {
	test("on a registered token whose ABI spells the signature, the vocabulary reads by position and names the sender the call omits", () => {
		expect(callSurface(ctx, { name: "transfer", to: TOKEN, args: [TO, field(5n)] }, abi("transfer", ["to", "amount"]), true)).toEqual({
			kind: "transfer",
			to: TO,
			amount: "5",
			sender: { kind: "account", address: OWNER },
		})
		expect(
			callSurface({ ...ctx, noFrom: true }, { name: "transfer", args: [TO, field(5n)] }, abi("transfer", ["to", "amount"]), true),
		).toMatchObject({
			sender: { kind: "none" },
		})
		const tip = abi("transfer_in_private", ["from", "to", "amount", "authwit_nonce"])
		expect(callSurface(ctx, { name: "transfer_in_private", args: [OWNER, TO, field(5n), field(3n)] }, tip, true)).toEqual({
			kind: "transfer",
			to: TO,
			amount: "5",
			sender: { kind: "explicit", address: OWNER },
			nonce: "3",
		})
		expect(callSurface(ctx, { name: "mint_to_public", args: [TO, field(5n)] }, abi("mint_to_public", ["to", "amount"]), true)).toEqual({
			kind: "mint",
			to: TO,
			amount: "5",
		})
	})

	test("the ABI, not the app's name, picks the vocabulary entry", () => {
		const call = { name: "claim_lie", selector: "0x11223344", args: [TO, field(5n)] }
		expect(callSurface(ctx, call, abi("transfer", ["to", "amount"]), true)).toMatchObject({ kind: "transfer", to: TO, amount: "5" })
	})

	test("without corroboration the vocabulary never applies: unregistered contract, swapped roles, a wrong kind, or no decode yet", () => {
		const call = { name: "transfer", to: TOKEN, args: [TO, field(5n)] }
		expect(callSurface(ctx, call, abi("transfer", ["to", "amount"]), false)).toMatchObject({ kind: "decoded", fn: "transfer" })
		const swapped = abi("transfer", ["amount", "to"])
		expect(callSurface(ctx, { ...call, args: [field(5n), TO] }, swapped, true)).toEqual({
			kind: "decoded",
			fn: "transfer",
			params: swapped.params,
		})
		const wrongKind = {
			...abi("transfer", ["to", "amount"]),
			params: [
				{ name: "to", value: value("to") },
				{ name: "amount", value: { kind: "field" as const, value: field(5n) } },
			],
		}
		expect(callSurface(ctx, call, wrongKind, true)).toMatchObject({ kind: "decoded" })
		expect(callSurface(ctx, call, undefined, true)).toEqual({ kind: "pending" })
		expect(callSurface(ctx, call, { kind: "undecoded", reason: "unknown-contract" }, true)).toMatchObject({
			kind: "raw",
			reason: "unknown-contract",
		})
	})

	test("a hidden msg_sender or a missing caller context falls through to the decode instead of claiming a sender", () => {
		const two = abi("transfer", ["to", "amount"])
		expect(callSurface(ctx, { name: "transfer", args: [TO, field(5n)], hideMsgSender: true }, two, true)).toMatchObject({
			kind: "decoded",
		})
		expect(callSurface(undefined, { name: "transfer", args: [TO, field(5n)] }, two, true)).toMatchObject({ kind: "decoded" })
		const tip = abi("transfer_in_private", ["from", "to", "amount", "authwit_nonce"])
		expect(callSurface(undefined, { name: "transfer_in_private", args: [OWNER, TO, field(5n), field(0n)] }, tip, true)).toMatchObject({
			kind: "transfer",
			sender: { kind: "explicit", address: OWNER },
		})
	})

	test("raw fields carry the reason, trim, and read small values as decimals; the row cap is the caller's", () => {
		const args = [TO, field(500n)]
		expect(callSurface(ctx, { name: "claim", args }, { kind: "undecoded", reason: "arguments" })).toEqual({
			kind: "raw",
			reason: "arguments",
			rows: [
				{ kind: "field", short: trimAddress(TO, 10, 6), full: TO, decimal: undefined },
				{ kind: "field", short: trimAddress(field(500n), 10, 6), full: field(500n), decimal: "500" },
			],
			hidden: 0,
		})
		const many = Array.from({ length: 40 }, (_, i) => field(BigInt(i)))
		expect(callSurface(ctx, { args: many }, { kind: "undecoded", reason: "arguments" })).toMatchObject({ hidden: 8 })
		expect(callSurface(ctx, { args: many }, { kind: "undecoded", reason: "arguments" }, false, Number.POSITIVE_INFINITY)).toMatchObject(
			{ hidden: 0 },
		)
	})

	test("callName prefers the ABI's name once decoded, sanitizes it, and keeps protocol labels on their contract", () => {
		const call = { name: "claim_lie", to: TO, selector: "0x11223344", args: [] }
		expect(callName(call, { kind: "pending" })).toBe(callName({ name: "claim_lie", to: TO, args: [] }, { kind: "pending" }))
		expect(callName(call, { kind: "decoded", fn: "claim_private", params: [] })).not.toContain("lie")
		expect(callName(call, { kind: "decoded", fn: `claim${RLO}_private`, params: [] })).not.toContain(RLO)
		expect(callName(call, { kind: "decoded", fn: "x".repeat(200), params: [] }).length).toBeLessThan(80)
		// A third-party `claim` is not the fee-juice claim, decoded or app-named.
		expect(callName({ name: "claim", to: TO, args: [] }, { kind: "pending" })).toBe("Claim")
		expect(callName(call, { kind: "decoded", fn: "claim", params: [] })).toBe("Claim")
	})
})

describe("rawRows, tokenAt, amountLabel, valueText, valueTitle", () => {
	test("rows cap at 32 by default and count the rest; text is sanitized; objects without toString are opaque", () => {
		const { rows, hidden } = rawRows([...Array.from({ length: 33 }, (_, i) => field(BigInt(i))), "x"])
		expect(rows).toHaveLength(32)
		expect(hidden).toBe(2)
		expect(rawRows([`a${RLO}b`, {}]).rows).toEqual([{ kind: "text", value: "ab" }, { kind: "opaque" }])
	})

	test("tokenAt matches contract and chain case-blind", () => {
		expect(tokenAt([USDC], 1, TOKEN.toUpperCase().replace("0X", "0x"))).toBe(USDC)
		expect(tokenAt([USDC], 2, TOKEN)).toBeUndefined()
		expect(tokenAt(undefined, 1, TOKEN)).toBeUndefined()
	})

	test("an amount carries the known token's units and symbol; an unknown contract or an empty symbol keeps the raw integer", () => {
		expect(amountLabel([USDC], 1, TOKEN, "5000000")).toEqual({ text: "5", symbol: "USDC" })
		expect(amountLabel([USDC], 1, TOKEN, "1500000")).toEqual({ text: "1.5", symbol: "USDC" })
		expect(amountLabel([USDC], 2, TOKEN, "5000000")).toEqual({ text: "5000000" })
		expect(amountLabel(undefined, 1, TOKEN, "7")).toEqual({ text: "7" })
		expect(amountLabel([{ ...USDC, symbol: BEL }], 1, TOKEN, "5000000")).toEqual({ text: "5000000" })
	})

	test("values read on one line; a long list is summarized inline and complete in the title", () => {
		expect(valueText({ kind: "integer", value: "5" })).toBe("5")
		expect(valueText({ kind: "boolean", value: false })).toBe("false")
		expect(valueText({ kind: "field", value: TO })).toBe(trimAddress(TO, 10, 6))
		expect(valueText({ kind: "address", value: TO })).toBe(trimAddress(TO))
		expect(valueText({ kind: "string", value: `hi${BEL}` })).toBe("hi")
		expect(valueText({ kind: "none" })).toBe("none")
		const ten: DecodedValue = {
			kind: "array",
			items: Array.from({ length: 10 }, (_, i) => ({ kind: "integer", value: String(i + 1) })),
		}
		expect(valueText(ten)).toBe("[1, 2, 3, 4, 5, 6, 7, 8, +2 more]")
		expect(valueTitle(ten)).toBe("[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]")
		const two: DecodedValue = { kind: "array", items: [{ kind: "integer", value: "1" }] }
		expect(valueTitle(two)).toBeUndefined()
		expect(valueTitle({ kind: "field", value: TO })).toBe(TO)
		expect(valueText({ kind: "struct", fields: [{ name: "a", value: { kind: "boolean", value: true } }] })).toBe("{ a: true }")
		expect(valueTitle({ kind: "struct", fields: [{ name: "list", value: ten }] })).toContain("10]")
	})
})
