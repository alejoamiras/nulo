import { afterEach, describe, expect, test, beforeEach, vi } from "vitest"
import { mount } from "@vue/test-utils"
import { nextTick } from "vue"
import { validateSendAmount } from "@/popup/pages/send-amount"
import { parseAmountToBaseUnits } from "@/utils/amount"
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

	test("a keystroke is read from the input, not from a model the parent has not re-rendered yet", async () => {
		// The listener is what makes the model parent-owned (without one `defineModel` keeps local
		// state and a write reads back at once); the prop staying "1" is the re-render not having happened.
		const w = mountCard({ modelValue: "1", "onUpdate:modelValue": () => {}, token: { symbol: "TT", decimals: 18 } })
		const input = w.find("input[data-testid='send-amount-input']")
		;(input.element as HTMLInputElement).value = "1."
		await input.trigger("input", { data: "." })
		const emits = w.emitted("update:modelValue")
		expect(emits?.[emits.length - 1]).toEqual(["1."])
	})

	test('a first "0" becomes "0." without a clamp hint, even for a token with no decimals', async () => {
		const w = mountCard({ modelValue: "", "onUpdate:modelValue": () => {}, token: { symbol: "NFT", decimals: 0 } })
		const input = w.find("input[data-testid='send-amount-input']")
		;(input.element as HTMLInputElement).value = "0"
		await input.trigger("input", { data: "0" })
		const emits = w.emitted("update:modelValue")
		expect(emits?.[emits.length - 1]).toEqual(["0."])
		expect(w.find("[data-testid='send-amount-clamp-hint']").exists()).toBe(false)
	})

	test("renders ONLY the Max action link (Half was dropped in the 1A rework)", () => {
		const w = mountCard()
		expect(w.find("[data-testid='send-amount-half']").exists()).toBe(false)
		expect(w.find("[data-testid='send-amount-max']").exists()).toBe(true)
	})

	test.each([
		["1123456789012345678", "1.123456789012345678"],
		["99876543210987654321", "99.876543210987654321"],
		["100000000000", "0.0000001"],
	])("token-mode Max fills the raw balance %s exactly, as %s", async (raw, filled) => {
		const w = mountCard({
			token: { symbol: "TST", decimals: 18 },
			tokenBalanceByType: Number(raw) / 10 ** 18,
			balanceRawByType: raw,
			modelValue: "",
		})
		await w.find("[data-testid='send-amount-max']").trigger("click")
		const emits = w.emitted("update:modelValue") ?? []
		const last = emits[emits.length - 1]?.[0]
		expect(last).toBe(filled)
		expect(parseAmountToBaseUnits(String(last), 18)).toBe(BigInt(raw))
	})

	test.each([
		["no raw balance", { token: { symbol: "TST", decimals: 18 }, balanceRawByType: null }],
		["no decimals", { token: { symbol: "TST" }, balanceRawByType: "250" }],
	])("token-mode Max with %s fills nothing", async (_name, props) => {
		const w = mountCard({ tokenBalanceByType: 250, modelValue: "", ...props })
		await w.find("[data-testid='send-amount-max']").trigger("click")
		expect(w.emitted("update:modelValue")).toBeUndefined()
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
			token: { symbol: "USDC", decimals: 6 },
			tokenBalanceByType: 42,
			balanceRawByType: "42000000",
		})
		const seg = w.find("[data-testid='send-amount-balance']")
		expect(seg.exists()).toBe(true)
		expect(seg.text()).toBe("42 USDC")
		expect(seg.text()).not.toContain("PRIVATE")
		expect(seg.text()).not.toContain("PUBLIC")
	})

	test.each([
		["124457554400000000000000000", "124,457,554.4 TST"],
		["1123456789012345678", "1.12345678 TST"],
		["1000000000", "0 TST"],
	])("the balance beside Max reads the raw balance %s as %s: exact, cut at 8 places", (raw, text) => {
		const w = mountCard({ token: { symbol: "TST", decimals: 18 }, tokenBalanceByType: Number(raw) / 10 ** 18, balanceRawByType: raw })
		expect(w.get("[data-testid='send-amount-balance']").text()).toBe(text)
	})

	test.each([
		["a zero balance", { tokenBalanceByType: 0, balanceRawByType: "0" }],
		["no raw balance", { tokenBalanceByType: 42, balanceRawByType: null }],
		["no decimals", { token: { symbol: "TST" }, tokenBalanceByType: 42, balanceRawByType: "42" }],
	])("no balance beside Max with %s", (_name, props) => {
		const w = mountCard({ token: { symbol: "TST", decimals: 18 }, ...props })
		expect(w.find("[data-testid='send-amount-balance']").exists()).toBe(false)
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

	test("a paste past the decimals is read whole, then its reading is clamped at once", async () => {
		const w = mountCard({ modelValue: "", "onUpdate:modelValue": () => {}, token: { symbol: "USDC", decimals: 6 } })
		const input = w.find("input[data-testid='send-amount-input']")
		;(input.element as HTMLInputElement).value = "1.234,5678901"
		await input.trigger("input", { inputType: "insertFromPaste" })
		expect((input.element as HTMLInputElement).value).toBe("1234.567890")
		const emits = w.emitted("update:modelValue")
		expect(emits?.[emits.length - 1]).toEqual(["1234.567890"])
		expect(w.find("[data-testid='send-amount-clamp-hint']").exists()).toBe(true)
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

	test("a grouped amount re-clamps on the fraction alone when the decimals drop", async () => {
		const w = mountCard({ modelValue: "1,234,567.123456789", token: { symbol: "ETH", decimals: 18 } })
		await w.setProps({ token: { symbol: "USDC", decimals: 6 } })
		const emits = w.emitted("update:modelValue") ?? []
		expect(emits[emits.length - 1]?.[0]).toBe("1,234,567.123456")
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
			// The page owns the guard, so a write reads back only once the page has re-rendered.
			const w: ReturnType<typeof mountFiat> = mountFiat({
				fiatMode: true,
				fiatGuard: { frozenUsd: QUOTE.usd, frozenAt: Date.now(), converting: false },
				"onUpdate:fiatGuard": (v: unknown) => {
					void w.setProps({ fiatGuard: v })
				},
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

describe("composite/AmountCard — fiat mode", () => {
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

// jsdom has no layout: a stand-in font measures the field's amount at its full 40 px (digits 20 px,
// separators 10 px), and `room` is the width the field gives its text.
let room = 10_000
const standInWidth = (text: string) => [...text].reduce((w, c) => w + (c === "," || c === "." ? 10 : 20), 0)
vi.mock("@/utils/hero-ruler", () => ({
	inputRoom: () => room,
	rulerWidth: (el: Element, scale: number) => standInWidth(el.textContent ?? "") * scale,
}))

describe("composite/AmountCard — the field at rest shows the whole amount", () => {
	// Attached and really focused: the fit asks which element has the focus.
	const mountField = (props: Record<string, unknown> = {}) =>
		mount(AmountCard, {
			props: { tokenBalanceByType: 100, modelValue: "", token: { symbol: "TST", decimals: 18 }, ...props },
			global: { stubs: STUBS },
			attachTo: document.body,
		})
	type Field = ReturnType<typeof mountField>
	const fieldOf = (w: Field) => w.get("[data-testid='send-amount-input']").element as HTMLInputElement
	const scaleOf = (w: Field) => fieldOf(w).style.getPropertyValue("--hero-scale")
	// "1,234,567.123456789012345678": 25 digits and 3 separators, 530 px at full size.
	const LONG = "1234567.123456789012345678"

	beforeEach(() => {
		vi.restoreAllMocks()
		room = 200
	})
	afterEach(() => {
		room = 10_000
	})

	test("a long amount, once left, draws at the largest scale that shows all of it; focus brings back 40 px", async () => {
		const w = mountField()
		await w.get("[data-testid='send-amount-input']").setValue(LONG)
		expect(scaleOf(w)).toBe("1")
		fieldOf(w).blur()
		await nextTick()
		expect(fieldOf(w).value).toBe("1,234,567.123456789012345678")
		expect(scaleOf(w)).toBe("0.37")
		fieldOf(w).focus()
		await nextTick()
		expect(scaleOf(w)).toBe("1")
		w.unmount()
	})

	test("a press on Max leaves the field at rest, grouped and fitted at once: the focus is not taken back", async () => {
		// The page owns the model, so a write reads back only once the page has re-rendered.
		const w: Field = mountField({
			tokenBalanceByType: 1234567,
			balanceRawByType: "1234567123456789012345678",
			"onUpdate:modelValue": (v: unknown) => {
				void w.setProps({ modelValue: v })
			},
		})
		// The field takes the focus on mount; a pointer press on Max, a span, takes it off first.
		fieldOf(w).blur()
		await w.get("[data-testid='send-amount-max']").trigger("click")
		await nextTick()
		expect(w.emitted("update:modelValue")).toEqual([["1,234,567.123456789012345678"]])
		expect(document.activeElement).not.toBe(fieldOf(w))
		expect(fieldOf(w).value).toBe("1,234,567.123456789012345678")
		expect(scaleOf(w)).toBe("0.37")
		w.unmount()
	})

	test("an amount that fits keeps 40 px at rest", async () => {
		const w = mountField()
		await w.get("[data-testid='send-amount-input']").setValue("12.5")
		fieldOf(w).blur()
		await nextTick()
		expect(scaleOf(w)).toBe("1")
		w.unmount()
	})

	test("a font load, or the fiat toggle taking width, fits the field again; unmounting stops listening", async () => {
		const fonts = new EventTarget()
		const stopListening = vi.spyOn(fonts, "removeEventListener")
		Object.defineProperty(document, "fonts", { value: fonts, configurable: true })
		try {
			const w = mountField()
			await w.get("[data-testid='send-amount-input']").setValue(LONG)
			fieldOf(w).blur()
			await nextTick()
			expect(scaleOf(w)).toBe("0.37")
			room = 150
			fonts.dispatchEvent(new Event("loadingdone"))
			await nextTick()
			expect(scaleOf(w)).toBe("0.28")
			room = 100
			await w.setProps({ liveQuote: { usd: 1, fetchedAt: Date.now() } })
			expect(scaleOf(w)).toBe("0.18")
			w.unmount()
			expect(stopListening).toHaveBeenCalledWith("loadingdone", expect.any(Function))
		} finally {
			Reflect.deleteProperty(document, "fonts")
		}
	})
})

describe("composite/AmountCard — the field reads its text whole", () => {
	const TOKEN = { symbol: "TST", decimals: 18 }
	type Card = ReturnType<typeof mountCard>
	const input = (w: Card, testid = "send-amount-input") => w.get(`[data-testid='${testid}']`)
	const textOf = (w: Card, testid?: string) => (input(w, testid).element as HTMLInputElement).value
	const edit = async (w: Card, value: string, inputType: string, testid?: string) => {
		;(input(w, testid).element as HTMLInputElement).value = value
		await input(w, testid).trigger("input", { inputType, data: inputType === "insertText" ? value.slice(-1) : null })
	}
	/** Each key typed at the end of the text; what the field shows after each. */
	const typeKeys = async (w: Card, keys: string, testid?: string) => {
		const after: string[] = []
		for (const key of keys) {
			await edit(w, textOf(w, testid) + key, "insertText", testid)
			after.push(textOf(w, testid))
		}
		return after
	}
	const paste = (w: Card, text: string, testid?: string) => edit(w, text, "insertFromPaste", testid)
	/** A key typed where the input's caret is, as a browser inserts it. */
	const typeAtCaret = async (w: Card, key: string, testid?: string) => {
		const el = input(w, testid).element as HTMLInputElement
		const at = el.selectionStart ?? el.value.length
		el.value = el.value.slice(0, at) + key + el.value.slice(el.selectionEnd ?? at)
		el.setSelectionRange(at + key.length, at + key.length)
		await input(w, testid).trigger("input", { inputType: "insertText", data: key })
	}
	const hints = (w: Card) =>
		["clamp", "unreadable", "ambiguous"].filter((name) => w.find(`[data-testid='send-amount-${name}-hint']`).exists())
	const lastEmit = (w: Card, event: string) => w.emitted(event)?.at(-1)?.[0]
	const lastRested = (w: Card) => (lastEmit(w, "update:rested") as string | null | undefined) ?? null

	test.each([
		["1,234,567", "1.234567"],
		["1,234", "1.234"],
	])("typed %j shows %j, with no hint", async (keys, shown) => {
		const w = mountCard({ token: TOKEN, modelValue: "" })
		expect((await typeKeys(w, keys)).at(-1)).toBe(shown)
		expect(hints(w)).toEqual([])
	})

	// A browser puts the caret at the end whenever script sets the input's value.
	test('",5" typed between the digits of "12" reads 1.52: a rewrite keeps the caret where the key went', async () => {
		const w = mountCard({ token: TOKEN, modelValue: "" })
		await typeKeys(w, "12")
		;(input(w).element as HTMLInputElement).setSelectionRange(1, 1)
		await typeAtCaret(w, ",")
		await typeAtCaret(w, "5")
		expect([textOf(w), lastEmit(w, "update:modelValue")]).toEqual(["1.52", "1.52"])
	})

	test("one event holding text that reads no way says so only once the field is left", async () => {
		const w = mountCard({ token: TOKEN, modelValue: "" })
		await input(w).setValue("1.234,5,678901")
		expect([textOf(w), hints(w)]).toEqual(["1.234,5,678901", []])
		await input(w).trigger("blur")
		expect([textOf(w), hints(w)]).toEqual(["1.234,5,678901", ["unreadable"]])
	})

	test('a paste of "1.234,56" stays as pasted with no hint, and rests as "1,234.56" once left', async () => {
		const w = mountCard({ token: TOKEN, modelValue: "" })
		await paste(w, "1.234,56")
		expect([textOf(w), lastEmit(w, "update:modelValue"), hints(w)]).toEqual(["1.234,56", "1.234,56", []])
		await input(w).trigger("blur")
		expect([textOf(w), lastRested(w)]).toEqual(["1,234.56", "1,234.56"])
	})

	test('a paste of "1e5" says it is not an amount, and prices nothing', async () => {
		const w = mountCard({ token: TOKEN, modelValue: "", liveQuote: { usd: 1, fetchedAt: Date.now() } })
		await paste(w, "1e5")
		expect(w.get("[data-testid='send-amount-unreadable-hint']").text()).toBe("Not an amount. Type it like 1234.56")
		expect(w.get("[data-testid='send-amount-fiat-label']").text()).toBe("1 TST ≈ $1.00")
	})

	test('a paste of "1,234" names both readings at once', async () => {
		const w = mountCard({ token: TOKEN, modelValue: "" })
		await paste(w, "1,234")
		expect(w.get("[data-testid='send-amount-ambiguous-hint']").text()).toBe("Is that 1234 or 1.234? Type the one you mean.")
	})

	test.each([
		["1e5", "1e5", null, "invalid"],
		["1.234,567", "1,234.56", "1,234.56", 123_456n],
		["1.234,56", "1.234,56", null, 123_456n],
	])(
		"%j pasted, then a 2-decimal token: the field shows %j, at rest as %j, and the page reads %s",
		async (pasted, shown, rested, sent) => {
			const w = mountCard({ token: TOKEN, modelValue: "" })
			await paste(w, pasted)
			await w.setProps({ token: { symbol: "USDC", decimals: 2 } })
			expect([textOf(w), lastRested(w)]).toEqual([shown, rested])
			expect(validateSendAmount({ input: textOf(w), rested: lastRested(w), tokenDecimals: 2, balanceRaw: 10n ** 40n })).toEqual(
				typeof sent === "bigint" ? { valid: true, integerized: sent } : { valid: false, reason: sent },
			)
		},
	)

	describe("the rest Max marks", () => {
		// The page owns both models, so a write reads back once the page re-renders.
		const mountBound = () => {
			const w: Card = mountCard({
				token: TOKEN,
				tokenBalanceByType: 1234,
				balanceRawByType: (1_234n * 10n ** 18n).toString(),
				modelValue: "",
				rested: null,
				"onUpdate:modelValue": (v: unknown) => void w.setProps({ modelValue: v }),
				"onUpdate:rested": (v: unknown) => void w.setProps({ rested: v }),
			})
			return w
		}
		const max = (w: Card) => w.get("[data-testid='send-amount-max']").trigger("click")

		test("Max marks its text as the rest, and a keystroke after it reads those commas as grouping", async () => {
			const w = mountBound()
			await max(w)
			expect([textOf(w), lastRested(w)]).toEqual(["1,234", "1,234"])
			expect(await typeKeys(w, "5")).toEqual(["12345"])
			expect(lastRested(w)).toBeNull()
		})

		test("a paste after Max clears the rest, and a keystroke edits the pasted text as it stands", async () => {
			const w = mountBound()
			await max(w)
			await paste(w, "1,234")
			expect([textOf(w), lastRested(w), hints(w)]).toEqual(["1,234", null, ["ambiguous"]])
			expect(await typeKeys(w, "5")).toEqual(["1,2345"])
			expect(hints(w)).toEqual([])
		})

		test("a write of null from the page clears the rest, and the next keystroke starts from empty", async () => {
			const w = mountBound()
			await max(w)
			await w.setProps({ modelValue: null })
			expect(w.emitted("update:rested")?.at(-1)).toEqual([null])
			expect(await typeKeys(w, "5")).toEqual(["5"])
		})
	})

	describe("in USD", () => {
		const USD = "send-amount-fiat-input"
		const mountUsd = () => {
			const w: Card = mountCard({
				token: { symbol: "cUSD", decimals: 6 },
				tokenBalanceByType: 1000,
				liveQuote: { usd: 1, fetchedAt: Date.now() },
				fiatMode: true,
				fiatGuard: { frozenUsd: 1, frozenAt: Date.now(), converting: false },
				modelValue: "",
				"onUpdate:modelValue": (v: unknown) => void w.setProps({ modelValue: v }),
			})
			return w
		}
		/** The token amount the debounced conversion leaves in the page's model, at $1 a token. */
		const converted = async (w: Card) => {
			await vi.advanceTimersByTimeAsync(300)
			return w.props("modelValue")
		}

		beforeEach(() => {
			vi.useFakeTimers()
		})
		afterEach(() => {
			vi.useRealTimers()
		})

		test.each([
			["1e5", "", ["unreadable"]],
			["1,234", "", ["ambiguous"]],
			["1.234,56", "1234.56", []],
			["$12.50", "12.5", []],
			[".5", "0.5", []],
		])("%j pasted converts to %j tokens, with hints %j", async (pasted, tokens, shown) => {
			const w = mountUsd()
			await paste(w, pasted, USD)
			expect(await converted(w)).toBe(tokens)
			expect(hints(w)).toEqual(shown)
		})

		test('"12,5" typed reads 12.5', async () => {
			const w = mountUsd()
			expect(await typeKeys(w, "12,5", USD)).toEqual(["1", "12", "12.", "12.5"])
			expect(await converted(w)).toBe("12.5")
		})

		test('",5" typed between the digits of "12" reads 1.52', async () => {
			const w = mountUsd()
			await typeKeys(w, "12", USD)
			;(input(w, USD).element as HTMLInputElement).setSelectionRange(1, 1)
			await typeAtCaret(w, ",", USD)
			await typeAtCaret(w, "5", USD)
			expect(textOf(w, USD)).toBe("1.52")
			expect(await converted(w)).toBe("1.52")
		})

		test('"1,234" typed and then "." re-reads the comma as grouping', async () => {
			const w = mountUsd()
			expect(await typeKeys(w, "1,234.", USD)).toEqual(["1", "1.", "1.2", "1.23", "1.234", "1234."])
			expect(await converted(w)).toBe("1234")
		})

		test('a replacing edit ends the comma point: a "." after it is dropped', async () => {
			const w = mountUsd()
			expect((await typeKeys(w, "1,234", USD)).at(-1)).toBe("1.234")
			await edit(w, "1.234", "insertReplacementText", USD)
			expect(await typeKeys(w, ".", USD)).toEqual(["1.234"])
			expect(await converted(w)).toBe("1.234")
		})
	})
})
