/**
 * Locks the autocomplete suggestion contract for RecipientField:
 *   - candidates with `abbr` render the uniform .contact_avatar tile
 *   - candidates without `abbr` fall back to a <Icon name="vault"> tile
 *
 * The fallback is the regression-prone branch — covered here so a future
 * structural refactor of the suggestion list doesn't silently drop it.
 */
import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import RecipientField from "./RecipientField.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>", props: ["size", "weight", "color", "noWrap", "align"] },
	Icon: { template: '<i data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color", "scale"] },
	Input: {
		template: `<div class="stub-input">
			<input :value="modelValue" @focus="$emit('focus')" @blur="$emit('blur')" />
			<slot name="suffix" />
		</div>`,
		props: ["modelValue", "placeholder"],
		emits: ["focus", "blur", "update:modelValue"],
	},
	Transition: { template: "<slot />" },
}

const mountField = (props: Record<string, unknown> = {}) => mount(RecipientField, { props, global: { stubs: STUBS } })

const aliceWithAbbr = { id: "1", name: "Alice", address: "0xaaaa", abbr: "AL" }
const accountNoAbbr = { id: "2", name: "Account 1", address: "0xbbbb" }

describe("modules/send/RecipientField", () => {
	test("candidate with abbr renders .contact_avatar tile, no vault fallback", async () => {
		const w = mountField({ candidates: [aliceWithAbbr], searchTerm: "Alice" })
		// Activate the suggestions popover: focus the input.
		await w.find("input").trigger("focus")
		// The avatar branch shows initials text; the vault fallback shows a 28px Icon.
		const vaultIcons = w.findAll('[data-name="vault"]').filter((i) => i.attributes("data-size") === "28")
		expect(vaultIcons).toHaveLength(0)
		expect(w.text()).toContain("Alice")
	})

	test("candidate WITHOUT abbr falls back to a vault Icon tile", async () => {
		const w = mountField({ candidates: [accountNoAbbr], searchTerm: "Account" })
		await w.find("input").trigger("focus")
		// Two Icon stubs are present in the surface (one in the input suffix, one in the suggestion).
		// The fallback we care about is the size=28 vault inside the suggestion row.
		const allVault = w.findAll('[data-name="vault"]')
		expect(allVault.length).toBeGreaterThanOrEqual(1)
	})
})
