import { describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"
import AccountSelectRow from "./AccountSelectRow.vue"

vi.mock("@/components/ui/utils.js", () => ({
	getChainName: (chainId: number) => `chain-${chainId}`,
}))

vi.mock("@/wallet/utils/caip", () => ({
	formatCaipAccount: (chainId: number, address: string) => `aztec:${chainId}:${address}`,
}))

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<i :data-name="name" />', props: ["name", "size", "color"] },
	Tooltip: { template: "<div><slot /></div>" },
}

const baseAccount = { address: "0x1234567890abcdef", name: "Alpha", chainId: 1 }

const factory = (props: Record<string, unknown> = {}) =>
	mount(AccountSelectRow, {
		props: { account: baseAccount, selected: false, ...props },
		global: { stubs: STUBS },
	})

describe("AccountSelectRow", () => {
	test("preserves the canonical testids + data attributes", () => {
		const w = factory()
		const row = w.find('[data-testid="cap-account-item"]')
		expect(row.attributes("data-account-id")).toBe("0x1234567890abcdef")
		expect(row.attributes("data-account-name")).toBe("Alpha")
	})

	test("exposes data-selected when selected so e2e helpers can be idempotent", () => {
		const unselected = factory({ selected: false })
		expect(unselected.find('[data-testid="cap-account-item"]').attributes("data-selected")).toBeUndefined()
		const selected = factory({ selected: true })
		expect(selected.find('[data-testid="cap-account-item"]').attributes("data-selected")).toBe("true")
	})

	test("renders the truncated address", () => {
		const w = factory()
		expect(w.text()).toContain("0x1234...cdef")
	})

	test("renders the uppercased chain label", () => {
		const w = factory({ account: { ...baseAccount, chainId: 7 } })
		expect(w.text()).toContain("CHAIN-7")
	})

	test("alias block hidden when not selected", () => {
		const w = factory({ selected: false })
		expect(w.find('[data-testid="cap-account-alias-input"]').exists()).toBe(false)
	})

	test("alias block visible when selected", () => {
		const w = factory({ selected: true })
		expect(w.find('[data-testid="cap-account-alias-input"]').exists()).toBe(true)
	})

	test("alias input defaults to account name", () => {
		const w = factory({ selected: true })
		expect(w.find('[data-testid="cap-account-alias-input"]').attributes("value")).toBe("Alpha")
	})

	test("alias input uses the alias prop when provided", () => {
		const w = factory({ selected: true, alias: "Custom" })
		expect(w.find('[data-testid="cap-account-alias-input"]').attributes("value")).toBe("Custom")
	})

	test("clicking the row emits 'toggle'", async () => {
		const w = factory()
		await w.find('[data-testid="cap-account-item"]').trigger("click")
		expect(w.emitted("toggle")).toHaveLength(1)
	})

	test("Enter key on the row emits 'toggle'", async () => {
		const w = factory()
		await w.find('[data-testid="cap-account-item"]').trigger("keydown.enter")
		expect(w.emitted("toggle")).toHaveLength(1)
	})

	test("typing in the alias input emits updateAlias(caip, value)", async () => {
		const w = factory({ selected: true })
		await w.find('[data-testid="cap-account-alias-input"]').setValue("MyAlias")
		const evt = w.emitted("updateAlias")?.[0]
		expect(evt?.[0]).toBe("aztec:1:0x1234567890abcdef")
		expect(evt?.[1]).toBe("MyAlias")
	})

	test("disabled=true blocks interactions visually (row_disabled class)", () => {
		const w = factory({ disabled: true })
		const cls = w.find('[data-testid="cap-account-item"]').attributes("class") || ""
		expect(cls).toContain("row_disabled")
	})
})
