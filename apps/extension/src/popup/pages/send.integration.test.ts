/**
 * The Send page over the real fee card, its selector and the balances store — the seam
 * `send.test.ts` stubs. Every settled state is read as one whole: the footer's action against the
 * strip's `you` cell, the three cells, the sheet's own reading, and then what a click sends.
 */
import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { nextTick, reactive } from "vue"

const ACCOUNT = "0xacct"
const DESTINATION = `0x${"b".repeat(64)}`
const TOKEN = {
	id: 7,
	contract: `0x${"c".repeat(64)}`,
	symbol: "TST",
	decimals: 6,
	chainId: 111,
	hasPrivateTransfers: true,
	hasPublicTransfers: true,
	hasPrivateBalances: true,
	hasPublicBalances: true,
}
const BALANCE = { id: "b1", account: ACCOUNT, token: TOKEN, privateBalance: "5000000", publicBalance: "3000000", updatedAt: 1 }

const mocks = vi.hoisted(() => ({
	executeTransfer: vi.fn(),
	estimateTransferFee: vi.fn(),
	cancelEstimate: vi.fn(async () => {}),
	getGasBalances: vi.fn(),
	getFpcs: vi.fn(),
	getTokens: vi.fn(),
	getTokenBalances: vi.fn(),
	getContacts: vi.fn(async () => []),
	openToast: vi.fn(),
	routerBack: vi.fn(),
	routerReplace: vi.fn(),
	legalStatus: vi.fn(async () => "current"),
}))
/** One pair of FPC events for every client instance, so a test can fire what the wallet would. */
const fpcEvents = await vi.hoisted(async () => {
	const { EventHandler } = await import("@nulo/wallet-core/utils")
	return { onFpcDeleted: new EventHandler<unknown>(), onFpcUpdated: new EventHandler<unknown>() }
})

vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			executeTransfer: mocks.executeTransfer,
			estimateTransferFee: mocks.estimateTransferFee,
			cancelEstimate: mocks.cancelEstimate,
			getGasBalances: mocks.getGasBalances,
			peekGasBalances: vi.fn(async () => null),
		}
	}),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), getFpcs: mocks.getFpcs, ...fpcEvents }
	}),
	FpcType: { DefaultSponsoredFpc: 1, PrivateFpc: 2 },
}))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onTokenAdded: new EventHandler(), onTokenDeleted: new EventHandler(), getTokens: mocks.getTokens }
	}),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			onTokenBalanceAdded: new EventHandler(),
			onTokenBalanceUpdated: new EventHandler(),
			onTokenBalanceDeleted: new EventHandler(),
			getTokenBalances: mocks.getTokenBalances,
		}
	}),
}))
vi.mock("@/wallet/services/contact/client", () => ({
	ContactServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onContactAdded: new EventHandler(),
			onContactUpdated: new EventHandler(),
			onContactDeleted: new EventHandler(),
			getContacts: mocks.getContacts,
		}
	}),
}))
vi.mock("@/wallet/services/price/client", () => ({
	PriceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onQuotesUpdated: new EventHandler(),
			onConnected: new EventHandler(),
			refreshIfStale: vi.fn(async () => ({})),
		}
	}),
}))
vi.mock("@/wallet/services/transaction/client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/wallet/services/transaction/client")>()),
	TransactionServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), onTransactionAdded: new EventHandler(), onTransactionUpdated: new EventHandler() }
	}),
}))
vi.mock("@/utils/core", () => ({
	managers: {
		legal: {
			onAcceptanceChanged: new EventHandler(),
			onConnected: new EventHandler(),
			getStatus: mocks.legalStatus,
			accept: vi.fn(),
		},
	},
}))
vi.mock("@/composables/toast.js", () => ({
	useToast: () => ({ openToast: mocks.openToast }),
	TOAST_DURATION: { DEFAULT: 2000, LONG: 4000 },
}))
const route = reactive({ name: "popup-send", path: "/popup/send", query: {} as Record<string, string>, meta: {} })
vi.mock("vue-router", () => ({
	useRoute: () => route,
	useRouter: () => ({ back: mocks.routerBack, replace: mocks.routerReplace }),
	RouterLink: { template: "<a><slot /></a>" },
}))

import type { PayerKind, TransferSide, Visibility } from "@/components/composite/send/publish-facts"
import { REVIEW_ARM_MS } from "@/composables/useSendReview"
import { UI_STORAGE_KEYS } from "@/popup/constants/storage-keys"
import { useAppStore } from "@/stores/app.store"
import { INIT_RETRY_BACKOFF_MS } from "@/stores/balances.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
import { installChromeStorage } from "../../../tests/helpers/chrome-storage-mock"
import Send from "./send.vue"

const STUBS = {
	Flex: { template: '<div v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	MaterialIcon: { template: "<i />" },
	Tooltip: { template: '<div><slot /><slot name="content" /></div>' },
	SubPageHeader: { template: "<header />" },
	Banner: { template: '<div data-testid="stub-banner"><slot /></div>' },
	Button: {
		template: '<button v-bind="$attrs" :disabled="disabled || loading" @click="$emit(\'click\', $event)"><slot /></button>',
		props: ["variant", "size", "disabled", "loading", "wide"],
		emits: ["click"],
		inheritAttrs: false,
	},
	SelectTokenCard: { template: '<div data-testid="stub-token-card" />', props: ["token"] },
	RecipientField: {
		template: '<input data-testid="stub-recipient" :value="searchTerm" @input="$emit(\'update:searchTerm\', $event.target.value)" />',
		props: ["searchTerm", "selectedContact", "candidates"],
		emits: ["update:searchTerm", "update:selectedContact"],
	},
	AmountCard: {
		template: '<input data-testid="stub-amount" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
		props: ["modelValue", "fiatMode", "fiatGuard", "token", "tokenBalanceByType", "balanceRawByType", "liveQuote", "proxyTicker"],
		emits: ["update:modelValue", "update:fiatMode", "update:fiatGuard"],
		methods: { refreezeQuote() {} },
	},
	// The card's read-only rows, and the menu chrome around the real selector's items.
	FeeMethodRow: { template: '<div data-testid="stub-fee-method-row" />' },
	FeeCostReadout: { template: '<div data-testid="stub-fee-cost" />' },
	FeePriorityRow: { template: '<div data-testid="stub-fee-priority" />' },
	DropdownRoot: { template: '<div data-testid="stub-dropdown"><slot name="trigger" /><slot name="popup" /></div>' },
	Popup: {
		name: "Popup",
		template: '<div v-if="show" data-testid="stub-popup" :data-order="displaceIdx"><slot /></div>',
		props: { show: Boolean, displaceIdx: Number, closeOnEscape: Boolean, initialFocus: [String, Boolean] },
		emits: ["onClose"],
	},
	PopupCard: { template: '<div data-testid="stub-card" :data-depth="displaceIdx"><slot /></div>', props: ["displaceIdx"] },
	PopupHeader: {
		template:
			'<div><slot name="title" /><button v-if="closable" data-testid="popup-close-btn" @click="$emit(\'onClose\')">x</button></div>',
		props: { closable: { type: Boolean, default: false } },
		emits: ["onClose"],
	},
}

type W = ReturnType<typeof mount>
type Gas = { publicFeeJuice: string | null; privateFeeJuice: string | null }
type Funding = { gas: Gas; fpcs: unknown[] }

const HELD = "1000000000000000000"
const PRIVATE_FPC = { id: "p1", type: 2, name: "Private FPC", isProtocol: true }
const SPONSOR = { id: "s1", type: 1, name: "Sponsor", isProtocol: true }
const HAND_ADDED = { id: "s2", type: 1, name: "Mine", isProtocol: false }
const SEND_PICKS = UI_STORAGE_KEYS.SEND_FEE_PAYMENT_METHODS

const FUNDING = {
	"no gas, a sponsor": { gas: { publicFeeJuice: "0", privateFeeJuice: "0" }, fpcs: [PRIVATE_FPC, SPONSOR] },
	"public Fee Juice only": { gas: { publicFeeJuice: HELD, privateFeeJuice: "0" }, fpcs: [PRIVATE_FPC, SPONSOR] },
	"private Fee Juice only": { gas: { publicFeeJuice: "0", privateFeeJuice: HELD }, fpcs: [PRIVATE_FPC, SPONSOR] },
	"both Fee Juices": { gas: { publicFeeJuice: HELD, privateFeeJuice: HELD }, fpcs: [PRIVATE_FPC, SPONSOR] },
	"no gas, a hand-added sponsor": { gas: { publicFeeJuice: "0", privateFeeJuice: "0" }, fpcs: [PRIVATE_FPC, HAND_ADDED] },
} satisfies Record<string, Funding>

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
	let resolve!: (v: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

async function mountSend(funding: Funding, opts: { storage?: Record<string, unknown>; holdGas?: boolean } = {}) {
	installChromeStorage(opts.storage ?? {})
	mocks.getFpcs.mockResolvedValue(funding.fpcs)
	const gas = deferred<Gas>()
	if (opts.holdGas) mocks.getGasBalances.mockReturnValue(gas.promise)
	else mocks.getGasBalances.mockResolvedValue(funding.gas)
	const pinia = createTestingPinia({ stubActions: false })
	const appStore = useAppStore(pinia)
	appStore.isLogined = true
	appStore.profile = { id: "p1" } as never
	appStore.network = { id: "n1", chainId: TOKEN.chainId } as never
	appStore.account = { address: ACCOUNT } as never
	const cacheStore = useCacheStore(pinia)
	const popupStore = usePopupStore(pinia)
	const w = mount(Send, {
		attachTo: document.body,
		global: { plugins: [pinia], stubs: STUBS, mocks: { getChainName: () => "Test" } },
	})
	await flushPromises()
	return { w, appStore, cacheStore, popupStore, gas }
}

async function fillForm(w: W) {
	await w.get('[data-testid="stub-recipient"]').setValue(DESTINATION)
	await w.get('[data-testid="stub-amount"]').setValue("1.5")
}

const submit = (w: W) => w.get('[data-testid="send-submit"]')
const strip = (w: W) => w.get('[data-testid="send-publish-strip"]')
const tag = (w: W) => w.find('[data-testid="send-fee-privacy-notice"]')
const sheetOpen = (w: W) => w.get('[data-testid="send-review-sheet"]').attributes("data-open") === "true"
const closeSheet = (w: W) => w.get('[data-testid="popup-close-btn"]').trigger("click")
const feeTrigger = (w: W) => w.get('[data-testid="send-fee-method-trigger"]').attributes("data-fee-method")
const pickFee = (w: W, subtitle: "public" | "private" | "sponsored") =>
	w.get(`[data-testid="send-fee-method-${subtitle}"]`).trigger("click")
/** Both sides start private for a token that can do either; one toggle each reaches public. */
const setSide = async (w: W, side: "from" | "to", want: TransferSide) => {
	if (want === "public") await w.get(`[data-testid="send-${side}-type"]`).trigger("click")
}

/** The one reading a settled state must give everywhere at once: the tag, the footer's action and the strip's `you`. */
function settled(w: W) {
	const action = submit(w).attributes("data-action")
	const you = strip(w).attributes("data-you")
	expect(action === "review").toBe(you === "exposed")
	expect(tag(w).exists()).toBe(you === "exposed")
	return { action, you, to: strip(w).attributes("data-to"), amount: strip(w).attributes("data-amount") }
}

const submittedFee = () => (mocks.executeTransfer.mock.calls[0]?.[6] as { paymentMethod: unknown } | undefined)?.paymentMethod

beforeEach(() => {
	document.body.innerHTML = '<div id="popup"></div>'
	mocks.getTokens.mockResolvedValue([TOKEN])
	mocks.getTokenBalances.mockResolvedValue([BALANCE])
	mocks.executeTransfer.mockResolvedValue(undefined)
	mocks.legalStatus.mockResolvedValue("current")
	vi.spyOn(console, "error").mockImplementation(() => {})
	vi.spyOn(console, "debug").mockImplementation(() => {})
})
afterEach(() => {
	vi.clearAllMocks()
	vi.restoreAllMocks()
	vi.useRealTimers()
	document.body.innerHTML = ""
})

/** Funding × origin: who the wallet resolves as payer, and what that publishes about the account. */
const SWEEP: Array<[keyof typeof FUNDING, TransferSide, Visibility, PayerKind, { kind: string; fpcId?: string }]> = [
	["no gas, a sponsor", "private", "hidden", "contract", { kind: "fpc", fpcId: "s1" }],
	["no gas, a sponsor", "public", "public", "contract", { kind: "fpc", fpcId: "s1" }],
	["public Fee Juice only", "private", "exposed", "account", { kind: "fj" }],
	["public Fee Juice only", "public", "public", "account", { kind: "fj" }],
	["private Fee Juice only", "private", "hidden", "contract", { kind: "fpc", fpcId: "p1" }],
	["private Fee Juice only", "public", "public", "contract", { kind: "fpc", fpcId: "p1" }],
	["both Fee Juices", "private", "hidden", "contract", { kind: "fpc", fpcId: "p1" }],
	["both Fee Juices", "public", "public", "account", { kind: "fj" }],
	["no gas, a hand-added sponsor", "private", "unknown", "unvouched", { kind: "fpc", fpcId: "s2" }],
	["no gas, a hand-added sponsor", "public", "public", "unvouched", { kind: "fpc", fpcId: "s2" }],
]
const SIDE_CELLS = {
	"private→private": { to: "hidden", amount: "hidden" },
	"private→public": { to: "public", amount: "public" },
	"public→private": { to: "hidden", amount: "public" },
	"public→public": { to: "public", amount: "public" },
} as const

describe.each(SWEEP)("send page with the real fee card — %s, %s origin", (funding, origin, you, payer, fee) => {
	test.each<TransferSide>(["private", "public"])("→ %s destination", async (destination) => {
		const { w } = await mountSend(FUNDING[funding])
		await fillForm(w)
		await setSide(w, "from", origin)
		await setSide(w, "to", destination)
		expect(mocks.getGasBalances).toHaveBeenCalledWith("n1", ACCOUNT, true)

		const state = settled(w)
		expect(state.you).toBe(you)
		expect({ to: state.to, amount: state.amount }).toEqual(SIDE_CELLS[`${origin}→${destination}`])
		expect(feeTrigger(w)).toBe(fee.kind === "fj" ? "public" : fee.fpcId === "p1" ? "private" : "sponsored")

		await strip(w).trigger("click")
		expect(w.get('[data-testid="send-review-row-you"]').attributes("data-visibility")).toBe(you)
		expect(w.get('[data-testid="send-review-fee"]').attributes("data-payer")).toBe(payer)
		await closeSheet(w)

		await submit(w).trigger("click")
		if (state.action === "review") {
			expect(mocks.executeTransfer).not.toHaveBeenCalled()
			expect(sheetOpen(w)).toBe(true)
			expect(w.get('[data-testid="send-review-row-you"]').attributes("data-notice-shape")).toBe(`private-${destination}`)
			expect(tag(w).attributes("data-notice-shape")).toBe(`private-${destination}`)
		} else {
			expect(mocks.executeTransfer).toHaveBeenCalledTimes(1)
			expect(submittedFee()).toMatchObject(fee)
			expect(sheetOpen(w)).toBe(false)
		}
		w.unmount()
	})
})

describe("send page with the real fee card — nothing to send", () => {
	test("no sendable token with funded Fee Juice: no strip, no tag, and the action is never review", async () => {
		mocks.getTokens.mockResolvedValue([])
		mocks.getTokenBalances.mockResolvedValue([])
		const { w } = await mountSend(FUNDING["public Fee Juice only"])
		expect(w.find('[data-testid="send-publish-strip"]').exists()).toBe(false)
		expect(tag(w).exists()).toBe(false)
		expect(submit(w).attributes("data-action")).toBe("send")
		expect(submit(w).attributes("disabled")).toBeDefined()
		w.unmount()
	})

	test("no gas and no sponsor: the footer asks for gas, and the strip vouches for nothing", async () => {
		const { w } = await mountSend({ gas: { publicFeeJuice: "0", privateFeeJuice: "0" }, fpcs: [PRIVATE_FPC] })
		await fillForm(w)
		expect(w.find('[data-testid="send-submit"]').exists()).toBe(false)
		expect(w.get('[data-testid="send-get-fee-juice"]').text()).toBe("Get private gas")
		expect(strip(w).attributes("data-you")).toBe("unknown")
		w.unmount()
	})
})

describe("send page with the real fee card — transitions", () => {
	test("balances still pending: —, no tag, nothing sendable; the read landing settles it", async () => {
		const { w, gas } = await mountSend(FUNDING["public Fee Juice only"], { holdGas: true })
		await fillForm(w)
		expect(strip(w).attributes("data-you")).toBe("unknown")
		expect(tag(w).exists()).toBe(false)
		expect(submit(w).attributes("data-action")).toBe("send")
		expect(submit(w).attributes("disabled")).toBeDefined()
		expect(feeTrigger(w)).toBeUndefined()

		gas.resolve(FUNDING["public Fee Juice only"].gas)
		await flushPromises()
		expect(settled(w)).toMatchObject({ you: "exposed", action: "review" })
		expect(submit(w).attributes("disabled")).toBeUndefined()
		w.unmount()
	})

	test("Fee Juice picked by hand under a private origin turns the send gated; the primary button then only opens the sheet", async () => {
		const { w } = await mountSend(FUNDING["both Fee Juices"])
		await fillForm(w)
		expect(settled(w)).toMatchObject({ you: "hidden", action: "send" })

		await pickFee(w, "public")
		expect(feeTrigger(w)).toBe("public")
		expect(settled(w)).toMatchObject({ you: "exposed", action: "review" })
		await submit(w).trigger("click")
		expect(mocks.executeTransfer).not.toHaveBeenCalled()
		expect(sheetOpen(w)).toBe(true)
		await closeSheet(w)

		await pickFee(w, "private")
		expect(settled(w)).toMatchObject({ you: "hidden", action: "send" })
		await submit(w).trigger("click")
		expect(submittedFee()).toEqual({ kind: "fpc", fpcId: "p1" })
		w.unmount()
	})

	test("the picked sponsor deleted: the walk moves on to the account, and the send turns gated", async () => {
		const picks = { [ACCOUNT]: { private: { type: "fpc", fpc: { id: "s1", name: "Sponsor" } } } }
		const { w } = await mountSend(FUNDING["public Fee Juice only"], { storage: { [SEND_PICKS]: picks } })
		await fillForm(w)
		expect(feeTrigger(w)).toBe("sponsored")
		expect(settled(w)).toMatchObject({ you: "hidden", action: "send" })

		fpcEvents.onFpcDeleted.invoke(SPONSOR)
		await nextTick()
		expect(mocks.openToast).toHaveBeenCalledWith({ label: "Selected FPC was deleted" })
		expect(feeTrigger(w)).toBe("public")
		expect(settled(w)).toMatchObject({ you: "exposed", action: "review" })
		await submit(w).trigger("click")
		expect(mocks.executeTransfer).not.toHaveBeenCalled()
		w.unmount()
	})

	test("a failed balance read pays through the sponsor; the store's retry lands and the walk reaches the account", async () => {
		vi.useFakeTimers()
		mocks.getGasBalances.mockRejectedValueOnce(new Error("boom"))
		const { w } = await mountSend(FUNDING["public Fee Juice only"])
		await fillForm(w)
		expect(w.find('[data-testid="fee-init-degraded"]').exists()).toBe(true)
		expect(settled(w)).toMatchObject({ you: "hidden", action: "send" })

		await vi.advanceTimersByTimeAsync(INIT_RETRY_BACKOFF_MS[0])
		await vi.advanceTimersByTimeAsync(0)
		expect(mocks.getGasBalances).toHaveBeenCalledTimes(2)
		expect(w.find('[data-testid="fee-init-degraded"]').exists()).toBe(false)
		expect(settled(w)).toMatchObject({ you: "exposed", action: "review" })
		w.unmount()
	})

	test("the protocol sponsor's row updated to a custom address under the same id: HIDDEN is withdrawn", async () => {
		const { w } = await mountSend(FUNDING["no gas, a sponsor"])
		await fillForm(w)
		expect(settled(w)).toMatchObject({ you: "hidden", action: "send" })

		fpcEvents.onFpcUpdated.invoke({ ...SPONSOR, isProtocol: false })
		await nextTick()
		expect(settled(w)).toMatchObject({ you: "unknown", action: "send" })
		await strip(w).trigger("click")
		expect(w.get('[data-testid="send-review-fee"]').attributes("data-payer")).toBe("unvouched")
		expect(w.get('[data-testid="send-review-row-you"]').text()).toContain("added by hand")
		w.unmount()
	})

	test("a network switch reads — until the new scope commits, never the old scope's HIDDEN", async () => {
		const { w, appStore } = await mountSend(FUNDING["no gas, a sponsor"])
		await fillForm(w)
		expect(settled(w).you).toBe("hidden")

		const gas = deferred<Gas>()
		mocks.getGasBalances.mockReturnValueOnce(gas.promise)
		appStore.network = { id: "n2", chainId: TOKEN.chainId } as never
		await flushPromises()
		expect(strip(w).attributes("data-you")).toBe("unknown")
		expect(submit(w).attributes("data-action")).toBe("send")
		expect(submit(w).attributes("disabled")).toBeDefined()

		gas.resolve(FUNDING["public Fee Juice only"].gas)
		await flushPromises()
		expect(mocks.getGasBalances).toHaveBeenLastCalledWith("n2", ACCOUNT, true)
		expect(settled(w)).toMatchObject({ you: "exposed", action: "review" })
		w.unmount()
	})

	test("origin and destination toggles move the cells and the action together, with the same payer", async () => {
		const { w } = await mountSend(FUNDING["public Fee Juice only"])
		await fillForm(w)
		expect(settled(w)).toEqual({ action: "review", you: "exposed", to: "hidden", amount: "hidden" })

		await w.get('[data-testid="send-to-type"]').trigger("click")
		expect(settled(w)).toEqual({ action: "review", you: "exposed", to: "public", amount: "public" })
		expect(tag(w).attributes("data-notice-shape")).toBe("private-public")
		await strip(w).trigger("click")
		expect(w.get('[data-testid="send-review-row-you"]').attributes("data-notice-shape")).toBe("private-public")
		await closeSheet(w)

		await w.get('[data-testid="send-from-type"]').trigger("click")
		expect(settled(w)).toEqual({ action: "send", you: "public", to: "public", amount: "public" })
		expect(feeTrigger(w)).toBe("public")

		await w.get('[data-testid="send-from-type"]').trigger("click")
		expect(settled(w)).toEqual({ action: "review", you: "exposed", to: "public", amount: "public" })
		w.unmount()
	})

	test("an account switch while the sheet is open closes it, and its send event then sends nothing", async () => {
		vi.useFakeTimers()
		const { w, appStore } = await mountSend(FUNDING["public Fee Juice only"])
		await fillForm(w)
		await submit(w).trigger("click")
		expect(sheetOpen(w)).toBe(true)
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		await nextTick()
		expect(w.get('[data-testid="send-review-submit"]').attributes("data-ready")).toBe("true")

		appStore.account = { address: "0xother" } as never
		await flushPromises()
		expect(sheetOpen(w)).toBe(false)
		w.findComponent({ name: "SendReviewSheet" }).vm.$emit("send")
		await flushPromises()
		expect(mocks.executeTransfer).not.toHaveBeenCalled()
		w.unmount()
	})

	test("closing the sheet leaves the hand-picked fee source and the rest of the form in place", async () => {
		const { w } = await mountSend(FUNDING["both Fee Juices"])
		await fillForm(w)
		await pickFee(w, "public")
		await submit(w).trigger("click")
		expect(sheetOpen(w)).toBe(true)
		await closeSheet(w)
		expect(sheetOpen(w)).toBe(false)
		expect(feeTrigger(w)).toBe("public")
		expect((w.get('[data-testid="stub-amount"]').element as HTMLInputElement).value).toBe("1.5")
		expect((w.get('[data-testid="stub-recipient"]').element as HTMLInputElement).value).toBe(DESTINATION)
		expect(settled(w)).toMatchObject({ you: "exposed", action: "review" })
		w.unmount()
	})
})
