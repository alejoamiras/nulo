/**
 * The Archives list hands each row kind its detail route; the cards own the link.
 */
import { mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import TransactionsList from "./TransactionsList.vue"

vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: { add: vi.fn(), remove: vi.fn() },
			onConnected: { add: vi.fn(), remove: vi.fn() },
			refreshIfStale: vi.fn().mockResolvedValue({}),
		}
	}),
}))

const cardStub = (name: string) => ({ name, props: ["to"], template: `<div data-stub="${name}" :data-to="to" />` })

const ROWS = [
	{ type: "tx", key: "tx:0xh1", sortKey: 3000, tx: { hash: "0xh1" } },
	{
		type: "journal",
		key: "journal:op-1",
		sortKey: 2000,
		op: { id: "op-1", kind: "transfer", terminalAt: 1, createdAt: 1, progress: { stage: "cancelled" } },
	},
	{ type: "incoming", key: "inc:r1", sortKey: 1000, inc: { id: "r1", kind: "note", amountRaw: "1", txHash: "0xh" } },
]

describe("modules/activity/TransactionsList", () => {
	test("each row kind links to its detail route", () => {
		const w = mount(TransactionsList, {
			props: { rows: ROWS },
			global: {
				stubs: {
					Flex: { template: "<div><slot /></div>" },
					TransactionCard: cardStub("TransactionCard"),
					TransactionTerminalCard: cardStub("TransactionTerminalCard"),
					TransactionIncomingCard: cardStub("TransactionIncomingCard"),
				},
			},
		})
		expect(w.find('[data-stub="TransactionCard"]').attributes("data-to")).toBe("/popup/tx/0xh1")
		expect(w.find('[data-stub="TransactionTerminalCard"]').attributes("data-to")).toBe("/popup/journal/op-1")
		expect(w.find('[data-stub="TransactionIncomingCard"]').attributes("data-to")).toBe("/popup/received/r1")
	})
})
