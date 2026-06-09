import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const withdrawFn = vi.fn(async (_amount: bigint, _isPrivate: boolean) => {})

vi.mock("@/composables/useWithdraw", () => ({
	useWithdraw: () => ({
		stage: ref("idle"),
		error: ref(null),
		provenBlock: ref(null),
		targetBlock: ref(null),
		hasPending: ref(false),
		withdraw: withdrawFn,
	}),
}))
vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected: ref(true) }),
}))
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ status: ref("connected") }),
}))

import { TESTIDS } from "@/lib/testids"
import WithdrawCard from "./WithdrawCard.vue"

const sel = (t: string) => `[data-testid="${t}"]`

describe("WithdrawCard privacy toggle", () => {
	beforeEach(() => withdrawFn.mockClear())

	it("defaults to public — the private note is hidden", () => {
		const w = mount(WithdrawCard)
		expect(w.find(sel(TESTIDS.withdrawPrivateNote)).exists()).toBe(false)
	})

	it("selecting Private reveals the private-balance note", async () => {
		const w = mount(WithdrawCard)
		await w.find(sel(TESTIDS.withdrawModePrivate)).trigger("click")
		expect(w.find(sel(TESTIDS.withdrawPrivateNote)).exists()).toBe(true)
	})

	it("switching back to Public hides the note again", async () => {
		const w = mount(WithdrawCard)
		await w.find(sel(TESTIDS.withdrawModePrivate)).trigger("click")
		await w.find(sel(TESTIDS.withdrawModePublic)).trigger("click")
		expect(w.find(sel(TESTIDS.withdrawPrivateNote)).exists()).toBe(false)
	})

	it("withdraws PUBLIC by default — isPrivate=false", async () => {
		const w = mount(WithdrawCard)
		await w.find(sel(TESTIDS.withdrawSubmit)).trigger("click")
		expect(withdrawFn).toHaveBeenCalledWith(40_000_000n, false)
	})

	it("withdraws PRIVATE after selecting Private — isPrivate=true", async () => {
		const w = mount(WithdrawCard)
		await w.find(sel(TESTIDS.withdrawModePrivate)).trigger("click")
		await w.find(sel(TESTIDS.withdrawSubmit)).trigger("click")
		expect(withdrawFn).toHaveBeenCalledWith(40_000_000n, true)
	})
})
