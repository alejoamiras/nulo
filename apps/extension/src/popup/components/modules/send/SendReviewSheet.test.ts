import { mount } from "@vue/test-utils"
import { afterEach, describe, expect, test } from "vitest"
import {
	FACT_SENTENCES,
	noticeBodyFor,
	PAID_BY,
	type PayerDescriptor,
	type PayerKind,
	type PublishFacts,
	publishFacts,
} from "@/components/composite/send/publish-facts"
import mark from "@/components/composite/send/publish-mark.module.css"
import { FEE_JUICE_BRIDGE_URL } from "./fee-helpers"
import SendReviewSheet from "./SendReviewSheet.vue"

const STUBS = {
	Flex: { template: '<div v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	MaterialIcon: { template: "<span />" },
	// The popup family is stubbed to what the sheet wires into it: the stack numbers, escape, initial focus, close.
	Popup: {
		name: "Popup",
		template:
			'<div v-if="show" data-testid="stub-popup" :data-order="displaceIdx" :data-escape="closeOnEscape" :data-focus="initialFocus"><slot /></div>',
		props: { show: Boolean, displaceIdx: Number, closeOnEscape: Boolean, initialFocus: [String, Boolean] },
		emits: ["onClose"],
	},
	PopupCard: { template: '<div data-testid="stub-card" :data-depth="displaceIdx"><slot /></div>', props: ["displaceIdx"] },
	PopupHeader: {
		template:
			'<div><slot name="title" /><button v-if="closable" data-testid="popup-close-btn" @click="$emit(\'onClose\')">x</button></div>',
		props: { closable: { type: Boolean, default: false } },
		emits: ["onClose"],
	},
	Button: {
		template: '<button v-bind="$attrs" :disabled="disabled || loading" @click="$emit(\'click\', $event)"><slot /></button>',
		props: ["variant", "size", "disabled", "loading", "wide"],
		emits: ["click"],
		inheritAttrs: false,
	},
}

const ADDRESS = `0x${"a".repeat(56)}12345678`
type SheetProps = {
	show: boolean
	order: number
	depth: number
	facts: PublishFacts
	amount?: string
	symbol?: string
	recipientName?: string
	recipientAddress?: string
	feeText?: string
	payerKind: PayerKind
	payerType?: PayerDescriptor["type"]
	canSend: boolean
	sending: boolean
	ready: boolean
}
const BASE: SheetProps = {
	show: true,
	order: 0,
	depth: 1,
	facts: publishFacts("private", "private", "account"),
	amount: "25",
	symbol: "TST",
	recipientName: "Ana",
	recipientAddress: ADDRESS,
	feeText: "~0.0028 FJ",
	payerKind: "account",
	payerType: "fj",
	canSend: true,
	sending: false,
	ready: true,
}

const mountSheet = (props: Partial<SheetProps> = {}) => mount(SendReviewSheet, { props: { ...BASE, ...props }, global: { stubs: STUBS } })
type W = ReturnType<typeof mountSheet>
const row = (w: W, id: string) => w.get(`[data-testid="send-review-row-${id}"]`)
const submit = (w: W) => w.get('[data-testid="send-review-submit"]')

describe("modules/send/SendReviewSheet", () => {
	let w: W | undefined
	afterEach(() => w?.unmount())

	test("joins the popup stack with the slot's order and its own depth, escape and initial focus", () => {
		w = mountSheet({ order: 2, depth: 3 })
		const popup = w.get('[data-testid="stub-popup"]')
		expect(popup.attributes("data-order")).toBe("2")
		expect(popup.attributes("data-escape")).toBe("true")
		expect(popup.attributes("data-focus")).toBe("#send-review-title")
		expect(w.get('[data-testid="stub-card"]').attributes("data-depth")).toBe("3")
		expect(w.get("#send-review-title").attributes("tabindex")).toBe("-1")
		const dialog = w.get('[role="dialog"]')
		expect(dialog.attributes("aria-modal")).toBe("true")
		expect(dialog.attributes("aria-labelledby")).toBe("send-review-title")
	})

	test("the open marker stays in the page whether or not the popup renders", async () => {
		w = mountSheet({ show: false })
		expect(w.get('[data-testid="send-review-sheet"]').attributes("data-open")).toBe("false")
		expect(w.find('[data-testid="stub-popup"]').exists()).toBe(false)
		await w.setProps({ show: true })
		expect(w.get('[data-testid="send-review-sheet"]').attributes("data-open")).toBe("true")
	})

	test("summary: amount with its symbol, the recipient's name and masked address", () => {
		w = mountSheet()
		expect(w.get('[data-testid="send-review-amount"]').text()).toBe("25TST")
		expect(w.get('[data-testid="send-review-recipient"]').text()).toBe("to Ana · 0xaaaaaa…12345678")
	})

	test("an unfinished form reads — and cannot send", () => {
		w = mountSheet({
			amount: undefined,
			recipientName: undefined,
			recipientAddress: undefined,
			feeText: undefined,
			canSend: false,
			payerKind: null,
			payerType: undefined,
		})
		expect(w.get('[data-testid="send-review-amount"]').text()).toBe("—")
		expect(w.get('[data-testid="send-review-recipient"]').text()).toBe("to — · —")
		expect(w.get('[data-testid="send-review-fee"]').text()).toBe("Fee · —")
		expect(w.get('[data-testid="send-review-fee"]').attributes("data-payer")).toBe("none")
		expect(submit(w).attributes("disabled")).toBeDefined()
	})

	test.each([
		[
			"private → private, own fee juice",
			publishFacts("private", "private", "account"),
			"account",
			["exposed", "hidden", "hidden"],
			"private-private",
		],
		[
			"private → public, own fee juice",
			publishFacts("private", "public", "account"),
			"account",
			["exposed", "public", "public"],
			"private-public",
		],
		[
			"private → private, protocol contract",
			publishFacts("private", "private", "contract"),
			"contract",
			["hidden", "hidden", "hidden"],
			undefined,
		],
		["public → private", publishFacts("public", "private", "contract"), "contract", ["public", "hidden", "public"], undefined],
		[
			"private → public, hand-added sponsor",
			publishFacts("private", "public", "unvouched"),
			"unvouched",
			["unknown", "public", "public"],
			undefined,
		],
	] as const)("rows for %s", (_name, facts, payerKind, visibilities, shape) => {
		w = mountSheet({ facts, payerKind })
		expect(["you", "to", "amount"].map((id) => row(w as W, id).attributes("data-visibility"))).toEqual(visibilities)
		expect(row(w, "you").attributes("data-notice-shape")).toBe(shape)
		for (const [i, id] of ["you", "to", "amount"].entries()) {
			const filled = visibilities[i] === "public" || visibilities[i] === "exposed"
			expect(row(w, id).get("i").classes().includes(mark.filled), id).toBe(filled)
			expect(row(w, id).classes()).toContain(mark[visibilities[i] as keyof typeof mark])
		}
	})

	test("public rows carry their sentence, hidden rows none, and the gated row its remedy link", () => {
		w = mountSheet({ facts: publishFacts("private", "public", "account") })
		expect(row(w, "you").text()).toContain(noticeBodyFor("private-public"))
		expect(row(w, "to").text()).toContain(FACT_SENTENCES.recipient)
		expect(row(w, "amount").text()).toContain(FACT_SENTENCES.amount)
		const remedy = w.get('[data-testid="send-fee-privacy-remedy"]')
		expect(remedy.attributes("href")).toBe(FEE_JUICE_BRIDGE_URL)
		expect(remedy.attributes("target")).toBe("_blank")
		expect(remedy.attributes("rel")).toBe("noopener noreferrer")

		w.unmount()
		w = mountSheet({ facts: publishFacts("private", "private", "account") })
		expect(row(w, "you").text()).toContain(noticeBodyFor("private-private"))
		expect(row(w, "to").text()).toBe("RecipientHIDDEN")
		expect(row(w, "amount").text()).toBe("AmountHIDDEN")

		w.unmount()
		w = mountSheet({ facts: publishFacts("public", "private", "contract"), payerKind: "contract", payerType: "private_fpc" })
		expect(row(w, "you").text()).toContain(FACT_SENTENCES.sender)
		expect(w.find('[data-testid="send-fee-privacy-remedy"]').exists()).toBe(false)
	})

	test("a hand-added sponsor reads — with its sentence; a pending payer reads — with none", () => {
		w = mountSheet({ facts: publishFacts("private", "private", "unvouched"), payerKind: "unvouched", payerType: "fpc" })
		expect(row(w, "you").text()).toBe(`Your address—${FACT_SENTENCES.unvouched}`)
		w.unmount()
		w = mountSheet({ facts: publishFacts("private", "private", null), payerKind: null, payerType: undefined })
		expect(row(w, "you").text()).toBe("Your address—")
	})

	test.each([
		["account", "fj", PAID_BY.account],
		["contract", "private_fpc", PAID_BY.contract],
		["contract", "fpc", PAID_BY.sponsor],
		["unvouched", "fpc", PAID_BY.sponsor],
	] as const)("the fee line for payer %s / %s", (payerKind, payerType, paidBy) => {
		w = mountSheet({ payerKind, payerType })
		const fee = w.get('[data-testid="send-review-fee"]')
		expect(fee.text()).toBe(`Fee · ~0.0028 FJ${paidBy}`)
		expect(fee.attributes("data-payer")).toBe(payerKind)
	})

	test("send now: enabled and emitting only when shown, sendable, ready and idle", async () => {
		w = mountSheet()
		expect(submit(w).attributes("data-ready")).toBe("true")
		expect(submit(w).attributes("disabled")).toBeUndefined()
		await submit(w).trigger("click")
		expect(w.emitted("send")).toEqual([[]])
	})

	test.each([
		["not ready", { ready: false }],
		["cannot send", { canSend: false }],
		["already sending", { sending: true }],
	])("send now is disabled and silent when %s, even on a programmatic click", async (_name, props) => {
		w = mountSheet(props)
		expect(submit(w).attributes("disabled")).toBeDefined()
		submit(w).element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
		;(w.vm as unknown as { handleSend?: () => void }).handleSend?.()
		expect(w.emitted("send")).toBeUndefined()
	})

	test("the guard reads the live props, not the mount-time ones", async () => {
		w = mountSheet({ ready: false })
		await submit(w).trigger("click")
		expect(w.emitted("send")).toBeUndefined()
		await w.setProps({ ready: true })
		await submit(w).trigger("click")
		expect(w.emitted("send")).toEqual([[]])
	})

	test("close comes from the header button and from the popup's own close paths", async () => {
		w = mountSheet()
		await w.get('[data-testid="popup-close-btn"]').trigger("click")
		expect(w.emitted("close")).toHaveLength(1)
		w.findComponent({ name: "Popup" }).vm.$emit("onClose")
		expect(w.emitted("close")).toHaveLength(2)
	})
})
