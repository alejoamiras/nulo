import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import SecretCountdownClose from "./SecretCountdownClose.vue"

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
}

const factory = (props: Record<string, unknown> = {}) =>
	mount(SecretCountdownClose, {
		props: { progressDurationMs: 120_000, ...props },
		global: { stubs: STUBS },
	})

describe("composite/SecretCountdownClose", () => {
	test("renders the Close button with the canonical testid", () => {
		const w = factory()
		expect(w.find('[data-testid="close-btn"]').exists()).toBe(true)
	})

	test("Close button always renders the literal 'Close' label", () => {
		const w = factory()
		expect(w.find('[data-testid="close-btn"]').text()).toContain("Close")
	})

	test("countdownLabel is appended after a separator when provided", () => {
		const w = factory({ countdownLabel: "1:30" })
		const text = w.find('[data-testid="close-btn"]').text().replace(/\s+/g, " ")
		expect(text).toContain("Close · 1:30")
	})

	test("when autoCloseDisabled is true, the countdown label is hidden", () => {
		const w = factory({ countdownLabel: "1:30", autoCloseDisabled: true })
		expect(w.find('[data-testid="close-btn"]').text()).not.toContain("·")
	})

	test("progress bar overlay appears only when auto-close is active", () => {
		const w = factory({ countdownLabel: "1:30" })
		expect(w.find("button > div").exists()).toBe(true)
	})

	test("progress bar overlay is hidden once autoCloseDisabled flips true", () => {
		const w = factory({ countdownLabel: "1:30", autoCloseDisabled: true })
		expect(w.find("button > div").exists()).toBe(false)
	})

	test("progressDurationMs drives the inline animation-duration", () => {
		const w = factory({ countdownLabel: "1:30", progressDurationMs: 300_000 })
		const bar = w.find("button > div")
		expect(bar.attributes("style")).toContain("300000ms")
	})

	test("clicking the Close button emits 'close'", async () => {
		const w = factory()
		await w.find('[data-testid="close-btn"]').trigger("click")
		expect(w.emitted("close")).toHaveLength(1)
	})

	test("'Disable auto-close' link appears while auto-close is active", () => {
		const w = factory()
		expect(w.text()).toContain("Disable auto-close")
	})

	test("'Disable auto-close' link disappears when autoCloseDisabled is true", () => {
		const w = factory({ autoCloseDisabled: true })
		expect(w.text()).not.toContain("Disable auto-close")
	})

	test("clicking the ghost link emits 'disableAutoClose'", async () => {
		const w = factory()
		const buttons = w.findAll("button")
		// 2 buttons: close (testid'd) + ghost link
		const ghost = buttons.find((b) => b.text() === "Disable auto-close")
		expect(ghost).toBeTruthy()
		await ghost!.trigger("click")
		expect(w.emitted("disableAutoClose")).toHaveLength(1)
	})
})
