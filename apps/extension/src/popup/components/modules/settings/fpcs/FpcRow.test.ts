import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import { RowAction } from "@nulo/design"
import FpcRow from "./FpcRow.vue"

const STUBS = {
	SettingItem: {
		props: ["title", "description", "icon", "iconBgColor", "raw"],
		template: '<div class="setting-item" :data-title="title"><slot /><slot name="right" /></div>',
		inheritAttrs: true,
	},
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Tooltip: { template: '<span><slot /><slot name="content" /></span>' },
	Icon: { props: ["name"], template: '<i :data-icon="name" />' },
}

const baseFpc = { id: "f1", address: "0xabc", name: "My FPC", typeName: "sponsored", typeDescription: "Fees covered by sponsor" }

const factory = (props: Record<string, unknown> = {}) =>
	mount(FpcRow, {
		props: { fpc: baseFpc, ...props },
		global: { stubs: STUBS, components: { RowAction } },
	})

const copyAction = (w: ReturnType<typeof factory>) => w.findAll('button[aria-label="Copy FPC address"]')

describe("FpcRow", () => {
	test("user-added row renders copy + edit + delete as named buttons", () => {
		const w = factory()
		expect(w.find('[data-testid="fpc-edit-btn"]').element.tagName).toBe("BUTTON")
		expect(w.find('[data-testid="fpc-edit-btn"]').attributes("aria-label")).toBe("Edit FPC")
		expect(w.find('[data-testid="fpc-delete-btn"]').attributes("aria-label")).toBe("Delete FPC")
		expect(copyAction(w)).toHaveLength(1)
	})

	test("never renders the colored badge", () => {
		const w = factory({ fpc: { ...baseFpc } })
		// Badge had a `data-color` style + Text content in old shape — assert
		// no element with the legacy badge class signature remains.
		expect(w.html()).not.toContain("var(--purple)")
		expect(w.html()).not.toContain("var(--green)")
	})

	test("never renders the banknote add-token icon (Token FPC removed)", () => {
		const w = factory()
		expect(w.findAll('[data-icon="banknote"]')).toHaveLength(0)
	})

	test("protected row hides the delete button but keeps edit + copy", () => {
		const w = factory({ protectedRow: true })
		expect(w.find('[data-testid="fpc-edit-btn"]').exists()).toBe(true)
		expect(w.find('[data-testid="fpc-delete-btn"]').exists()).toBe(false)
		expect(copyAction(w)).toHaveLength(1)
	})

	test("nonEditable + protected row (PrivateFPC) shows only the copy action", () => {
		const w = factory({ protectedRow: true, nonEditable: true })
		expect(w.find('[data-testid="fpc-edit-btn"]').exists()).toBe(false)
		expect(w.find('[data-testid="fpc-delete-btn"]').exists()).toBe(false)
		expect(copyAction(w)).toHaveLength(1)
	})

	test("synthetic public-fj row renders no actions", () => {
		const w = factory({
			fpc: { id: "public-fj", name: "Public Fee Juice", typeDescription: "Pays fees from your public Fee Juice" },
			synthetic: "public-fj",
		})
		expect(w.find('[data-testid="fpc-edit-btn"]').exists()).toBe(false)
		expect(w.find('[data-testid="fpc-delete-btn"]').exists()).toBe(false)
		expect(w.findAll("button")).toHaveLength(0)
	})

	test("emits 'edit' with the fpc when the edit action is pressed", async () => {
		const w = factory()
		await w.find('[data-testid="fpc-edit-btn"]').trigger("click")
		expect(w.emitted("edit")?.[0]?.[0]).toEqual(baseFpc)
	})

	test("emits 'delete' with the fpc when the delete action is pressed", async () => {
		const w = factory()
		await w.find('[data-testid="fpc-delete-btn"]').trigger("click")
		expect(w.emitted("delete")?.[0]?.[0]).toEqual(baseFpc)
	})

	test("emits 'copyAddress' with the address when the copy action is pressed", async () => {
		const w = factory()
		await copyAction(w)[0].trigger("click")
		expect(w.emitted("copyAddress")?.[0]?.[0]).toBe(baseFpc.address)
	})
})
