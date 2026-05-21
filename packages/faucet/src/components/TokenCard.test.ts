import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type DripResult = { kind: "txHash"; value: string } | { kind: "error"; value: string }
const refreshFn = vi.fn(async () => {})
const dripFn = vi.fn<(_t: unknown, _a: unknown, target: "public" | "private") => Promise<DripResult>>(async (_t, _a, target) => ({
	kind: "txHash",
	value: target === "public" ? "0xpublic" : "0xprivate",
}))

vi.mock("@/composables/useTokenBalance", () => ({
	useTokenBalance: () => ({
		publicBalance: { value: 1_000_000n },
		privateBalance: { value: 2_000_000n },
		loading: { value: false },
		error: { value: null },
		refresh: refreshFn,
		dispose: vi.fn(),
	}),
}))

vi.mock("@/composables/useFaucetDrip", () => {
	const _last = { value: null as Record<string, { kind: string; value: string }> | null }
	const inflight = { value: null as { tokenSymbol: string; target: string } | null }
	const lastRecord: Record<string, { kind: string; value: string }> = {}
	return {
		useFaucetDrip: () => ({
			inflight,
			last: lastRecord,
			isActive: (sym: string, tgt: string) => inflight.value?.tokenSymbol === sym && inflight.value.target === tgt,
			drip: dripFn,
		}),
	}
})

const pushFn = vi.fn()
vi.mock("@/composables/useToast", () => ({
	useToast: () => ({ push: pushFn, dismiss: vi.fn(), toasts: { value: [] } }),
}))

vi.mock("@/lib/explorer", () => ({
	explorerTxUrl: (hash: string) => `https://explorer.test/tx/${hash}`,
}))

import { AztecAddress } from "@aztec/aztec.js/addresses"
import { TESTIDS } from "@/lib/testids"
import TokenCard from "./TokenCard.vue"

const USDC = { symbol: "USDC", decimals: 6, displayAmount: "1,000", onchainAmount: 1_000_000_000n } as const
const USDC_ADDR = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000002")
const ACCOUNT = AztecAddress.fromString("0x000000000000000000000000000000000000000000000000000000000000000a")
// biome-ignore lint/suspicious/noExplicitAny: minimal wallet stub for component mount
const WALLET = {} as any

describe("TokenCard", () => {
	beforeEach(() => {
		refreshFn.mockClear()
		dripFn.mockReset()
		dripFn.mockImplementation(async (_t, _a, target) => ({
			kind: "txHash" as const,
			value: target === "public" ? "0xpublic" : "0xprivate",
		}))
		pushFn.mockClear()
	})
	afterEach(() => {
		vi.clearAllMocks()
	})

	function makeCard() {
		return mount(TokenCard, {
			props: { token: USDC, tokenAddress: USDC_ADDR, wallet: WALLET, account: ACCOUNT },
		})
	}

	it("renders the symbol header and the fixed-amount subline", () => {
		const w = makeCard()
		expect(w.text()).toContain("USDC")
		expect(w.text()).toContain("Fixed drip: 1,000 USDC")
	})

	it("renders the disclaimer chip", () => {
		const w = makeCard()
		expect(w.text()).toContain("Test token · no real value")
	})

	it("renders both drip buttons with the correct labels", () => {
		const w = makeCard()
		const pub = w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`)
		const priv = w.get(`[data-testid="${TESTIDS.btnDripPrivate}"]`)
		expect(pub.text()).toBe("Drip 1,000 USDC to public")
		expect(priv.text()).toBe("Drip 1,000 USDC to private")
	})

	it("renders the balance row with public + private values", () => {
		const w = makeCard()
		expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("1.00")
		expect(w.get(`[data-testid="${TESTIDS.balancePrivate}"]`).text()).toBe("2.00")
	})

	it("clicking 'Drip … to public' calls drip() with target=public and refreshes balance", async () => {
		const w = makeCard()
		await w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).trigger("click")
		await Promise.resolve()
		await Promise.resolve()
		expect(dripFn).toHaveBeenCalledTimes(1)
		expect(dripFn.mock.calls[0][2]).toBe("public")
		expect(refreshFn).toHaveBeenCalled()
	})

	it("clicking 'Drip … to private' calls drip() with target=private", async () => {
		const w = makeCard()
		await w.get(`[data-testid="${TESTIDS.btnDripPrivate}"]`).trigger("click")
		await Promise.resolve()
		expect(dripFn.mock.calls[0][2]).toBe("private")
	})

	it("on a successful drip, pushes a toast with the explorer link", async () => {
		const w = makeCard()
		await w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).trigger("click")
		await Promise.resolve()
		await Promise.resolve()
		expect(pushFn).toHaveBeenCalledTimes(1)
		const arg = pushFn.mock.calls[0][0] as { kind: string; link?: { href: string } }
		expect(arg.kind).toBe("ok")
		expect(arg.link?.href).toBe("https://explorer.test/tx/0xpublic")
	})

	it("on a drip error, pushes an error toast and does NOT refresh the balance", async () => {
		dripFn.mockImplementationOnce(async () => ({ kind: "error" as const, value: "Rejected in wallet." }))
		const w = makeCard()
		await w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).trigger("click")
		await Promise.resolve()
		expect(pushFn).toHaveBeenCalledTimes(1)
		const arg = pushFn.mock.calls[0][0] as { kind: string; text: string }
		expect(arg.kind).toBe("error")
		expect(arg.text).toBe("Rejected in wallet.")
		expect(refreshFn).not.toHaveBeenCalled()
	})

	it("carries the stable testid + data-symbol on the card root", () => {
		const w = makeCard()
		const card = w.get(`[data-testid="${TESTIDS.tokenCard}"]`)
		expect(card.attributes("data-symbol")).toBe("USDC")
	})

	it("the actions row renders inside the card", () => {
		const w = makeCard()
		const card = w.get(`[data-testid="${TESTIDS.tokenCard}"]`)
		const buttons = card.findAll("button")
		// 2 drip buttons (the spinner inside one of them when dripping wouldn't render here)
		expect(buttons.length).toBeGreaterThanOrEqual(2)
	})
})
