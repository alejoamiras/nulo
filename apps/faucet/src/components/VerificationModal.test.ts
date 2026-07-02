import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import VerificationModal from "./VerificationModal.vue"

const NINE = "🟢🔵🟡🟣🔴⚪⚫🟠🟤"

describe("VerificationModal", () => {
	it("renders when emojis is non-null", () => {
		const w = mount(VerificationModal, {
			props: { emojis: NINE },
			attachTo: document.body,
		})
		expect(document.querySelector(`[data-testid="${TESTIDS.verificationModal}"]`)).not.toBeNull()
		w.unmount()
	})

	it("does NOT render when emojis is null", () => {
		mount(VerificationModal, { props: { emojis: null }, attachTo: document.body })
		expect(document.querySelector(`[data-testid="${TESTIDS.verificationModal}"]`)).toBeNull()
	})

	it("renders the title and body copy from the plan", () => {
		const w = mount(VerificationModal, {
			props: { emojis: NINE },
			attachTo: document.body,
		})
		expect(document.body.textContent).toContain("VERIFY THE GRID")
		expect(document.body.textContent).toContain("Match this grid")
		w.unmount()
	})

	it("emits 'confirm' when the They Match button is clicked", async () => {
		const w = mount(VerificationModal, {
			props: { emojis: NINE },
			attachTo: document.body,
		})
		const btn = document.querySelector(`[data-testid="${TESTIDS.btnVerifyConfirm}"]`) as HTMLElement
		btn.click()
		await Promise.resolve()
		expect(w.emitted("confirm")).toHaveLength(1)
		w.unmount()
	})

	it("emits 'cancel' when the Cancel button is clicked", async () => {
		const w = mount(VerificationModal, {
			props: { emojis: NINE },
			attachTo: document.body,
		})
		const btn = document.querySelector(`[data-testid="${TESTIDS.btnVerifyCancel}"]`) as HTMLElement
		btn.click()
		await Promise.resolve()
		expect(w.emitted("cancel")).toHaveLength(1)
		w.unmount()
	})
})
