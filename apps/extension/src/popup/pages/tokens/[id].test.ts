/**
 * The token page's "Pin to Home" menu item: the label and `data-pinned` follow the stored pins, a
 * pin writes the contract and toasts, an unpin removes it, and a fourth pin opens the single-action
 * "Home is full" popup listing the pinned symbols — read from the token client AT CLICK TIME, so a
 * token added after mount is named too.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { nextTick, reactive } from "vue"
import { pinnedTokensKey } from "@/popup/constants/storage-keys"

const H = vi.hoisted(() => {
	const makeEvent = () => {
		const handlers = new Set<(x?: unknown) => void>()
		return {
			add: (fn: (x?: unknown) => void) => handlers.add(fn),
			remove: (fn: (x?: unknown) => void) => handlers.delete(fn),
			clear: () => handlers.clear(),
			emit: (x?: unknown) => {
				for (const fn of [...handlers]) fn(x)
			},
		}
	}
	return {
		tokens: { current: [] as Array<{ id: number; contract: string; symbol: string }> },
		getToken: vi.fn(),
		getTokens: vi.fn(),
		tokenDeleted: makeEvent(),
		balanceUpdated: makeEvent(),
		openToast: vi.fn(),
		popupOpen: vi.fn(),
		popupIsOpened: vi.fn(() => false),
		store: { current: null as unknown as Record<string, unknown> },
		cache: { current: null as unknown as { confirm: Record<string, unknown>; activeTokenIdx: unknown } },
	}
})

vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onTokenDeleted: H.tokenDeleted,
			getToken: H.getToken,
			getTokens: H.getTokens,
			deleteToken: vi.fn(),
		}
	}),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onTokenBalanceUpdated: H.balanceUpdated,
			getTokenBalances: vi.fn().mockResolvedValue([]),
			refreshTokenBalance: vi.fn(),
		}
	}),
}))
vi.mock("@/composables/toast.js", () => ({ useToast: () => ({ openToast: H.openToast }) }))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => H.store.current }))
vi.mock("@/stores/cache.store", () => ({ useCacheStore: () => H.cache.current }))
vi.mock("@/stores/popup.store", () => ({
	usePopupStore: () => ({ open: H.popupOpen, isOpened: H.popupIsOpened, closeAll: vi.fn() }),
}))
vi.mock("vue-router", async (importOriginal) => {
	const mod = await importOriginal<typeof import("vue-router")>()
	return { ...mod, useRoute: () => ({ params: { id: "1" } }), useRouter: () => ({ push: vi.fn() }) }
})

import TokenPage from "./[id].vue"
import { type ChromeStorageMock, installChromeStorage } from "../../../../tests/helpers/chrome-storage-mock"

const addr = (n: number) => `0x${n.toString(16).padStart(64, "0")}`
const tok = (id: number, symbol: string) => ({ id, contract: addr(id), symbol, name: `${symbol} Token`, decimals: 18, chainId: 7 })

const STUBS = {
	SubPageHeader: { template: "<div><slot /><slot name='trailing' /><slot name='actions' /></div>" },
	// The page imports `Dropdown` from the family index, whose SFC is named DropdownRoot.
	DropdownRoot: { template: "<div><slot /><slot name='popup' /></div>" },
	// `emits` keeps the parent's @click out of $attrs, so a click fires the handler exactly once.
	DropdownItem: { emits: ["click"], template: "<div v-bind='$attrs' @click=\"$emit('click')\"><slot /></div>", inheritAttrs: false },
	DropdownDivider: { template: "<hr />" },
	Tooltip: { template: "<div><slot /><slot name='content' /></div>" },
	BalanceView: { template: "<div />" },
	Banner: { template: "<div><slot /></div>" },
	RecentActivityView: { template: "<div />" },
	MaterialIcon: { template: "<i />" },
	Icon: { template: "<i />" },
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
}

let storage: ChromeStorageMock

async function mountPage() {
	const wrapper = mount(TokenPage, { global: { stubs: STUBS } })
	await flushPromises()
	return wrapper
}

const pinItem = (wrapper: ReturnType<typeof mount>) => wrapper.find('[data-testid="token-menu-pin"]')

describe("token page — Pin to Home", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		H.popupIsOpened.mockReturnValue(false)
		H.tokenDeleted.clear()
		H.balanceUpdated.clear()
		storage = installChromeStorage()
		H.tokens.current = [tok(1, "AAA"), tok(2, "BBB"), tok(3, "CCC"), tok(4, "DDD")]
		H.getToken.mockImplementation(async () => H.tokens.current[0])
		H.getTokens.mockImplementation(async () => H.tokens.current)
		H.store.current = reactive({
			isLogined: true,
			profile: { id: "p1" },
			network: { id: "n1", chainId: 7 },
			account: { address: "0xacct" },
		})
		H.cache.current = reactive({ confirm: {}, activeTokenIdx: undefined })
	})

	test("unpinned by default: the item reads Pin to Home and data-pinned is false", async () => {
		const wrapper = await mountPage()
		expect(pinItem(wrapper).text()).toContain("Pin to Home")
		expect(pinItem(wrapper).attributes("data-pinned")).toBe("false")
	})

	test("clicking pins the contract, toasts, and flips the item to Unpin from Home", async () => {
		const wrapper = await mountPage()
		await pinItem(wrapper).trigger("click")
		await flushPromises()
		expect(storage.data[pinnedTokensKey("p1")]).toEqual({ "7": [addr(1)] })
		expect(H.openToast).toHaveBeenCalledWith({ label: "Pinned to Home" })
		await nextTick()
		expect(pinItem(wrapper).text()).toContain("Unpin from Home")
		expect(pinItem(wrapper).attributes("data-pinned")).toBe("true")
	})

	test("a pinned token's item unpins on click", async () => {
		storage = installChromeStorage({ [pinnedTokensKey("p1")]: { "7": [addr(1), addr(2)] } })
		const wrapper = await mountPage()
		expect(pinItem(wrapper).attributes("data-pinned")).toBe("true")
		await pinItem(wrapper).trigger("click")
		await flushPromises()
		expect(storage.data[pinnedTokensKey("p1")]).toEqual({ "7": [addr(2)] })
		expect(H.openToast).toHaveBeenCalledWith({ label: "Unpinned from Home" })
	})

	test("a fourth pin opens the single-action Home is full popup naming the pinned symbols", async () => {
		storage = installChromeStorage({ [pinnedTokensKey("p1")]: { "7": [addr(2), addr(3), addr(4)] } })
		const wrapper = await mountPage()
		// A stale callback left in the store must not survive into the informational popup.
		H.cache.current.confirm.callback = vi.fn()
		await pinItem(wrapper).trigger("click")
		await flushPromises()

		expect(storage.data[pinnedTokensKey("p1")]).toEqual({ "7": [addr(2), addr(3), addr(4)] })
		expect(H.openToast).not.toHaveBeenCalled()
		expect(H.popupOpen).toHaveBeenCalledWith("confirm")
		expect(H.cache.current.confirm.callback).toBeUndefined()
		expect(H.cache.current.confirm).toMatchObject({ single: true, title: "Home is full", confirm_text: "Got it" })
		expect(H.cache.current.confirm.description).toBe("Home shows up to 3 pinned tokens. Unpin one of these to pin AAA: BBB, CCC, DDD")
	})

	test("the cap and the popup read the token list at click time: a token added after mount counts", async () => {
		// Only two pinned contracts are known at mount; the third pinned token appears before the click.
		storage = installChromeStorage({ [pinnedTokensKey("p1")]: { "7": [addr(2), addr(3), addr(4)] } })
		H.tokens.current = [tok(1, "AAA"), tok(2, "BBB"), tok(3, "CCC")]
		const wrapper = await mountPage()
		H.tokens.current = [tok(1, "AAA"), tok(2, "BBB"), tok(3, "CCC"), tok(4, "DDD")]
		await pinItem(wrapper).trigger("click")
		await flushPromises()
		expect(H.popupOpen).toHaveBeenCalledWith("confirm")
		expect(H.cache.current.confirm.description).toContain("BBB, CCC, DDD")
	})

	test("a confirm opened while the symbols were being fetched is left alone", async () => {
		storage = installChromeStorage({ [pinnedTokensKey("p1")]: { "7": [addr(2), addr(3), addr(4)] } })
		const resolvers: Array<(t: unknown) => void> = []
		const wrapper = await mountPage()
		H.getTokens.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvers.push(resolve)
				}),
		)
		await pinItem(wrapper).trigger("click")
		await flushPromises()
		// The cap check's token read resolves → "full" → the popup's own symbol read starts.
		resolvers.shift()?.(H.tokens.current)
		await flushPromises()
		// Meanwhile the user opened a destructive confirm (e.g. Remove token).
		const callback = vi.fn()
		H.cache.current.confirm = { description: "remove?", callback }
		H.popupIsOpened.mockReturnValue(true)
		resolvers.shift()?.(H.tokens.current)
		await flushPromises()

		expect(H.popupOpen).not.toHaveBeenCalledWith("confirm")
		expect(H.cache.current.confirm).toEqual({ description: "remove?", callback })
	})

	test("a hostile symbol is bounded in the popup copy", async () => {
		storage = installChromeStorage({ [pinnedTokensKey("p1")]: { "7": [addr(2), addr(3), addr(4)] } })
		H.tokens.current = [tok(1, "AAA"), tok(2, `${"X".repeat(40)}​`), tok(3, "CCC"), tok(4, "DDD")]
		const wrapper = await mountPage()
		await pinItem(wrapper).trigger("click")
		await flushPromises()
		expect(H.cache.current.confirm.description).toContain(`${"X".repeat(32)}…, CCC, DDD`)
	})
})
