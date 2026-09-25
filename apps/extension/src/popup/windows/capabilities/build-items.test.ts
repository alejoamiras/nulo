import { describe, expect, test } from "vitest"
import type { Capability } from "@nulo/wallet-bridge"
import { buildCapabilityItems, buildGrant, type CapabilityWindowParams, currentLine, type UICapabilityItem } from "./build-items"

const A = `0x${"0a".repeat(32)}`
const B = `0x${"0b".repeat(32)}`
const cap = (value: object) => value as Capability
const accounts = (canCreateAuthWit: boolean) => cap({ type: "accounts", canGet: true, canCreateAuthWit })
const txAny = cap({ type: "transaction", scope: "*" })
const txListed = cap({ type: "transaction", scope: [{ contract: A, function: "transfer" }] })
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
		...overrides,
	}
}

function grant(items: UICapabilityItem[], p: CapabilityWindowParams, accountsSelected = true) {
	return buildGrant({ items, delta: p.delta, existingGrants: p.existingGrants, heldGrants: p.heldGrants, accountsSelected })
}

const byRow = (items: UICapabilityItem[], key: string) => items.filter((item) => item.rowKey === key)
const setSwitch = (items: UICapabilityItem[], key: string, on: boolean) => {
	for (const item of byRow(items, key)) if (item.isNew) item.selected = on
}

describe("the cards", () => {
	test("switchless cards are granted as requested and carry no switch", () => {
		const items = buildCapabilityItems(params({ delta: [txAny, contracts] }))
		expect(items.map((item) => [item.rowKey, item.switchLabel, item.selected])).toEqual([
			["transaction", undefined, true],
			["contracts", undefined, true],
		])
	})

	test("the authorizations card replaces the rider: the row's title, its switch, High", () => {
		const [item] = buildCapabilityItems(params({ delta: [accounts(true), txListed] }))
		expect(item).toMatchObject({
			rowKey: "authorizations",
			capId: "accounts",
			label: "Act for you in transactions you approve",
			switchLabel: "Authorizations without asking",
			isNew: true,
			selected: true,
			risk: "high",
		})
		expect(currentLine(item)).toBe("Nulo signs its authorizations without asking.")
		item.selected = false
		expect(currentLine(item)).toBe("You confirm each authorization first.")
	})

	test("any contract starts the authorizations switch Off, with the broad lines", () => {
		const [item] = buildCapabilityItems(params({ delta: [accounts(true), txAny] }))
		expect(item.selected).toBe(false)
		expect(currentLine(item)).toBe("You confirm each authorization first. Off because it listed any contract.")
		item.selected = true
		expect(currentLine(item)).toBe("For any call, on any contract.")
	})

	test("with no transaction or simulation scope the authorizations card has no switch and the off line", () => {
		const [item] = buildCapabilityItems(params({ delta: [accounts(true), contracts] }))
		expect(item.switchLabel).toBeUndefined()
		expect(currentLine(item)).toBe("You confirm each authorization first.")
	})

	test("accounts without canCreateAuthWit draw no card (the picker is their section)", () => {
		expect(buildCapabilityItems(params({ delta: [accounts(false), txListed] })).map((item) => item.rowKey)).toEqual(["transaction"])
	})

	test("a re-request starts from the snapshot's consent over the grants after Allow", () => {
		const held = [accounts(true), txListed]
		const on = buildCapabilityItems(
			params({ delta: [cap({ ...accounts(true), canGet: false })], heldGrants: held, consent: { broad: false } }),
		)
		expect(on[0].selected).toBe(true)
		const off = buildCapabilityItems(params({ delta: [cap({ ...accounts(true), canGet: false })], heldGrants: held }))
		expect(off[0].selected).toBe(false)
	})

	test("a narrow consent widened to any contract comes back as a new card, Off, broad", () => {
		const items = buildCapabilityItems(params({ delta: [txAny], heldGrants: [accounts(true), txListed], consent: { broad: false } }))
		expect(items[0]).toMatchObject({
			rowKey: "authorizations",
			isNew: true,
			selected: false,
			switchLabel: "Authorizations without asking",
		})
		expect(currentLine(items[0])).toBe("You confirm each authorization first. Off because it listed any contract.")
	})

	test("a widening to more listed contracts keeps a narrow consent and draws no authorizations card", () => {
		const wider = cap({
			type: "transaction",
			scope: [
				{ contract: A, function: "transfer" },
				{ contract: B, function: "*" },
			],
		})
		const items = buildCapabilityItems(params({ delta: [wider], heldGrants: [accounts(true), txListed], consent: { broad: false } }))
		expect(byRow(items, "authorizations")).toEqual([])
	})

	test("a membership-only widening shows the held card with its stored line and no switch", () => {
		const items = buildCapabilityItems(
			params({
				delta: [accounts(true)],
				heldGrants: [accounts(true), txListed],
				accountsMembershipOnly: true,
				consent: { broad: false },
			}),
		)
		expect(items[0]).toMatchObject({ rowKey: "authorizations", isNew: false })
		expect(items[0].switchLabel).toBeUndefined()
		expect(currentLine(items[0])).toBe("Nulo signs its authorizations without asking.")
	})

	test("data is two cards, each holding only its half; private events on any contract start Off", () => {
		const data = cap({ type: "data", addressBook: true, privateEvents: { contracts: "*" } })
		const items = buildCapabilityItems(params({ delta: [data] }))
		expect(items.map((item) => [item.rowKey, item.label, item.selected, item.capability])).toEqual([
			["address-book", "See your address book", true, { type: "data", addressBook: true }],
			["private-events", "See private events from any contract", false, { type: "data", privateEvents: { contracts: "*" } }],
		])
		expect(items.map(currentLine)).toEqual(["Every name and address you saved.", "Not shared. The app may ask again later."])
	})

	test("private events from listed contracts start On", () => {
		const data = cap({ type: "data", privateEvents: { contracts: [A] } })
		const [item] = buildCapabilityItems(params({ delta: [data] }))
		expect([item.label, item.selected, currentLine(item)]).toEqual([
			"See private events from its contracts",
			true,
			"Private messages its contracts sent to your accounts, like a transfer you received.",
		])
	})

	test("a held data half the request does not newly ask for sits in Already granted, from the held record", () => {
		const held = cap({ type: "data", addressBook: true, privateEvents: { contracts: [A] } })
		const asked = cap({ type: "data", addressBook: true, privateEvents: { contracts: "*" } })
		const items = buildCapabilityItems(
			params({ delta: [asked], existingGrants: [], heldGrants: [held], reRequested: new Set(["data"]) }),
		)
		expect(items.map((item) => [item.rowKey, item.isNew, item.reRequested])).toEqual([
			["private-events", true, true],
			["address-book", false, false],
		])
	})

	test("a held data record draws one card per half, never a second copy from existingGrants", () => {
		const held = cap({ type: "data", addressBook: true, privateEvents: { contracts: [A] } })
		const items = buildCapabilityItems(params({ delta: [txAny], existingGrants: [held], heldGrants: [held] }))
		expect(items.filter((item) => !item.isNew).map((item) => [item.rowKey, item.label])).toEqual([
			["address-book", "See your address book"],
			["private-events", "See private events from its contracts"],
		])
	})

	test("unknown types are one card, Off, with the constant label and the switch", () => {
		const items = buildCapabilityItems(params({ delta: [unknownA, txListed, unknownB] }))
		const [unknown] = byRow(items, "unknown")
		expect(unknown).toMatchObject({
			label: "Unknown permission",
			isUnknown: true,
			selected: false,
			switchLabel: "Unknown permission",
			risk: "high",
			panelCapabilities: [unknownA, unknownB],
		})
		expect(unknown.capId).toBeUndefined()
		expect(unknown.description).toMatch(/doesn't recognize/)
	})

	test("an unknown type already granted keeps its read-only card and the constant label", () => {
		const [item] = buildCapabilityItems(params({ existingGrants: [unknownA] }))
		expect([item.label, item.isNew, item.isUnknown, item.capId]).toEqual(["Unknown permission", false, true, "experimental_v2"])
	})
})

describe("the grant", () => {
	test("switchless cards go as requested, and existing grants of other types are echoed", () => {
		const p = params({ delta: [txAny, contracts], existingGrants: [txListed] })
		expect(grant(buildCapabilityItems(p), p)).toEqual({ granted: [txAny, contracts], rejected: [] })
	})

	test("canCreateAuthWit is granted as requested with the switch Off; the switch rides beside it", () => {
		const p = params({ delta: [accounts(true), txListed] })
		const items = buildCapabilityItems(p)
		setSwitch(items, "authorizations", false)
		expect(grant(items, p)).toEqual({ granted: [accounts(true), txListed], rejected: [], authorizationsWithoutAsking: false })
		setSwitch(items, "authorizations", true)
		expect(grant(items, p).authorizationsWithoutAsking).toBe(true)
	})

	test("no switch shown, no switch value sent: no scope, and a membership-only widening", () => {
		const noScope = params({ delta: [accounts(true), contracts] })
		expect(grant(buildCapabilityItems(noScope), noScope)).not.toHaveProperty("authorizationsWithoutAsking")
		const membership = params({ delta: [accounts(true)], heldGrants: [accounts(true), txListed], accountsMembershipOnly: true })
		expect(grant(buildCapabilityItems(membership), membership)).toEqual({ granted: [accounts(true)], rejected: [] })
	})

	test("the widened consent's card sends its switch although accounts are not asked for", () => {
		const p = params({ delta: [txAny], heldGrants: [accounts(true), txListed], consent: { broad: false } })
		expect(grant(buildCapabilityItems(p), p)).toEqual({ granted: [txAny], rejected: [], authorizationsWithoutAsking: false })
	})

	test("accounts go only once the picker has a selection", () => {
		const p = params({ delta: [accounts(false)] })
		expect(grant(buildCapabilityItems(p), p, false)).toEqual({ granted: [], rejected: ["accounts"] })
	})

	test("unknown types are granted all or none", () => {
		const p = params({ delta: [unknownA, unknownB] })
		const items = buildCapabilityItems(p)
		expect(grant(items, p)).toEqual({ granted: [], rejected: ["experimental_v2", "experimental_v3"] })
		setSwitch(items, "unknown", true)
		expect(grant(items, p)).toEqual({ granted: [unknownA, unknownB], rejected: [] })
	})

	test("a first data grant with both rows Off is rejected; never a data grant with neither field", () => {
		const p = params({ delta: [cap({ type: "data", addressBook: true, privateEvents: { contracts: [A] } })] })
		const items = buildCapabilityItems(p)
		setSwitch(items, "address-book", false)
		setSwitch(items, "private-events", false)
		expect(grant(items, p)).toEqual({ granted: [], rejected: ["data"] })
	})

	test("a first data grant sends only the halves left On", () => {
		const p = params({ delta: [cap({ type: "data", addressBook: true, privateEvents: { contracts: "*" } })] })
		const items = buildCapabilityItems(p)
		expect(grant(items, p)).toEqual({ granted: [{ type: "data", addressBook: true }], rejected: [] })
	})

	describe("a data record held with the address book and private events from A, asked for any contract", () => {
		const held = cap({ type: "data", addressBook: true, privateEvents: { contracts: [A] } })
		const asked = cap({ type: "data", addressBook: true, privateEvents: { contracts: "*" } })
		const p = params({ delta: [asked], existingGrants: [held], heldGrants: [held] })

		test("private events left Off: the type is rejected and the held record stays", () => {
			expect(grant(buildCapabilityItems(p), p)).toEqual({ granted: [], rejected: ["data"] })
		})

		test("private events On: the address book kept, private events from any contract", () => {
			const items = buildCapabilityItems(p)
			setSwitch(items, "private-events", true)
			expect(grant(items, p)).toEqual({
				granted: [{ type: "data", addressBook: true, privateEvents: { contracts: "*" } }],
				rejected: [],
			})
		})
	})

	describe("a data record held with private events from A, asked for the address book and A and B", () => {
		const held = cap({ type: "data", privateEvents: { contracts: [A] } })
		const p = params({
			delta: [cap({ type: "data", addressBook: true, privateEvents: { contracts: [A, B] } })],
			existingGrants: [held],
			heldGrants: [held],
		})
		const decide = (book: boolean, events: boolean) => {
			const items = buildCapabilityItems(p)
			setSwitch(items, "address-book", book)
			setSwitch(items, "private-events", events)
			return grant(items, p)
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
