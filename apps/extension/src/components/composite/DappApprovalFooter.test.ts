import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import DappApprovalFooter from "./DappApprovalFooter.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<i :data-color="color"></i>', props: ["color"] },
	Tooltip: {
		template: '<div data-stub="tooltip" :data-wide="wide ? \'true\' : \'false\'"><slot /><slot name="content" /></div>',
		props: ["wide", "disabled", "side", "position"],
	},
	Button: {
		template: "<button :disabled=\"disabled\" :data-loading=\"loading ? 'true' : 'false'\" @click=\"$emit('click')\"><slot /></button>",
		props: ["disabled", "loading", "variant", "size", "wide"],
		emits: ["click"],
	},
}

const base = {
	rejectTestid: "x-reject-btn",
	rejectLabel: "Reject",
	confirmTestid: "x-confirm-btn",
	confirmLabel: "Confirm",
}

const factory = (props: Record<string, unknown> = {}) =>
	mount(DappApprovalFooter, { props: { ...base, ...props }, global: { stubs: STUBS } })

describe("composite/DappApprovalFooter", () => {
	test("renders the reject + confirm buttons with their forwarded testids", () => {
		const w = factory()
		expect(w.find('[data-testid="x-reject-btn"]').exists()).toBe(true)
		expect(w.find('[data-testid="x-confirm-btn"]').exists()).toBe(true)
	})

	test("renders the reject and confirm labels", () => {
		const w = factory({ rejectLabel: "Deny", confirmLabel: "Allow" })
		expect(w.text()).toContain("Deny")
		expect(w.text()).toContain("Allow")
	})

	test("clicking reject emits 'reject' (not 'approve')", async () => {
		const w = factory()
		await w.find('[data-testid="x-reject-btn"]').trigger("click")
		expect(w.emitted("reject")).toHaveLength(1)
		expect(w.emitted("approve")).toBeUndefined()
	})

	test("clicking confirm emits 'approve' (not 'reject')", async () => {
		const w = factory()
		await w.find('[data-testid="x-confirm-btn"]').trigger("click")
		expect(w.emitted("approve")).toHaveLength(1)
		expect(w.emitted("reject")).toBeUndefined()
	})

	test("rejectDisabled disables the reject button", () => {
		const w = factory({ rejectDisabled: true })
		expect((w.find('[data-testid="x-reject-btn"]').element as HTMLButtonElement).disabled).toBe(true)
	})

	test("confirmDisabled disables the confirm button", () => {
		const w = factory({ confirmDisabled: true })
		expect((w.find('[data-testid="x-confirm-btn"]').element as HTMLButtonElement).disabled).toBe(true)
	})

	test("confirmLoading is forwarded to the confirm button's loading state", () => {
		const w = factory({ confirmLoading: true })
		expect(w.find('[data-testid="x-confirm-btn"]').attributes("data-loading")).toBe("true")
	})

	test("no error banner when processingError is undefined", () => {
		const w = factory()
		expect(w.find('[data-testid="error-text"]').exists()).toBe(false)
		expect(w.find('[data-stub="tooltip"]').exists()).toBe(false)
	})

	test("renders the error banner (title) when processingError is present", () => {
		const w = factory({ processingError: { title: "Fee too low", type: "error" } })
		const errorText = w.find('[data-testid="error-text"]')
		expect(errorText.exists()).toBe(true)
		expect(errorText.text()).toBe("Fee too low")
	})

	test("error icon is red for an error and orange for a warning", () => {
		const err = factory({ processingError: { title: "e", type: "error" } })
		expect(err.find("i").attributes("data-color")).toBe("red")
		const warn = factory({ processingError: { title: "w", type: "warning" } })
		expect(warn.find("i").attributes("data-color")).toBe("orange")
	})

	test("wideTooltip is forwarded to the tooltip", () => {
		const wide = factory({ processingError: { title: "e", type: "error" }, wideTooltip: true })
		expect(wide.find('[data-stub="tooltip"]').attributes("data-wide")).toBe("true")
		const narrow = factory({ processingError: { title: "e", type: "error" } })
		expect(narrow.find('[data-stub="tooltip"]').attributes("data-wide")).toBe("false")
	})
})
