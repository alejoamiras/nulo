import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import ListStatusMessage from "./ListStatusMessage.vue"

describe("ListStatusMessage", () => {
	test("defaults to the empty variant", () => {
		const w = mount(ListStatusMessage, { props: { headline: "NO TOKENS YET" } })
		expect(w.text()).toContain("NO TOKENS YET")
		expect(w.find("span").exists()).toBe(true)
	})

	test("renders the headline and sub as stacked spans", () => {
		const w = mount(ListStatusMessage, {
			props: { headline: "NO CONTACTS YET", sub: "Save the people you send to or receive from often." },
		})
		const spans = w.findAll("span")
		expect(spans).toHaveLength(2)
		expect(spans[0]?.text()).toBe("NO CONTACTS YET")
		expect(spans[1]?.text()).toBe("Save the people you send to or receive from often.")
	})

	test("omits the sub span when sub is not passed", () => {
		const w = mount(ListStatusMessage, { props: { headline: "NO NOTES YET" } })
		expect(w.findAll("span")).toHaveLength(1)
	})

	test("forwards testid as data-testid on the empty root", () => {
		const w = mount(ListStatusMessage, { props: { headline: "NO CONTACTS YET", testid: "contacts-empty" } })
		expect(w.find('[data-testid="contacts-empty"]').exists()).toBe(true)
	})

	test("renders NO data-testid attribute when testid is omitted", () => {
		const w = mount(ListStatusMessage, { props: { headline: "X" } })
		expect(w.find("div").attributes("data-testid")).toBeUndefined()
	})

	test("no-results variant renders the default search-miss copy", () => {
		const w = mount(ListStatusMessage, { props: { variant: "no-results" } })
		expect(w.text()).toBe("NO MATCHES · TRY A DIFFERENT TERM")
	})

	test("no-results variant renders slot content over the default copy", () => {
		const w = mount(ListStatusMessage, {
			props: { variant: "no-results" },
			slots: { default: "NOTHING FOUND" },
		})
		expect(w.text()).toBe("NOTHING FOUND")
	})

	test("no-results variant ignores headline/sub props", () => {
		const w = mount(ListStatusMessage, {
			props: { variant: "no-results", headline: "IGNORED", sub: "ALSO IGNORED" },
		})
		expect(w.text()).not.toContain("IGNORED")
	})

	test("no-results variant forwards testid", () => {
		const w = mount(ListStatusMessage, { props: { variant: "no-results", testid: "search-miss" } })
		expect(w.find('[data-testid="search-miss"]').exists()).toBe(true)
	})

	test("empty variant does not render the slot", () => {
		const w = mount(ListStatusMessage, {
			props: { headline: "NO SENDERS YET" },
			slots: { default: "SLOT LEAKED" },
		})
		expect(w.text()).not.toContain("SLOT LEAKED")
	})

	test("variant switch swaps the rendered block", async () => {
		const w = mount(ListStatusMessage, { props: { variant: "empty", headline: "H" } })
		expect(w.findAll("span")).toHaveLength(1)
		await w.setProps({ variant: "no-results" })
		expect(w.findAll("span")).toHaveLength(0)
		expect(w.text()).toBe("NO MATCHES · TRY A DIFFERENT TERM")
	})
})
