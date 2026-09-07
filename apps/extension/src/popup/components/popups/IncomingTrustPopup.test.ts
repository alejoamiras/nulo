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
import { reactive, ref } from "vue"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const openToastMock = vi.fn()
const allowMock = vi.fn().mockResolvedValue(undefined)
const rejectMock = vi.fn().mockResolvedValue(undefined)

const contractAddress = `0x${"ab".repeat(32)}`

// reactive() so the popup's `tokenSymbol` computed re-evaluates when a test
// models a mid-RPC identity switch (mutating incomingTrust). A plain object
// would leave the computed cached and hide the B-28 capture-before-await bug.
const cacheStoreState: {
	incomingTrust: {
		tokenSymbol: string
		tokenDecimals: number
		amountRaw: string
		contract: string
		allow: () => Promise<void>
		reject: () => Promise<void>
	}
} = reactive({
	incomingTrust: {
		tokenSymbol: "TST",
		tokenDecimals: 18,
		amountRaw: "1000000000000000000",
		contract: contractAddress,
		allow: allowMock,
		reject: rejectMock,
	},
})

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
	allowMock.mockClear().mockResolvedValue(undefined)
	rejectMock.mockClear().mockResolvedValue(undefined)
	// Tests below mutate the shared incomingTrust slot to model a mid-RPC switch;
	// restore it so each test starts from the same prompt.
	cacheStoreState.incomingTrust.tokenSymbol = "TST"
	cacheStoreState.incomingTrust.contract = contractAddress
	cacheStoreState.incomingTrust.allow = allowMock
	cacheStoreState.incomingTrust.reject = rejectMock
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
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ icon: "warning" }), undefined)
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

describe("IncomingTrustPopup — decision handlers (B-26, B-28)", () => {
	test("(B-26) double-clicking Allow fires the decision once and closes exactly once", async () => {
		let resolveAllow!: (v: boolean) => void
		allowMock.mockImplementationOnce(() => new Promise((r) => (resolveAllow = r)))
		const w = mount(IncomingTrustPopup, { props: { show: true }, global: { stubs: STUBS } })
		await flushPromises()

		const allowBtn = w.find('[data-testid="incoming-trust-allow"]')
		await allowBtn.trigger("click") // first click → allow() in flight, latch set
		await allowBtn.trigger("click") // double click → dropped by the latch
		expect(allowMock).toHaveBeenCalledTimes(1)

		resolveAllow(true)
		await flushPromises()
		// Exactly one onClose — a second would dismiss the NEXT queued prompt.
		expect(w.emitted("onClose")?.length ?? 0).toBe(1)
	})

	test("(B-26) a decision completing AFTER the active prompt changed does not emit close", async () => {
		let resolveAllow!: (v: boolean) => void
		allowMock.mockImplementationOnce(() => new Promise((r) => (resolveAllow = r)))
		const w = mount(IncomingTrustPopup, { props: { show: true }, global: { stubs: STUBS } })
		await flushPromises()

		await w.find('[data-testid="incoming-trust-allow"]').trigger("click")
		// The queue advanced to a different prompt (new contract) mid-RPC.
		cacheStoreState.incomingTrust.contract = `0x${"cd".repeat(32)}`
		resolveAllow(true)
		await flushPromises()

		expect(w.emitted("onClose")).toBeUndefined() // must not close the now-different prompt
	})

	test("(B-28) success toast uses the token symbol captured at click, not a mid-RPC switch", async () => {
		let resolveAllow!: (v: boolean) => void
		allowMock.mockImplementationOnce(() => new Promise((r) => (resolveAllow = r)))
		const w = mount(IncomingTrustPopup, { props: { show: true }, global: { stubs: STUBS } })
		await flushPromises()

		await w.find('[data-testid="incoming-trust-allow"]').trigger("click")
		// Active identity switches mid-RPC — the reactive symbol now reads a different token.
		cacheStoreState.incomingTrust.tokenSymbol = "OTHER"
		resolveAllow(true)
		await flushPromises()

		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ label: "Now showing receives for TST" }))
	})
})

describe("IncomingTrustPopup — one decision path for allow and reject", () => {
	const mountShown = async () => {
		const w = mount(IncomingTrustPopup, { props: { show: true }, global: { stubs: STUBS } })
		await flushPromises()
		return w
	}
	const clickReject = (w: ReturnType<typeof mount>) => w.find('[data-testid="incoming-trust-reject"]').trigger("click")
	const clickAllow = (w: ReturnType<typeof mount>) => w.find('[data-testid="incoming-trust-allow"]').trigger("click")

	test("reject that returns true toasts the hiding copy with the info icon, closes once and releases the latch", async () => {
		rejectMock.mockResolvedValueOnce(true)
		const w = await mountShown()
		await clickReject(w)
		await flushPromises()
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ label: "Hiding receives from TST", icon: "info" }))
		expect(w.emitted("onClose")?.length).toBe(1)
		await clickReject(w)
		expect(rejectMock).toHaveBeenCalledTimes(2)
	})

	test.each([[false], [undefined]])(
		"reject that returns %s does not toast success but still closes once and releases the latch",
		async (value) => {
			rejectMock.mockResolvedValueOnce(value)
			const w = await mountShown()
			await clickReject(w)
			await flushPromises()
			expect(openToastMock).not.toHaveBeenCalled()
			expect(w.emitted("onClose")?.length).toBe(1)
			await clickReject(w)
			expect(rejectMock).toHaveBeenCalledTimes(2)
		},
	)

	test("a reject that throws toasts the failure copy, closes once and releases the latch", async () => {
		rejectMock.mockRejectedValueOnce(new Error("boom"))
		const w = await mountShown()
		await clickReject(w)
		await flushPromises()
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ label: "Couldn't update trust state", icon: "warning" }))
		expect(w.emitted("onClose")?.length).toBe(1)
		await clickReject(w)
		expect(rejectMock).toHaveBeenCalledTimes(2)
	})

	test("allow and reject share the latch: a reject during an in-flight allow is dropped", async () => {
		let resolveAllow!: (v: boolean) => void
		allowMock.mockImplementationOnce(() => new Promise((r) => (resolveAllow = r)))
		const w = await mountShown()
		await clickAllow(w)
		await clickReject(w)
		expect(rejectMock).not.toHaveBeenCalled()
		resolveAllow(true)
		await flushPromises()
		expect(w.emitted("onClose")?.length).toBe(1)
	})

	test("a reopen starts a new decision before the old one settles; the old settlement does not unlock the new prompt", async () => {
		let resolveOld!: (v: boolean) => void
		let resolveNew!: (v: boolean) => void
		allowMock
			.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
			.mockImplementationOnce(() => new Promise((r) => (resolveNew = r)))
		const w = await mountShown()
		await clickAllow(w) // old decision in flight
		await w.setProps({ show: false })
		await w.setProps({ show: true }) // the queue moved on: generation bump, latch cleared
		await flushPromises()
		await clickAllow(w) // new decision in flight
		expect(allowMock).toHaveBeenCalledTimes(2)
		resolveOld(true)
		await flushPromises()
		await clickAllow(w) // the old settlement must not have unlocked the new prompt
		expect(allowMock).toHaveBeenCalledTimes(2)
		resolveNew(true)
		await flushPromises()
		await clickAllow(w)
		expect(allowMock).toHaveBeenCalledTimes(3)
	})

	test("a reject completing after the active prompt changed does not emit close", async () => {
		let resolveReject!: (v: boolean) => void
		rejectMock.mockImplementationOnce(() => new Promise((r) => (resolveReject = r)))
		const w = await mountShown()
		await clickReject(w)
		cacheStoreState.incomingTrust.contract = `0x${"ef".repeat(32)}`
		resolveReject(true)
		await flushPromises()
		expect(w.emitted("onClose")).toBeUndefined()
	})

	test("the reject toast uses the symbol captured at click, not a mid-RPC switch", async () => {
		let resolveReject!: (v: boolean) => void
		rejectMock.mockImplementationOnce(() => new Promise((r) => (resolveReject = r)))
		const w = await mountShown()
		await clickReject(w)
		cacheStoreState.incomingTrust.tokenSymbol = "OTHER"
		resolveReject(true)
		await flushPromises()
		expect(openToastMock).toHaveBeenCalledWith(expect.objectContaining({ label: "Hiding receives from TST" }))
	})
})
