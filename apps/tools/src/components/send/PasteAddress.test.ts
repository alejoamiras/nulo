import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import PasteAddress from "./PasteAddress.vue"

const sel = (t: string) => `[data-testid="${t}"]`

const ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

function paste(error: string | null = null) {
	return mount(PasteAddress, { props: { error } })
}

describe("PasteAddress", () => {
	it("emits a lowercase address for a well-formed one", async () => {
		const w = paste()
		await w.find(sel(TESTIDS.sendPasteInput)).setValue(` ${ADDRESS} `)
		await w.find(sel(TESTIDS.sendPasteAdd)).trigger("click")
		expect(w.emitted("paste")).toEqual([[ADDRESS.toLowerCase()]])
		w.unmount()
	})

	it("refuses a malformed address locally instead of asking the catalog", async () => {
		const w = paste()
		await w.find(sel(TESTIDS.sendPasteInput)).setValue("0x1234")
		await w.find(sel(TESTIDS.sendPasteAdd)).trigger("click")
		expect(w.emitted("paste")).toBeUndefined()
		expect(w.find(sel(TESTIDS.sendPasteError)).text()).toContain("40 hex")
		w.unmount()
	})

	it("clears its own complaint as soon as the text changes", async () => {
		const w = paste()
		const input = w.find(sel(TESTIDS.sendPasteInput))
		await input.setValue("nope")
		await w.find(sel(TESTIDS.sendPasteAdd)).trigger("click")
		expect(w.find(sel(TESTIDS.sendPasteError)).exists()).toBe(true)
		await input.setValue("no")
		expect(w.find(sel(TESTIDS.sendPasteError)).exists()).toBe(false)
		w.unmount()
	})

	it("shows what the catalog rejected", () => {
		const w = paste("That token is already in the list.")
		expect(w.find(sel(TESTIDS.sendPasteError)).text()).toBe("That token is already in the list.")
		w.unmount()
	})

	it("Enter in the field adds, without a form submit", async () => {
		const w = paste()
		await w.find(sel(TESTIDS.sendPasteInput)).setValue(ADDRESS)
		await w.find(sel(TESTIDS.sendPasteInput)).trigger("keydown", { key: "Enter" })
		expect(w.emitted("paste")).toEqual([[ADDRESS.toLowerCase()]])
		w.unmount()
	})

	it("cannot be pressed with an empty field", async () => {
		const w = paste()
		expect(w.find(sel(TESTIDS.sendPasteAdd)).attributes("disabled")).toBeDefined()
		await w.find(sel(TESTIDS.sendPasteInput)).setValue("0x")
		expect(w.find(sel(TESTIDS.sendPasteAdd)).attributes("disabled")).toBeUndefined()
		w.unmount()
	})

	it("marks the field invalid while an error stands", async () => {
		const w = paste("nope")
		expect(w.find(sel(TESTIDS.sendPasteInput)).attributes("data-invalid")).toBe("true")
		w.unmount()
	})

	it("points the field at the complaint, and at nothing once it clears", async () => {
		const w = paste("nope")
		const input = w.find(sel(TESTIDS.sendPasteInput))
		expect(input.attributes("aria-invalid")).toBe("true")
		expect(input.attributes("aria-describedby")).toBe(w.find(sel(TESTIDS.sendPasteError)).attributes("id"))
		await w.setProps({ error: null })
		expect(w.find(sel(TESTIDS.sendPasteInput)).attributes("aria-invalid")).toBeUndefined()
		expect(w.find(sel(TESTIDS.sendPasteInput)).attributes("aria-describedby")).toBeUndefined()
		w.unmount()
	})

	it("announces its error politely", () => {
		const w = paste("nope")
		expect(w.find(sel(TESTIDS.sendPasteError)).attributes("aria-live")).toBe("polite")
		w.unmount()
	})
})
