import { describe, expect, test } from "vitest"
import { effectiveGrants, enforceScope } from "@nulo/wallet-bridge"
import { buildDetailsTable, type DetailsRow } from "./details-table"

// Wire-shaped: 0x + 64 hex, each value below the field modulus.
const FEE_JUICE = `0x${"0".repeat(63)}3`
const TOKEN = `0x${"1b".repeat(32)}`
const A = `0x${"0a".repeat(32)}`
const B = `0x${"0b".repeat(32)}`
const KNOWN = [
	{ address: FEE_JUICE, name: "Fee Juice" },
	{ address: TOKEN, name: "Test USDC" },
]

const row = (fields: Partial<DetailsRow>): DetailsRow => ({ simulate: [], add: false, transact: [], ...fields })
const sim = (transactions?: unknown, utilities?: unknown) => ({
	type: "simulation",
	...(transactions ? { transactions: { scope: transactions } } : {}),
	...(utilities ? { utilities: { scope: utilities } } : {}),
})
const tx = (scope: unknown) => ({ type: "transaction", scope })
const register = (contracts: unknown) => ({ type: "contracts", contracts, canRegister: true })

describe("the Details table", () => {
	test("Simulate reads both simulation scopes, Add reads canRegister, Transact the transaction scope", () => {
		const table = buildDetailsTable(
			[
				sim([{ contract: A, function: "balance_of" }], [{ contract: B, function: "token_for" }]),
				register([B]),
				tx([{ contract: A, function: "burn" }]),
			],
			[],
		)
		expect(table.unknown).toEqual([
			row({ address: A, simulate: ["balance_of"], transact: ["burn"] }),
			row({ address: B, simulate: ["token_for"], add: true }),
		])
		expect(table.known).toEqual([])
		expect(table.anyContract).toBeNull()
	})

	test("a contract appears once, matched case-blind, each column's functions as sent and not repeated", () => {
		const upper = A.toUpperCase().replace("0X", "0x")
		const table = buildDetailsTable(
			[
				sim(
					[
						{ contract: A, function: "claim" },
						{ contract: upper, function: "claim" },
					],
					[{ contract: upper, function: "balance_of_public" }],
				),
				tx([{ contract: upper, function: "claim" }]),
			],
			[],
		)
		expect(table.unknown).toEqual([row({ address: A, simulate: ["claim", "balance_of_public"], transact: ["claim"] })])
		expect(table.label).toBe("1 contract")
	})

	test("the wallet's list alone names a contract, matched lower-cased, and named rows come first", () => {
		const table = buildDetailsTable(
			[
				tx([
					{ contract: A, function: "burn" },
					{ contract: TOKEN.toUpperCase().replace("0X", "0x"), function: "transfer" },
				]),
				sim([{ contract: FEE_JUICE, function: "claim" }]),
			],
			KNOWN,
		)
		expect(table.known).toEqual([
			row({ address: TOKEN.toUpperCase().replace("0X", "0x"), name: "Test USDC", transact: ["transfer"] }),
			row({ address: FEE_JUICE, name: "Fee Juice", simulate: ["claim"] }),
		])
		expect(table.unknown).toEqual([row({ address: A, transact: ["burn"] })])
		expect(table.label).toBe("3 contracts")
	})

	test("a scope on any contract adds one Any contract row beside the listed ones, and the label says so", () => {
		const table = buildDetailsTable([tx([{ contract: A, function: "claim_public" }]), sim("*"), register("*")], [])
		expect(table.unknown).toEqual([row({ address: A, transact: ["claim_public"] })])
		expect(table.anyContract).toEqual(row({ name: "Any contract", simulate: ["Any function"], add: true }))
		expect(table.label).toBe("any contract")
	})

	test("a pattern on any contract marks only its own column, with its function", () => {
		const table = buildDetailsTable([sim([{ contract: "*", function: "balance_of_private" }]), tx("*")], [])
		expect(table.anyContract).toEqual(row({ name: "Any contract", simulate: ["balance_of_private"], transact: ["Any function"] }))
		expect(table.known.length + table.unknown.length).toBe(0)
	})

	test("a listed contract with every function reads Any function", () => {
		const table = buildDetailsTable([tx([{ contract: B, function: "*" }])], [])
		expect(table.unknown).toEqual([row({ address: B, transact: ["Any function"] })])
	})

	test("the label counts listed contracts, singular and plural", () => {
		expect(buildDetailsTable([register([A])], []).label).toBe("1 contract")
		expect(buildDetailsTable([register([A, B, TOKEN])], []).label).toBe("3 contracts")
	})

	test("contract details, data, accounts and contract classes feed no column", () => {
		const table = buildDetailsTable(
			[
				{ type: "contracts", contracts: [A], canGetMetadata: true },
				{ type: "data", addressBook: true, privateEvents: { contracts: [B] } },
				{ type: "accounts", canGet: true, canCreateAuthWit: true, accounts: [] },
				{ type: "contractClasses", classes: [TOKEN], canGetMetadata: true },
			],
			KNOWN,
		)
		expect(table).toEqual({ known: [], unknown: [], anyContract: null, label: "0 contracts" })
	})

	test("an address-book request after Allow still lists every contract the app holds", () => {
		const held = [register([A]), tx([{ contract: FEE_JUICE, function: "claim" }])]
		const table = buildDetailsTable(effectiveGrants(held, [{ type: "data", addressBook: true }]), KNOWN)
		expect(table.known.map((r) => r.name)).toEqual(["Fee Juice"])
		expect(table.unknown.map((r) => r.address)).toEqual([A])
	})

	test("a type whose widening was declined keeps its held contracts listed", () => {
		// Held grants keep a type with a stored rejection; the echo list drops it, the table must not.
		const heldTx = tx([{ contract: B, function: "burn_private" }])
		const table = buildDetailsTable(effectiveGrants([heldTx], [{ type: "data", privateEvents: { contracts: "*" } }]), [])
		expect(table.unknown).toEqual([row({ address: B, transact: ["burn_private"] })])
	})

	test("an unreadable scope or pattern reads as any contract, never as less", () => {
		const table = buildDetailsTable([tx({ scope: "odd" }), sim([null, { contract: 7, function: "f" }, { contract: A }])], [])
		expect(table.anyContract).toEqual(row({ name: "Any contract", simulate: ["Any function", "f"], transact: ["Any function"] }))
		expect(table.unknown).toEqual([row({ address: A, simulate: ["Any function"] })])
	})
})

describe("the Details table and the scope check", () => {
	const UPPER = `0x${A.slice(2).toUpperCase()}`
	const MIXED = `0x${A.slice(2, 34).toUpperCase()}${A.slice(34)}`
	const SPELLINGS = [A, UPPER, MIXED, B]
	const NOT_AN_ADDRESS = "0xTok"
	const checkPasses = (scoped: string, called: string): boolean => {
		const grants = [{ capability: { type: "transaction" as const, scope: [{ contract: scoped, function: "f" }] }, grantedAt: 1 }]
		try {
			enforceScope("sendTx", [{ calls: [{ to: called, name: "f" }] }], grants)
			return true
		} catch {
			return false
		}
	}

	test("two valid spellings share a row exactly when the check lets a scope of one reach the other", () => {
		expect([new Set(SPELLINGS).size, new Set(SPELLINGS.map((s) => s.toLowerCase())).size]).toEqual([4, 2])
		const table = buildDetailsTable([tx(SPELLINGS.map((contract, i) => ({ contract, function: `f${i}` })))], [])
		const rowOf = (i: number) => table.unknown.find((r) => r.transact.includes(`f${i}`))
		for (const [i, scoped] of SPELLINGS.entries()) {
			for (const [j, called] of SPELLINGS.entries()) {
				expect(rowOf(i) === rowOf(j), `${scoped} → ${called}`).toBe(checkPasses(scoped, called))
			}
		}
	})

	test("a held value that is not an address keeps its lower-cased row, and the check refuses it everywhere", () => {
		const table = buildDetailsTable(
			[
				tx([
					{ contract: NOT_AN_ADDRESS, function: "a" },
					{ contract: "0xtok", function: "b" },
				]),
			],
			[],
		)
		expect(table.unknown).toEqual([row({ address: NOT_AN_ADDRESS, transact: ["a", "b"] })])
		for (const other of [NOT_AN_ADDRESS, ...SPELLINGS]) {
			expect(checkPasses(NOT_AN_ADDRESS, other), `scope ${NOT_AN_ADDRESS} → ${other}`).toBe(false)
			expect(checkPasses(other, NOT_AN_ADDRESS), `scope ${other} → ${NOT_AN_ADDRESS}`).toBe(false)
		}
	})
})
