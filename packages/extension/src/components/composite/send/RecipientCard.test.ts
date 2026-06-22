import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import RecipientCard from "./RecipientCard.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>", props: ["size", "weight", "color", "noWrap", "mono", "selectable"] },
	Icon: { template: '<i data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	AccountAvatar: {
		template: '<div data-testid="stub-avatar" :data-address="address" :data-name="name" />',
		props: ["name", "address", "size"],
	},
}

// 66-char address: 0x + 64 hex. slice(0,8)="0x111111", slice(-8)="abcd1234".
const FULL = `0x${"1".repeat(56)}abcd1234`
const MASKED = "0x111111…abcd1234"

const mountCard = (props: Record<string, unknown> = {}) =>
	mount(RecipientCard, { props: { address: FULL, ...props }, global: { stubs: STUBS } })

const writeText = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
	writeText.mockClear()
	Object.assign(window.navigator, { clipboard: { writeText } })
})
afterEach(() => vi.clearAllTimers())

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

	test("masks the address as first-8 *** last-8", () => {
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
		const full = w.get('[data-testid="recipient-card-full"]')
		expect(full.text()).toContain(FULL)
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

	test("copy writes the FULL address to the clipboard and emits 'copied'", async () => {
		const w = mountCard({ name: "Alice" })
		await w.get('[data-testid="recipient-card-reveal"]').trigger("click")
		await w.get('[data-testid="recipient-card-copy"]').trigger("click")
		expect(writeText).toHaveBeenCalledWith(FULL)
		expect(w.emitted("copied")).toBeTruthy()
	})

	test("copy shows a transient 'Copied' confirmation", async () => {
		const w = mountCard({ name: "Alice" })
		await w.get('[data-testid="recipient-card-reveal"]').trigger("click")
		await w.get('[data-testid="recipient-card-copy"]').trigger("click")
		await w.vm.$nextTick()
		expect(w.get('[data-testid="recipient-card-copy"]').text()).toContain("Copied")
	})

	test("copy emits 'copy-error' (not 'copied') when the clipboard write fails", async () => {
		writeText.mockRejectedValueOnce(new Error("denied"))
		const w = mountCard({ name: "Alice" })
		await w.get('[data-testid="recipient-card-reveal"]').trigger("click")
		await w.get('[data-testid="recipient-card-copy"]').trigger("click")
		await flushPromises()
		expect(w.emitted("copy-error")).toBeTruthy()
		expect(w.emitted("copied")).toBeFalsy()
	})

	test("the change button emits 'change'", async () => {
		const w = mountCard({ name: "Alice" })
		await w.get('[data-testid="recipient-card-change"]').trigger("click")
		expect(w.emitted("change")).toBeTruthy()
	})

	test("passes name + address through to the AccountAvatar", () => {
		const w = mountCard({ name: "Alice" })
		const avatar = w.get('[data-testid="stub-avatar"]')
		expect(avatar.attributes("data-address")).toBe(FULL)
		expect(avatar.attributes("data-name")).toBe("Alice")
	})
})
