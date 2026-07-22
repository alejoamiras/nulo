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

	test("renders ONLY the Max action link (Half was dropped in the 1A rework)", () => {
		const w = mountCard()
		expect(w.find("[data-testid='send-amount-half']").exists()).toBe(false)
		expect(w.find("[data-testid='send-amount-max']").exists()).toBe(true)
	})

	test("clicking Use Maximum sets the model value to tokenBalanceByType", async () => {
		const w = mountCard({ tokenBalanceByType: 250, modelValue: "" })
		await w.find("[data-testid='send-amount-max']").trigger("click")
		const emits = w.emitted("update:modelValue")
		expect(emits).toBeTruthy()
		expect(emits?.[emits.length - 1]).toEqual([250])
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

	test("corner balance segment: amount + symbol only — no privacy dot/word (the From selector owns that)", () => {
		const w = mountCard({
			token: { symbol: "USDC" },
			tokenBalanceByType: 42,
		})
		const seg = w.find("[data-testid='send-amount-balance']")
		expect(seg.exists()).toBe(true)
		expect(seg.text()).toBe("42 USDC")
		expect(seg.text()).not.toContain("PRIVATE")
		expect(seg.text()).not.toContain("PUBLIC")
	})

	test("quoteless: no fiat line at all — no fake $0.00, no warning noise", () => {
		const w = mountCard()
		expect(w.text()).not.toContain("Price unavailable")
		expect(w.text()).not.toContain("$0.00")
		expect(w.find("[data-testid='send-amount-fiat-label']").exists()).toBe(false)
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

describe("composite/AmountCard — C3 fiat input", () => {
	const TOKEN = { symbol: "cUSD", decimals: 6 }
	const QUOTE = { usd: 0.999857, fetchedAt: Date.now() }
	const BAL_RAW = (1_000n * 10n ** 6n).toString() // 1,000 cUSD

	const mountFiat = (props: Record<string, unknown> = {}) =>
		mountCard({
			token: TOKEN,
			tokenBalanceByType: 1000,
			balanceRawByType: BAL_RAW,
			liveQuote: QUOTE,
			proxyTicker: "USDC",
			modelValue: "",
			"onUpdate:modelValue": (_v: unknown) => {},
			...props,
		})

	test("toggle only offered for priced tokens", () => {
		expect(mountFiat().find("[data-testid='send-amount-fiat-toggle']").exists()).toBe(true)
		expect(mountFiat({ liveQuote: null }).find("[data-testid='send-amount-fiat-toggle']").exists()).toBe(false)
	})

	test("token mode shows the live conversion; proxy provenance rides the tooltip (G1b)", async () => {
		const w = mountFiat({ modelValue: "125" })
		const label = w.find("[data-testid='send-amount-fiat-label']")
		expect(label.exists()).toBe(true)
		expect(label.text()).toBe("≈ $124.98")
		expect(label.attributes("title")).toContain("via USDC")
	})

	test("entering fiat mode freezes the session quote and swaps the input", async () => {
		const w = mountFiat()
		await w.find("[data-testid='send-amount-fiat-toggle']").trigger("click")
		expect(w.find("input[data-testid='send-amount-fiat-input']").exists()).toBe(true)
		const guardEmits = w.emitted("update:fiatGuard")
		expect(guardEmits).toBeTruthy()
		const guard = guardEmits?.at(-1)?.[0] as { frozenUsd: number; converting: boolean }
		expect(guard.frozenUsd).toBe(QUOTE.usd)
		expect(guard.converting).toBe(false)
		expect(w.emitted("update:fiatMode")?.at(-1)).toEqual([true])
	})

	test("typed dollars derive token units ROUND-DOWN at the frozen quote after the debounce", async () => {
		vi.useFakeTimers()
		try {
			const w = mountFiat()
			await w.find("[data-testid='send-amount-fiat-toggle']").trigger("click")
			await w.setProps({ fiatMode: true, fiatGuard: { frozenUsd: QUOTE.usd, frozenAt: Date.now(), converting: false } })

			const input = w.find("input[data-testid='send-amount-fiat-input']")
			await input.setValue("125")
			await input.trigger("input")

			// Converting flag flips on immediately (skeleton state)...
			let guard = w.emitted("update:fiatGuard")?.at(-1)?.[0] as { converting: boolean }
			expect(guard.converting).toBe(true)

			await vi.advanceTimersByTimeAsync(300)

			// ...and the derived token amount lands after the debounce.
			const modelEmits = w.emitted("update:modelValue")
			const derived = modelEmits?.at(-1)?.[0] as string
			// $125 at 0.999857 → 125.0178778... → round-down at 6 decimals.
			expect(derived).toBe("125.017877")
			guard = w.emitted("update:fiatGuard")?.at(-1)?.[0] as { converting: boolean }
			expect(guard.converting).toBe(false)
		} finally {
			vi.useRealTimers()
		}
	})

	test("skeleton shows while converting; derived line after", async () => {
		const w = mountFiat({ fiatMode: true, fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: true } })
		expect(w.find("[data-testid='send-amount-converting']").exists()).toBe(true)

		await w.setProps({ fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false }, modelValue: "125.017875" })
		const derived = w.find("[data-testid='send-amount-derived']")
		expect(derived.exists()).toBe(true)
		expect(derived.text()).toBe("≈ 125.017875 cUSD")
	})

	test("fiat-mode Max sends the EXACT raw balance (bigint, no Number pivot)", async () => {
		const w = mountFiat({
			fiatMode: true,
			fiatGuard: { frozenUsd: QUOTE.usd, frozenAt: Date.now(), converting: false },
			balanceRawByType: "1234567891",
			token: { symbol: "cUSD", decimals: 6 },
		})
		await w.find("[data-testid='send-amount-max']").trigger("click")
		expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["1234.567891"])
	})

	test("leaving fiat mode clears the guard", async () => {
		const w = mountFiat({ fiatMode: true, fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false } })
		await w.find("[data-testid='send-amount-fiat-toggle']").trigger("click")
		expect(w.emitted("update:fiatMode")?.at(-1)).toEqual([false])
		expect(w.emitted("update:fiatGuard")?.at(-1)).toEqual([null])
	})

	test("refreezeQuote re-freezes at the CURRENT live quote and re-derives", async () => {
		vi.useFakeTimers()
		try {
			const moved = { usd: 1.2, fetchedAt: Date.now() }
			const w = mountFiat({
				fiatMode: true,
				fiatGuard: { frozenUsd: QUOTE.usd, frozenAt: Date.now(), converting: false },
				liveQuote: moved,
			})
			const input = w.find("input[data-testid='send-amount-fiat-input']")
			await input.setValue("120")
			await input.trigger("input")
			await vi.advanceTimersByTimeAsync(300)
			;(w.vm as unknown as { refreezeQuote(): void }).refreezeQuote()
			const guard = w.emitted("update:fiatGuard")?.at(-1)?.[0] as { frozenUsd: number }
			expect(guard.frozenUsd).toBe(1.2)
			await vi.advanceTimersByTimeAsync(300)
			// $120 at $1.20 → exactly 100 tokens.
			expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["100"])
		} finally {
			vi.useRealTimers()
		}
	})

	test("fiat input truncates beyond micro precision (round-down, never credit extra)", async () => {
		const w = mountFiat({ fiatMode: true, fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false } })
		const input = w.find("input[data-testid='send-amount-fiat-input']")
		await input.setValue("1.23456789")
		await input.trigger("input")
		expect((input.element as HTMLInputElement).value).toBe("1.234567")
	})

	test("quoteless token in token mode renders no fiat line (silent, not a warning)", () => {
		const w = mountFiat({ liveQuote: null, modelValue: "5" })
		expect(w.find("[data-testid='send-amount-fiat-label']").exists()).toBe(false)
		expect(w.text()).not.toContain("Price unavailable")
	})
})

describe("composite/AmountCard — round 2 (T1 swap button + E1 empty state)", () => {
	const TOKEN = { symbol: "cUSD", decimals: 6 }
	const QUOTE = { usd: 0.999857, fetchedAt: Date.now() }

	const mountPriced = (props: Record<string, unknown> = {}) =>
		mountCard({ token: TOKEN, tokenBalanceByType: 1000, liveQuote: QUOTE, proxyTicker: "USDC", modelValue: "", ...props })

	test("priced + EMPTY input shows the unit rate — never the warning (1b bug pin)", () => {
		const w = mountPriced()
		const label = w.find("[data-testid='send-amount-fiat-label']")
		expect(label.exists()).toBe(true)
		expect(label.text()).toBe("1 cUSD ≈ $1.00")
		expect(w.text()).not.toContain("Price unavailable")
	})

	test("typing swaps the rate line for the live conversion", async () => {
		const w = mountPriced({ modelValue: "125" })
		expect(w.find("[data-testid='send-amount-fiat-label']").text()).toBe("≈ $124.98")
	})

	test("the toggle is the cUSD/USD unit pair beside the input (G1b — no arrows)", () => {
		const w = mountPriced()
		const pair = w.find("[data-testid='send-amount-fiat-toggle']")
		expect(pair.exists()).toBe(true)
		expect(pair.text().replace(/\s+/g, "")).toBe("cUSD/USD")
		expect(w.text()).not.toContain("⇅")
	})

	test("unpriced token: no swap button, no fiat line, no warning (silent)", () => {
		const w = mountPriced({ liveQuote: null })
		expect(w.find("button[data-testid='send-amount-fiat-toggle']").exists()).toBe(false)
		expect(w.text()).not.toContain("Price unavailable")
	})

	test("fiat mode with empty field shows the unit rate as the secondary line", () => {
		const w = mountPriced({ fiatMode: true, fiatGuard: { frozenUsd: QUOTE.usd, frozenAt: Date.now(), converting: false } })
		const derived = w.find("[data-testid='send-amount-derived']")
		expect(derived.exists()).toBe(true)
		expect(derived.text()).toBe("1 cUSD ≈ $1.00")
	})
})

describe("composite/AmountCard — code-review fixes", () => {
	test("switching the token mid-fiat-session exits fiat mode (stale frozen quote must not survive)", async () => {
		const w = mountCard({
			token: { symbol: "cUSD", decimals: 6 },
			tokenBalanceByType: 1000,
			liveQuote: { usd: 1, fetchedAt: Date.now() },
			fiatMode: true,
			fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false },
			modelValue: "",
		})
		await w.setProps({ token: { symbol: "OTHER", decimals: 18, contract: "0xother" } })
		expect(w.emitted("update:fiatMode")?.at(-1)).toEqual([false])
		expect(w.emitted("update:fiatGuard")?.at(-1)).toEqual([null])
	})

	test("SAME contract on a different chain is a different token — exits fiat mode", async () => {
		const w = mountCard({
			token: { symbol: "cUSD", decimals: 6, contract: "0xsame", chainId: 1 },
			tokenBalanceByType: 1000,
			liveQuote: { usd: 1, fetchedAt: Date.now() },
			fiatMode: true,
			fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false },
			modelValue: "",
		})
		await w.setProps({ token: { symbol: "cUSD", decimals: 6, contract: "0xsame", chainId: 2 } })
		expect(w.emitted("update:fiatMode")?.at(-1)).toEqual([false])
		expect(w.emitted("update:fiatGuard")?.at(-1)).toEqual([null])
	})
})

describe("composite/AmountCard — codex post-impl fixes", () => {
	test("quote lost mid-fiat-session exits fiat mode (requote would be a no-op)", async () => {
		const w = mountCard({
			token: { symbol: "cUSD", decimals: 6 },
			tokenBalanceByType: 1000,
			liveQuote: { usd: 1, fetchedAt: Date.now() },
			fiatMode: true,
			fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false },
			modelValue: "",
		})
		await w.setProps({ liveQuote: null })
		expect(w.emitted("update:fiatMode")?.at(-1)).toEqual([false])
		expect(w.emitted("update:fiatGuard")?.at(-1)).toEqual([null])
	})

	test("quote-loss exit is FAIL-CLOSED: the fiat-derived amount is cleared, not left sendable", async () => {
		const w = mountCard({
			token: { symbol: "cUSD", decimals: 6 },
			tokenBalanceByType: 1000,
			liveQuote: { usd: 1, fetchedAt: Date.now() },
			fiatMode: true,
			fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false },
			modelValue: "100",
		})
		await w.setProps({ liveQuote: null })
		// Without the clear, the 100 tokens derived at the dead quote would
		// silently become an allowed token-mode submit.
		expect(w.emitted("update:modelValue")?.at(-1)).toEqual([""])
	})

	test("token-swap exit also clears the amount (a count of the OLD token must not price the new one)", async () => {
		const w = mountCard({
			token: { symbol: "cUSD", decimals: 6, contract: "0xa", chainId: 1 },
			tokenBalanceByType: 1000,
			liveQuote: { usd: 1, fetchedAt: Date.now() },
			fiatMode: true,
			fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false },
			modelValue: "100",
		})
		await w.setProps({ token: { symbol: "OTHER", decimals: 18, contract: "0xb", chainId: 1 } })
		expect(w.emitted("update:modelValue")?.at(-1)).toEqual([""])
	})

	test("leading-dot fiat input ('.5') normalizes to '0.5' and converts", async () => {
		vi.useFakeTimers()
		try {
			const w = mountCard({
				token: { symbol: "cUSD", decimals: 6 },
				tokenBalanceByType: 1000,
				liveQuote: { usd: 1, fetchedAt: Date.now() },
				fiatMode: true,
				fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false },
				modelValue: "",
			})
			const input = w.find("input[data-testid='send-amount-fiat-input']")
			await input.setValue(".5")
			await input.trigger("input")
			await vi.advanceTimersByTimeAsync(300)
			// $0.50 at $1/token → 0.5 tokens derived (not a cleared model).
			expect(w.emitted("update:modelValue")?.at(-1)).toEqual(["0.5"])
		} finally {
			vi.useRealTimers()
		}
	})

	test("fiat-mode Max seeds the field in MACHINE format (no locale separators, no symbols)", async () => {
		const w = mountCard({
			token: { symbol: "cUSD", decimals: 6 },
			tokenBalanceByType: 1250,
			balanceRawByType: (1_250n * 10n ** 6n).toString(),
			liveQuote: { usd: 1, fetchedAt: Date.now() },
			fiatMode: true,
			fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false },
			modelValue: "",
		})
		await w.find("[data-testid='send-amount-max']").trigger("click")
		const input = w.find("input[data-testid='send-amount-fiat-input']")
		expect((input.element as HTMLInputElement).value).toBe("1250")
	})
})
