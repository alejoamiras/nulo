import { flushPromises, mount } from "@vue/test-utils"
import { afterEach, describe, expect, test, vi } from "vitest"
import ReceivedDetail from "./[id].vue"

const mocks = vi.hoisted(() => ({ getTokens: vi.fn() }))

const TOKEN = `0x${"0a".repeat(32)}`
const ACCOUNT = `0x${"0c".repeat(32)}`
const RECEIPT = {
	id: "r1",
	kind: "note",
	profileId: "p1",
	networkId: "n1",
	accountAddress: ACCOUNT,
	tokenId: 7,
	contract: TOKEN,
	amountRaw: (10n ** 18n).toString(),
	txHash: `0x${"2b".repeat(32)}`,
	discoveredAt: 1_000,
}

vi.mock("vue-router", () => ({ useRoute: () => ({ params: { id: "r1" } }) }))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => ({}) }))
vi.mock("@/composables/toast", () => ({ useToast: () => ({ openToast: vi.fn() }) }))
vi.mock("@/composables/usePrices", () => ({
	usePrices: () => ({ tokenFiatLabel: () => undefined, feeJuiceQuote: { value: undefined }, dispose: vi.fn() }),
}))
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return { disconnect: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/incoming-transfer/client", () => ({
	IncomingTransferServiceClient: vi.fn(function () {
		return {
			getIncomingTransferById: vi.fn(async () => RECEIPT),
			getReceiptFee: vi.fn(async () => null),
			onIncomingTransferDeleted: { add: vi.fn(), remove: vi.fn() },
			disconnect: vi.fn(),
		}
	}),
}))
vi.mock("@/wallet/services/network/client", () => ({
	NetworkServiceClient: vi.fn(function () {
		return { getNetwork: vi.fn(async () => ({ id: "n1", chainId: 1 })), disconnect: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return { getTokens: mocks.getTokens, disconnect: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/config/client", () => ({
	ConfigServiceClient: vi.fn(function () {
		return { getValue: vi.fn(async () => "aztecscan"), disconnect: vi.fn() }
	}),
}))

afterEach(() => {
	vi.clearAllMocks()
})

async function mountPage(tokens: Promise<unknown[]>) {
	mocks.getTokens.mockReturnValue(tokens)
	const w = mount(ReceivedDetail, {
		global: {
			stubs: {
				SubPageHeader: true,
				SectionLabel: true,
				AddressDisplay: true,
				Icon: true,
				Text: true,
				Flex: { inheritAttrs: false, template: "<div v-bind='$attrs'><slot /></div>" },
			},
		},
	})
	await flushPromises()
	return w
}

const token = (over: Record<string, unknown>) => ({ id: 7, chainId: 1, contract: TOKEN, name: "Test", symbol: "TST", ...over })
const amountBlock = (w: Awaited<ReturnType<typeof mountPage>>) => w.find("[class*='amount_value']")

describe("the received page's amount", () => {
	test("shows no amount while the token list is pending", async () => {
		const w = await mountPage(new Promise(() => {}))
		expect(amountBlock(w).exists()).toBe(false)
	})

	test("shows no amount for a token without a decimals getter", async () => {
		const w = await mountPage(Promise.resolve([token({ decimals: 0, hasDecimals: false })]))
		expect(amountBlock(w).exists()).toBe(false)
	})

	test("(pin) reads +1 TST once an 18-decimal token resolves", async () => {
		const w = await mountPage(Promise.resolve([token({ decimals: 18, hasDecimals: true })]))
		expect(amountBlock(w).text()).toMatch(/^\+1\s+TST$/)
	})
})
