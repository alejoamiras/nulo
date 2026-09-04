/**
 * A dApp that names the account itself as payer with no fee call asks for the wallet's own Fee
 * Juice: the card must render the fee card LOCKED to it — never the "fee set by the app" badge
 * (the payload carries no payment) and never a free picker (a picker's default on a gasless
 * account is the sponsored FPC).
 */
import { mount } from "@vue/test-utils"
import { CLAIM_AND_END_SETUP, CLAIM_AND_END_SETUP_SELECTOR, FEE_JUICE_CONTRACT } from "@nulo/wallet-bridge"
import { describe, expect, test } from "vitest"
import OperationCard from "./OperationCard.vue"

const CLAIM = {
	name: CLAIM_AND_END_SETUP,
	to: FEE_JUICE_CONTRACT,
	selector: CLAIM_AND_END_SETUP_SELECTOR,
	type: "private",
	isStatic: false,
	args: [],
}

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
		claiming.exec.calls = [CLAIM, ...claiming.exec.calls]
		expect(mountCard(claiming).find('[data-testid="execute-op-fee-set-badge"]').exists()).toBe(true)
	})

	test("a call merely NAMED like the claim, to another contract, is still a self-pay: the locked card, never the badge", () => {
		const impostor = sendTxOp({ feePayer: OWNER })
		impostor.exec.calls = [{ ...CLAIM, to: FPC }, ...impostor.exec.calls]
		const w = mountCard(impostor)
		expect(w.find('[data-testid="execute-op-fee-set-badge"]').exists()).toBe(false)
		expect(w.find('[data-testid="fee-card"]').attributes("data-locked")).toBe("fj")
	})

	test("no payer named leaves the fee card free", () => {
		const w = mountCard(sendTxOp({}))
		expect(w.find('[data-testid="execute-op-fee-set-badge"]').exists()).toBe(false)
		expect(w.find('[data-testid="fee-card"]').attributes("data-locked")).toBe("")
	})
})
