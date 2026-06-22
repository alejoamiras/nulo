/**
 * Tests for the contract-verification redesign of IncomingTrustPopup.
 *
 * The popup is the only chokepoint where a user can see + verify the
 * full contract address before allowing receives from it — so its
 * keyboard/copy/expand affordances are security-relevant, not polish.
 *
 * Coverage:
 *   - default: trimmed address visible; full not in DOM (aria-expanded=false)
 *   - expand: click toggle → full in DOM + aria-expanded=true + testid present
 *   - collapse: click again → full removed + aria-expanded=false
 *   - copy: click → navigator.clipboard.writeText called with full address +
 *           toast fired
 *   - copy fail: clipboard throws → warning toast + no crash
 *   - initial focus on expand toggle when show=true (verification-first)
 *   - state reset when popup closes (show=false → expanded=false)
 */

import { flushPromises, mount } from "@vue/test-utils"
import { ref } from "vue"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const openToastMock = vi.fn()
const allowMock = vi.fn().mockResolvedValue(undefined)
const rejectMock = vi.fn().mockResolvedValue(undefined)

const contractAddress = `0x${"ab".repeat(32)}`

const cacheStoreState: {
	incomingTrust: {
		tokenSymbol: string
		tokenDecimals: number
		amountRaw: string
		contract: string
		allow: () => Promise<void>
		reject: () => Promise<void>
	}
} = {
	incomingTrust: {
		tokenSymbol: "TST",
		tokenDecimals: 18,
		amountRaw: "1000000000000000000",
		contract: contractAddress,
		allow: allowMock,
		reject: rejectMock,
	},
}

vi.mock("@/stores/cache.store.ts", () => ({
	useCacheStore: () => cacheStoreState,
}))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ len: 1, popups: { incoming_trust: { order: 0 } } }),
}))
vi.mock("@/composables/toast", () => ({
	useToast: () => ({
		openToast: openToastMock,
		TOAST_DURATION: { SHORT: 1500, DEFAULT: 2000, LONG: 4000 },
	}),
}))
vi.mock("@/utils/amount.js", () => ({
	balanceFormatted: (raw: string, _decimals: number, _max: number) => ({ value: raw }),
}))
vi.mock("@/utils/string", () => ({
	trimAddress: (s: string, head: number, tail: number) => `${s.slice(0, head)}…${s.slice(-tail)}`,
}))

const STUBS = {
	Popup: {
		props: ["show", "displaceIdx"],
		emits: ["onClose"],
		template: '<div v-if="show" data-testid="popup-root"><slot /></div>',
	},
	PopupCard: { template: "<div><slot /></div>" },
	Flex: { template: "<div><slot /></div>" },
	Icon: {
		props: ["name", "size", "color"],
		template: '<i :data-icon="name" />',
	},
	Text: { template: "<span><slot /></span>" },
	Button: {
		props: ["wide", "variant", "size"],
		emits: ["click"],
		template: "<button :data-testid=\"$attrs['data-testid']\" @click=\"$emit('click')\"><slot /></button>",
		inheritAttrs: false,
	},
}

import IncomingTrustPopup from "./IncomingTrustPopup.vue"

beforeEach(() => {
	openToastMock.mockClear()
	allowMock.mockClear()
	rejectMock.mockClear()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("IncomingTrustPopup — contract verification surface", () => {
	test("default state: trimmed address visible; full row in DOM but hidden; aria-expanded=false; aria-controls absent", async () => {
		const show = ref(true)
		const w = mount(IncomingTrustPopup, { props: { show: show.value }, global: { stubs: STUBS } })
		await flushPromises()

		const trimmed = w.find('[data-testid="incoming-trust-contract"]')
		expect(trimmed.exists()).toBe(true)
		expect(trimmed.text()).toBe(`0xabab…abab`)

		const expandBtn = w.find('[data-testid="incoming-trust-contract-expand"]')
		expect(expandBtn.exists()).toBe(true)
		expect(expandBtn.attributes("aria-expanded")).toBe("false")
		// aria-controls is conditionally emitted only when expanded — APG SC 4.1.2 +
		// ARIA 1.2: no dangling controls reference + no focusable invisible target.
		expect(expandBtn.attributes("aria-controls")).toBeUndefined()

		// Under v-show the node is in the DOM with style="display: none". The
		// inner [data-testid="incoming-trust-contract-full"] is inside the
		// hidden container; check the container has display:none rather than
		// using `isVisible()` (which doesn't walk through Vue's stub trees
		// reliably with our minimal Flex/PopupCard stubs).
		const fullRow = w.find("#incoming-trust-contract-full")
		expect(fullRow.exists()).toBe(true)
		expect(fullRow.attributes("style") ?? "").toContain("display: none")
		expect(w.find('[data-testid="incoming-trust-contract-full"]').exists()).toBe(true)
		expect(w.find('[data-testid="incoming-trust-contract-copy"]').exists()).toBe(true)
	})

	test("expand: click toggle → aria-expanded=true + aria-controls resolves + full address visible", async () => {
		const w = mount(IncomingTrustPopup, { props: { show: true }, global: { stubs: STUBS } })
		await flushPromises()

		await w.find('[data-testid="incoming-trust-contract-expand"]').trigger("click")

		const full = w.find('[data-testid="incoming-trust-contract-full"]')
		expect(full.exists()).toBe(true)
		expect(full.text()).toBe(contractAddress)
		// Container should NOT have display:none after expand.
		const fullRow = w.find("#incoming-trust-contract-full")
		expect(fullRow.attributes("style") ?? "").not.toContain("display: none")

		const expandBtn = w.find('[data-testid="incoming-trust-contract-expand"]')
		expect(expandBtn.attributes("aria-expanded")).toBe("true")
		expect(expandBtn.attributes("aria-controls")).toBe("incoming-trust-contract-full")

		expect(w.find('[data-testid="incoming-trust-contract-copy"]').exists()).toBe(true)
	})

	test("collapse: a second click on expand toggle → full hidden + aria-expanded=false + aria-controls absent", async () => {
		const w = mount(IncomingTrustPopup, { props: { show: true }, global: { stubs: STUBS } })
		await flushPromises()
		const expandBtn = w.find('[data-testid="incoming-trust-contract-expand"]')

		await expandBtn.trigger("click")
		// v-show keeps the node in DOM; check the FULL ROW container has no
		// display:none, not just the inner span.
		const expandedRow = () => w.find("#incoming-trust-contract-full")
		expect(expandedRow().attributes("style") ?? "").not.toContain("display: none")

		await expandBtn.trigger("click")
		expect(expandedRow().attributes("style") ?? "").toContain("display: none")
		expect(expandBtn.attributes("aria-expanded")).toBe("false")
		expect(expandBtn.attributes("aria-controls")).toBeUndefined()
	})

	test("copy: click → navigator.clipboard.writeText called with full address + success toast", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		const w = mount(IncomingTrustPopup, { props: { show: true }, global: { stubs: STUBS } })
		await flushPromises()

		await w.find('[data-testid="incoming-trust-contract-expand"]').trigger("click")
		await w.find('[data-testid="incoming-trust-contract-copy"]').trigger("click")
		await flushPromises()

		expect(writeText).toHaveBeenCalledExactlyOnceWith(contractAddress)
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ label: "Contract address copied" }), expect.any(Number))
	})

	test("copy failure: clipboard throws → warning toast fires + no crash", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("denied"))
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		const w = mount(IncomingTrustPopup, { props: { show: true }, global: { stubs: STUBS } })
		await flushPromises()

		await w.find('[data-testid="incoming-trust-contract-expand"]').trigger("click")
		await w.find('[data-testid="incoming-trust-contract-copy"]').trigger("click")
		await flushPromises()

		expect(writeText).toHaveBeenCalled()
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ icon: "warning" }))
	})

	test("state reset on close: open → expand → close → reopen reads collapsed", async () => {
		const w = mount(IncomingTrustPopup, { props: { show: true }, global: { stubs: STUBS } })
		await flushPromises()

		await w.find('[data-testid="incoming-trust-contract-expand"]').trigger("click")
		expect(w.find("#incoming-trust-contract-full").attributes("style") ?? "").not.toContain("display: none")

		await w.setProps({ show: false })
		await flushPromises()
		await w.setProps({ show: true })
		await flushPromises()

		// After reopen, full row should be hidden again (display:none under v-show)
		// to prevent state bleed across separate pending contracts.
		expect(w.find("#incoming-trust-contract-full").attributes("style") ?? "").toContain("display: none")
		expect(w.find('[data-testid="incoming-trust-contract-expand"]').attributes("aria-expanded")).toBe("false")
	})
})

describe("F-009 / Phase 6: token symbol sanitization", () => {
	test("strips bidi-override + zero-width chars from on-chain-supplied tokenSymbol", async () => {
		// RTL override (U+202E) + zero-width space (U+200B) injected into a
		// "USDC" lookalike. Pre-fix this would render with the override
		// active, letting a phishing token visually impersonate USDC.
		cacheStoreState.incomingTrust.tokenSymbol = "U‮SDC​"
		const show = ref(true)
		const w = mount(IncomingTrustPopup, { props: { show: show.value }, global: { stubs: STUBS } })
		await flushPromises()
		// Sanitized output should not contain the control codepoints.
		const html = w.html()
		expect(html).not.toMatch(/‮/)
		expect(html).not.toMatch(/​/)
		// Reset for other tests.
		cacheStoreState.incomingTrust.tokenSymbol = "TST"
	})
})
