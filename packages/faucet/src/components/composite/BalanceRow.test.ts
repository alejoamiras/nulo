import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import BalanceRow from "./BalanceRow.vue"

describe("BalanceRow", () => {
	it("renders public + private labels", () => {
		const w = mount(BalanceRow, { props: { publicBalance: 0n, privateBalance: 0n, decimals: 6 } })
		expect(w.text()).toContain("balance · public")
		expect(w.text()).toContain("balance · private")
	})

	it("formats decimals=6 amounts as 1,000.00 etc.", () => {
		const w = mount(BalanceRow, {
			props: { publicBalance: 1_000_000_000n, privateBalance: 50_000n, decimals: 6 },
		})
		expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("1,000.00")
		expect(w.get(`[data-testid="${TESTIDS.balancePrivate}"]`).text()).toBe("0.05")
	})

	it("formats decimals=18 amounts as 1.00 etc.", () => {
		const w = mount(BalanceRow, {
			props: { publicBalance: 1_000_000_000_000_000_000n, privateBalance: 0n, decimals: 18 },
		})
		expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("1.00")
	})

	it("renders '—' when balance is null and not loading", () => {
		const w = mount(BalanceRow, { props: { publicBalance: null, privateBalance: null, decimals: 6 } })
		expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("—")
		expect(w.get(`[data-testid="${TESTIDS.balancePrivate}"]`).text()).toBe("—")
	})

	it("renders '…' when balance is null and loading", () => {
		const w = mount(BalanceRow, {
			props: { publicBalance: null, privateBalance: null, decimals: 6, loading: true },
		})
		expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("…")
	})

	it("renders zero balances as '0.00'", () => {
		const w = mount(BalanceRow, { props: { publicBalance: 0n, privateBalance: 0n, decimals: 6 } })
		expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("0.00")
	})

	it("carries stable testids for both balances", () => {
		const w = mount(BalanceRow, { props: { publicBalance: 0n, privateBalance: 0n, decimals: 6 } })
		expect(w.find(`[data-testid="${TESTIDS.balancePublic}"]`).exists()).toBe(true)
		expect(w.find(`[data-testid="${TESTIDS.balancePrivate}"]`).exists()).toBe(true)
	})

	it("doesn't round when truncating fractional places (1.234567 → 1.23 not 1.24)", () => {
		const w = mount(BalanceRow, { props: { publicBalance: 1_234_567n, privateBalance: 0n, decimals: 6 } })
		expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("1.23")
	})

	it("handles very large decimals=18 amounts without losing precision", () => {
		const w = mount(BalanceRow, {
			props: { publicBalance: 123_456_789_000_000_000_000n, privateBalance: 0n, decimals: 18 },
		})
		expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("123.45")
	})

	it("reacts to prop changes (re-renders new balance)", async () => {
		const w = mount(BalanceRow, { props: { publicBalance: 0n, privateBalance: 0n, decimals: 6 } })
		await w.setProps({ publicBalance: 5_000_000n })
		expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("5.00")
	})
})
