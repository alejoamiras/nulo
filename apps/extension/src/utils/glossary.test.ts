import { describe, expect, test } from "vitest"
import { GLOSSARY, GLOSSARY_SECTIONS } from "./glossary"

// The design spec's nine entries, word for word, in its section order.
const SPEC = [
	["Balances", "private-balance", "Private balance", "Only you can see it. Marked with a padlock.", "Home · tokens · send"],
	[
		"Balances",
		"public-balance",
		"Public balance",
		"Anyone can see it, like a balance on Ethereum. Marked with a globe.",
		"Home · tokens · send",
	],
	["Fees", "fee-juice", "Fee Juice", "The token that pays network fees on Aztec. Shown as FJ.", "Home · fee card"],
	["Fees", "public-fee-juice", "Public Fee Juice", "Paying a fee with it shows your address.", "Home · fee menu"],
	["Fees", "private-fee-juice", "Private Fee Juice", "Paying a fee with it keeps your address hidden.", "Home · fee menu"],
	["Fees", "sponsored", "Sponsored", "Someone else pays the network fee for you.", "Fee menu"],
	[
		"Apps",
		"authorization",
		"Authorization",
		"Lets a contract do one specific thing for you, once.",
		"Permission window · approval window",
	],
	["Apps", "name-for-this-app", "Name for this app", "A private name for this account visible only to this app.", "Permission window"],
	[
		"Transactions",
		"proving",
		"Proving",
		"Your device builds a proof that the transaction is valid without revealing what's in it. It's the slow step before sending.",
		"History · Settings",
	],
] as const

describe("glossary", () => {
	test("the nine entries are the spec's strings", () => {
		const entries = Object.fromEntries(SPEC.map(([, key, term, definition, where]) => [key, { term, definition, where }]))
		expect(GLOSSARY).toEqual(entries)
	})

	test("the sections are the spec's, in its order", () => {
		const flat = GLOSSARY_SECTIONS.flatMap((s) => s.keys.map((key) => [s.title, key]))
		expect(flat).toEqual(SPEC.map(([title, key]) => [title, key]))
	})

	test("every key sits in exactly one section, and the sections cover every key", () => {
		const listed = GLOSSARY_SECTIONS.flatMap((s) => s.keys)
		expect(new Set(listed).size).toBe(listed.length)
		expect([...listed].sort()).toEqual(Object.keys(GLOSSARY).sort())
	})
})
