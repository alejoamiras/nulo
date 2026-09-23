import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import BridgeReceipt from "./BridgeReceipt.vue"
// Token amounts + symbol derive from the LIVE manifest (the cutover changes both); Fee-Juice rows
// stay 18-dec (FJ is chain-fixed, not token-driven).
// A journal record with no token block of its own renders under asset-label's generic fallback.
const BRIDGE_TOKEN_DECIMALS = 18
const BRIDGE_TOKEN_SYMBOL = "TOKEN"
const UNIT = 10n ** BigInt(BRIDGE_TOKEN_DECIMALS)

const sel = (t: string) => `[data-testid="${t}"]`
const L1 = `0x${"ab".repeat(32)}`
const L2 = `0x${"cd".repeat(32)}`

describe("BridgeReceipt", () => {
	it("deposit receipt: eyebrow route + done-mark, Bridged hero, both validated links, NEW BRIDGE emits", async () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "deposit" as const,
					amount: (100n * UNIT).toString(),
					isPrivate: true,
					l1TxHash: L1,
					l2TxHash: L2,
					startedAt: 1_000,
					completedAt: 223_000,
				},
			},
		})
		// The bold "BRIDGED ✓" stamp is gone; success is the past-tense hero + the small ✓ done-mark.
		expect(w.text()).not.toContain("BRIDGED ✓")
		const done = w.find('[aria-label="completed"]')
		expect(done.exists()).toBe(true)
		expect(done.text()).toBe("✓")
		// Pin the a11y exposure (role="img" + name) so a regression dropping the role is caught.
		expect(done.attributes("role")).toBe("img")
		expect(w.text()).toContain("Ethereum → Aztec")
		expect(w.text()).toContain("Bridged")
		expect(w.text()).toContain(`100 ${BRIDGE_TOKEN_SYMBOL}`)
		expect(w.text()).toContain("private")
		expect(w.text()).toContain("3m 42s")
		const links = w.findAll(sel(TESTIDS.receiptLink))
		expect(links).toHaveLength(2)
		expect(links[0].attributes("href")).toBe(`https://sepolia.etherscan.io/tx/${L1}`)
		expect(links[1].attributes("href")).toContain(`/tx-effects/${L2}`)
		await w.find(sel(TESTIDS.receiptNewBridge)).trigger("click")
		expect(w.emitted("new-bridge")).toHaveLength(1)
	})

	it("withdraw receipt: Aztec → Ethereum, Released hero, token only (no gas ever), junk hash renders no link", () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "withdraw" as const,
					amount: (40n * UNIT).toString(),
					isPrivate: false,
					l1TxHash: "junk",
					l2TxHash: L2,
				},
			},
		})
		expect(w.text()).toContain("Aztec → Ethereum")
		expect(w.text()).toContain("Released")
		expect(w.text()).toContain(`40 ${BRIDGE_TOKEN_SYMBOL}`)
		// A withdraw never carries gas back to Ethereum — no FJ anywhere.
		expect(w.text()).not.toContain("FJ")
		expect(w.findAll(sel(TESTIDS.receiptLink))).toHaveLength(1)
	})

	it("private fueled deposit: Bridged hero + dim Gas ready (net) / Gas used rows, no gross 'bought' or reserve copy", () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "deposit" as const,
					amount: "150000000000000000",
					isPrivate: true,
					fuelReceived: "87700000000000000000",
					fuelUsed: "2880000000000000000",
					startedAt: 0,
					completedAt: 302_000,
				},
			},
		})
		expect(w.text()).toContain("Bridged")
		expect(w.text()).toContain("Gas ready")
		// ready = received − used = 87.70 − 2.88 = 84.82 (net the user can spend next).
		expect(w.text()).toContain("84.82 Private FJ")
		expect(w.text()).toContain("Gas used")
		expect(w.text()).toContain("2.88")
		// The gross "Gas bought" line and the boxed "available / Ready to power…" panel are dropped.
		expect(w.text()).not.toContain("Gas bought")
		expect(w.text()).not.toContain("available")
		expect(w.text()).not.toContain("Ready to power")
		// The receiptFuel marker is on the Gas-ready row for a fueled token deposit — exactly one.
		expect(w.findAll(sel(TESTIDS.receiptFuel))).toHaveLength(1)
	})

	it("public fueled deposit: gas reads FJ (not Private FJ)", () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "deposit" as const,
					amount: "150000000000000000",
					isPrivate: false,
					fuelReceived: "53000000000000000000",
				},
			},
		})
		expect(w.text()).toContain("Gas ready")
		expect(w.text()).toContain("53 FJ")
		expect(w.text()).not.toContain("Private FJ")
		expect(w.text()).not.toContain("Ready to power")
	})

	it("no-fuel deposit: no gas rows", () => {
		const w = mount(BridgeReceipt, {
			props: { snapshot: { direction: "deposit" as const, amount: (100n * UNIT).toString(), isPrivate: true } },
		})
		expect(w.text()).toContain(`100 ${BRIDGE_TOKEN_SYMBOL}`)
		expect(w.text()).not.toContain("Gas ready")
		expect(w.text()).not.toContain("Gas used")
	})

	it("fueled deposit without a known claim fee: Gas ready = received, no 'Gas used' row", () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "deposit" as const,
					amount: "150000000000000000",
					isPrivate: true,
					fuelReceived: "87700000000000000000",
				},
			},
		})
		expect(w.text()).toContain("87.7 Private FJ")
		expect(w.text()).not.toContain("Gas used")
	})

	// Fuel variant (assetKind "fee-juice"): the amount IS Fee Juice (18-dec) — it gets the SAME hero treatment.
	it("fuel (private) receipt: Fueled hero in Private FJ, NEW FUEL cta, no token leak, one receiptFuel", async () => {
		const w = mount(BridgeReceipt, {
			props: {
				ctaLabel: "NEW FUEL",
				snapshot: {
					direction: "deposit" as const,
					assetKind: "fee-juice" as const,
					amount: (20n * 10n ** 18n).toString(), // Fee Juice — ALWAYS 18-dec
					isPrivate: true,
					l1TxHash: L1,
					l2TxHash: L2,
				},
			},
		})
		expect(w.text()).toContain("Fueled")
		expect(w.text()).toContain("20 Private FJ")
		expect(w.text()).not.toContain("AZLO")
		expect(w.text()).not.toContain("Bridged")
		// The Fee-Juice amount IS the hero, so the receiptFuel marker sits on the hero row — exactly one.
		expect(w.findAll(sel(TESTIDS.receiptFuel))).toHaveLength(1)
		expect(w.find(sel(TESTIDS.receiptNewBridge)).text()).toBe("NEW FUEL")
		await w.find(sel(TESTIDS.receiptNewBridge)).trigger("click")
		expect(w.emitted("new-bridge")).toHaveLength(1)
	})

	it("fuel (public) receipt: reads FJ, not Private FJ", () => {
		const w = mount(BridgeReceipt, {
			props: {
				ctaLabel: "NEW FUEL",
				snapshot: {
					direction: "deposit" as const,
					assetKind: "fee-juice" as const,
					amount: "12500000000000000000",
					isPrivate: false,
				},
			},
		})
		expect(w.text()).toContain("12.5 FJ")
		expect(w.text()).not.toContain("Private FJ")
	})

	// Schema-3 sends carry their own token identity; the receipt must never format an 8-dec WBTC
	// amount at the single-token bridge's decimals.
	it("send receipt: the record's own symbol + decimals, send-specific ids, review-said and the add CTA", async () => {
		const w = mount(BridgeReceipt, {
			props: {
				ctaLabel: "NEW SEND",
				snapshot: {
					direction: "deposit" as const,
					amount: "150000000",
					isPrivate: true,
					token: { displaySymbol: "WBTC", decimals: 8 },
					fuelReceived: "5000000000000000000",
					reviewSaid: "1.5 WBTC + ≈ 5.00 FJ gas",
					addTokenLabel: "ADD WBTC TO WALLET",
				},
			},
		})
		expect(w.find(sel(TESTIDS.sendReceiptToken)).text()).toContain("1.5 WBTC")
		expect(w.find(sel(TESTIDS.sendReceiptGas)).text()).toContain("5 Private FJ")
		// The send ids REPLACE receiptFuel on a send, so neither surface can double up.
		expect(w.findAll(sel(TESTIDS.receiptFuel))).toHaveLength(0)
		const said = w.find(sel(TESTIDS.sendReceiptReviewSaid))
		expect(said.text()).toContain("Review said 1.5 WBTC + ≈ 5.00 FJ gas")
		expect(said.text()).toContain("you got 1.5 WBTC + 5 Private FJ")
		await w.find(sel(TESTIDS.sendReceiptAddToken)).trigger("click")
		expect(w.emitted("add-token")).toHaveLength(1)
	})

	// "Review said X · you got Y" is only a check the reader can make if Y is written the way X was.
	it("send receipt: a sub-cent amount reads back at full precision, not as zero", () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "deposit" as const,
					amount: "5000",
					isPrivate: false,
					token: { displaySymbol: "USDC", decimals: 6 },
					reviewSaid: "0.005 USDC",
				},
			},
		})
		expect(w.find(sel(TESTIDS.sendReceiptToken)).text()).toContain("0.005 USDC")
		expect(w.find(sel(TESTIDS.sendReceiptReviewSaid)).text()).toContain("Review said 0.005 USDC · you got 0.005 USDC")
	})

	it("send receipt: no add CTA without a token to add, and the CTA disables while adding", () => {
		const base = { direction: "deposit" as const, amount: "100000000", isPrivate: false, token: { displaySymbol: "WBTC", decimals: 8 } }
		expect(
			mount(BridgeReceipt, { props: { snapshot: base } })
				.find(sel(TESTIDS.sendReceiptAddToken))
				.exists(),
		).toBe(false)
		const w = mount(BridgeReceipt, {
			props: { snapshot: { ...base, addTokenLabel: "ADD WBTC TO WALLET" }, addTokenBusy: true },
		})
		expect(w.find(sel(TESTIDS.sendReceiptAddToken)).attributes("disabled")).toBeDefined()
	})

	// The `!isFuel` guard on hasFuel keeps the two receiptFuel sites mutually exclusive — a pathological
	// (valid-by-interface) Fuel snapshot that also carries fuelReceived must NOT duplicate the testid.
	it("never renders two receiptFuel nodes (isFuel and hasFuel are mutually exclusive)", () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "deposit" as const,
					assetKind: "fee-juice" as const,
					amount: "20000000000000000000",
					isPrivate: true,
					fuelReceived: "5000000000000000000",
					fuelUsed: "1000000000000000000",
				},
			},
		})
		expect(w.findAll(sel(TESTIDS.receiptFuel))).toHaveLength(1)
		expect(w.text()).toContain("Fueled")
		expect(w.text()).not.toContain("Gas ready")
	})

	it("fuel figures a storage update could have replaced with impossible strings read as dashes", () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "deposit" as const,
					amount: "150000000000000000",
					isPrivate: false,
					fuelReceived: "9".repeat(90),
					fuelUsed: "12abc",
					startedAt: 0,
					completedAt: 1_000,
				},
			},
		})
		expect(w.text()).toContain("Gas ready")
		expect(w.text()).toContain("—")
		expect(w.text()).not.toContain("9".repeat(20))
	})
})
