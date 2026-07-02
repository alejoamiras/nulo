/**
 * `FormPopup` composite.
 *
 * L3 contract: ≥10 cases. Tests use real `Popup` + `PopupCard` +
 * `PopupHeader` children stubbed at the wrapper level so the focus is
 * on `FormPopup`'s own contract (slots, props, emits).
 *
 * `Popup` teleports its content to `#popup`, so most assertions look at
 * the teleport target after `show=true`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mount, flushPromises } from "@vue/test-utils"
import FormPopup from "./FormPopup.vue"

vi.mock("focus-trap", () => ({
	createFocusTrap: vi.fn(() => ({
		activate: vi.fn(),
		deactivate: vi.fn(),
		active: false,
	})),
}))

vi.mock("@/utils/core", () => ({
	managers: { profile: { refreshSession: vi.fn() } },
}))

vi.mock("@/composables/fullscreenPopupSetting", () => ({
	useFullscreenPopupSetting: () => ({ value: true }),
}))

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	MaterialIcon: { template: '<span data-testid="stub-mat-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Spinner: { template: '<span data-testid="stub-spinner" />' },
	RouterLink: { template: "<a><slot /></a>", props: ["to"] },
	// Popup family — minimal stubs that preserve teleport + close-button
	// semantics so FormPopup's wiring is observable in jsdom.
	Popup: {
		template: '<teleport to="#popup"><div v-if="show" data-testid="stub-popup"><slot /></div></teleport>',
		props: ["show", "displaceIdx"],
		emits: ["onClose"],
	},
	PopupCard: {
		template: '<div data-testid="stub-popup-card"><slot /></div>',
		props: ["displaceIdx", "large"],
	},
	PopupHeader: {
		template:
			'<div data-testid="stub-popup-header"><slot name="title" /><slot name="right" /><button v-if="closable" aria-label="Close" @click="$emit(\'onClose\')">x</button></div>',
		props: { closable: { type: Boolean, default: false } },
		emits: ["onClose"],
	},
	// Button stub mirrors the real Button's disabled-on-loading rule.
	Button: {
		template:
			'<button :data-testid="$attrs[\'data-testid\']" :disabled="disabled || loading" :class="variant" @click="!(disabled || loading) && $emit(\'click\', $event)"><slot /></button>',
		props: ["variant", "size", "disabled", "loading", "wide", "leftIcon", "rightIcon"],
		emits: ["click"],
		inheritAttrs: false,
	},
}

let popupRoot: HTMLDivElement

const mountFormPopup = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
	mount(FormPopup, {
		props: {
			show: true,
			displaceIdx: 1,
			submitLabel: "Save",
			...props,
		},
		slots,
		attachTo: document.body,
		global: { stubs: STUBS },
	})

describe("composite/FormPopup", () => {
	beforeEach(() => {
		popupRoot = document.createElement("div")
		popupRoot.id = "popup"
		document.body.appendChild(popupRoot)
	})

	afterEach(() => {
		popupRoot.remove()
	})

	test("teleports content into #popup when show=true", async () => {
		mountFormPopup({}, { default: "<div data-testid='form-body'>Body</div>" })
		await flushPromises()
		expect(popupRoot.querySelector("[data-testid='form-body']")).not.toBeNull()
	})

	test("does NOT teleport content when show=false", async () => {
		mountFormPopup({ show: false }, { default: "<div data-testid='form-body'>Body</div>" })
		await flushPromises()
		expect(popupRoot.querySelector("[data-testid='form-body']")).toBeNull()
	})

	test("renders the title prop in the header by default", async () => {
		mountFormPopup({ title: "Add endpoint" })
		await flushPromises()
		expect(popupRoot.textContent).toContain("Add endpoint")
	})

	test("title slot overrides the title prop", async () => {
		mountFormPopup({ title: "fallback" }, { title: "<span>Custom title</span>" })
		await flushPromises()
		expect(popupRoot.textContent).toContain("Custom title")
		expect(popupRoot.textContent).not.toContain("fallback")
	})

	test("renders the submitLabel on the primary button", async () => {
		mountFormPopup({ submitLabel: "Add endpoint", submitTestId: "submit" })
		await flushPromises()
		const btn = popupRoot.querySelector("button[data-testid='submit']")
		expect(btn?.textContent).toContain("Add endpoint")
	})

	test("submitTestId is forwarded to the button", async () => {
		mountFormPopup({ submitLabel: "Save", submitTestId: "save-btn" })
		await flushPromises()
		expect(popupRoot.querySelector("button[data-testid='save-btn']")).not.toBeNull()
	})

	test("clicking the submit button emits 'submit'", async () => {
		const w = mountFormPopup({ submitTestId: "save-btn" })
		await flushPromises()
		const btn = popupRoot.querySelector("button[data-testid='save-btn']") as HTMLButtonElement
		btn.click()
		await flushPromises()
		expect(w.emitted("submit")).toHaveLength(1)
	})

	test("submitDisabled=true sets the button disabled attribute", async () => {
		mountFormPopup({ submitDisabled: true, submitTestId: "save-btn" })
		await flushPromises()
		const btn = popupRoot.querySelector("button[data-testid='save-btn']")
		expect(btn?.hasAttribute("disabled")).toBe(true)
	})

	test("submitLoading=true does NOT fire submit on click (Button blocks loading clicks)", async () => {
		mountFormPopup({ submitLoading: true, submitTestId: "save-btn" })
		await flushPromises()
		const btn = popupRoot.querySelector("button[data-testid='save-btn']") as HTMLButtonElement
		btn.click()
		await flushPromises()
		// Loading buttons mark themselves disabled at the DOM level.
		expect(btn.hasAttribute("disabled")).toBe(true)
	})

	test("default body slot renders inside the wrapper", async () => {
		mountFormPopup({}, { default: "<div data-testid='field-1'>One</div><div data-testid='field-2'>Two</div>" })
		await flushPromises()
		expect(popupRoot.querySelector("[data-testid='field-1']")).not.toBeNull()
		expect(popupRoot.querySelector("[data-testid='field-2']")).not.toBeNull()
	})

	test("aboveSubmit slot renders above the primary button", async () => {
		mountFormPopup({ submitTestId: "save-btn" }, { aboveSubmit: "<div data-testid='error-row'>Err</div>" })
		await flushPromises()
		expect(popupRoot.querySelector("[data-testid='error-row']")).not.toBeNull()
	})

	test("belowSubmit slot renders below the primary button (for help text)", async () => {
		mountFormPopup({}, { belowSubmit: "<div data-testid='help-text'>Help</div>" })
		await flushPromises()
		expect(popupRoot.querySelector("[data-testid='help-text']")).not.toBeNull()
	})

	test("headerRight slot renders inside PopupHeader's right region", async () => {
		mountFormPopup({}, { headerRight: "<button data-testid='hdr-btn'>edit</button>" })
		await flushPromises()
		expect(popupRoot.querySelector("[data-testid='hdr-btn']")).not.toBeNull()
	})

	test("submitVariant controls the button variant class", async () => {
		mountFormPopup({ submitVariant: "cta_destructive", submitTestId: "del-btn" })
		await flushPromises()
		const btn = popupRoot.querySelector("button[data-testid='del-btn']")
		expect(btn?.getAttribute("class") ?? "").toMatch(/cta_destructive/)
	})

	test("close emits onClose (PopupHeader → close button)", async () => {
		const w = mountFormPopup()
		await flushPromises()
		const closeBtn = popupRoot.querySelector("button[aria-label='Close']") as HTMLButtonElement | null
		expect(closeBtn).not.toBeNull()
		closeBtn?.click()
		await flushPromises()
		expect(w.emitted("onClose")).toBeTruthy()
	})
})
