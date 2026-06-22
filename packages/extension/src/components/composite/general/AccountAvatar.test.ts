import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import AccountAvatar from "./AccountAvatar.vue"

// Flex/Text are auto-registered @nulo/design primitives; default inheritAttrs
// forwards class/style/data-* to the stub root so we can assert them.
const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
}

const mountAvatar = (props: Record<string, unknown> = {}) => mount(AccountAvatar, { props, global: { stubs: STUBS } })
const root = (w: ReturnType<typeof mountAvatar>) => w.get('[data-testid="account-avatar"]')

describe("composite/AccountAvatar", () => {
	test("renders with data-testid='account-avatar' for selectors", () => {
		expect(mountAvatar({ name: "Vault" }).find('[data-testid="account-avatar"]').exists()).toBe(true)
	})

	test("two-word name → initials of the first two words, uppercased", () => {
		const w = mountAvatar({ name: "Alejo Savings" })
		expect(w.text()).toBe("AS")
		expect(root(w).attributes("data-initials")).toBe("AS")
	})

	test("single-word name → first two chars, uppercased", () => {
		expect(mountAvatar({ name: "vault" }).text()).toBe("VA")
	})

	test("three+ word name → only the first two initials", () => {
		expect(mountAvatar({ name: "my cold wallet" }).text()).toBe("MC")
	})

	test("empty name → empty initials (no crash)", () => {
		const w = mountAvatar({ name: "" })
		expect(w.text()).toBe("")
		expect(root(w).attributes("data-initials")).toBe("")
	})

	test("brutalist: NO inline background color (flat grey via CSS, never a per-account color)", () => {
		const style = root(mountAvatar({ name: "A", address: "0xdeadbeef" })).attributes("style") ?? ""
		expect(style).not.toMatch(/background/)
		expect(style).not.toMatch(/rgb|#[0-9a-fA-F]{3,6}/)
	})

	test("initials use the primary text color (not white-on-color)", () => {
		expect(mountAvatar({ name: "AB" }).get("span").attributes("color")).toBe("primary")
	})

	test("size prop sets the disc width/height", () => {
		const style = root(mountAvatar({ name: "A", size: 40 })).attributes("style") ?? ""
		expect(style).toContain("width: 40px")
		expect(style).toContain("height: 40px")
	})

	test("defaults to 28px when no size prop", () => {
		expect(root(mountAvatar({ name: "A" })).attributes("style") ?? "").toContain("width: 28px")
	})

	test("font-size scales with size and is floored at 9px for small discs", () => {
		const fzOf = (size: number) => mountAvatar({ name: "A", size }).get("span").attributes("style") ?? ""
		expect(fzOf(40)).toContain("font-size: 16px")
		expect(fzOf(12)).toContain("font-size: 9px")
	})
})
