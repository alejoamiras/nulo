import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import Glossary from "./glossary.vue"

const Shell = {
	props: ["title", "backTo"],
	template: '<div data-testid="shell" :data-title="title" :data-back="backTo"><slot /></div>',
}

const mountPage = () => mount(Glossary, { global: { stubs: { SettingsPageShell: Shell } } })

const text = (w: ReturnType<typeof mountPage>, testid: string) => w.get(`[data-testid="${testid}"]`).text()

describe("settings/glossary", () => {
	test("is a sub-page titled Glossary that goes back to Settings", () => {
		const shell = mountPage().get('[data-testid="shell"]')
		expect(shell.attributes("data-title")).toBe("Glossary")
		expect(shell.attributes("data-back")).toBe("/popup/settings")
	})

	test("lists the four sections in order, each with its entries in order", () => {
		const w = mountPage()
		const sections = w.findAll('[data-testid^="glossary-section-"]')
		expect(sections.map((s) => s.get("span").text())).toEqual(["Balances", "Fees", "Apps", "Transactions"])
		expect(sections.map((s) => s.findAll('[data-testid^="glossary-entry-"]').map((e) => e.attributes("data-testid")))).toEqual([
			["glossary-entry-private-balance", "glossary-entry-public-balance"],
			["glossary-entry-fee-juice", "glossary-entry-public-fee-juice", "glossary-entry-private-fee-juice", "glossary-entry-sponsored"],
			["glossary-entry-authorization", "glossary-entry-name-for-this-app"],
			["glossary-entry-proving"],
		])
	})

	test.each([
		["private-balance", "Private balance", "Only you can see it. Marked with a padlock.", "Home · tokens · send"],
		["public-balance", "Public balance", "Anyone can see it, like a balance on Ethereum. Marked with a globe.", "Home · tokens · send"],
		["fee-juice", "Fee Juice", "The token that pays network fees on Aztec. Shown as FJ.", "Home · fee card"],
		["public-fee-juice", "Public Fee Juice", "Paying a fee with it shows your address.", "Home · fee menu"],
		["private-fee-juice", "Private Fee Juice", "Paying a fee with it keeps your address hidden.", "Home · fee menu"],
		["sponsored", "Sponsored", "Someone else pays the network fee for you.", "Fee menu"],
		["authorization", "Authorization", "Lets a contract do one specific thing for you, once.", "Permission window · approval window"],
		["name-for-this-app", "Name for this app", "A private name for this account visible only to this app.", "Permission window"],
		[
			"proving",
			"Proving",
			"Your device builds a proof that the transaction is valid without revealing what's in it. It's the slow step before sending.",
			"History · Settings",
		],
	])("%s reads as the spec writes it", (key, term, definition, where) => {
		const w = mountPage()
		expect(text(w, `glossary-term-${key}`)).toBe(term)
		expect(text(w, `glossary-definition-${key}`)).toBe(definition)
		expect(text(w, `glossary-where-${key}`)).toBe(where)
	})
})
