import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import { NO_FACTS, type PublishFacts, publishFacts, stripAriaLabel } from "./publish-facts"
import mark from "./publish-mark.module.css"
import PublishStrip from "./PublishStrip.vue"

const STUBS = { MaterialIcon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] } }

const mountStrip = (facts: PublishFacts) => mount(PublishStrip, { props: { facts }, global: { stubs: STUBS } })
const strip = (w: ReturnType<typeof mountStrip>) => w.get('[data-testid="send-publish-strip"]')
const cell = (w: ReturnType<typeof mountStrip>, attr: string) => w.get(`[data-cell="${attr}"]`)
const markOf = (w: ReturnType<typeof mountStrip>, attr: string) => cell(w, attr).get("i").classes()

describe("composite/send/PublishStrip", () => {
	test("is one button carrying the three visibilities as data attributes", () => {
		const w = mountStrip(publishFacts("private", "public", "account"))
		expect(w.findAll("button")).toHaveLength(1)
		const el = strip(w)
		expect(el.attributes("type")).toBe("button")
		expect([el.attributes("data-you"), el.attributes("data-to"), el.attributes("data-amount")]).toEqual(["exposed", "public", "public"])
	})

	test.each<[string, PublishFacts, string, boolean, string]>([
		["you hidden", publishFacts("private", "private", "contract"), "you", false, "HIDDEN"],
		["you public", publishFacts("public", "private", null), "you", true, "SENDER"],
		["you exposed", publishFacts("private", "private", "account"), "you", true, "FEE PAYER"],
		["you unknown", publishFacts("private", "private", null), "you", false, "—"],
		["to hidden", publishFacts("public", "private", null), "to", false, "HIDDEN"],
		["to public", publishFacts("private", "public", "contract"), "to", true, "PUBLIC"],
		["amount hidden", publishFacts("private", "private", "contract"), "amount", false, "HIDDEN"],
		["amount public", publishFacts("public", "private", "contract"), "amount", true, "PUBLIC"],
	])("%s: mark, tone and word", (_name, facts, attr, filled, word) => {
		const w = mountStrip(facts)
		const visibility = attr === "you" ? facts.you : attr === "to" ? facts.recipient : facts.amount
		expect(cell(w, attr).classes()).toContain(mark[visibility])
		expect(markOf(w, attr)).toContain(mark.mark)
		expect(markOf(w, attr).includes(mark.filled)).toBe(filled)
		expect(cell(w, attr).get("span").text()).toBe(word)
	})

	test("the cells keep their order and labels", () => {
		const w = mountStrip(publishFacts("public", "public", "account"))
		expect(w.findAll("[data-cell]").map((c) => c.attributes("data-cell"))).toEqual(["you", "to", "amount"])
		expect(w.findAll("[data-cell] b").map((b) => b.text())).toEqual(["You", "To", "Amount"])
	})

	test("the accessible name is the facts' label, and the chevron is decoration", () => {
		const facts = publishFacts("private", "public", "unvouched")
		const w = mountStrip(facts)
		expect(strip(w).attributes("aria-label")).toBe(stripAriaLabel(facts))
		expect(w.get('[data-testid="stub-icon"]').attributes("data-name")).toBe("chevron_right")
		expect(w.get('[data-testid="stub-icon"]').element.parentElement?.getAttribute("aria-hidden")).toBe("true")
	})

	test("a click emits open once, with no payload", async () => {
		const w = mountStrip(publishFacts("private", "private", "account"))
		await strip(w).trigger("click")
		expect(w.emitted("open")).toEqual([[]])
	})

	test("re-renders when the facts change", async () => {
		const w = mountStrip(publishFacts("private", "private", "contract"))
		expect(strip(w).attributes("data-you")).toBe("hidden")
		await w.setProps({ facts: publishFacts("private", "private", "account") })
		expect(strip(w).attributes("data-you")).toBe("exposed")
		expect(cell(w, "you").get("span").text()).toBe("FEE PAYER")
	})

	test("with nothing to send every cell is hollow and the you cell reads —", () => {
		const w = mountStrip(NO_FACTS)
		expect(w.findAll("[data-cell] i").filter((i) => i.classes().includes(mark.filled))).toHaveLength(0)
		expect(cell(w, "you").get("span").text()).toBe("—")
	})
})
