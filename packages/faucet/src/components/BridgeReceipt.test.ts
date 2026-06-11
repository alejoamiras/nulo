import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { TESTIDS } from "@/lib/testids"
import BridgeReceipt from "./BridgeReceipt.vue"

const sel = (t: string) => `[data-testid="${t}"]`
const L1 = `0x${"ab".repeat(32)}`
const L2 = `0x${"cd".repeat(32)}`

describe("BridgeReceipt", () => {
	it("deposit receipt: headline, both validated links, NEW BRIDGE emits", async () => {
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
		expect(w.text()).toContain("BRIDGED ✓")
		expect(w.text()).toContain("100.00 AZLO to Aztec")
		expect(w.text()).toContain("PRIVATE")
		expect(w.text()).toContain("3m 42s end to end.")
		const links = w.findAll(sel(TESTIDS.receiptLink))
		expect(links).toHaveLength(2)
		expect(links[0].attributes("href")).toBe(`https://sepolia.etherscan.io/tx/${L1}`)
		expect(links[1].attributes("href")).toContain(`/tx-effects/${L2}`)
		await w.find(sel(TESTIDS.receiptNewBridge)).trigger("click")
		expect(w.emitted("new-bridge")).toHaveLength(1)
	})

	it("withdraw receipt: Ethereum wording; junk hashes render no link", () => {
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
		expect(w.text()).toContain("RELEASED ✓")
		expect(w.text()).toContain("40.00 AZLO to Ethereum")
		expect(w.findAll(sel(TESTIDS.receiptLink))).toHaveLength(1)
	})
})
