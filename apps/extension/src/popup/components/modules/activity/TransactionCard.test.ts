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
import { CHAIN_IDS } from "@/utils/chain-ids"
import { flushPromises } from "@vue/test-utils"

// Bypass the real Pinia app store + its chrome.storage subscriptions —
// TransactionCard only reads `network.chainId` + `defaultExplorer` for the
// explorer URL computed; nothing in the chip-render path needs the store.
vi.mock("@/stores/app.store", () => ({
	useAppStore: () => ({ network: { chainId: CHAIN_IDS.MAINNET }, defaultExplorer: "aztecscan" }),
}))

// Controllable price feed for the D2 fiat case.
let mockQuotes: Record<string, unknown> = {}
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: { add: vi.fn(), remove: vi.fn() },
			onConnected: { add: vi.fn(), remove: vi.fn() },
			refreshIfStale: vi.fn().mockImplementation(async () => mockQuotes),
		}
	}),
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
				<span v-if="amountFiat" data-testid="activity-fiat">{{ amountFiat }}</span>
			</div>
		`,
		props: [
			"title",
			"icon",
			"amount",
			"amountSymbol",
			"amountFiat",
			"testId",
			"txAmountDisplay",
			"txTransferTypeLabel",
			"txStatus",
			"txHash",
		],
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

describe("TransactionCard fiat (D2 activity rows)", () => {
	const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
	const mkTransferTx = (contract: string) =>
		({
			hash: "0xfiat1",
			status: TxStatus.Proposed,
			origin: { type: OriginType.UI },
			calls: [
				{
					contract,
					method: "transfer",
					transfers: [
						{
							token: { name: "cUSD", symbol: "cUSD", decimals: 6 },
							type: TransferType.Private,
							from: "0xa",
							to: "0xb",
							amount: (125n * 10n ** 6n).toString(),
						},
					],
				},
			],
		}) as never

	test("priced transfer row renders the ≈ fiat under the amount", async () => {
		mockQuotes = { "usd-coin": { coingeckoId: "usd-coin", usd: 1.0, fetchedAt: Date.now(), providerUpdatedAt: null } }
		const w = mount(TransactionCard, { props: { tx: mkTransferTx(CUSD) }, global: { stubs: STUBS } })
		await flushPromises()
		const fiat = w.find('[data-testid="activity-fiat"]')
		expect(fiat.exists()).toBe(true)
		expect(fiat.text()).toBe("≈ $125.00")
	})

	test("unpriced transfer row renders NO fiat element", async () => {
		mockQuotes = {}
		const w = mount(TransactionCard, { props: { tx: mkTransferTx("0xunmapped") }, global: { stubs: STUBS } })
		await flushPromises()
		expect(w.find('[data-testid="activity-fiat"]').exists()).toBe(false)
	})
})
