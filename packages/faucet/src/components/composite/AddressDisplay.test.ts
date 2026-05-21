import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AddressDisplay from "./AddressDisplay.vue"

const FULL = "0x12345678901234567890123456789012345678901234567890123456789012ab"

describe("AddressDisplay", () => {
	let writeText: ReturnType<typeof vi.fn>
	beforeEach(() => {
		writeText = vi.fn(async () => {})
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it("shortens long addresses using the default head/tail split", () => {
		const w = mount(AddressDisplay, { props: { address: FULL } })
		expect(w.text()).toContain(`${FULL.slice(0, 6)}…${FULL.slice(-4)}`)
	})

	it("shows the full address as the button title and aria-label", () => {
		const w = mount(AddressDisplay, { props: { address: FULL } })
		const btn = w.get("button")
		expect(btn.attributes("title")).toBe(FULL)
		expect(btn.attributes("aria-label")).toBe(`Copy address ${FULL}`)
	})

	it("emits 'copy' with the full address when clicked", async () => {
		const w = mount(AddressDisplay, { props: { address: FULL } })
		await w.get("button").trigger("click")
		await Promise.resolve()
		expect(writeText).toHaveBeenCalledWith(FULL)
		expect(w.emitted("copy")?.[0]).toEqual([FULL])
	})

	it("renders custom head/tail lengths", () => {
		const w = mount(AddressDisplay, { props: { address: FULL, head: 4, tail: 6 } })
		expect(w.text()).toContain(`${FULL.slice(0, 4)}…${FULL.slice(-6)}`)
	})

	it("renders an em-dash for the empty string", () => {
		const w = mount(AddressDisplay, { props: { address: "" } })
		expect(w.text()).toContain("—")
	})
})
