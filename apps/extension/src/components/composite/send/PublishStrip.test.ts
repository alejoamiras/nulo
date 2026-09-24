import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import { NO_FACTS, type PublishFacts, publishFacts, stripAriaLabel } from "./publish-facts"
import mark from "./publish-mark.module.css"
import PublishStrip from "./PublishStrip.vue"

const STUBS = {
	MaterialIcon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Icon: { template: '<svg data-testid="stub-glyph" :data-name="name" :data-size="size" />', props: ["name", "size"] },
}

const mountStrip = (facts: PublishFacts) => mount(PublishStrip, { props: { facts }, global: { stubs: STUBS } })
const strip = (w: ReturnType<typeof mountStrip>) => w.get('[data-testid="send-publish-strip"]')
const cell = (w: ReturnType<typeof mountStrip>, attr: string) => w.get(`[data-cell="${attr}"]`)
const glyphOf = (w: ReturnType<typeof mountStrip>, attr: string) => {
	const glyph = cell(w, attr).find('[data-testid="stub-glyph"]')
	return glyph.exists() ? glyph.attributes("data-name") : null
}

describe("composite/send/PublishStrip", () => {
	test("is one button carrying the three visibilities as data attributes", () => {
		const w = mountStrip(publishFacts("private", "public", "account"))
		expect(w.findAll("button")).toHaveLength(1)
		const el = strip(w)
		expect(el.attributes("type")).toBe("button")
		expect([el.attributes("data-you"), el.attributes("data-to"), el.attributes("data-amount")]).toEqual(["exposed", "public", "public"])
	})

	test.each<[string, PublishFacts, string, string | null, string]>([
		["you hidden", publishFacts("private", "private", "contract"), "you", "lock", "HIDDEN"],
		["you public", publishFacts("public", "private", null), "you", "globe", "SENDER"],
		["you exposed", publishFacts("private", "private", "account"), "you", "globe", "FEE PAYER"],
		["you unknown", publishFacts("private", "private", null), "you", null, "—"],
		["to hidden", publishFacts("public", "private", null), "to", "lock", "HIDDEN"],
		["to public", publishFacts("private", "public", "contract"), "to", "globe", "PUBLIC"],
		["amount hidden", publishFacts("private", "private", "contract"), "amount", "lock", "HIDDEN"],
		["amount public", publishFacts("public", "private", "contract"), "amount", "globe", "PUBLIC"],
	])("%s: glyph, tone and word", (_name, facts, attr, glyph, word) => {
		const w = mountStrip(facts)
		const visibility = attr === "you" ? facts.you : attr === "to" ? facts.recipient : facts.amount
		expect(cell(w, attr).classes()).toContain(mark[visibility])
		expect(glyphOf(w, attr)).toBe(glyph)
		expect(cell(w, attr).get("span").text()).toBe(word)
	})

	test("a glyph is decoration at 10px: the words and the label carry the meaning", () => {
		const w = mountStrip(publishFacts("private", "public", "contract"))
		const glyphs = w.findAll('[data-testid="stub-glyph"]')
		expect(glyphs).toHaveLength(3)
		for (const glyph of glyphs) {
			expect(glyph.attributes("data-size")).toBe("10")
			expect(glyph.attributes("aria-hidden")).toBe("true")
		}
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

	test("with nothing to send the you cell draws no glyph and reads —; nothing reads public", () => {
		const w = mountStrip(NO_FACTS)
		expect(glyphOf(w, "you")).toBeNull()
		expect(cell(w, "you").get("span").text()).toBe("—")
		expect([glyphOf(w, "to"), glyphOf(w, "amount")]).toEqual(["lock", "lock"])
	})
})
