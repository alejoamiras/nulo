import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import NewProfileMethodTabs from "./NewProfileMethodTabs.vue"

const mountTabs = (type = "password") => mount(NewProfileMethodTabs, { props: { type } })
const tablist = (w: ReturnType<typeof mountTabs>) => w.get('[role="tablist"]')
const pwTab = (w: ReturnType<typeof mountTabs>) => w.get('[data-testid="register-method-password"]')
const pkTab = (w: ReturnType<typeof mountTabs>) => w.get('[data-testid="register-method-passkey"]')

describe("new-profile/NewProfileMethodTabs (roving tablist)", () => {
	test("only the ACTIVE tab is in the Tab order (tabindex 0); the other is -1", () => {
		const w = mountTabs("password")
		expect(pwTab(w).attributes("tabindex")).toBe("0")
		expect(pkTab(w).attributes("tabindex")).toBe("-1")
	})

	test("activating passkey moves the single tab stop to it", () => {
		const w = mountTabs("passkey")
		expect(pkTab(w).attributes("tabindex")).toBe("0")
		expect(pwTab(w).attributes("tabindex")).toBe("-1")
	})

	test("clicking a tab emits update:type", async () => {
		const w = mountTabs("password")
		await pkTab(w).trigger("click")
		expect(w.emitted("update:type")?.at(-1)).toEqual(["passkey"])
	})

	test("ArrowRight switches the method (roving)", async () => {
		const w = mountTabs("password")
		await tablist(w).trigger("keydown", { key: "ArrowRight" })
		expect(w.emitted("update:type")?.at(-1)).toEqual(["passkey"])
	})

	test("ArrowLeft switches the method (roving)", async () => {
		const w = mountTabs("passkey")
		await tablist(w).trigger("keydown", { key: "ArrowLeft" })
		expect(w.emitted("update:type")?.at(-1)).toEqual(["password"])
	})

	test("a non-arrow key does NOT switch the method", async () => {
		const w = mountTabs("password")
		await tablist(w).trigger("keydown", { key: "a" })
		expect(w.emitted("update:type")).toBeUndefined()
	})

	test("exposes role=tablist + role=tab + aria-selected for assistive tech", () => {
		const w = mountTabs("password")
		expect(tablist(w).attributes("aria-label")).toBe("Authentication method")
		expect(pwTab(w).attributes("role")).toBe("tab")
		expect(pwTab(w).attributes("aria-selected")).toBe("true")
		expect(pkTab(w).attributes("aria-selected")).toBe("false")
	})
})
