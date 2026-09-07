import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import BarrierOverlay from "./BarrierOverlay.vue"

const stubs = {
	MaterialIcon: {
		props: ["name", "size", "color"],
		template: `<i data-testid="glyph" :data-name="name" :data-size="size" :data-color="color" />`,
	},
}

const mountOverlay = (props = {}, slots = {}) => mount(BarrierOverlay, { props, slots, global: { stubs } })

describe("BarrierOverlay", () => {
	test("lays the card out as glyph, title, sub, detail, then the parent's extra content", () => {
		const w = mountOverlay({}, { title: "BLOCKED", sub: "why", detail: "how", default: "<button data-testid='retry' />" })
		const card = w.element.firstElementChild
		expect(card?.children.length).toBe(5)
		expect(card?.children[0]?.getAttribute("data-testid")).toBe("glyph")
		expect(card?.children[1]?.textContent).toBe("BLOCKED")
		expect(card?.children[2]?.textContent).toBe("why")
		expect(card?.children[3]?.textContent).toBe("how")
		expect(card?.children[4]?.getAttribute("data-testid")).toBe("retry")
	})

	test("the root, sub and detail carry the testids the parent passes", () => {
		const w = mountOverlay(
			{ testid: "migration-blocked", subTestid: "blocked-copy", detailTestid: "migration-blocked-detail" },
			{ title: "T", sub: "S", detail: "D" },
		)
		expect(w.attributes("data-testid")).toBe("migration-blocked")
		expect(w.find("[data-testid='blocked-copy']").text()).toBe("S")
		expect(w.find("[data-testid='migration-blocked-detail']").text()).toBe("D")
	})

	test("testids that are not passed leave no attribute behind", () => {
		const w = mountOverlay({}, { title: "T", sub: "S", detail: "D" })
		expect(w.html()).not.toContain('data-testid="undefined"')
		expect(w.attributes("data-testid")).toBeUndefined()
	})

	test("the default glyph is the red warning icon", () => {
		const w = mountOverlay({}, { title: "T" })
		const glyph = w.find("[data-testid='glyph']")
		expect(glyph.attributes("data-name")).toBe("warning")
		expect(glyph.attributes("data-size")).toBe("24")
		expect(glyph.attributes("data-color")).toBe("--red")
	})

	test("the icon slot replaces the default glyph", () => {
		const w = mountOverlay({}, { title: "T", icon: "<i data-testid='spinner' />" })
		expect(w.find("[data-testid='spinner']").exists()).toBe(true)
		expect(w.find("[data-testid='glyph']").exists()).toBe(false)
	})

	test("no sub slot means no sub span", () => {
		const w = mountOverlay({}, { title: "T" })
		expect(w.findAll("span")).toHaveLength(1)
	})

	test("a detail slot that renders empty still produces its span", () => {
		const w = mountOverlay({ detailTestid: "d" }, { title: "T", detail: "" })
		expect(w.find("[data-testid='d']").exists()).toBe(true)
		expect(w.find("[data-testid='d']").text()).toBe("")
	})

	test("no detail slot means no detail span", () => {
		const w = mountOverlay({ detailTestid: "d" }, { title: "T", sub: "S" })
		expect(w.find("[data-testid='d']").exists()).toBe(false)
		expect(w.findAll("span")).toHaveLength(2)
	})

	test("copy renders as text, never as markup", () => {
		const w = mountOverlay({}, { title: "T", sub: () => "<script>alert(1)</script> — no legitimate screen will ask for it." })
		expect(w.find("script").exists()).toBe(false)
		expect(w.text()).toContain("<script>alert(1)</script> — no legitimate screen will ask for it.")
	})

	test("the parent's extra content lands after the detail, inside the card", () => {
		const w = mountOverlay({}, { title: "T", detail: "D", default: "<button data-testid='retry'>Retry</button>" })
		const card = w.element.firstElementChild
		expect(card?.lastElementChild?.getAttribute("data-testid")).toBe("retry")
		expect(card?.lastElementChild?.previousElementSibling?.textContent).toBe("D")
	})
})
