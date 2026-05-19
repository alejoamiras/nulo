import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
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
	Icon: {
		props: ["name"],
		// Forward the native event so parents using `@click.stop` can call
		// $event.stopPropagation() without crashing the runtime.
		template: '<i v-bind="$attrs" :data-icon="name" @click="$emit(\'click\', $event)"></i>',
		emits: ["click"],
		inheritAttrs: false,
	},
}

const baseFpc = { id: "f1", address: "0xabc", name: "My FPC", typeName: "sponsored", typeDescription: "Fees covered by sponsor" }

const factory = (props: Record<string, unknown> = {}) =>
	mount(FpcRow, {
		props: { fpc: baseFpc, ...props },
		global: { stubs: STUBS },
	})

describe("FpcRow", () => {
	test("user-added row renders copy + edit + delete icons", () => {
		const w = factory()
		expect(w.find('[data-testid="fpc-edit-btn"]').exists()).toBe(true)
		expect(w.find('[data-testid="fpc-delete-btn"]').exists()).toBe(true)
		// copy icon has no testid; locate via the data-icon attribute on the stub
		expect(w.findAll('[data-icon="copy"]')).toHaveLength(1)
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
		expect(w.findAll('[data-icon="copy"]')).toHaveLength(1)
	})

	test("nonEditable + protected row (PrivateFPC) shows only the copy icon", () => {
		const w = factory({ protectedRow: true, nonEditable: true })
		expect(w.find('[data-testid="fpc-edit-btn"]').exists()).toBe(false)
		expect(w.find('[data-testid="fpc-delete-btn"]').exists()).toBe(false)
		expect(w.findAll('[data-icon="copy"]')).toHaveLength(1)
	})

	test("synthetic public-fj row renders no action icons", () => {
		const w = factory({
			fpc: { id: "public-fj", name: "Public Fee Juice", typeDescription: "Pays fees from your public Fee Juice" },
			synthetic: "public-fj",
		})
		expect(w.find('[data-testid="fpc-edit-btn"]').exists()).toBe(false)
		expect(w.find('[data-testid="fpc-delete-btn"]').exists()).toBe(false)
		expect(w.findAll('[data-icon="copy"]')).toHaveLength(0)
	})

	test("emits 'edit' with the fpc when edit icon is clicked", async () => {
		const w = factory()
		await w.find('[data-testid="fpc-edit-btn"]').trigger("click")
		expect(w.emitted("edit")?.[0]?.[0]).toEqual(baseFpc)
	})

	test("emits 'delete' with the fpc when delete icon is clicked", async () => {
		const w = factory()
		await w.find('[data-testid="fpc-delete-btn"]').trigger("click")
		expect(w.emitted("delete")?.[0]?.[0]).toEqual(baseFpc)
	})

	test("emits 'copyAddress' with the address when copy icon is clicked", async () => {
		const w = factory()
		await w.findAll('[data-icon="copy"]')[0].trigger("click")
		expect(w.emitted("copyAddress")?.[0]?.[0]).toBe(baseFpc.address)
	})
})
