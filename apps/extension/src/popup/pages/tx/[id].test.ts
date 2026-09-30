import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, describe, expect, test, vi } from "vitest"
import { OriginType, TransferType, TxStatus } from "@/wallet/services/transaction/spec"
import TxDetail from "./[id].vue"

const mocks = vi.hoisted(() => ({
	getTokens: vi.fn(),
	store: { transactions: [] as unknown[], profile: { id: "p1" }, network: { chainId: 1 }, defaultExplorer: "aztecscan" },
}))

vi.mock("vue-router", () => ({
	useRoute: () => ({ params: { id: "0xh1" } }),
	useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => mocks.store }))
vi.mock("@/composables/toast", () => ({ useToast: () => ({ openToast: vi.fn() }) }))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return { getTokens: mocks.getTokens, disconnect: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return { getProps: vi.fn(async () => []), disconnect: vi.fn() }
	}),
}))
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

afterEach(() => {
	vi.clearAllMocks()
})

const field = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`
const TOKEN = `0x${"0a".repeat(32)}`
const ACCOUNT = `0x${"0c".repeat(32)}`
const listed = { id: 1, chainId: 1, contract: TOKEN, name: "Test", symbol: "TST", decimals: 18, hasDecimals: true }

const settled = (origin: { type: OriginType; name?: string }, calls: unknown[]) => ({
	hash: "0xh1",
	chainId: 1,
	account: ACCOUNT,
	status: TxStatus.Proposed,
	updatedAt: 1_000,
	origin,
	calls,
})
const sentTransfer = settled({ type: OriginType.UI }, [
	{
		contract: TOKEN,
		method: "transfer_private_to_private",
		args: [ACCOUNT, ACCOUNT, (10n ** 18n).toString(), "0"],
		transfers: [
			{
				token: { name: "Test", symbol: "TST", decimals: 18 },
				type: TransferType.Private,
				from: ACCOUNT,
				to: ACCOUNT,
				amount: (10n ** 18n).toString(),
			},
		],
	},
])
const dappMint = settled({ type: OriginType.DAPP, name: "example.dapp.io" }, [
	{ contract: TOKEN, method: "mint_to_public", args: [ACCOUNT, field(10n ** 18n)] },
])

async function mountPage(tx: unknown, tokens: Promise<unknown[]>) {
	mocks.store.transactions = [tx]
	mocks.getTokens.mockReturnValue(tokens)
	const w = mount(TxDetail, {
		global: {
			stubs: {
				SubPageHeader: true,
				TxFeeRow: true,
				TxDebugPanel: true,
				Banner: true,
				SectionLabel: true,
				AddressDisplay: true,
				Icon: true,
				Flex: { inheritAttrs: false, template: "<div v-bind='$attrs'><slot /></div>" },
			},
		},
	})
	await flushPromises()
	return w
}

const amountBlock = (w: Awaited<ReturnType<typeof mountPage>>) => w.find("[class*='amount_value']")

describe("the transaction page's amount", () => {
	test("a sent transfer of one 18-decimal token reads 1 and its symbol while the token list loads", async () => {
		const w = await mountPage(sentTransfer, new Promise(() => {}))
		expect(amountBlock(w).text()).toMatch(/^1\s+TST$/)
	})

	test("a dApp mint of a listed 18-decimal token reads 1 TST, captioned Mint amount", async () => {
		const w = await mountPage(dappMint, Promise.resolve([listed]))
		expect(amountBlock(w).text()).toMatch(/^1\s+TST$/)
		expect(w.find("[class*='amount_caption']").text()).toBe("Mint amount")
	})

	test("a dApp mint of an unlisted token renders no amount block", async () => {
		const w = await mountPage(dappMint, Promise.resolve([]))
		expect(amountBlock(w).exists()).toBe(false)
		expect(w.text()).not.toContain("Mint amount")
	})
})
