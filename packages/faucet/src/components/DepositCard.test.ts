import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const depositFn = vi.fn(async (_amount: bigint, _isPrivate: boolean) => {})
const hasPendingRef = ref(false)

vi.mock("@/composables/useDeposit", () => ({
	useDeposit: () => ({
		stage: ref("idle"),
		error: ref(null),
		hasPending: hasPendingRef,
		deposit: depositFn,
		discardPending: vi.fn(),
	}),
}))
vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ isConnected: ref(true) }),
}))
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ status: ref("connected") }),
}))

import { TESTIDS } from "@/lib/testids"
import DepositCard from "./DepositCard.vue"

const sel = (t: string) => `[data-testid="${t}"]`

describe("DepositCard privacy toggle", () => {
	beforeEach(() => {
		depositFn.mockClear()
		hasPendingRef.value = false
	})

	it("defaults to public — the bearer warning is hidden", () => {
		const w = mount(DepositCard)
		expect(w.find(sel(TESTIDS.depositBearerWarning)).exists()).toBe(false)
	})

	it("selecting Private reveals the bearer warning", async () => {
		const w = mount(DepositCard)
		await w.find(sel(TESTIDS.depositModePrivate)).trigger("click")
		expect(w.find(sel(TESTIDS.depositBearerWarning)).exists()).toBe(true)
	})

	it("switching back to Public hides the warning again", async () => {
		const w = mount(DepositCard)
		await w.find(sel(TESTIDS.depositModePrivate)).trigger("click")
		await w.find(sel(TESTIDS.depositModePublic)).trigger("click")
		expect(w.find(sel(TESTIDS.depositBearerWarning)).exists()).toBe(false)
	})

	it("deposits PUBLIC by default — isPrivate=false", async () => {
		const w = mount(DepositCard)
		await w.find(sel(TESTIDS.depositSubmit)).trigger("click")
		expect(depositFn).toHaveBeenCalledWith(100_000_000n, false)
	})

	it("deposits PRIVATE after selecting Private — isPrivate=true", async () => {
		const w = mount(DepositCard)
		await w.find(sel(TESTIDS.depositModePrivate)).trigger("click")
		await w.find(sel(TESTIDS.depositSubmit)).trigger("click")
		expect(depositFn).toHaveBeenCalledWith(100_000_000n, true)
	})

	it("disables the deposit button while a deposit is pending (guards the recovery record)", () => {
		hasPendingRef.value = true
		const w = mount(DepositCard)
		expect(w.find(sel(TESTIDS.depositSubmit)).attributes("disabled")).toBeDefined()
	})
})
