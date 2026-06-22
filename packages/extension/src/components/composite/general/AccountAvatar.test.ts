import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import AccountAvatar from "./AccountAvatar.vue"

// Flex/Text are auto-registered @nulo/design primitives; default inheritAttrs
// forwards class/style/data-* to the stub root so we can assert them.
const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
}

const PALETTE = ["#C0392B", "#D35400", "#B7950B", "#1E8449", "#117A65", "#2471A3", "#6C3483", "#A93226", "#BA4A78", "#515A5A"]
// jsdom serializes `background: #RRGGBB` into `rgb(r, g, b)` — compare in that form.
const toRgb = (hex: string) => {
	const n = Number.parseInt(hex.slice(1), 16)
	return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
const PALETTE_RGB = PALETTE.map(toRgb)
const bgOf = (w: ReturnType<typeof mountAvatar>) => (root(w).attributes("style") ?? "").match(/rgb\([^)]*\)/)?.[0]

const mountAvatar = (props: Record<string, unknown> = {}) => mount(AccountAvatar, { props, global: { stubs: STUBS } })
const root = (w: ReturnType<typeof mountAvatar>) => w.get('[data-testid="account-avatar"]')

describe("composite/AccountAvatar", () => {
	test("renders with data-testid='account-avatar' for selectors", () => {
		expect(mountAvatar({ name: "Vault", address: "0xabc" }).find('[data-testid="account-avatar"]').exists()).toBe(true)
	})

	test("two-word name → initials of the first two words, uppercased", () => {
		const w = mountAvatar({ name: "Alejo Savings", address: "0x1" })
		expect(w.text()).toBe("AS")
		expect(root(w).attributes("data-initials")).toBe("AS")
	})

	test("single-word name → first two chars, uppercased", () => {
		expect(mountAvatar({ name: "vault", address: "0x1" }).text()).toBe("VA")
	})

	test("three+ word name → only the first two initials", () => {
		expect(mountAvatar({ name: "my cold wallet", address: "0x1" }).text()).toBe("MC")
	})

	test("empty name → empty initials (no crash)", () => {
		const w = mountAvatar({ name: "", address: "0xabc" })
		expect(w.text()).toBe("")
		expect(root(w).attributes("data-initials")).toBe("")
	})

	test("disc color is one of the palette colors", () => {
		expect(PALETTE_RGB).toContain(bgOf(mountAvatar({ name: "A", address: "0xdeadbeef" })))
	})

	test("disc color is deterministic for a given address (across mounts)", () => {
		expect(bgOf(mountAvatar({ name: "X", address: "0xfeedface" }))).toBe(bgOf(mountAvatar({ name: "X", address: "0xfeedface" })))
	})

	test("color keys off the address, not the name (same address + different names → same color)", () => {
		expect(bgOf(mountAvatar({ name: "Alpha", address: "0xsamehash" }))).toBe(bgOf(mountAvatar({ name: "Beta", address: "0xsamehash" })))
	})

	test("falls back to the name for color when no address is given", () => {
		expect(PALETTE_RGB).toContain(bgOf(mountAvatar({ name: "Named" })))
	})

	test("size prop sets the disc width/height", () => {
		const style = root(mountAvatar({ name: "A", address: "0x1", size: 40 })).attributes("style") ?? ""
		expect(style).toContain("width: 40px")
		expect(style).toContain("height: 40px")
	})

	test("defaults to 28px when no size prop", () => {
		const style = root(mountAvatar({ name: "A", address: "0x1" })).attributes("style") ?? ""
		expect(style).toContain("width: 28px")
	})

	test("font-size scales with size and is floored at 9px for small discs", () => {
		const fzOf = (size: number) => mountAvatar({ name: "A", address: "0x1", size }).get("span").attributes("style") ?? ""
		expect(fzOf(40)).toContain("font-size: 16px")
		expect(fzOf(12)).toContain("font-size: 9px")
	})

	test("initials text uses white color (readable on the saturated disc)", () => {
		expect(mountAvatar({ name: "AB", address: "0x1" }).get("span").attributes("color")).toBe("white")
	})
})
