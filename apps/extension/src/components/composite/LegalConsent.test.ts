import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import { CONSENT_LABEL, CONTINUE_LABEL, RISK_POINTS } from "@nulo/legal"
import LegalConsent from "./LegalConsent.vue"

const STUBS = {
	Flex: { template: '<div v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: '<span v-bind="$attrs"><slot /></span>', inheritAttrs: false },
	Icon: { template: '<i data-testid="stub-icon" />' },
	Button: {
		template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>',
		props: ["disabled", "variant", "size", "wide"],
		inheritAttrs: false,
	},
}

const mountConsent = (props: Record<string, unknown> = {}) =>
	mount(LegalConsent, { props: { points: RISK_POINTS, termsVersion: "1.0", ...props }, global: { stubs: STUBS } })

const box = (w: ReturnType<typeof mountConsent>) => w.get('[data-testid="legal-consent-checkbox"]')
const button = (w: ReturnType<typeof mountConsent>) => w.get('[data-testid="legal-continue"]')
const text = (w: ReturnType<typeof mountConsent>, id: string) => w.get(`[data-testid="${id}"]`).text().replace(/\s+/g, " ")

describe("composite/LegalConsent", () => {
	test("starts unchecked with Continue disabled, and says so", () => {
		const w = mountConsent()
		expect(box(w).attributes("aria-checked")).toBe("false")
		expect(button(w).attributes("disabled")).toBeDefined()
		expect(text(w, "legal-consent-hint")).toBe("Tick the box to continue")
	})

	test("a remount starts unchecked again: agreement is never restored", async () => {
		const first = mountConsent()
		await box(first).trigger("click")
		first.unmount()
		expect(box(mountConsent()).attributes("aria-checked")).toBe("false")
	})

	test("ticking enables Continue and names the version that will be recorded", async () => {
		const w = mountConsent({ termsVersion: "1.2" })
		await box(w).trigger("click")
		expect(box(w).attributes("aria-checked")).toBe("true")
		expect(button(w).attributes("disabled")).toBeUndefined()
		expect(text(w, "legal-consent-hint")).toBe("Recorded on this device only · v1.2")
	})

	test("Continue emits nothing while unchecked, by click or by Enter", async () => {
		const w = mountConsent()
		await button(w).trigger("click")
		await button(w).trigger("keydown.enter")
		expect(w.emitted("accept")).toBeUndefined()
	})

	test("ticked, Continue emits accept exactly once per click", async () => {
		const w = mountConsent()
		await box(w).trigger("click")
		await button(w).trigger("click")
		expect(w.emitted("accept")).toHaveLength(1)
	})

	test.each(["keydown.enter", "keydown.space"])("%s toggles the checkbox", async (key) => {
		const w = mountConsent()
		await box(w).trigger(key)
		expect(box(w).attributes("aria-checked")).toBe("true")
		await box(w).trigger(key)
		expect(box(w).attributes("aria-checked")).toBe("false")
	})

	test("the checkbox is one tab stop and the in-label links are none", () => {
		const w = mountConsent()
		expect(box(w).attributes("tabindex")).toBe("0")
		expect(w.get('[data-testid="legal-terms-link"]').attributes("tabindex")).toBe("-1")
		expect(w.get('[data-testid="legal-privacy-link"]').attributes("tabindex")).toBe("-1")
	})

	test.each([
		["legal-terms-link", "terms"],
		["legal-privacy-link", "privacy"],
	])("%s asks the parent to open %s and does not tick the box", async (testid, doc) => {
		const w = mountConsent()
		await w.get(`[data-testid="${testid}"]`).trigger("click")
		expect(w.emitted("open")).toEqual([[doc]])
		expect(box(w).attributes("aria-checked")).toBe("false")
	})

	test("renders the points it is given, in order, numbered", () => {
		const w = mountConsent()
		const rows = w.findAll('[data-testid="legal-point"]').map((row) => row.text().replace(/\s+/g, " "))
		expect(rows).toHaveLength(RISK_POINTS.length)
		RISK_POINTS.forEach((point, index) => {
			expect(rows[index]).toContain(`0${index + 1}`)
			expect(rows[index]).toContain(point.lead)
			expect(rows[index]).toContain(point.body)
		})
	})

	test("compact keeps every lead and drops the sentences under them", () => {
		const rows = mountConsent({ compact: true })
			.findAll('[data-testid="legal-point"]')
			.map((row) => row.text())
		RISK_POINTS.forEach((point, index) => {
			expect(rows[index]).toContain(point.lead)
			expect(rows[index]).not.toContain(point.body)
		})
	})

	test("the label carries the package's consent wording and button label verbatim", () => {
		const w = mountConsent()
		expect(text(w, "legal-consent-label")).toBe(`I understand the four points above, and ${CONSENT_LABEL}.`)
		expect(button(w).text()).toBe(CONTINUE_LABEL)
	})

	test("a re-acceptance lists what changed instead of the points, under the bare consent wording", () => {
		const w = mountConsent({ points: undefined, changes: ["Fees moved.", "Venue changed."] })
		expect(w.find('[data-testid="legal-points"]').exists()).toBe(false)
		expect(w.findAll('[data-testid="legal-change"]').map((row) => row.text())).toEqual(["Fees moved.", "Venue changed."])
		expect(text(w, "legal-consent-label")).toBe(`${CONSENT_LABEL}, version 1.0.`)
	})

	test("busy freezes the control: no toggle, no second accept", async () => {
		const w = mountConsent()
		await box(w).trigger("click")
		await w.setProps({ busy: true })
		await box(w).trigger("click")
		await button(w).trigger("click")
		expect(box(w).attributes("aria-checked")).toBe("true")
		expect(w.emitted("accept")).toBeUndefined()
	})

	test("no copy of its own uses an em dash", () => {
		expect(mountConsent().text()).not.toContain("—")
	})
})
