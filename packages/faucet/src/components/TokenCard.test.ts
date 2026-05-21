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

	it("status row is absent when no drip has happened yet", () => {
		const w = makeCard()
		expect(w.find(`[data-testid="${TESTIDS.dripStatus}"]`).exists()).toBe(false)
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

	it("after a successful drip, the card status row appears with data-drip-status='ok'", async () => {
		const w = makeCard()
		await w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).trigger("click")
		await Promise.resolve()
		await Promise.resolve()
		const row = w.find(`[data-testid="${TESTIDS.dripStatus}"]`)
		expect(row.exists()).toBe(true)
		expect(row.attributes("data-drip-status")).toBe("ok")
		expect(row.attributes("data-emphasized")).toBe("true")
		expect(row.find("a").attributes("href")).toBe("https://explorer.test/tx/0xpublic")
	})

	it("after a drip error, the card status row shows the error message and no tx link", async () => {
		dripFn.mockImplementationOnce(async () => ({ kind: "error" as const, value: "Rejected in wallet." }))
		const w = makeCard()
		await w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).trigger("click")
		await Promise.resolve()
		await Promise.resolve()
		const row = w.find(`[data-testid="${TESTIDS.dripStatus}"]`)
		expect(row.attributes("data-drip-status")).toBe("error")
		expect(row.text()).toContain("Rejected in wallet.")
		expect(row.find("a").exists()).toBe(false)
		expect(refreshFn).not.toHaveBeenCalled()
	})

	it("recency: a later private drip overrides an earlier public drip in the status row", async () => {
		// dripFn flips kind to error on second call so we can tell which one wins.
		dripFn
			.mockImplementationOnce(async () => ({ kind: "txHash" as const, value: "0xpublic" }))
			.mockImplementationOnce(async () => ({ kind: "error" as const, value: "Reverted" }))
		const w = makeCard()
		await w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).trigger("click")
		await Promise.resolve()
		await Promise.resolve()
		await w.get(`[data-testid="${TESTIDS.btnDripPrivate}"]`).trigger("click")
		await Promise.resolve()
		await Promise.resolve()
		const row = w.find(`[data-testid="${TESTIDS.dripStatus}"]`)
		// The newer (private/error) outcome wins regardless of insertion order.
		expect(row.attributes("data-drip-status")).toBe("error")
		expect(row.text()).toContain("Reverted")
	})

	it("ok emphasis decays after 3s: row stays, emphasized marker drops", async () => {
		vi.useFakeTimers()
		const w = makeCard()
		await w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).trigger("click")
		await Promise.resolve()
		await Promise.resolve()
		expect(w.find(`[data-testid="${TESTIDS.dripStatus}"]`).attributes("data-emphasized")).toBe("true")
		await vi.advanceTimersByTimeAsync(3_500)
		const row = w.find(`[data-testid="${TESTIDS.dripStatus}"]`)
		expect(row.exists()).toBe(true)
		expect(row.attributes("data-emphasized")).toBeUndefined()
		vi.useRealTimers()
	})

	it("error emphasis persists past 3s: bright red stays until next click", async () => {
		vi.useFakeTimers()
		dripFn.mockImplementationOnce(async () => ({ kind: "error" as const, value: "Reverted" }))
		const w = makeCard()
		await w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).trigger("click")
		await Promise.resolve()
		await Promise.resolve()
		expect(w.find(`[data-testid="${TESTIDS.dripStatus}"]`).attributes("data-emphasized")).toBe("true")
		await vi.advanceTimersByTimeAsync(10_000)
		// Emphasis should still be set — errors don't auto-decay.
		expect(w.find(`[data-testid="${TESTIDS.dripStatus}"]`).attributes("data-emphasized")).toBe("true")
		vi.useRealTimers()
	})

	it("carries the stable testid + data-symbol on the card root", () => {
		const w = makeCard()
		const card = w.get(`[data-testid="${TESTIDS.tokenCard}"]`)
		expect(card.attributes("data-symbol")).toBe("USDC")
	})

	it("the actions row renders both drip buttons", () => {
		const w = makeCard()
		const card = w.get(`[data-testid="${TESTIDS.tokenCard}"]`)
		const dripButtons = card.findAll(`[data-testid^="fa-btn-drip-"]`)
		expect(dripButtons).toHaveLength(2)
	})

	describe("disconnected variant (no wallet, no account)", () => {
		function makeDisconnectedCard() {
			return mount(TokenCard, {
				props: { token: USDC, tokenAddress: USDC_ADDR },
			})
		}

		it("renders the symbol + buttons even with no wallet", () => {
			const w = makeDisconnectedCard()
			expect(w.text()).toContain("USDC")
			expect(w.text()).toContain("Fixed drip: 1,000 USDC")
			expect(w.find(`[data-testid="${TESTIDS.btnDripPublic}"]`).exists()).toBe(true)
			expect(w.find(`[data-testid="${TESTIDS.btnDripPrivate}"]`).exists()).toBe(true)
		})

		it("drip buttons are disabled", () => {
			const w = makeDisconnectedCard()
			expect(w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).attributes("disabled")).toBeDefined()
			expect(w.get(`[data-testid="${TESTIDS.btnDripPrivate}"]`).attributes("disabled")).toBeDefined()
		})

		it("clicking a disabled drip button is a no-op", async () => {
			const w = makeDisconnectedCard()
			await w.get(`[data-testid="${TESTIDS.btnDripPublic}"]`).trigger("click")
			expect(dripFn).not.toHaveBeenCalled()
		})

		it("shows the 'Connect a wallet to drip' hint instead of the status row", () => {
			const w = makeDisconnectedCard()
			expect(w.text()).toContain("Connect a wallet to drip")
			expect(w.find(`[data-testid="${TESTIDS.dripStatus}"]`).exists()).toBe(false)
		})

		it("balance row renders em-dash placeholders (no live data)", () => {
			const w = makeDisconnectedCard()
			expect(w.get(`[data-testid="${TESTIDS.balancePublic}"]`).text()).toBe("—")
			expect(w.get(`[data-testid="${TESTIDS.balancePrivate}"]`).text()).toBe("—")
		})

		it("carries data-connected=undefined on the card root", () => {
			const w = makeDisconnectedCard()
			expect(w.get(`[data-testid="${TESTIDS.tokenCard}"]`).attributes("data-connected")).toBeUndefined()
		})
	})
})
