/**
 * The Send page with its cards stubbed: what the footer does with a click, and what the submit
 * tail does with the promise. The fee card's real behaviour is `send.integration.test.ts`.
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
	TOAST_DURATION: { DEFAULT: 2000, LONG: 4000 },
}))
const route = reactive({ name: "popup-send", path: "/popup/send", query: {} as Record<string, string>, meta: {} })
vi.mock("vue-router", () => ({
	useRoute: () => route,
	useRouter: () => ({ back: mocks.routerBack, replace: mocks.routerReplace }),
	RouterLink: { template: "<a><slot /></a>" },
}))

import { TransferType } from "@/wallet/services/transaction/client"
import { TRANSFER_FAILED_COPY, TRANSFER_TERMS_COPY } from "@/popup/utils/transfer-failure-copy"
import { useAppStore } from "@/stores/app.store"
import { useCacheStore } from "@/stores/cache.store"
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
			"modelValue",
			"needsFeeJuice",
		],
		emits: ["update:modelValue", "update:needsFeeJuice"],
	},
}

type W = ReturnType<typeof mount>
const FJ_SETTINGS = { paymentMethod: { kind: "fj" } }

async function mountSend() {
	installChromeStorage()
	const pinia = createTestingPinia({ stubActions: false })
	const appStore = useAppStore(pinia)
	appStore.isLogined = true
	appStore.profile = { id: "p1" } as never
	appStore.network = { id: "n1", chainId: TOKEN.chainId } as never
	appStore.account = { address: ACCOUNT } as never
	const cacheStore = useCacheStore(pinia)
	const w = mount(Send, { attachTo: document.body, global: { plugins: [pinia], stubs: STUBS, mocks: { getChainName: () => "Test" } } })
	await flushPromises()
	return { w, appStore, cacheStore }
}

/** A complete, sendable form: recipient, amount, and the card's settings. */
async function fillForm(w: W, settings: unknown = FJ_SETTINGS) {
	// `null`, not `undefined`, is the "no settings" input: `undefined` would select the default.
	await w.get('[data-testid="stub-recipient"]').setValue(DESTINATION)
	await w.get('[data-testid="stub-amount"]').setValue("1.5")
	w.findComponent({ name: "FeeSettingsCard" }).vm.$emit("update:modelValue", settings)
	await nextTick()
}

const submit = (w: W) => w.get('[data-testid="send-submit"]')
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
	document.body.innerHTML = ""
})

describe("send page — the submit tail", () => {
	test("a click posts the awaiting row, fires the transfer with the snapshotted args, and leaves", async () => {
		const { w, appStore } = await mountSend()
		await fillForm(w)
		expect(submit(w).attributes("disabled")).toBeUndefined()

		await submit(w).trigger("click")

		expect(mocks.executeTransfer).toHaveBeenCalledTimes(1)
		expect(mocks.executeTransfer).toHaveBeenCalledWith(
			"n1",
			ACCOUNT,
			TOKEN.id,
			TransferType.Private,
			DESTINATION,
			1_500_000n,
			FJ_SETTINGS,
			undefined,
		)
		expect(appStore.awaitingTransactions).toHaveLength(1)
		expect(appStore.awaitingTransactions[0]).toMatchObject({ account: ACCOUNT, destination: DESTINATION, contract: TOKEN.contract })
		expect(mocks.routerReplace).toHaveBeenCalledWith("/popup/general")
		expect(submit(w).text()).toBe("CONFIRMING")
		w.unmount()
	})

	test("a second activation while the first is in flight sends nothing more", async () => {
		const { w } = await mountSend()
		await fillForm(w)
		pendingTransfer()
		// Both land before Vue patches `disabled` onto the button: only the handler's own guard can stop the second.
		submit(w).element.click()
		submit(w).element.click()
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
		expect(mocks.openToast).toHaveBeenCalledWith({ label: "Transaction submitted", icon: "check-circle" })
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
		expect(mocks.openToast).toHaveBeenCalledWith({ label: TRANSFER_FAILED_COPY, icon: "warning", color: "red" }, 4000)
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
		expect(mocks.openToast).toHaveBeenCalledWith({ label: TRANSFER_TERMS_COPY, icon: "warning", color: "red" }, 4000)
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
})
