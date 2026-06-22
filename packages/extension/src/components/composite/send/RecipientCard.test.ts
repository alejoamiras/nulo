import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import RecipientCard from "./RecipientCard.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>", props: ["size", "weight", "color", "noWrap", "mono", "selectable"] },
	Icon: { template: '<i data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	AccountAvatar: { template: '<div data-testid="stub-avatar" :data-name="name" />', props: ["name", "address", "size"] },
}

// 66-char address: 0x + 64 hex. slice(0,8)="0x111111", slice(-8)="abcd1234".
const FULL = `0x${"1".repeat(56)}abcd1234`
const MASKED = "0x111111…abcd1234"

const mountCard = (props: Record<string, unknown> = {}) =>
	mount(RecipientCard, { props: { address: FULL, ...props }, global: { stubs: STUBS } })

describe("composite/send/RecipientCard", () => {
	test("renders with data-testid='recipient-card'", () => {
		expect(mountCard({ name: "Alice" }).find('[data-testid="recipient-card"]').exists()).toBe(true)
	})

	test("shows the recipient name when provided", () => {
		expect(mountCard({ name: "Alice" }).text()).toContain("Alice")
	})

	test("falls back to 'Address' when no name (raw typed/pasted address)", () => {
		expect(mountCard({}).text()).toContain("Address")
	})

	test("masks the address as first-8 … last-8 (single ellipsis)", () => {
		expect(mountCard({ name: "Alice" }).get('[data-testid="recipient-card-masked"]').text()).toBe(MASKED)
	})

	test("a short address is shown as-is (no masking)", () => {
		expect(mountCard({ address: "0xabcd" }).get('[data-testid="recipient-card-masked"]').text()).toBe("0xabcd")
	})

	test("the full address is hidden until revealed", () => {
		expect(mountCard({ name: "Alice" }).find('[data-testid="recipient-card-full"]').exists()).toBe(false)
	})

	test("tapping reveal shows the FULL address (verification surface)", async () => {
		const w = mountCard({ name: "Alice" })
		await w.get('[data-testid="recipient-card-reveal"]').trigger("click")
		expect(w.get('[data-testid="recipient-card-full"]').text()).toContain(FULL)
	})

	test("reveal toggles closed again on a second tap", async () => {
		const w = mountCard({ name: "Alice" })
		const btn = w.get('[data-testid="recipient-card-reveal"]')
		await btn.trigger("click")
		await btn.trigger("click")
		expect(w.find('[data-testid="recipient-card-full"]').exists()).toBe(false)
	})

	test("reveal button aria-label reflects the toggle state", async () => {
		const w = mountCard({ name: "Alice" })
		const btn = w.get('[data-testid="recipient-card-reveal"]')
		expect(btn.attributes("aria-label")).toBe("Reveal full address")
		await btn.trigger("click")
		expect(btn.attributes("aria-label")).toBe("Hide full address")
	})

	test("the change button emits 'change'", async () => {
		const w = mountCard({ name: "Alice" })
		await w.get('[data-testid="recipient-card-change"]').trigger("click")
		expect(w.emitted("change")).toBeTruthy()
	})

	test("passes the name through to the AccountAvatar", () => {
		expect(mountCard({ name: "Alice" }).get('[data-testid="stub-avatar"]').attributes("data-name")).toBe("Alice")
	})
})
