/**
 * Shell-integration coverage for the extension's <Button> wrapper. The full variant/size/loading/icon
 * matrix lives in @nulo/design's Button.test.ts (the base); here we assert the wrapper renders the
 * base, forwards props, and preserves the legacy `link` prop via RouterLink (custom) → base anchor.
 */
import { mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
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

	// Attribute fallthrough must reach the real element in BOTH branches. The wrapper is a v-if/v-else
	// template; the `link` branch renders RouterLink in `custom` mode (slot-only fragment root), which
	// without inheritAttrs:false + v-bind="$attrs" silently DROPS undeclared attrs like data-testid onto
	// the fragment (Vue warns) — breaking e2e selectors that the pre-round-2 single-root contract carried
	// onto the <a>. These pin the seam so a regression can't slip past unit gates again.
	test("non-link: data-testid + @click + :style fall through to the <button> root", async () => {
		const onClick = vi.fn()
		const w = mount(Button, {
			attrs: { "data-testid": "btn-x", onClick, style: "width: 50%;" },
			slots: { default: "Go" },
			global: { stubs: STUBS },
		})
		expect(w.get("button").attributes("data-testid")).toBe("btn-x")
		expect(w.get("button").attributes("style") ?? "").toContain("width: 50%")
		await w.get("button").trigger("click")
		expect(onClick).toHaveBeenCalledTimes(1)
	})

	test("link: data-testid falls through to the anchor root (not dropped by the custom RouterLink)", () => {
		const w = mount(Button, {
			props: { link: "/popup/general" },
			attrs: { "data-testid": "link-x" },
			slots: { default: "Home" },
			global: { stubs: STUBS },
		})
		expect(w.get("a").attributes("data-testid")).toBe("link-x")
	})
})
