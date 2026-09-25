/**
 * The Send page with its cards stubbed: what the footer does with a click, what the review sheet
 * authorises, and what the submit tail does with the promise. The fee card's real behaviour, and
 * the tag ⇔ gate ⇔ strip equivalence it feeds, is `send.integration.test.ts`.
 */
import { createTestingPinia } from "@pinia/testing"
import { flushPromises, mount } from "@vue/test-utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { JobCancelledError, TermsAcceptanceRequiredError } from "@nulo/extension-messaging/errors"
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
	executionDisconnect: vi.fn(),
	getTokens: vi.fn(),
	getTokenBalances: vi.fn(),
	getContacts: vi.fn(async () => []),
	openToast: vi.fn(),
	routerBack: vi.fn(),
	routerReplace: vi.fn(),
	legalStatus: vi.fn(async () => "current"),
}))

vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: mocks.executionDisconnect,
			executeTransfer: mocks.executeTransfer,
			estimateTransferFee: mocks.estimateTransferFee,
			cancelEstimate: mocks.cancelEstimate,
		}
	}),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return { disconnect: vi.fn(), onTokenAdded: new EventHandler(), onTokenDeleted: new EventHandler(), getTokens: mocks.getTokens }
	}),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn(function () {
		return {
			disconnect: vi.fn(),
			onTokenBalanceAdded: new EventHandler(),
			onTokenBalanceUpdated: new EventHandler(),
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
}))
const route = reactive({ name: "popup-send", path: "/popup/send", query: {} as Record<string, string>, meta: {} })
vi.mock("vue-router", () => ({
	useRoute: () => route,
	useRouter: () => ({ back: mocks.routerBack, replace: mocks.routerReplace }),
	RouterLink: { template: "<a><slot /></a>" },
}))

import { REVIEW_ARM_MS } from "@/composables/useSendReview"
import { TRANSFER_FAILED_COPY, TRANSFER_TERMS_COPY } from "@/popup/utils/transfer-failure-copy"
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
import { usePopupStore } from "@/stores/popup.store"
import { TransferType } from "@/wallet/services/transaction/client"
import { installChromeStorage } from "../../../tests/helpers/chrome-storage-mock"
import Send from "./send.vue"

const STUBS = {
	Flex: { template: '<div v-bind="$attrs"><slot /></div>', inheritAttrs: false },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	MaterialIcon: { template: "<i />" },
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
	FeeSettingsCard: {
		name: "FeeSettingsCard",
		template: '<div data-testid="stub-fee-card" :data-origin="originPrivacy" :data-destination="destinationPrivacy" />',
		props: [
			"profile",
			"network",
			"account",
			"feeEstimate",
			"isEstimating",
			"originPrivacy",
			"destinationPrivacy",
			"payerNoticeShape",
			"modelValue",
			"needsFeeJuice",
			"payer",
		],
		emits: ["update:modelValue", "update:needsFeeJuice", "update:payer"],
	},
	// The popup family under the real review sheet: what the sheet hands it, without trap or teleport.
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
/** The account's own Fee Juice: the one payer that names it. */
const FJ = { settings: { paymentMethod: { kind: "fj" } }, payer: { type: "fj", isProtocol: false } }
/** A protocol sponsor: hidden, one tap. */
const SPONSOR = { settings: { paymentMethod: { kind: "fpc", fpcId: "s1" } }, payer: { type: "fpc", fpcId: "s1", isProtocol: true } }

async function mountSend() {
	installChromeStorage()
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
	return { w, appStore, cacheStore, popupStore }
}

/** What the fee card would hand the page for a resolved method. */
async function feeCard(w: W, method: { settings: unknown; payer: unknown } | null) {
	const card = w.findComponent({ name: "FeeSettingsCard" }).vm
	card.$emit("update:payer", method?.payer ?? null)
	card.$emit("update:modelValue", method?.settings ?? null)
	await nextTick()
}

/** A complete, sendable form — a sponsor pays unless told otherwise, so nothing needs review. */
async function fillForm(w: W, method: { settings: unknown; payer: unknown } | null = SPONSOR) {
	await w.get('[data-testid="stub-recipient"]').setValue(DESTINATION)
	await w.get('[data-testid="stub-amount"]').setValue("1.5")
	await feeCard(w, method)
}

const submit = (w: W) => w.get('[data-testid="send-submit"]')
const strip = (w: W) => w.find('[data-testid="send-publish-strip"]')
const sheetOpen = (w: W) => w.get('[data-testid="send-review-sheet"]').attributes("data-open") === "true"
const sendNow = (w: W) => w.get('[data-testid="send-review-submit"]')
const awaitingIds = (store: ReturnType<typeof useAppStore>) => store.awaitingTransactions.map((row) => row.id)

/** A transfer the test settles by hand. */
function pendingTransfer() {
	let resolve: () => void = () => {}
	let reject: (err: unknown) => void = () => {}
	mocks.executeTransfer.mockImplementation(
		() =>
			new Promise<void>((res, rej) => {
				resolve = res
				reject = rej
			}),
	)
	return { resolve: () => resolve(), reject: (err: unknown) => reject(err) }
}

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

describe("send page — the submit tail", () => {
	test("a click posts the awaiting row, fires the transfer with the snapshotted args, and leaves", async () => {
		const { w, appStore } = await mountSend()
		await fillForm(w)
		expect(submit(w).attributes("disabled")).toBeUndefined()
		expect(submit(w).text()).toBe("Confirm Transaction")

		await submit(w).trigger("click")

		expect(mocks.executeTransfer).toHaveBeenCalledTimes(1)
		expect(mocks.executeTransfer).toHaveBeenCalledWith(
			"n1",
			ACCOUNT,
			TOKEN.id,
			TransferType.Private,
			DESTINATION,
			1_500_000n,
			SPONSOR.settings,
			undefined,
		)
		expect(appStore.awaitingTransactions).toHaveLength(1)
		expect(appStore.awaitingTransactions[0]).toMatchObject({ account: ACCOUNT, destination: DESTINATION, contract: TOKEN.contract })
		expect(mocks.routerReplace).toHaveBeenCalledWith("/popup/general")
		expect(submit(w).text()).toBe("CONFIRMING")
		w.unmount()
	})

	test("two activations in the same tick, before the button is patched disabled, send once", async () => {
		const { w } = await mountSend()
		await fillForm(w)
		pendingTransfer()
		;(submit(w).element as HTMLButtonElement).click()
		;(submit(w).element as HTMLButtonElement).click()
		await flushPromises()
		expect(mocks.executeTransfer).toHaveBeenCalledTimes(1)
		w.unmount()
	})

	test("resolved: the success toast; the awaiting row stays for the journal to replace", async () => {
		const { w, appStore } = await mountSend()
		await fillForm(w)
		const transfer = pendingTransfer()
		await submit(w).trigger("click")
		transfer.resolve()
		await flushPromises()
		expect(mocks.openToast).toHaveBeenCalledWith({ kind: "success", label: "Transaction submitted" })
		expect(awaitingIds(appStore)).toHaveLength(1)
		expect(mocks.executionDisconnect).toHaveBeenCalledTimes(1)
		w.unmount()
		expect(mocks.executionDisconnect).toHaveBeenCalledTimes(1)
	})

	test("rejected: exactly this awaiting row is removed and the failure toast is red", async () => {
		const { w, appStore } = await mountSend()
		await fillForm(w)
		appStore.addAwaitingTransaction({ id: "other", account: ACCOUNT, destination: DESTINATION, contract: TOKEN.contract })
		const transfer = pendingTransfer()
		await submit(w).trigger("click")
		expect(awaitingIds(appStore)).toHaveLength(2)
		transfer.reject(new Error("boom"))
		await flushPromises()
		expect(awaitingIds(appStore)).toEqual(["other"])
		expect(mocks.openToast).toHaveBeenCalledWith({ kind: "error", label: TRANSFER_FAILED_COPY })
		expect(console.error).toHaveBeenCalledWith("[send] executeTransfer failed:", expect.any(Error))
		expect(mocks.executionDisconnect).toHaveBeenCalledTimes(1)
		w.unmount()
	})

	test("rejected by the terms wall: the terms copy, logged at debug", async () => {
		const { w } = await mountSend()
		await fillForm(w)
		const transfer = pendingTransfer()
		await submit(w).trigger("click")
		transfer.reject(new TermsAcceptanceRequiredError())
		await flushPromises()
		expect(mocks.openToast).toHaveBeenCalledWith({ kind: "error", label: TRANSFER_TERMS_COPY })
		expect(console.debug).toHaveBeenCalledWith("[send] executeTransfer refused:", expect.any(TermsAcceptanceRequiredError))
		expect(console.error).not.toHaveBeenCalledWith("[send] executeTransfer failed:", expect.anything())
		w.unmount()
	})

	test("cancelled by the user: the row goes, no toast", async () => {
		const { w, appStore } = await mountSend()
		await fillForm(w)
		const transfer = pendingTransfer()
		await submit(w).trigger("click")
		transfer.reject(new JobCancelledError())
		await flushPromises()
		expect(awaitingIds(appStore)).toHaveLength(0)
		expect(mocks.openToast).not.toHaveBeenCalled()
		w.unmount()
	})

	test("unmounting mid-flight leaves the execution port to the transfer's own teardown", async () => {
		const { w } = await mountSend()
		await fillForm(w)
		const transfer = pendingTransfer()
		await submit(w).trigger("click")
		w.unmount()
		expect(mocks.executionDisconnect).not.toHaveBeenCalled()
		transfer.resolve()
		await flushPromises()
		expect(mocks.executionDisconnect).toHaveBeenCalledTimes(1)
	})

	test("unmounting with nothing in flight disconnects the execution port once", async () => {
		const { w } = await mountSend()
		await fillForm(w)
		w.unmount()
		expect(mocks.executionDisconnect).toHaveBeenCalledTimes(1)
	})
})

describe("send page — the footer", () => {
	test("no settings from the card: nothing is sendable", async () => {
		const { w } = await mountSend()
		await fillForm(w, null)
		expect(submit(w).attributes("disabled")).toBeDefined()
		await submit(w).trigger("click")
		expect(mocks.executeTransfer).not.toHaveBeenCalled()
		w.unmount()
	})

	test("needsFeeJuice from the card takes the footer over", async () => {
		const { w } = await mountSend()
		await fillForm(w)
		w.findComponent({ name: "FeeSettingsCard" }).vm.$emit("update:needsFeeJuice", true)
		await nextTick()
		expect(w.find('[data-testid="send-submit"]').exists()).toBe(false)
		expect(w.get('[data-testid="send-get-fee-juice"]').text()).toBe("Get private gas")
		w.unmount()
	})

	test("no sendable token: no strip, and the action is never review, whatever the card says", async () => {
		mocks.getTokens.mockResolvedValue([])
		mocks.getTokenBalances.mockResolvedValue([])
		const { w } = await mountSend()
		await feeCard(w, FJ)
		expect(strip(w).exists()).toBe(false)
		expect(submit(w).attributes("data-action")).toBe("send")
		expect(submit(w).text()).toBe("Confirm Transaction")
		w.unmount()
	})

	test("the strip carries the facts and opens the sheet on an unfinished form", async () => {
		const { w } = await mountSend()
		await feeCard(w, FJ)
		const el = strip(w)
		expect(el.attributes("data-you")).toBe("exposed")
		expect(el.attributes("data-to")).toBe("hidden")
		expect(el.attributes("data-amount")).toBe("hidden")
		await el.trigger("click")
		expect(sheetOpen(w)).toBe(true)
		expect(sendNow(w).attributes("disabled")).toBeDefined()
		expect(w.get('[data-testid="send-review-amount"]').text()).toBe("—")
		w.unmount()
	})

	test("the card's payer reading and the origin flip the action together", async () => {
		const { w } = await mountSend()
		await fillForm(w, FJ)
		expect(submit(w).attributes("data-action")).toBe("review")
		expect(submit(w).text()).toBe("Review send")
		await feeCard(w, SPONSOR)
		expect(submit(w).attributes("data-action")).toBe("send")
		await feeCard(w, FJ)
		await w.get('[data-testid="send-from-type"]').trigger("click")
		expect(submit(w).attributes("data-action")).toBe("send")
		expect(strip(w).attributes("data-you")).toBe("public")
		w.unmount()
	})

	test("the card is handed the tag's shape exactly while the send is gated", async () => {
		const { w } = await mountSend()
		const shape = () => w.findComponent({ name: "FeeSettingsCard" }).props("payerNoticeShape")
		await fillForm(w, FJ)
		expect(shape()).toBe("private-private")
		await w.get('[data-testid="send-to-type"]').trigger("click")
		expect(shape()).toBe("private-public")
		await feeCard(w, SPONSOR)
		expect(shape()).toBeNull()
		await feeCard(w, FJ)
		await w.get('[data-testid="send-from-type"]').trigger("click")
		expect(shape()).toBeNull()
		w.unmount()
	})
})

describe("send page — consent", () => {
	test("gated: the primary button opens the sheet and sends nothing", async () => {
		const { w } = await mountSend()
		await fillForm(w, FJ)
		await submit(w).trigger("click")
		expect(mocks.executeTransfer).not.toHaveBeenCalled()
		expect(sheetOpen(w)).toBe(true)
		expect(w.get('[data-testid="send-review-row-you"]').attributes("data-visibility")).toBe("exposed")
		expect(w.get('[data-testid="send-review-row-you"]').attributes("data-notice-shape")).toBe("private-private")
		w.unmount()
	})

	test("gated: Send now before the wait sends nothing, after it sends once — the slot closed before leaving", async () => {
		vi.useFakeTimers()
		const { w, popupStore } = await mountSend()
		await fillForm(w, FJ)
		await submit(w).trigger("click")
		expect(sendNow(w).attributes("data-ready")).toBe("false")
		await sendNow(w).trigger("click")
		expect(mocks.executeTransfer).not.toHaveBeenCalled()

		vi.advanceTimersByTime(REVIEW_ARM_MS)
		await nextTick()
		expect(sendNow(w).attributes("data-ready")).toBe("true")
		const closeSpy = vi.spyOn(popupStore, "close")
		await sendNow(w).trigger("click")
		expect(mocks.executeTransfer).toHaveBeenCalledTimes(1)
		expect(mocks.executeTransfer.mock.calls[0]?.[6]).toEqual(FJ.settings)
		expect(closeSpy.mock.invocationCallOrder[0]).toBeLessThan(mocks.routerReplace.mock.invocationCallOrder[0] as number)
		expect(sheetOpen(w)).toBe(false)
		w.unmount()
	})

	test("not gated: the optional sheet, opened from the strip, sends at once", async () => {
		const { w } = await mountSend()
		await fillForm(w)
		await strip(w).trigger("click")
		expect(sendNow(w).attributes("data-ready")).toBe("true")
		await sendNow(w).trigger("click")
		expect(mocks.executeTransfer).toHaveBeenCalledTimes(1)
		w.unmount()
	})

	test("turning gated while the sheet is open starts the wait; turning back makes it sendable at once", async () => {
		vi.useFakeTimers()
		const { w } = await mountSend()
		await fillForm(w)
		await strip(w).trigger("click")
		await feeCard(w, FJ)
		expect(sendNow(w).attributes("data-ready")).toBe("false")
		await sendNow(w).trigger("click")
		expect(mocks.executeTransfer).not.toHaveBeenCalled()
		vi.advanceTimersByTime(REVIEW_ARM_MS - 1)
		await nextTick()
		expect(sendNow(w).attributes("data-ready")).toBe("false")

		await feeCard(w, SPONSOR)
		expect(sendNow(w).attributes("data-ready")).toBe("true")
		await sendNow(w).trigger("click")
		expect(mocks.executeTransfer).toHaveBeenCalledTimes(1)
		w.unmount()
	})

	test.each([
		["gated", FJ],
		["not gated", SPONSOR],
	])("the sheet's send event while its slot is closed sends nothing (%s, wait elapsed)", async (_name, method) => {
		vi.useFakeTimers()
		const { w } = await mountSend()
		await fillForm(w, method)
		await strip(w).trigger("click")
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		await w.get('[data-testid="popup-close-btn"]').trigger("click")
		expect(sheetOpen(w)).toBe(false)
		w.findComponent({ name: "SendReviewSheet" }).vm.$emit("send")
		await flushPromises()
		expect(mocks.executeTransfer).not.toHaveBeenCalled()
		w.unmount()
	})

	test("a popup opened over the armed sheet takes its consent; closed again, the wait starts over", async () => {
		vi.useFakeTimers()
		const { w, popupStore } = await mountSend()
		await fillForm(w, FJ)
		await submit(w).trigger("click")
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		await nextTick()
		expect(sendNow(w).attributes("data-ready")).toBe("true")

		popupStore.open("confirm")
		await nextTick()
		expect(sendNow(w).attributes("data-ready")).toBe("false")
		expect(sendNow(w).attributes("disabled")).toBeDefined()
		await sendNow(w).trigger("click")
		expect(mocks.executeTransfer).not.toHaveBeenCalled()

		popupStore.close("confirm")
		await nextTick()
		expect(sendNow(w).attributes("data-ready")).toBe("false")
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		await nextTick()
		expect(sendNow(w).attributes("data-ready")).toBe("true")
		await sendNow(w).trigger("click")
		expect(mocks.executeTransfer).toHaveBeenCalledTimes(1)
		w.unmount()
	})

	test("the primary button never sends a gated transfer, even with the sheet open and ready", async () => {
		vi.useFakeTimers()
		const { w } = await mountSend()
		await fillForm(w, FJ)
		await strip(w).trigger("click")
		vi.advanceTimersByTime(REVIEW_ARM_MS)
		await nextTick()
		expect(sendNow(w).attributes("data-ready")).toBe("true")
		;(submit(w).element as HTMLButtonElement).click()
		await flushPromises()
		expect(mocks.executeTransfer).not.toHaveBeenCalled()
		w.unmount()
	})
})

describe("send page — the sheet on the popup stack", () => {
	test("a popup opened on top gets the higher order; the sheet is displaced behind it", async () => {
		const { w, popupStore } = await mountSend()
		await fillForm(w)
		await strip(w).trigger("click")
		expect(w.get('[data-testid="stub-popup"]').attributes("data-order")).toBe("0")
		expect(w.get('[data-testid="stub-card"]').attributes("data-depth")).toBe("1")
		popupStore.open("confirm")
		await nextTick()
		expect(popupStore.popups.confirm?.order).toBe(1)
		expect(w.get('[data-testid="stub-popup"]').attributes("data-order")).toBe("0")
		expect(w.get('[data-testid="stub-card"]').attributes("data-depth")).toBe("2")
		w.unmount()
	})

	test("closing the sheet underneath a newer popup keeps orders unique; opening twice does not renumber", async () => {
		const { w, popupStore } = await mountSend()
		await fillForm(w)
		await strip(w).trigger("click")
		popupStore.open("confirm")
		await strip(w).trigger("click")
		expect(popupStore.popups.send_review?.order).toBe(0)
		await w.get('[data-testid="popup-close-btn"]').trigger("click")
		expect(popupStore.popups.confirm?.order).toBe(0)
		expect(popupStore.len).toBe(1)
		w.unmount()
	})

	test("closeAll (lock) closes it; unmounting releases the slot; a reopen takes a fresh one", async () => {
		const { w, popupStore } = await mountSend()
		await fillForm(w)
		await strip(w).trigger("click")
		popupStore.closeAll()
		await nextTick()
		expect(sheetOpen(w)).toBe(false)
		await strip(w).trigger("click")
		expect(sheetOpen(w)).toBe(true)
		w.unmount()
		expect(popupStore.isOpened("send_review")).toBe(false)
	})

	test.each([
		["account switch", (store: ReturnType<typeof useAppStore>) => (store.account = { address: "0xother" } as never)],
		["network switch", (store: ReturnType<typeof useAppStore>) => (store.network = { id: "n2", chainId: TOKEN.chainId } as never)],
	])("an %s while the sheet is open closes it and sends nothing", async (_name, switchIdentity) => {
		const { w, appStore } = await mountSend()
		await fillForm(w, FJ)
		await submit(w).trigger("click")
		expect(sheetOpen(w)).toBe(true)
		switchIdentity(appStore)
		await flushPromises()
		expect(sheetOpen(w)).toBe(false)
		expect(mocks.executeTransfer).not.toHaveBeenCalled()
		w.unmount()
	})

	test("a token switch while the sheet is open closes it", async () => {
		const other = { ...TOKEN, id: 8, contract: `0x${"d".repeat(64)}` }
		mocks.getTokens.mockResolvedValue([TOKEN, other])
		const { w, cacheStore } = await mountSend()
		await fillForm(w, FJ)
		await submit(w).trigger("click")
		cacheStore.activeTokenIdx = other.id
		await nextTick()
		expect(sheetOpen(w)).toBe(false)
		w.unmount()
	})

	test.each([
		["header close", async (w: W) => w.get('[data-testid="popup-close-btn"]').trigger("click")],
		["backdrop / Escape", async (w: W) => w.findComponent({ name: "Popup" }).vm.$emit("onClose")],
	])("closing by %s leaves the form intact", async (_name, close) => {
		const { w } = await mountSend()
		await fillForm(w, FJ)
		await w.get('[data-testid="send-to-type"]').trigger("click")
		await submit(w).trigger("click")
		expect(sheetOpen(w)).toBe(true)
		await close(w)
		await nextTick()
		expect(sheetOpen(w)).toBe(false)
		expect((w.get('[data-testid="stub-amount"]').element as HTMLInputElement).value).toBe("1.5")
		expect((w.get('[data-testid="stub-recipient"]').element as HTMLInputElement).value).toBe(DESTINATION)
		expect(strip(w).attributes("data-to")).toBe("public")
		expect(submit(w).attributes("data-action")).toBe("review")
		w.unmount()
	})
})
