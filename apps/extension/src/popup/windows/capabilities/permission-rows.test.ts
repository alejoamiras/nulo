import { describe, expect, test } from "vitest"
import type { ContractsCapability, SimulationCapability, TransactionCapability } from "@nulo/wallet-bridge"
import {
	accountAddressRow,
	addressBookRow,
	authorizationsDefault,
	authorizationsRow,
	consentLostOnWidening,
	contractClassesRow,
	contractsRow,
	holdsCallScope,
	isBroadRequest,
	type PermissionRowEntry,
	plainText,
	privateEventsDefault,
	privateEventsRow,
	simulationRow,
	transactionRow,
	unknownRow,
} from "./permission-rows"

const A = `0x${"0a".repeat(32)}`
const B = `0x${"0b".repeat(32)}`
const GROUP_WORDS = { "without-asking": "Without asking", "if-you-allow": "If you allow", "always-asks": "Always asks you first" }

/** A row as the design's row list prints it: group, title (with its chip), and the line under it. */
function cells(row: PermissionRowEntry): [string, string, string] {
	const title = row.chip ? `${row.title} · ${row.chip}` : row.title
	const on = plainText(row.subOn)
	const off = plainText(row.subOff ?? row.subOn)
	const line = on === off ? on || "—" : `On: ${on} · Off: ${off}`
	return [GROUP_WORDS[row.group], title, line]
}

const sim = (transactions?: unknown, utilities?: unknown) =>
	({
		type: "simulation",
		...(transactions ? { transactions: { scope: transactions } } : {}),
		...(utilities ? { utilities: { scope: utilities } } : {}),
	}) as SimulationCapability
const tx = (scope: unknown) => ({ type: "transaction", scope }) as TransactionCapability
const accounts = (canCreateAuthWit: boolean) => ({ type: "accounts", canGet: true, canCreateAuthWit })
const listed = [{ contract: A, function: "transfer" }]

describe("the row list, row by row", () => {
	test("one account's address", () => {
		expect(cells(accountAddressRow(["Account 1"]))).toEqual(["Without asking", "See Account 1's address", "—"])
	})

	test("several accounts, and none selected, name no account", () => {
		const row = ["Without asking", "See the addresses of the accounts you share", "—"]
		expect(cells(accountAddressRow(["Account 1", "Account 2"]))).toEqual(row)
		expect(cells(accountAddressRow([]))).toEqual(row)
	})

	test("simulations on listed contracts", () => {
		expect(cells(simulationRow(sim(listed, listed)))).toEqual([
			"Without asking",
			"Run simulations and read the results",
			"Results can include your private balances.",
		])
	})

	test("simulations on any contract, from either sub-scope, carry the chip and the flag", () => {
		const expected = ["Without asking", "Run simulations on any contract · Any contract", "Results can include your private balances."]
		expect(cells(simulationRow(sim("*", listed)))).toEqual(expected)
		expect(cells(simulationRow(sim(listed, "*")))).toEqual(expected)
		expect(cells(simulationRow(sim([{ contract: "*", function: "f" }])))).toEqual(expected)
		expect(simulationRow(sim(undefined, "*")).flagged).toBe(true)
		expect(simulationRow(sim(listed)).flagged).toBe(false)
	})

	test("adding listed contracts, and any contract", () => {
		expect(cells(contractsRow({ type: "contracts", contracts: [A], canRegister: true })!)).toEqual([
			"Without asking",
			"Add contracts to your wallet",
			"—",
		])
		const any = contractsRow({ type: "contracts", contracts: "*", canRegister: true })!
		expect(cells(any)).toEqual(["Without asking", "Add any contract to your wallet · Any contract", "—"])
		expect(any.flagged).toBe(true)
	})

	test("contract details only, and a request with both flags shows only the add row", () => {
		const details = contractsRow({ type: "contracts", contracts: "*", canGetMetadata: true })!
		expect(details.key).toBe("contract-details")
		expect(cells(details)).toEqual(["Without asking", "See details of contracts in your wallet", "—"])
		const both: ContractsCapability = { type: "contracts", contracts: [A], canRegister: true, canGetMetadata: true }
		expect(contractsRow(both)?.key).toBe("contracts")
		expect(contractsRow({ type: "contracts", contracts: [A] })).toBeUndefined()
	})

	test("contract classes name the network", () => {
		expect(cells(contractClassesRow("Testnet"))).toEqual([
			"Without asking",
			"Look up contract code on Testnet",
			"Public information any node can give it.",
		])
	})

	test("authorizations, with the B lines and their switch", () => {
		const row = authorizationsRow({ broad: false, noScope: false })
		expect(cells(row)).toEqual([
			"If you allow",
			"Act for you in transactions you approve",
			"On: Nulo signs its authorizations without asking. · Off: You confirm each authorization first.",
		])
		expect(row.switchLabel).toBe("Authorizations without asking")
		expect(row.icon).toBe("signature")
		expect(row.flagged).toBe(false)
	})

	test("the dotted word is the only term segment of the authorizations lines", () => {
		const row = authorizationsRow({ broad: false, noScope: false })
		expect(row.subOn).toEqual([{ text: "Nulo signs its " }, { term: "authorizations" }, { text: " without asking." }])
		expect(row.subOff).toEqual([{ text: "You confirm each " }, { term: "authorization" }, { text: " first." }])
	})

	test("authorizations on a broad request: flagged, no chip, the broad lines", () => {
		const row = authorizationsRow({ broad: true, noScope: false })
		expect(plainText(row.subOn)).toBe("For any call, on any contract.")
		expect(plainText(row.subOff)).toBe("You confirm each authorization first. Off because it listed any contract.")
		expect(row.flagged).toBe(true)
		expect(row.chip).toBeUndefined()
	})

	test("authorizations with no transaction or simulation scope always ask: no switch, the off line", () => {
		const row = authorizationsRow({ broad: false, noScope: true })
		expect(cells(row)).toEqual([
			"Always asks you first",
			"Act for you in transactions you approve",
			"You confirm each authorization first.",
		])
		expect(row.switchLabel).toBeUndefined()
	})

	test("the address book", () => {
		const row = addressBookRow({ broadRequest: false })
		expect(cells(row)).toEqual([
			"If you allow",
			"See your address book",
			"On: Every name and address you saved. · Off: Not shared. The app may ask again later.",
		])
		expect(row.switchLabel).toBe("Share address book")
		expect(row.icon).toBe("contacts")
	})

	test("private events from listed contracts", () => {
		const row = privateEventsRow([A])
		expect(cells(row)).toEqual([
			"If you allow",
			"See private events from its contracts",
			"On: Private messages its contracts sent to your accounts, like a transfer you received. · Off: Not shared. The app may ask again later.",
		])
		expect(row.switchLabel).toBe("Share private events")
		expect(row.icon).toBe("mail_lock")
		expect(row.flagged).toBe(false)
	})

	test("private events from any contract: the chip, the flag and the listed row's lines", () => {
		const row = privateEventsRow("*")
		expect(cells(row).slice(0, 2)).toEqual(["If you allow", "See private events from any contract · Any contract"])
		expect(cells(row)[2]).toBe(cells(privateEventsRow([A]))[2])
		expect(row.flagged).toBe(true)
	})

	test("unknown permissions, singular and plural", () => {
		expect(cells(unknownRow(1, { broadRequest: false }))).toEqual([
			"If you allow",
			"Use 1 permission Nulo doesn't recognize",
			"Nulo can't tell you what it allows.",
		])
		expect(unknownRow(2, { broadRequest: false }).title).toBe("Use 2 permissions Nulo doesn't recognize")
		expect(unknownRow(1, { broadRequest: false }).switchLabel).toBe("Unknown permission")
	})

	test("transactions on listed contracts, and on any contract", () => {
		expect(cells(transactionRow(tx(listed)))).toEqual(["Always asks you first", "Every transaction", "—"])
		expect(cells(transactionRow(tx("*")))).toEqual(["Always asks you first", "Every transaction, on any contract", "—"])
	})

	test("the address book and unknown rows are flagged only in a broad request", () => {
		expect(addressBookRow({ broadRequest: true }).flagged).toBe(true)
		expect(unknownRow(1, { broadRequest: true }).flagged).toBe(true)
		expect(isBroadRequest([tx("*")])).toBe(true)
		expect(isBroadRequest([sim(listed, "*")])).toBe(true)
		expect(isBroadRequest([tx(listed), sim(listed, listed)])).toBe(false)
	})
})

describe("defaults", () => {
	test("any contract defaults Off: authorizations on a first grant, and private events", () => {
		expect(authorizationsDefault({ firstGrant: true, consent: undefined, resulting: [accounts(true), tx("*")] })).toBe(false)
		expect(authorizationsDefault({ firstGrant: true, consent: undefined, resulting: [accounts(true), sim("*")] })).toBe(false)
		expect(privateEventsDefault("*")).toBe(false)
	})

	test("a first grant over listed scopes starts On, and utilities alone never make it broad", () => {
		expect(authorizationsDefault({ firstGrant: true, consent: undefined, resulting: [accounts(true), tx(listed)] })).toBe(true)
		expect(authorizationsDefault({ firstGrant: true, consent: undefined, resulting: [tx(listed), sim(undefined, "*")] })).toBe(true)
		expect(privateEventsDefault([A, B])).toBe(true)
	})

	test("a re-request starts from the snapshot's effective consent over the resulting grants", () => {
		const narrow = { broad: false }
		expect(authorizationsDefault({ firstGrant: false, consent: narrow, resulting: [tx(listed)] })).toBe(true)
		expect(authorizationsDefault({ firstGrant: false, consent: narrow, resulting: [tx("*")] })).toBe(false)
		expect(authorizationsDefault({ firstGrant: false, consent: { broad: true }, resulting: [tx("*")] })).toBe(true)
		expect(authorizationsDefault({ firstGrant: false, consent: undefined, resulting: [tx(listed)] })).toBe(false)
		expect(authorizationsDefault({ firstGrant: false, consent: "yes", resulting: [tx(listed)] })).toBe(false)
	})

	test("a narrow consent is asked about again only when the request widens to any contract", () => {
		const held = [accounts(true), tx(listed)]
		expect(consentLostOnWidening({ broad: false }, held, [accounts(true), tx("*")])).toBe(true)
		expect(consentLostOnWidening({ broad: false }, held, [accounts(true), tx([...listed, { contract: B, function: "*" }])])).toBe(false)
		expect(consentLostOnWidening({ broad: true }, held, [accounts(true), tx("*")])).toBe(false)
		expect(consentLostOnWidening(undefined, held, [accounts(true), tx("*")])).toBe(false)
		expect(consentLostOnWidening({ broad: false }, [accounts(false), tx(listed)], [accounts(false), tx("*")])).toBe(false)
	})

	test("a call scope is a transaction grant or simulated transactions, never utilities alone", () => {
		expect(holdsCallScope([tx(listed)])).toBe(true)
		expect(holdsCallScope([sim(listed)])).toBe(true)
		expect(holdsCallScope([sim(undefined, "*"), accounts(true)])).toBe(false)
		expect(holdsCallScope([])).toBe(false)
	})
})
