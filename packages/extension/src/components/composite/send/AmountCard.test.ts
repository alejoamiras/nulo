import { describe, expect, test, beforeEach, vi } from "vitest"
import { mount } from "@vue/test-utils"
import AmountCard from "./AmountCard.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" />', props: ["name", "size", "color"] },
	Tooltip: { template: '<span><slot /><slot name="content" /></span>' },
}

const mountCard = (props: Record<string, unknown> = {}) =>
	mount(AmountCard, {
		props: { tokenBalanceByType: 100, ...props },
		global: { stubs: STUBS },
	})

beforeEach(() => {
	// jsdom HTMLInputElement.focus throws on the onMounted call when the
	// element isn't in the layout — silence to keep tests readable.
	vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(() => {})
})

describe("composite/AmountCard", () => {
	test("renders the amount input with placeholder and testid", () => {
		const w = mountCard()
		const input = w.find("input[data-testid='send-amount-input']")
		expect(input.exists()).toBe(true)
		expect(input.attributes("placeholder")).toBe("0.00")
	})

	test("renders Half and Use Maximum action links with their testids", () => {
		const w = mountCard()
		expect(w.find("[data-testid='send-amount-half']").exists()).toBe(true)
		expect(w.find("[data-testid='send-amount-max']").exists()).toBe(true)
	})

	test("clicking Use Maximum sets the model value to tokenBalanceByType", async () => {
		const w = mountCard({ tokenBalanceByType: 250, modelValue: "" })
		await w.find("[data-testid='send-amount-max']").trigger("click")
		const emits = w.emitted("update:modelValue")
		expect(emits).toBeTruthy()
		expect(emits?.[emits.length - 1]).toEqual([250])
	})

	test("clicking Half on an empty value sets it to half of tokenBalanceByType", async () => {
		const w = mountCard({ tokenBalanceByType: 200, modelValue: "" })
		await w.find("[data-testid='send-amount-half']").trigger("click")
		const emits = w.emitted("update:modelValue")
		expect(emits).toBeTruthy()
		expect(Number(emits?.[emits.length - 1]?.[0])).toBe(100)
	})

	test("Half clamps the result to the token's decimal precision", async () => {
		// 6-dec token, balance 1.234567 → /2 in Number domain = 0.6172835 (7 decimals).
		// Must clamp to 6.
		const w = mountCard({
			tokenBalanceByType: 1.234567,
			modelValue: "",
			token: { symbol: "USDC", decimals: 6 },
		})
		await w.find("[data-testid='send-amount-half']").trigger("click")
		const emits = w.emitted("update:modelValue")
		expect(emits).toBeTruthy()
		const last = String(emits?.[emits.length - 1]?.[0])
		expect(last).toBe("0.617283")
	})

	test("Use Maximum is a no-op when tokenBalanceByType is 0/falsy (disabled balance)", async () => {
		const w = mountCard({ tokenBalanceByType: 0, modelValue: "" })
		await w.find("[data-testid='send-amount-max']").trigger("click")
		expect(w.emitted("update:modelValue")).toBeUndefined()
	})

	test("input is disabled when tokenBalanceByType is 0/falsy", () => {
		const w = mountCard({ tokenBalanceByType: 0 })
		const input = w.find("input[data-testid='send-amount-input']")
		expect(input.attributes("disabled")).toBeDefined()
	})

	test("renders the token symbol and balance line when token + balance are set", () => {
		const w = mountCard({
			token: { symbol: "USDC" },
			tokenBalanceByType: 42,
			selectedSendType: "private",
		})
		expect(w.text()).toContain("USDC")
		expect(w.text()).toContain("private")
	})

	test("renders the conversion line with placeholder dollar amount", () => {
		const w = mountCard()
		expect(w.text()).toContain("$0.00")
	})

	test("clamps typed input to token.decimals on type", async () => {
		const w = mountCard({
			tokenBalanceByType: 100,
			modelValue: "",
			token: { symbol: "TST", decimals: 6 },
		})
		const input = w.find("input[data-testid='send-amount-input']")
		// Set the v-model to the over-decimaled value AND fire input — handleAmountInput
		// runs against the new model.value and clamps to 6.
		await input.setValue("14.0234375")
		const emits = w.emitted("update:modelValue")
		expect(emits).toBeTruthy()
		expect(emits?.[emits.length - 1]?.[0]).toBe("14.023437")
	})

	test("renders the inline hint when typed amount is clamped", async () => {
		const w = mountCard({
			tokenBalanceByType: 100,
			modelValue: "",
			token: { symbol: "TST", decimals: 6 },
		})
		const input = w.find("input[data-testid='send-amount-input']")
		await input.setValue("1.1234567")
		const hint = w.find("[data-testid='send-amount-clamp-hint']")
		expect(hint.exists()).toBe(true)
		expect(hint.text()).toContain("TST")
		expect(hint.text()).toContain("6 decimal")
	})

	test("does NOT render the inline hint when input fits within decimals", async () => {
		const w = mountCard({
			tokenBalanceByType: 100,
			modelValue: "",
			token: { symbol: "TST", decimals: 6 },
		})
		const input = w.find("input[data-testid='send-amount-input']")
		await input.setValue("1.5")
		expect(w.find("[data-testid='send-amount-clamp-hint']").exists()).toBe(false)
	})

	test("re-clamps existing value when token decimals shrink (token swap)", async () => {
		const w = mountCard({
			tokenBalanceByType: 100,
			modelValue: "1.123456789",
			token: { symbol: "ETH", decimals: 18 },
		})
		// Initial: 18-decimal token, value untouched.
		expect(w.props("modelValue")).toBe("1.123456789")
		// Switch to a 4-decimal token — the watcher re-clamps.
		await w.setProps({ token: { symbol: "USDC", decimals: 4 } })
		const emits = w.emitted("update:modelValue") ?? []
		expect(emits[emits.length - 1]?.[0]).toBe("1.1234")
	})

	test("clamps to 0 decimals (token with no fractional units strips the dot)", async () => {
		const w = mountCard({
			tokenBalanceByType: 100,
			modelValue: "",
			token: { symbol: "INT", decimals: 0 },
		})
		const input = w.find("input[data-testid='send-amount-input']")
		await input.setValue("5.5")
		const emits = w.emitted("update:modelValue") ?? []
		expect(emits[emits.length - 1]?.[0]).toBe("5")
	})
})
