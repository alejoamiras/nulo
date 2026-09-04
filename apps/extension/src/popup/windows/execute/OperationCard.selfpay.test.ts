/**
 * A dApp that names the account itself as payer with no fee call asks for the wallet's own Fee
 * Juice: the card must render the fee card LOCKED to it — never the "fee set by the app" badge
 * (the payload carries no payment) and never a free picker (a picker's default on a gasless
 * account is the sponsored FPC).
 */
import { mount } from "@vue/test-utils"
import { describe, expect, test } from "vitest"
import OperationCard from "./OperationCard.vue"

const OWNER = "0xowner0000000000000000000000000000000000000000000000000000000cc"
const FPC = "0xfpc000000000000000000000000000000000000000000000000000000000dd"

function sendTxOp(exec: Record<string, unknown>) {
	return {
		kind: "aztec_sendTx" as const,
		networkId: "net-1",
		accountAddress: OWNER,
		account: { name: "Owner", address: OWNER, profileId: "p1", chainId: 0, index: 0, type: 0, visible: true },
		feeSettings: { paymentMethod: { kind: "fj" } },
		exec: { calls: [{ name: "transfer", to: FPC, selector: "0x1", args: [] }], ...exec },
		opts: { from: OWNER },
	}
}

const stubs = {
	AddressDisplay: { props: ["address"], template: '<span class="addr">{{ address }}</span>' },
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: true,
	MaterialIcon: true,
	AmountCard: true,
	JsonViewer: true,
	FeeSettingsCard: {
		props: ["lockedMethod"],
		template: '<div data-testid="fee-card" :data-locked="lockedMethod ?? \'\'" />',
	},
}

const mountCard = (op: unknown) =>
	mount(OperationCard, {
		props: { op: op as never, index: 0 },
		global: {
			stubs,
			mocks: {
				trimAddress: (a: string) => a,
				humanizeMethodName: (m: string) => m,
				humanizeOperationKind: (k: string) => k,
				parseTransferIntent: () => ({ kind: "unverified" }),
			},
		},
	})

describe("OperationCard — a dApp-requested self-pay", () => {
	test("renders the fee card locked to Fee Juice, not the set-by-the-app badge", () => {
		const w = mountCard(sendTxOp({ feePayer: OWNER }))
		expect(w.find('[data-testid="execute-op-fee-set-badge"]').exists()).toBe(false)
		expect(w.find('[data-testid="fee-card"]').attributes("data-locked")).toBe("fj")
	})

	test("a payer that carries its payment keeps the badge: an external contract, or the sender claiming in setup", () => {
		expect(
			mountCard(sendTxOp({ feePayer: FPC }))
				.find('[data-testid="execute-op-fee-set-badge"]')
				.exists(),
		).toBe(true)
		const claiming = sendTxOp({ feePayer: OWNER })
		claiming.exec.calls = [{ name: "claim_and_end_setup", to: FPC, selector: "0x2", args: [] }, ...claiming.exec.calls]
		expect(mountCard(claiming).find('[data-testid="execute-op-fee-set-badge"]').exists()).toBe(true)
	})

	test("no payer named leaves the fee card free", () => {
		const w = mountCard(sendTxOp({}))
		expect(w.find('[data-testid="execute-op-fee-set-badge"]').exists()).toBe(false)
		expect(w.find('[data-testid="fee-card"]').attributes("data-locked")).toBe("")
	})
})
