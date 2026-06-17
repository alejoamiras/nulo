import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import BridgeReceipt from "./BridgeReceipt.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const L1 = `0x${"ab".repeat(32)}`
const L2 = `0x${"cd".repeat(32)}`

describe("BridgeReceipt", () => {
	it("deposit receipt: header (route · privacy · time), tokens hero, both links, NEW BRIDGE emits", async () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "deposit" as const,
					amount: "100000000000000000000",
					isPrivate: true,
					l1TxHash: L1,
					l2TxHash: L2,
					startedAt: 1_000,
					completedAt: 223_000,
				},
			},
		})
		expect(w.text()).toContain("Bridged")
		expect(w.text()).toContain("100.00 AZLO")
		// Route · privacy · time now all live in the one mini-header (time moved up off the bottom).
		expect(w.text()).toContain("Ethereum → Aztec")
		expect(w.text()).toContain("private")
		expect(w.text()).toContain("3m 42s")
		const links = w.findAll(sel(TESTIDS.receiptLink))
		expect(links).toHaveLength(2)
		expect(links[0].attributes("href")).toBe(`https://sepolia.etherscan.io/tx/${L1}`)
		expect(links[1].attributes("href")).toContain(`/tx-effects/${L2}`)
		await w.find(sel(TESTIDS.receiptNewBridge)).trigger("click")
		expect(w.emitted("new-bridge")).toHaveLength(1)
	})

	it("withdraw receipt: Aztec → Ethereum, token only (no gas ever), junk hash renders no link", () => {
		const w = mount(BridgeReceipt, {
			props: {
				snapshot: {
					direction: "withdraw" as const,
					amount: "40000000000000000000",
					isPrivate: false,
					l1TxHash: "junk",
					l2TxHash: L2,
				},
			},
		})
		expect(w.text()).toContain("Released")
		expect(w.text()).toContain("Aztec → Ethereum")
		expect(w.text()).toContain("40.00 AZLO")
		// A withdraw never carries gas back to Ethereum — no FJ anywhere.
		expect(w.text()).not.toContain("FJ")
		expect(w.findAll(sel(TESTIDS.receiptLink))).toHaveLength(1)
	})

	it("private fueled deposit: tokens hero + dim gas rows (ready = received − used, Private FJ)", () => {
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
		expect(w.text()).toContain("Gas ready")
		// ready = 87.70 − 2.88 = 84.82
		expect(w.text()).toContain("84.82 Private FJ")
		expect(w.text()).toContain("Gas used")
		expect(w.text()).toContain("2.88")
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
		expect(w.text()).toContain("53.00 FJ")
		expect(w.text()).not.toContain("Private FJ")
	})

	it("no-fuel deposit: tokens only, no gas rows", () => {
		const w = mount(BridgeReceipt, {
			props: { snapshot: { direction: "deposit" as const, amount: "100000000000000000000", isPrivate: true } },
		})
		expect(w.text()).toContain("100.00 AZLO")
		expect(w.text()).not.toContain("Gas")
	})

	it("fueled deposit without a known claim fee: ready = received, no 'used' row", () => {
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
		expect(w.text()).toContain("Gas ready")
		expect(w.text()).toContain("87.70 Private FJ")
		expect(w.text()).not.toContain("Gas used")
	})
})
