/**
 * TransactionCard (settled) — colocated unit tests.
 *
 * The settled card derives its two title-row chips from independent sources
 * (call shape → transferTypeLabel; tx.origin → originLabel), unlike the
 * journal-driven awaiting + terminal cards where the two are mutually
 * exclusive. This test pins the dApp-initiated-transfer case where BOTH
 * fields are set, to guard against the regression caught by Codex on PR #96
 * (a `||` template silently dropped the dApp origin chip on dApp transfers).
 */

import { mount } from "@vue/test-utils"
import { describe, expect, test, vi } from "vitest"
import { OriginType, TransferType, TxStatus } from "@/wallet/services/transaction/spec"

// Bypass the real Pinia app store + its chrome.storage subscriptions —
// TransactionCard only reads `network.chainId` + `defaultExplorer` for the
// explorer URL computed; nothing in the chip-render path needs the store.
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({ network: { chainId: 1 }, defaultExplorer: "aztecscan" }),
}))

import TransactionCard from "./TransactionCard.vue"

const STUBS = {
	Flex: { template: '<div :class="$attrs.class" v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: '<span data-testid="stub-icon" :data-name="name" :data-color="color" />', props: ["name", "size", "color"] },
	TransactionCardLayout: {
		template: `
			<div :data-testid="testId" :data-tx-transfer-type="txTransferTypeLabel">
				<span class="title">{{ title }}</span>
				<slot name="title-trailing" />
				<slot name="badge" />
				<slot name="secondary" />
				<span class="amount">{{ amount }}</span>
				<span class="symbol">{{ amountSymbol }}</span>
			</div>
		`,
		props: ["title", "icon", "amount", "amountSymbol", "testId", "txAmountDisplay", "txTransferTypeLabel", "txStatus", "txHash"],
	},
}

const dappTransferTx = {
	hash: "0xabcd1234abcd1234",
	status: TxStatus.Proposed,
	calls: [
		{
			contract: "0xtoken",
			method: "transfer_private_to_public",
			args: ["0xfrom", "0xto", "5000000"],
			transfers: [
				{
					token: { name: "USDC", symbol: "USDC", decimals: 6 },
					type: TransferType.PrivateToPublic,
					from: "0xfrom",
					to: "0xto",
					amount: "5000000",
				},
			],
		},
	],
	origin: { type: OriginType.DAPP, name: "example.dapp.io" },
}

const mountCard = (tx: Record<string, unknown>) => mount(TransactionCard, { props: { tx }, global: { stubs: STUBS } })

describe("modules/activity/TransactionCard (settled)", () => {
	test("dApp-initiated transfer renders BOTH transferTypeLabel and originLabel chips (codex PR #96 regression pin)", () => {
		const w = mountCard(dappTransferTx)
		// transferTypeLabel from call.transfers[0].type
		expect(w.text()).toContain("Private → Public")
		// originLabel from tx.origin.name — must NOT be silently dropped by
		// the `||` template when the call shape ALSO produces a transferType.
		expect(w.text()).toContain("example.dapp.io")
	})
})
