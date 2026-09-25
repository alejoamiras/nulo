import { MaterialIcon, RowAction } from "@nulo/design"
import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import DetailsTable from "./DetailsTable.vue"

// Wire-shaped: 0x + 64 hex, each value below the field modulus.
const TOKEN = `0x0c1e${"0".repeat(56)}5a7f`
const DRIP = `0x0643${"1".repeat(56)}15fd`
const FEE_JUICE = `0x${"0".repeat(63)}5`

const feeJuice = { address: FEE_JUICE, name: "Fee Juice", simulate: ["claim", "balance_of_public"], add: false, transact: ["claim"] }
const token = { address: TOKEN, simulate: ["balance_of_public"], add: true, transact: ["transfer", "burn_public"] }
const drip = { address: DRIP, simulate: [], add: true, transact: ["drip_to_public"] }
const anyContract = { name: "Any contract", simulate: ["Any function"], add: false, transact: [] }

const mountTable = (props: Record<string, unknown> = {}) =>
	mount(DetailsTable, {
		props: { known: [feeJuice], unknown: [token, drip], anyContract: null, label: "3 contracts", ...props } as never,
		global: { components: { MaterialIcon, RowAction } },
	})

/** The compiled `<style module>` class names; a script-setup instance does not expose `$style`. */
const STYLE = (DetailsTable as unknown as { __cssModules: { $style: Record<string, string> } }).__cssModules.$style

const opened = async (props: Record<string, unknown> = {}) => {
	const w = mountTable(props)
	await w.find('[data-testid="cap-detail-toggle"]').trigger("click")
	return w
}
const targets = (w: ReturnType<typeof mountTable>) => w.findAll('[data-testid="cap-details-row"]')
const rowOf = (w: ReturnType<typeof mountTable>, i: number) => targets(w)[i].element.parentElement as HTMLElement
const fnLines = (w: ReturnType<typeof mountTable>) =>
	w
		.find('[data-testid="cap-details-fns"]')
		.findAll(`.${STYLE.fn}`)
		.map((line) => line.findAll("span").map((cell) => cell.text()))
/** What a screen reader says for the row: the text of the element its target is labelled by. */
const spoken = (w: ReturnType<typeof mountTable>, i: number) => w.find(`[id="${targets(w)[i].attributes("aria-labelledby")}"]`).text()

describe("composite/capabilities/DetailsTable", () => {
	test("a Details fold reading its label, closed until pressed", async () => {
		const w = mountTable()
		const toggle = w.find('[data-testid="cap-detail-toggle"]')
		expect(toggle.find("span").text()).toBe("Details · 3 contracts")
		expect(toggle.attributes("aria-expanded")).toBe("false")
		expect(targets(w)).toHaveLength(0)
		await toggle.trigger("click")
		expect(toggle.attributes("aria-expanded")).toBe("true")
		expect(targets(w)).toHaveLength(3)
	})

	test("the head, the sub-headers in order, and the any-contract row last under none", async () => {
		const w = await opened({ anyContract })
		expect(w.find(`.${STYLE.head}`).attributes("aria-hidden")).toBe("true")
		const lines = [...w.find(`.${STYLE.table}`).element.children].flatMap((el) => {
			if (el.classList.contains(STYLE.sub)) return [`# ${el.textContent}`]
			if (!el.classList.contains(STYLE.row)) return []
			return [(el.querySelector(`.${STYLE.name}`) ?? el.querySelector(`.${STYLE.address} > span`))?.textContent]
		})
		expect(lines).toEqual(["# Nulo knows", "Fee Juice", "# Nulo doesn't know", "0x0c1e…5a7f", "0x0643…15fd", "Any contract"])
	})

	test("no sub-header for an empty side", async () => {
		const w = await opened({ known: [], unknown: [token] })
		expect(w.findAll(`.${STYLE.sub}`).map((sub) => sub.text())).toEqual(["Nulo doesn't know"])
	})

	test("a check in each column that includes the contract, a dash in the others", async () => {
		const w = await opened()
		const marks = (i: number) =>
			[...rowOf(w, i).children]
				.filter((el) => el.classList.contains(STYLE.yes) || el.classList.contains(STYLE.no))
				.map((el) => (el.classList.contains(STYLE.yes) ? "check" : "dash"))
		expect(marks(0)).toEqual(["check", "dash", "check"])
		expect(marks(1)).toEqual(["check", "check", "check"])
		expect(marks(2)).toEqual(["dash", "check", "check"])
		expect(rowOf(w, 0).querySelector(`.${STYLE.yes}`)?.textContent).toBe("check")
	})

	test("a named row's target is named for what it lists, since the head is hidden", async () => {
		const w = await opened({ anyContract })
		expect(spoken(w, 0)).toBe("Fee Juice: simulate, transact")
		expect(spoken(w, 3)).toBe("Any contract: simulate")
	})

	test("an unknown row's target is named for what it lists too, after its address", async () => {
		const w = await opened()
		expect(spoken(w, 1)).toMatch(/^0x\S+: simulate, add, transact$/)
		expect(spoken(w, 2)).toMatch(/^0x\S+: add, transact$/)
	})

	test.todo("an unknown row's spoken address: which form of it is read out is the owner's call")

	test("a row opens on its native button and lists the functions the app sent", async () => {
		const w = await opened()
		const target = targets(w)[1]
		expect((target.element as HTMLButtonElement).type).toBe("button")
		for (const key of ["Enter", " "]) {
			const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
			target.element.dispatchEvent(event)
			expect(event.defaultPrevented).toBe(false)
		}
		expect(target.attributes("aria-expanded")).toBe("false")
		await target.trigger("click")
		expect(target.attributes("aria-expanded")).toBe("true")
		expect(fnLines(w)).toEqual([
			["Simulate", "balance_of_public"],
			["Transact", "transfer · burn_public"],
		])
		await target.trigger("click")
		expect(w.find('[data-testid="cap-details-fns"]').exists()).toBe(false)
	})

	test("an opened row shows only the lines it has functions for", async () => {
		const w = await opened()
		await targets(w)[2].trigger("click")
		expect(fnLines(w)).toEqual([["Transact", "drip_to_public"]])
	})

	test("an unknown contract shows its address's first six and last four characters", async () => {
		const w = await opened()
		expect(w.findAll(`.${STYLE.address}`).map((cell) => cell.find("span").text())).toEqual(["0x0c1e…5a7f", "0x0643…15fd"])
	})

	test("a named row shows its name, with no address and no copy button", async () => {
		const w = await opened()
		expect(rowOf(w, 0).querySelector(`.${STYLE.name}`)?.textContent).toBe("Fee Juice")
		expect(rowOf(w, 0).textContent).not.toContain("0x")
		expect(rowOf(w, 0).querySelector('[data-testid="cap-details-copy"]')).toBeNull()
	})

	test("copy emits the full address, leaves its row as it was, and is not a Tab stop", async () => {
		const w = await opened()
		const copy = w.findAll('[data-testid="cap-details-copy"]')[0]
		expect(copy.attributes("tabindex")).toBe("-1")
		expect(copy.attributes("aria-label")).toBe("Copy address")
		expect(copy.attributes("data-details-key")).toBe(targets(w)[1].attributes("data-details-key"))
		await copy.trigger("click")
		expect(w.emitted("copy")).toEqual([[TOKEN]])
		expect(targets(w)[1].attributes("aria-expanded")).toBe("false")
	})

	test("bidi and control characters in a function name and an address are stripped", async () => {
		const hostile = `0x0c1e‮${"0".repeat(56)}​5a7f`
		const w = await opened({ known: [], unknown: [{ address: hostile, simulate: ["bal‮ance\u0007_of"], add: false, transact: [] }] })
		expect(w.find(`.${STYLE.address}`).find("span").text()).toBe("0x0c1e…5a7f")
		await targets(w)[0].trigger("click")
		expect(w.find('[data-testid="cap-details-fns"]').text()).toContain("balance_of")
		await w.find('[data-testid="cap-details-copy"]').trigger("click")
		expect(w.emitted("copy")).toEqual([[TOKEN]])
	})

	test("the footnote says where the function names come from", async () => {
		const w = await opened()
		expect(w.find(`.${STYLE.foot}`).text()).toBe(
			"Function names come from the app. Anything it didn't list is refused instantly; you won't be asked.",
		)
	})
})
