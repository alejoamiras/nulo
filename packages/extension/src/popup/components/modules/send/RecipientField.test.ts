/**
 * Locks the recipient contract for RecipientField after the P3 card redesign:
 *   - the `vault` icon is gone everywhere (suffix + suggestions)
 *   - suggestion rows render an <AccountAvatar> (initials), no vault fallback
 *   - a selected recipient renders the <RecipientCard> (masked addr + reveal),
 *     replacing the typing input
 *   - the card's `change` action clears the selection and restores the input
 */
import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import RecipientField from "./RecipientField.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>", props: ["size", "weight", "color", "noWrap", "align", "mono", "selectable"] },
	Icon: { template: '<i data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color", "scale"] },
	AddressInput: {
		template: `<div class="stub-input"><input :value="modelValue" @focus="$emit('focus')" @blur="$emit('blur')" /><slot name="suffix" /></div>`,
		props: ["modelValue", "placeholder", "autofocus"],
		emits: ["focus", "blur", "update:modelValue"],
	},
	Transition: { template: "<slot />" },
	AccountAvatar: {
		template: '<div data-testid="stub-avatar" :data-name="name" :data-address="address" />',
		props: ["name", "address", "size"],
	},
	RecipientCard: {
		template: `<div data-testid="stub-card" :data-name="name" :data-address="address"><button data-testid="card-change-btn" @click="$emit('change')" /></div>`,
		props: ["name", "address"],
		emits: ["change", "copied"],
	},
}

const mountField = (props: Record<string, unknown> = {}) => mount(RecipientField, { props, global: { stubs: STUBS } })

const alice = { id: "1", name: "Alice", address: "0xaaaa", abbr: "AL" }
const account1 = { id: "2", name: "Account 1", address: "0xbbbb" }

describe("modules/send/RecipientField", () => {
	test("renders no vault icon anywhere (removed in P3)", async () => {
		const w = mountField({ candidates: [alice, account1], searchTerm: "a" })
		await w.find("input").trigger("focus")
		const iconNames = w.findAll('[data-testid="stub-icon"]').map((i) => i.attributes("data-name"))
		expect(iconNames).not.toContain("vault")
	})

	test("suggestion rows render an AccountAvatar per candidate (name + address)", async () => {
		const w = mountField({ candidates: [alice, account1], searchTerm: "a" })
		await w.find("input").trigger("focus")
		const avatars = w.findAll('[data-testid="stub-avatar"]')
		expect(avatars).toHaveLength(2)
		expect(avatars.map((a) => a.attributes("data-address"))).toEqual(["0xaaaa", "0xbbbb"])
	})

	test("filters candidates by name substring", async () => {
		const w = mountField({ candidates: [alice, account1], searchTerm: "alice" })
		await w.find("input").trigger("focus")
		const avatars = w.findAll('[data-testid="stub-avatar"]')
		expect(avatars).toHaveLength(1)
		expect(avatars[0].attributes("data-name")).toBe("Alice")
	})

	test("a selected recipient renders the RecipientCard (with the full address), not the input", () => {
		const w = mountField({ candidates: [alice], selectedContact: alice })
		const card = w.find('[data-testid="stub-card"]')
		expect(card.exists()).toBe(true)
		expect(card.attributes("data-address")).toBe("0xaaaa")
		expect(card.attributes("data-name")).toBe("Alice")
		expect(w.find("input").exists()).toBe(false)
	})

	test("the card's change action clears the selection and restores the input", async () => {
		const w = mountField({ candidates: [alice], selectedContact: alice, searchTerm: alice.address })
		await w.find('[data-testid="card-change-btn"]').trigger("click")
		expect(w.emitted("update:selectedContact")?.at(-1)).toEqual([null])
		expect(w.emitted("update:searchTerm")?.at(-1)).toEqual([""])
		expect(w.find("input").exists()).toBe(true)
		expect(w.find('[data-testid="stub-card"]').exists()).toBe(false)
	})
})
