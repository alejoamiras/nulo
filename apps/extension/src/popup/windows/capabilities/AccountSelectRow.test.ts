import { afterEach, describe, expect, test, vi } from "vitest"
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import AccountSelectRow from "./AccountSelectRow.vue"

vi.mock("@/components/ui/utils.js", () => ({
	getChainName: (chainId: number) => `chain-${chainId}`,
}))

vi.mock("@/wallet/utils/caip", () => ({
	formatCaipAccount: (chainId: number, address: string) => `aztec:${chainId}:${address}`,
}))

enableAutoUnmount(afterEach)

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<i :data-name="name" />', props: ["name", "size", "color"] },
	Tooltip: { template: "<div><slot /></div>" },
}

// Wire-shaped: 0x + 64 hex, below the field modulus.
const baseAccount = { address: `0x${"0a".repeat(32)}`, name: "Alpha", chainId: 1 }

const factory = (props: Record<string, unknown> = {}) =>
	mount(AccountSelectRow, {
		props: { account: baseAccount, selected: false, ...props },
		attachTo: document.body,
		global: { stubs: STUBS },
	})

type Row = ReturnType<typeof factory>
const root = (w: Row) => w.get('[data-testid="cap-account-item"]')
const target = (w: Row) => w.get("[data-row-target]")
const rename = (w: Row) => w.find('[data-testid="cap-account-rename-btn"]')
const field = (w: Row) => w.find('[data-testid="cap-account-alias-input"]')

describe("AccountSelectRow", () => {
	test("keeps the canonical testid and data attributes on the root", () => {
		const w = factory()
		expect(root(w).attributes("data-account-id")).toBe(baseAccount.address)
		expect(root(w).attributes("data-account-name")).toBe("Alpha")
	})

	test("marks the selection on the root, so e2e helpers can be idempotent", () => {
		expect(root(factory({ selected: false })).attributes("data-selected")).toBeUndefined()
		expect(root(factory({ selected: true })).attributes("data-selected")).toBe("true")
	})

	test("shows the name, the uppercased chain and the trimmed address", () => {
		const w = factory({ account: { ...baseAccount, chainId: 7 } })
		expect(w.text()).toContain("Alpha")
		expect(w.text()).toContain("CHAIN-7")
		expect(w.text()).toContain("0x0a0a...0a0a")
	})

	test("selects through its target: a click toggles, and aria-pressed follows the selection", async () => {
		const w = factory()
		expect(target(w).attributes("aria-pressed")).toBe("false")
		await target(w).trigger("click")
		expect(w.emitted("toggle")).toHaveLength(1)
		expect(target(factory({ selected: true })).attributes("aria-pressed")).toBe("true")
	})

	test("Enter and Space are the target's own: a native button, and nothing cancels either key", () => {
		const w = factory()
		const button = target(w).element as HTMLButtonElement
		expect(button.tagName).toBe("BUTTON")
		expect(button.type).toBe("button")
		expect(button.hasAttribute("tabindex")).toBe(false)
		for (const key of ["Enter", " "]) {
			const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
			button.dispatchEvent(event)
			expect(event.defaultPrevented).toBe(false)
		}
	})

	test("the target is named by the account's name", () => {
		const w = factory()
		expect(document.getElementById(target(w).attributes("aria-labelledby") as string)?.textContent).toBe("Alpha")
	})

	test("no control sits inside another", async () => {
		const w = factory({ selected: true })
		await rename(w).trigger("click")
		expect(root(w).attributes("role")).toBeUndefined()
		expect(root(w).attributes("tabindex")).toBeUndefined()
		expect(target(w).element.children).toHaveLength(0)
		expect(w.findAll("button button, button input, [role='button'] button, [role='button'] input")).toHaveLength(0)
	})

	test("a selected row shows the rename link; the field comes only once it is pressed, prefilled and focused", async () => {
		const w = factory({ selected: true })
		expect(rename(w).text()).toBe("Rename for this app")
		expect(field(w).exists()).toBe(false)
		await rename(w).trigger("click")
		await flushPromises()
		expect(rename(w).exists()).toBe(false)
		expect((field(w).element as HTMLInputElement).value).toBe("Alpha")
		expect(document.activeElement).toBe(field(w).element)
		expect(w.get(`label[for="${field(w).attributes("id")}"]`).text()).toBe("Name for this app")
	})

	test("pressing the link, then clicking in the field, leaves the selection as it was", async () => {
		const w = factory({ selected: true })
		await rename(w).trigger("click")
		await field(w).trigger("click")
		expect(w.emitted("toggle")).toBeUndefined()
	})

	test("an unselected row has neither the link nor the field", () => {
		const w = factory({ selected: false })
		expect(rename(w).exists()).toBe(false)
		expect(field(w).exists()).toBe(false)
	})

	test("the field shows the alias the parent holds, and typing sends the account's caip with the value", async () => {
		const w = factory({ selected: true, alias: "Custom" })
		await rename(w).trigger("click")
		expect((field(w).element as HTMLInputElement).value).toBe("Custom")
		await field(w).setValue("MyAlias")
		expect(w.emitted("updateAlias")).toEqual([[`aztec:1:${baseAccount.address}`, "MyAlias"]])
	})

	test("once pressed, the field stays open, emptied or deselected and selected again", async () => {
		const w = factory({ selected: true })
		await rename(w).trigger("click")
		await field(w).setValue("")
		expect(field(w).exists()).toBe(true)
		await w.setProps({ selected: false })
		expect(field(w).exists()).toBe(false)
		await w.setProps({ selected: true })
		expect(field(w).exists()).toBe(true)
		expect(rename(w).exists()).toBe(false)
	})

	test("no Alias label and no ⓘ", async () => {
		const w = factory({ selected: true })
		await rename(w).trigger("click")
		expect(w.text()).not.toContain("Alias")
		expect(w.find('[data-name="info"]').exists()).toBe(false)
	})

	test("a disabled row: its target out of the Tab order and aria-disabled, a click ignored, the row dimmed", async () => {
		const w = factory({ disabled: true })
		expect(target(w).attributes("tabindex")).toBe("-1")
		expect(target(w).attributes("aria-disabled")).toBe("true")
		expect(root(w).attributes("class")).toContain("row_disabled")
		await target(w).trigger("click")
		expect(w.emitted("toggle")).toBeUndefined()
	})

	test("a selected, disabled row: its link aria-disabled and out of the Tab order, and pressing it opens no field", async () => {
		const enabled = rename(factory({ selected: true }))
		expect(enabled.attributes("aria-disabled")).toBeUndefined()
		expect(enabled.attributes("tabindex")).toBeUndefined()
		const w = factory({ selected: true, disabled: true })
		expect(rename(w).attributes("aria-disabled")).toBe("true")
		expect(rename(w).attributes("tabindex")).toBe("-1")
		// A native button, so Enter on it is this click.
		expect((rename(w).element as HTMLButtonElement).type).toBe("button")
		await rename(w).trigger("click")
		await flushPromises()
		expect(field(w).exists()).toBe(false)
		expect(rename(w).exists()).toBe(true)
	})

	test("a locked row: granted and selected, its target out of the Tab order and aria-disabled, no link, SHARED", async () => {
		const w = factory({ selected: true, locked: true })
		expect(root(w).attributes("data-granted")).toBe("true")
		expect(root(w).attributes("data-selected")).toBe("true")
		expect(target(w).attributes("tabindex")).toBe("-1")
		expect(target(w).attributes("aria-disabled")).toBe("true")
		expect(target(w).attributes("aria-pressed")).toBe("true")
		await target(w).trigger("click")
		expect(w.emitted("toggle")).toBeUndefined()
		expect(rename(w).exists()).toBe(false)
		expect(field(w).exists()).toBe(false)
		expect(w.text()).toContain("SHARED")
	})
})
