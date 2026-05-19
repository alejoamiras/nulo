/**
 * Component test for `Button.vue`.
 *
 * Pattern reference for L2 primitive tests:
 *   - Colocated next to the SFC.
 *   - jsdom env (configured in `vitest.config.ts`).
 *   - `@vue/test-utils` `mount` + global stubs for auto-registered children
 *     (`Spinner`, `Icon`, `RouterLink` — these aren't auto-resolved in tests
 *     because `unplugin-vue-components` is a Vite plugin, not a vitest one).
 *
 * Conventions enforced here (see `CLAUDE.md`):
 *   - ≥5 cases for L2 primitives.
 *   - Test prop reactivity, event emission, slot rendering, edge cases.
 *   - No reach-into private internals; assert on rendered DOM + emitted events.
 */
import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import Button from "./Button.vue"

const STUBS = {
	Spinner: { template: '<span data-testid="stub-spinner" />' },
	Icon: { template: '<span data-testid="stub-icon" />' },
	RouterLink: { template: "<a><slot /></a>", props: ["to"] },
}

const mountButton = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(Button, { props, slots, global: { stubs: STUBS } })

describe("ui/Button", () => {
	test("renders default slot content inside a <button>", () => {
		const w = mountButton({}, { default: "Click me" })
		expect(w.element.tagName).toBe("BUTTON")
		expect(w.text()).toBe("Click me")
	})

	test("emits click when not disabled", async () => {
		const w = mountButton({}, { default: "Go" })
		await w.trigger("click")
		expect(w.emitted("click")).toHaveLength(1)
	})

	test("disabled prop sets the native disabled attribute", () => {
		const w = mountButton({ disabled: true }, { default: "X" })
		expect(w.attributes("disabled")).toBeDefined()
		// tabindex=-1 keeps disabled buttons out of the keyboard cycle
		expect(w.attributes("tabindex")).toBe("-1")
	})

	test("loading prop renders a Spinner inside the button", () => {
		const w = mountButton({ loading: true }, { default: "Saving" })
		expect(w.find('[data-testid="stub-spinner"]').exists()).toBe(true)
	})

	test("leftIcon + rightIcon props render Icon stubs flanking the slot", () => {
		const w = mountButton({ leftIcon: "arrow-left", rightIcon: "arrow-right" }, { default: "Continue" })
		expect(w.findAll('[data-testid="stub-icon"]')).toHaveLength(2)
	})

	test("link prop renders a non-button element (RouterLink swap)", () => {
		// Full RouterLink resolution requires installing vue-router with a
		// real route config — overkill for a unit test. We assert on the
		// observable contract: when `link` is set, the root is no longer
		// a native <button>. RouterLink rendering correctness is covered
		// by e2e (every navigation in the app exercises this path).
		const w = mountButton({ link: "/popup/general" }, { default: "Home" })
		expect(w.element.tagName).not.toBe("BUTTON")
	})

	test("size prop applies the matching size CSS module class", () => {
		// CSS modules in jsdom resolve to plain class names (no hash by default
		// when running through @vitejs/plugin-vue test compile). The wrapper
		// element should carry a class containing the size keyword.
		const w = mountButton({ size: "large" }, { default: "Big" })
		const cls = w.attributes("class") ?? ""
		expect(cls).toMatch(/large/)
	})

	test("variant prop applies the matching variant CSS module class", () => {
		const w = mountButton({ variant: "secondary" }, { default: "Less prominent" })
		const cls = w.attributes("class") ?? ""
		expect(cls).toMatch(/secondary/)
	})

	test("variant=cta applies the cta class (full-width brutalist primary)", () => {
		const w = mountButton({ variant: "cta" }, { default: "Continue" })
		const cls = w.attributes("class") ?? ""
		expect(cls).toMatch(/cta/)
	})

	test("variant=cta_outline applies the cta_outline class (outlined CTA)", () => {
		const w = mountButton({ variant: "cta_outline" }, { default: "Cancel" })
		const cls = w.attributes("class") ?? ""
		expect(cls).toMatch(/cta_outline/)
	})

	test("variant=cta_destructive applies the destructive cta class", () => {
		const w = mountButton({ variant: "cta_destructive" }, { default: "Delete" })
		const cls = w.attributes("class") ?? ""
		expect(cls).toMatch(/cta_destructive/)
	})

	test("variant=ghost applies the ghost class (renamed from tertiary)", () => {
		const w = mountButton({ variant: "ghost" }, { default: "Skip" })
		const cls = w.attributes("class") ?? ""
		expect(cls).toMatch(/ghost/)
	})

	test("wide prop applies the wide modifier class", () => {
		const w = mountButton({ wide: true }, { default: "Full" })
		const cls = w.attributes("class") ?? ""
		expect(cls).toMatch(/wide/)
	})

	test("loading prop applies the loading modifier class", () => {
		const w = mountButton({ loading: true }, { default: "Saving" })
		const cls = w.attributes("class") ?? ""
		expect(cls).toMatch(/loading/)
	})
})
