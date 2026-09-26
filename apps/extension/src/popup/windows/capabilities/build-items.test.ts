import { describe, expect, test } from "vitest"
import type { Capability } from "@nulo/wallet-bridge"
import { buildCapabilityItems, buildGrant, type CapabilityWindowParams, currentLine, type WindowRow } from "./build-items"
import { plainText } from "./permission-rows"

const A = `0x${"0a".repeat(32)}`
const B = `0x${"0b".repeat(32)}`
const cap = (value: object) => value as Capability
const accounts = (canCreateAuthWit: boolean) => cap({ type: "accounts", canGet: true, canCreateAuthWit })
const txAny = cap({ type: "transaction", scope: "*" })
const txListed = cap({ type: "transaction", scope: [{ contract: A, function: "transfer" }] })
const simListed = cap({ type: "simulation", transactions: { scope: [{ contract: A, function: "transfer" }] } })
const contracts = cap({ type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true })
const unknownA = cap({ type: "experimental_v2" })
const unknownB = cap({ type: "experimental_v3" })

function params(overrides: Partial<CapabilityWindowParams>): CapabilityWindowParams {
	return {
		delta: [],
		existingGrants: [],
		heldGrants: [],
		reRequested: new Set(),
		accountsMembershipOnly: false,
		consent: undefined,
		networkName: "Testnet",
		heldAccounts: [],
		...overrides,
	}
}

function grant(rows: WindowRow[], p: CapabilityWindowParams, accountsSelected = true) {
	return buildGrant({ rows, delta: p.delta, existingGrants: p.existingGrants, heldGrants: p.heldGrants, accountsSelected })
}

const fresh = (rows: WindowRow[]) => rows.filter((row) => row.isNew)
const held = (rows: WindowRow[]) => rows.filter((row) => !row.isNew)
const keys = (rows: WindowRow[]) => rows.map((row) => row.entry.key)
const line = (row: WindowRow) => plainText(currentLine(row))
const newRow = (rows: WindowRow[], key: string) => {
	const found = fresh(rows).find((row) => row.entry.key === key)
	if (!found) throw new Error(`no new ${key} row`)
	return found
}
const setSwitch = (rows: WindowRow[], key: string, on: boolean) => {
	newRow(rows, key).selected = on
}

describe("the new rows", () => {
	test("switchless rows are granted as requested, carry no switch, and follow the row list's order", () => {
		const rows = buildCapabilityItems(params({ delta: [txAny, contracts, simListed] }))
		expect(rows.map((row) => [row.entry.key, row.entry.switchLabel, row.selected, row.isNew])).toEqual([
			["simulation", undefined, true, true],
			["contracts", undefined, true, true],
			["transaction", undefined, true, true],
		])
	})

	test("accounts give the address row and, with canCreateAuthWit, the authorizations row with its switch", () => {
		const rows = buildCapabilityItems(params({ delta: [accounts(true), txListed] }))
		expect(keys(rows)).toEqual(["account-address", "authorizations", "transaction"])
		const row = newRow(rows, "authorizations")
		expect(row).toMatchObject({ capId: "accounts", isNew: true, selected: true })
		expect(row.entry).toMatchObject({
			group: "if-you-allow",
			title: "Act for you in transactions you approve",
			switchLabel: "Authorizations without asking",
		})
		expect(line(row)).toBe("Nulo signs its authorizations without asking.")
		row.selected = false
		expect(line(row)).toBe("You confirm each authorization first.")
		expect(newRow(rows, "account-address")).toMatchObject({ capId: "accounts", selected: true })
	})

	test("accounts without canGet give no address row, and without canCreateAuthWit no authorizations row", () => {
		expect(keys(buildCapabilityItems(params({ delta: [cap({ ...accounts(true), canGet: false }), txListed] })))).toEqual([
			"authorizations",
			"transaction",
		])
		expect(keys(buildCapabilityItems(params({ delta: [accounts(false), txListed] })))).toEqual(["account-address", "transaction"])
	})

	test("any contract starts the authorizations switch Off, with the broad lines, flagged", () => {
		const row = newRow(buildCapabilityItems(params({ delta: [accounts(true), txAny] })), "authorizations")
		expect(row.selected).toBe(false)
		expect(row.entry.flagged).toBe(true)
		expect(line(row)).toBe("You confirm each authorization first. Off because it listed any contract.")
		row.selected = true
		expect(line(row)).toBe("For any call, on any contract.")
	})

	test("with no transaction or simulation scope the authorizations row always asks: no switch, the off line", () => {
		const row = newRow(buildCapabilityItems(params({ delta: [accounts(true), contracts] })), "authorizations")
		expect(row.entry.group).toBe("always-asks")
		expect(row.entry.switchLabel).toBeUndefined()
		expect(line(row)).toBe("You confirm each authorization first.")
	})

	test("contract classes name the dApp's network", () => {
		const [row] = buildCapabilityItems(params({ delta: [cap({ type: "contractClasses", classes: "*" })], networkName: "Sandbox" }))
		expect(row.entry.title).toBe("Look up contract code on Sandbox")
	})

	test("a contracts permission with neither flag draws no row", () => {
		expect(buildCapabilityItems(params({ delta: [cap({ type: "contracts", contracts: [A] })] }))).toEqual([])
	})

	test("a re-request starts from the snapshot's consent over the grants after Allow", () => {
		const heldGrants = [accounts(true), txListed]
		const delta = [cap({ ...accounts(true), canGet: false })]
		const on = buildCapabilityItems(params({ delta, heldGrants, consent: { broad: false } }))
		expect(newRow(on, "authorizations").selected).toBe(true)
		const off = buildCapabilityItems(params({ delta, heldGrants }))
		expect(newRow(off, "authorizations").selected).toBe(false)
	})

	test("a narrow consent widened to any contract comes back as a new row, Off, broad", () => {
		const rows = buildCapabilityItems(params({ delta: [txAny], heldGrants: [accounts(true), txListed], consent: { broad: false } }))
		expect(keys(fresh(rows))).toEqual(["authorizations", "transaction"])
		const row = newRow(rows, "authorizations")
		expect(row).toMatchObject({ capId: "accounts", selected: false })
		expect(row.entry).toMatchObject({ switchLabel: "Authorizations without asking", flagged: true })
		expect(line(row)).toBe("You confirm each authorization first. Off because it listed any contract.")
	})

	test("a widening to more listed contracts keeps a narrow consent: the authorizations row stays folded", () => {
		const wider = cap({
			type: "transaction",
			scope: [
				{ contract: A, function: "transfer" },
				{ contract: B, function: "*" },
			],
		})
		const rows = buildCapabilityItems(params({ delta: [wider], heldGrants: [accounts(true), txListed], consent: { broad: false } }))
		expect(keys(fresh(rows))).toEqual(["transaction"])
		expect(keys(held(rows))).toContain("authorizations")
	})

	test("a membership-only widening: only the address row is new, the authorizations row folds with its stored line", () => {
		const rows = buildCapabilityItems(
			params({
				delta: [accounts(true)],
				heldGrants: [accounts(true), txListed],
				accountsMembershipOnly: true,
				consent: { broad: false },
			}),
		)
		expect(keys(fresh(rows))).toEqual(["account-address"])
		const folded = held(rows).find((row) => row.entry.key === "authorizations")!
		expect(folded.entry.switchLabel).toBeUndefined()
		expect(line(folded)).toBe("Nulo signs its authorizations without asking.")
	})

	test("adding an account while the scopes widen to any contract brings the narrow consent back, Off", () => {
		const heldGrants = [accounts(true), txListed]
		const p = params({
			delta: [txAny, accounts(true)],
			existingGrants: heldGrants,
			heldGrants,
			accountsMembershipOnly: true,
			consent: { broad: false },
		})
		const rows = buildCapabilityItems(p)
		expect(keys(fresh(rows))).toEqual(["account-address", "authorizations", "transaction"])
		const row = newRow(rows, "authorizations")
		expect(row).toMatchObject({ selected: false })
		expect(line(row)).toBe("You confirm each authorization first. Off because it listed any contract.")
		expect(grant(rows, p)).toEqual({ granted: [txAny, accounts(true)], rejected: [], authorizationsWithoutAsking: false })
	})

	test("data is two rows; private events on any contract start Off", () => {
		const data = cap({ type: "data", addressBook: true, privateEvents: { contracts: "*" } })
		const rows = buildCapabilityItems(params({ delta: [data] }))
		expect(rows.map((row) => [row.entry.key, row.entry.title, row.selected, row.capId])).toEqual([
			["address-book", "See your address book", true, "data"],
			["private-events", "See private events from any contract", false, "data"],
		])
		expect(rows.map(line)).toEqual(["Every name and address you saved.", "Not shared. The app may ask again later."])
	})

	test("private events from listed contracts start On", () => {
		const [row] = buildCapabilityItems(params({ delta: [cap({ type: "data", privateEvents: { contracts: [A] } })] }))
		expect([row.entry.title, row.selected, line(row)]).toEqual([
			"See private events from its contracts",
			true,
			"Private messages its contracts sent to your accounts, like a transfer you received.",
		])
	})

	test("the address book and unknown rows are flagged when the grants after Allow reach any contract", () => {
		const data = cap({ type: "data", addressBook: true })
		const broad = buildCapabilityItems(params({ delta: [data, unknownA], heldGrants: [txAny] }))
		expect(fresh(broad).map((row) => [row.entry.key, row.entry.flagged])).toEqual([
			["address-book", true],
			["unknown", true],
		])
		const listed = buildCapabilityItems(params({ delta: [data, unknownA], heldGrants: [txListed] }))
		expect(fresh(listed).map((row) => row.entry.flagged)).toEqual([false, false])
	})

	test("unknown types are one row, Off, with the counted title, its switch and no type of its own", () => {
		const rows = buildCapabilityItems(params({ delta: [unknownA, txListed, unknownB], reRequested: new Set(["experimental_v3"]) }))
		const row = newRow(rows, "unknown")
		expect(row).toMatchObject({ selected: false, reRequested: true })
		expect(row.entry).toMatchObject({ title: "Use 2 permissions Nulo doesn't recognize", switchLabel: "Unknown permission" })
		expect(row.capId).toBeUndefined()
		expect(line(row)).toBe("Nulo can't tell you what it allows.")
	})

	test("the re-requested mark sits on each new row of a type with a stored rejection", () => {
		const data = cap({ type: "data", addressBook: true, privateEvents: { contracts: [A] } })
		const rows = buildCapabilityItems(params({ delta: [data, txListed], reRequested: new Set(["data"]) }))
		expect(rows.map((row) => [row.entry.key, row.reRequested])).toEqual([
			["address-book", true],
			["private-events", true],
			["transaction", false],
		])
	})
})

describe("the held rows", () => {
	const toolsApp = [accounts(true), simListed, cap({ type: "contracts", contracts: [A], canRegister: true }), txListed]

	test("every stored grant folds, read-only, in the row list's order: four permissions, five rows", () => {
		const rows = buildCapabilityItems(
			params({
				delta: [cap({ type: "data", addressBook: true })],
				heldGrants: toolsApp,
				consent: { broad: false },
				heldAccounts: [{ name: "Account 1" }],
			}),
		)
		expect(keys(fresh(rows))).toEqual(["address-book"])
		expect(held(rows).map((row) => [row.entry.key, row.entry.title, line(row)])).toEqual([
			["account-address", "See Account 1's address", ""],
			["simulation", "Run simulations and read the results", "Results can include your private balances."],
			["contracts", "Add contracts to your wallet", ""],
			["authorizations", "Act for you in transactions you approve", "Nulo signs its authorizations without asking."],
			["transaction", "Every transaction", ""],
		])
		expect(held(rows).every((row) => row.entry.switchLabel === undefined && row.selected && !row.reRequested)).toBe(true)
	})

	test("the folded address row names the session's accounts by their wallet names", () => {
		const shown = (heldAccounts: CapabilityWindowParams["heldAccounts"]) =>
			held(buildCapabilityItems(params({ heldGrants: [accounts(false)], heldAccounts })))[0].entry.title
		expect(shown([{ name: "Savings" }])).toBe("See Savings's address")
		expect(shown([{ name: "Account 1" }, { name: "Account 2" }])).toBe("See the addresses of the accounts you share")
		expect(shown([{}])).toBe("See the addresses of the accounts you share")
	})

	test("a held accounts grant without canGet folds no address row", () => {
		const rows = buildCapabilityItems(
			params({ heldGrants: [cap({ ...accounts(true), canGet: false }), txListed], heldAccounts: [{ name: "Account 1" }] }),
		)
		expect(keys(held(rows))).toEqual(["authorizations", "transaction"])
	})

	test("the folded authorizations row reads the snapshot's consent over the held grants", () => {
		const off = held(buildCapabilityItems(params({ heldGrants: [accounts(true), txListed] })))
		expect(line(off.find((row) => row.entry.key === "authorizations")!)).toBe("You confirm each authorization first.")
		const broad = held(buildCapabilityItems(params({ heldGrants: [accounts(true), txAny], consent: { broad: true } })))
		expect(line(broad.find((row) => row.entry.key === "authorizations")!)).toBe("For any call, on any contract.")
	})

	test("a held data half the request does not newly ask for folds, and so does the half it widens", () => {
		const heldData = cap({ type: "data", addressBook: true, privateEvents: { contracts: [A] } })
		const asked = cap({ type: "data", addressBook: true, privateEvents: { contracts: "*" } })
		const rows = buildCapabilityItems(params({ delta: [asked], heldGrants: [heldData], reRequested: new Set(["data"]) }))
		expect(rows.map((row) => [row.entry.key, row.entry.title, row.isNew, row.reRequested])).toEqual([
			["private-events", "See private events from any contract", true, true],
			["address-book", "See your address book", false, false],
			["private-events", "See private events from its contracts", false, false],
		])
	})

	test("the held rows come from every stored grant, never from the echo list", () => {
		const heldData = cap({ type: "data", addressBook: true, privateEvents: { contracts: [A] } })
		const rows = buildCapabilityItems(params({ delta: [txAny], existingGrants: [heldData, txListed], heldGrants: [heldData] }))
		expect(keys(held(rows))).toEqual(["address-book", "private-events"])
	})

	test("held unknown types fold as one unknown row", () => {
		const rows = buildCapabilityItems(params({ heldGrants: [unknownA, unknownB] }))
		expect(rows).toHaveLength(1)
		expect(rows[0].isNew).toBe(false)
		expect(rows[0].entry.title).toBe("Use 2 permissions Nulo doesn't recognize")
		expect(rows[0].capId).toBeUndefined()
	})
})

describe("the grant", () => {
	test("switchless rows go as requested, and existing grants of other types are echoed", () => {
		const p = params({ delta: [txAny, contracts], existingGrants: [txListed, simListed] })
		expect(grant(buildCapabilityItems(p), p)).toEqual({ granted: [txAny, contracts, simListed], rejected: [] })
	})

	test("canCreateAuthWit is granted as requested with the switch Off; the switch rides beside it", () => {
		const p = params({ delta: [accounts(true), txListed] })
		const rows = buildCapabilityItems(p)
		setSwitch(rows, "authorizations", false)
		expect(grant(rows, p)).toEqual({ granted: [accounts(true), txListed], rejected: [], authorizationsWithoutAsking: false })
		setSwitch(rows, "authorizations", true)
		expect(grant(rows, p).authorizationsWithoutAsking).toBe(true)
	})

	test("no switch shown, no switch value sent: no scope, and a membership-only widening", () => {
		const noScope = params({ delta: [accounts(true), contracts] })
		expect(grant(buildCapabilityItems(noScope), noScope)).not.toHaveProperty("authorizationsWithoutAsking")
		const membership = params({ delta: [accounts(true)], heldGrants: [accounts(true), txListed], accountsMembershipOnly: true })
		expect(grant(buildCapabilityItems(membership), membership)).toEqual({ granted: [accounts(true)], rejected: [] })
	})

	test("the widened consent's row sends its switch although accounts are not asked for", () => {
		const p = params({ delta: [txAny], heldGrants: [accounts(true), txListed], consent: { broad: false } })
		expect(grant(buildCapabilityItems(p), p)).toEqual({ granted: [txAny], rejected: [], authorizationsWithoutAsking: false })
	})

	test("accounts go only once the picker has a selection", () => {
		const p = params({ delta: [accounts(false)] })
		expect(grant(buildCapabilityItems(p), p, false)).toEqual({ granted: [], rejected: ["accounts"] })
	})

	test("unknown types are granted all or none", () => {
		const p = params({ delta: [unknownA, unknownB] })
		const rows = buildCapabilityItems(p)
		expect(grant(rows, p)).toEqual({ granted: [], rejected: ["experimental_v2", "experimental_v3"] })
		setSwitch(rows, "unknown", true)
		expect(grant(rows, p)).toEqual({ granted: [unknownA, unknownB], rejected: [] })
	})

	test("a first data grant with both rows Off is rejected; never a data grant with neither field", () => {
		const p = params({ delta: [cap({ type: "data", addressBook: true, privateEvents: { contracts: [A] } })] })
		const rows = buildCapabilityItems(p)
		setSwitch(rows, "address-book", false)
		setSwitch(rows, "private-events", false)
		expect(grant(rows, p)).toEqual({ granted: [], rejected: ["data"] })
	})

	test("a first data grant sends only the rows left On", () => {
		const p = params({ delta: [cap({ type: "data", addressBook: true, privateEvents: { contracts: "*" } })] })
		expect(grant(buildCapabilityItems(p), p)).toEqual({ granted: [{ type: "data", addressBook: true }], rejected: [] })
	})

	describe("a data record held with the address book and private events from A, asked for any contract", () => {
		const heldData = cap({ type: "data", addressBook: true, privateEvents: { contracts: [A] } })
		const asked = cap({ type: "data", addressBook: true, privateEvents: { contracts: "*" } })
		const p = params({ delta: [asked], existingGrants: [heldData], heldGrants: [heldData] })

		test("private events left Off: the type is rejected and the held record stays", () => {
			expect(grant(buildCapabilityItems(p), p)).toEqual({ granted: [], rejected: ["data"] })
		})

		test("private events On: the address book kept, private events from any contract", () => {
			const rows = buildCapabilityItems(p)
			setSwitch(rows, "private-events", true)
			expect(grant(rows, p)).toEqual({
				granted: [{ type: "data", addressBook: true, privateEvents: { contracts: "*" } }],
				rejected: [],
			})
		})
	})

	describe("a data record held with private events from A, asked for the address book and A and B", () => {
		const heldData = cap({ type: "data", privateEvents: { contracts: [A] } })
		const p = params({
			delta: [cap({ type: "data", addressBook: true, privateEvents: { contracts: [A, B] } })],
			existingGrants: [heldData],
			heldGrants: [heldData],
		})
		const decide = (book: boolean, events: boolean) => {
			const rows = buildCapabilityItems(p)
			setSwitch(rows, "address-book", book)
			setSwitch(rows, "private-events", events)
			return grant(rows, p)
		}

		test.each([
			[true, false, { type: "data", addressBook: true, privateEvents: { contracts: [A] } }],
			[false, true, { type: "data", privateEvents: { contracts: [A, B] } }],
			[true, true, { type: "data", addressBook: true, privateEvents: { contracts: [A, B] } }],
		])("address book %s, private events %s", (book, events, stored) => {
			expect(decide(book, events)).toEqual({ granted: [stored], rejected: [] })
		})

		test("both Off: the type is rejected", () => {
			expect(decide(false, false)).toEqual({ granted: [], rejected: ["data"] })
		})
	})
})
