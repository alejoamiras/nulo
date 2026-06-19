/**
 * Shell-integration coverage for the extension's <Button> wrapper. The full variant/size/loading/icon
 * matrix lives in @nulo/design's Button.test.ts (the base); here we assert the wrapper renders the
 * base, forwards props, and preserves the legacy `link` prop via RouterLink (custom) → base anchor.
 */
import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import Button from "./Button.vue"

// The wrapper renders the REAL @nulo/design ButtonBase; only the base's Spinner/Icon + RouterLink are
// stubbed. RouterLink is stubbed in `custom` mode (renders only the slot, providing href + navigate).
const STUBS = {
	Spinner: { template: '<span data-testid="stub-spinner" />' },
	Icon: { template: '<span data-testid="stub-icon" />' },
	RouterLink: { props: ["to", "custom"], template: '<slot :href="to" :navigate="() => {}" />' },
}

const mountButton = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(Button, { props, slots, global: { stubs: STUBS } })

describe("ui/Button (wrapper → @nulo/design ButtonBase)", () => {
	test("renders a <button> with the slot when no link is set", () => {
		const w = mountButton({}, { default: "Click me" })
		expect(w.element.tagName).toBe("BUTTON")
		expect(w.text()).toBe("Click me")
	})

	test("forwards variant + loading through to the base", () => {
		const w = mountButton({ variant: "secondary", loading: true }, { default: "Go" })
		expect(w.attributes("class") ?? "").toMatch(/secondary/)
		expect(w.find('[data-testid="stub-spinner"]').exists()).toBe(true)
	})

	test("forwards leftIcon + rightIcon through to the base", () => {
		const w = mountButton({ leftIcon: "arrow-left", rightIcon: "arrow-right" }, { default: "Continue" })
		expect(w.findAll('[data-testid="stub-icon"]')).toHaveLength(2)
	})

	test("link prop renders a non-button element (RouterLink branch, not the plain <button>)", () => {
		// Observable contract: with `link` set, the root is no longer a native <button> (it goes through
		// RouterLink). Full RouterLink/SPA correctness is covered by e2e; the base's tag="a" anchor +
		// rel hygiene is asserted in @nulo/design's Button.test.ts.
		const w = mountButton({ link: "/popup/general" }, { default: "Home" })
		expect(w.element.tagName).not.toBe("BUTTON")
	})
})
