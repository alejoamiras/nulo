/**
 * The execute window's scope banner and the follow that runs after Confirm. Sibling of
 * `index.test.ts` (the shell-lifecycle oracle) with the same mock shape; init resolves eagerly so
 * each case starts from a rendered window and controls only the timing it is about.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushPromises, mount } from "@vue/test-utils"
import { reactive, ref, type Ref } from "vue"

const TESTNET = { id: "n-testnet", chainId: 1, name: "Testnet" }
const LOCAL = { id: "n-local", chainId: 1, name: "Local Network" }
const MAIN = { address: "0xmain", chainId: 1, name: "Main", visible: true }
const SAVINGS = { address: "0xsavings", chainId: 1, name: "Savings", visible: true }
const ACCOUNTS: Record<string, unknown> = { [MAIN.address]: MAIN, [SAVINGS.address]: SAVINGS }

let requestIdMock = ref<string | undefined>(undefined)
let dappMock = ref<{ name: string; url: string } | null>(null)
let payloadMock: Ref<unknown> = ref(null)
let isCancelledMock = ref(false)
let payloadToLoad: unknown = null

/** Which row the transient network client resolves for chain 1. */
let opsNetwork: { id: string; chainId: number; name: string } = TESTNET

const appStoreDefaults = () =>
	reactive({
		isSessionChecked: true,
		isLogined: true,
		account: SAVINGS as typeof SAVINGS | undefined,
		network: TESTNET as typeof TESTNET | undefined,
		pageAwaitingAuth: "",
		hasInFlightSend: false,
		refreshInFlight: vi.fn(async () => undefined),
	})
let appStoreMock = appStoreDefaults()

const approveInteractionMock = vi.fn(async () => undefined)
const rejectViaInteractionServiceMock = vi.fn()
const onActiveProfileChangedAddMock = vi.fn()
const windowsRemoveMock = vi.fn()
const setActiveNetworkMock = vi.fn(async () => undefined)
const getActiveNetworkMock = vi.fn(async () => appStoreMock.network)
const storageSetMock = vi.fn(async (_items: Record<string, unknown>) => undefined)
/** A fake Web Lock: runs the callback at once (jsdom has none). */
const locksRequestMock = vi.fn((_name: string, callback: () => Promise<unknown>) => callback())

vi.mock("@/composables/useDappInteractionPayload", () => ({
	useDappInteractionPayload: vi.fn(() => ({
		requestId: requestIdMock,
		payload: payloadMock,
		dapp: dappMock,
		isCancelled: isCancelledMock,
		load: vi.fn(async () => {
			requestIdMock.value = "req-1"
			dappMock.value = { name: "Test DApp", url: "https://example.com" }
			payloadMock.value = payloadToLoad
		}),
		reject: rejectViaInteractionServiceMock,
	})),
}))
vi.mock("@/composables/useDappHostname", () => ({
	useDappHostname: vi.fn(() => ({ hostname: ref("example.com"), isSuspicious: ref(false) })),
}))
vi.mock("@/composables/useFeeEstimationMap", () => ({
	useFeeEstimationMap: vi.fn(() => ({
		results: ref({}),
		estimating: ref({}),
		estimate: vi.fn(),
		cancel: vi.fn(),
		cancelAll: vi.fn(),
		handoffAll: vi.fn(() => ({})),
		rearm: vi.fn(),
		dispose: vi.fn(),
	})),
}))
vi.mock("@/composables/toast", () => ({
	useToast: () => ({ openToast: vi.fn() }),
	TOAST_DURATION: { SHORT: 2000, LONG: 5000 },
}))
vi.mock("@/utils/core", () => ({
	requireNetwork: () => ({ setActiveNetwork: setActiveNetworkMock, getActiveNetwork: getActiveNetworkMock }),
}))
vi.mock("@/wallet/services/profile/client", () => ({
	ProfileServiceClient: vi.fn(function () {
		return {
			getActiveProfile: vi.fn(async () => ({ id: "p1" })),
			connect: vi.fn(),
			disconnect: vi.fn(),
			onActiveProfileChanged: { add: onActiveProfileChangedAddMock },
		}
	}),
}))
vi.mock("@/wallet/services/dapp-interaction/client", () => ({
	DappInteractionServiceClient: vi.fn(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), approveInteraction: approveInteractionMock }
	}),
}))
vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			estimateOperationFee: vi.fn(async () => undefined),
			previewOperationAuthwits: vi.fn(async () => undefined),
			decodeCallsForDisplay: vi.fn(async () => []),
			cancelEstimate: vi.fn(async () => undefined),
		}
	}),
}))
vi.mock("@/wallet/services/token/client", () => ({
	TokenServiceClient: vi.fn(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			previewTokenMetadata: vi.fn(async () => undefined),
			getTokens: vi.fn(async () => []),
		}
	}),
}))
vi.mock("@/wallet/services/account/client", () => ({
	AccountServiceClient: vi.fn(function () {
		return {
			getAccount: vi.fn(async (_p: string, _c: number, address: string) => ACCOUNTS[address]),
			connect: vi.fn(),
			disconnect: vi.fn(),
		}
	}),
}))
vi.mock("@/wallet/services/network/client", () => ({
	NetworkServiceClient: vi.fn(function () {
		return { getNetworks: vi.fn(async () => [opsNetwork]), connect: vi.fn(), disconnect: vi.fn() }
	}),
}))
vi.mock("@/wallet/services/transaction/client", () => ({
	OriginType: { UI: "ui", DAPP: "dapp" },
}))
vi.mock("@/stores/app.store", () => ({ useAppStore: () => appStoreMock }))
vi.mock("vue-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("vue-router")>()
	return {
		...actual,
		useRouter: () => ({
			currentRoute: { value: { fullPath: "/windows/execute?requestId=req-1", query: { requestId: "req-1" } } },
			push: vi.fn(),
		}),
	}
})

const STUBS = {
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: { template: "<i />" },
	Tooltip: { template: "<div><slot /></div>" },
	Button: {
		props: ["disabled", "loading"],
		emits: ["click"],
		template: `<button :data-testid="$attrs['data-testid']" :disabled="disabled || loading" @click="$emit('click', $event)"><slot /></button>`,
	},
	Banner: {
		props: ["variant", "direction", "wide", "action"],
		template: `
			<div :data-testid="$attrs['data-testid']" :data-state="$attrs['data-state']" :data-variant="variant">
				<span data-testid="banner-title"><slot name="title" /></span>
				<span data-testid="banner-desc"><slot name="description" /></span>
				<button v-if="action" :data-testid="action.testId" @click="action.callback()">{{ action.name }}</button>
			</div>`,
	},
	SectionLabel: { template: "<div />" },
	OperationCard: { template: "<div />" },
	SignerIdentityStrip: { template: "<div />", props: ["signerAccounts", "signerNetworks", "status"] },
	DappIdentityBlock: { template: "<div />", props: ["dapp", "hostname", "hostnameSuspicious", "actionLabel"] },
	DappCancelledOverlay: { template: "<div />", props: ["message"] },
}

import Execute from "./index.vue"

let w: ReturnType<typeof mount> | undefined

/** A send whose fee the dApp pays, so Confirm needs no fee pick. */
const sendFrom = (address: string) => ({
	kind: "send_transaction",
	account: `aztec:1:${address}`,
	calls: [],
	fee: { embeddedFeePayment: {} },
})
const readFrom = (address: string) => ({ kind: "simulate_utility", account: `aztec:1:${address}`, calls: [] })

const payloadWith = (operations: unknown[]) => ({
	session: { profileId: "p1", dappMetadata: { name: "Test DApp", url: "https://example.com" } },
	params: { operations },
})

const open = async (operations: unknown[]) => {
	payloadToLoad = payloadWith(operations)
	// biome-ignore lint/suspicious/noExplicitAny: chrome runtime stub for tests
	;(globalThis as any).chrome = {
		windows: { getCurrent: (_o: unknown, cb: (x: { id?: number }) => void) => cb({ id: 1 }), remove: windowsRemoveMock },
		runtime: { getURL: (p: string) => `chrome-extension://test/${p}` },
		storage: {
			local: { get: vi.fn(async () => ({})), set: storageSetMock },
			onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
		},
	}
	Object.defineProperty(navigator, "locks", { value: { request: locksRequestMock }, configurable: true })
	w = mount(Execute, { global: { stubs: STUBS } })
	await flushPromises()
	return w
}
const banner = () => w!.find('[data-testid="execute-scope-banner"]')
const bannerText = () => ({ title: w!.find('[data-testid="banner-title"]').text(), body: w!.find('[data-testid="banner-desc"]').text() })
const action = () => w!.find('[data-testid="execute-scope-action-btn"]')
type ExecVm = { approve: () => Promise<void>; reject: () => Promise<void>; processingError?: { title: string } }
const vm = () => w!.vm as unknown as ExecVm
const accountWrites = () => storageSetMock.mock.calls.map(([items]) => items["nulo:ui:activeAccount"])

beforeEach(() => {
	opsNetwork = TESTNET
})

afterEach(() => {
	w?.unmount()
	w = undefined
	Reflect.deleteProperty(navigator, "locks")
	requestIdMock = ref(undefined)
	dappMock = ref(null)
	payloadMock = ref(null)
	isCancelledMock = ref(false)
	payloadToLoad = null
	appStoreMock = appStoreDefaults()
	vi.clearAllMocks()
})

describe("execute window — the scope banner", () => {
	test("no banner when the payload runs where the wallet is", async () => {
		await open([sendFrom(SAVINGS.address)])
		expect(banner().exists()).toBe(false)
	})

	test("account state: names the signer, offers to stay, and declining flips the copy both ways", async () => {
		await open([sendFrom(MAIN.address)])
		expect(banner().attributes("data-state")).toBe("account")
		expect(banner().attributes("data-variant")).toBe("info")
		expect(bannerText()).toEqual({
			title: "Signed by Main",
			body: "Your wallet is on Savings. It switches to Main after you confirm, so you can watch the transaction.",
		})
		expect(action().text()).toBe("Stay on Savings")

		await action().trigger("click")
		expect(banner().attributes("data-state")).toBe("account-declined")
		expect(bannerText().body).toBe(
			"Your wallet stays on Savings. This still executes — you just won't see it in your balances or activity.",
		)
		expect(action().text()).toBe("Switch after confirming")

		await action().trigger("click")
		expect(banner().attributes("data-state")).toBe("account")
		expect(action().text()).toBe("Stay on Savings")
	})

	test("chain state: names both rows and the follow account, and declining keeps the info tone", async () => {
		opsNetwork = LOCAL
		await open([sendFrom(MAIN.address)])
		expect(banner().attributes("data-state")).toBe("chain")
		expect(bannerText()).toEqual({
			title: "Runs on Local Network",
			body: "Your wallet is on Savings · Testnet. It switches to Main · Local Network after you confirm, so you can watch the transaction.",
		})
		expect(action().text()).toBe("Stay on Testnet")

		await action().trigger("click")
		expect(banner().attributes("data-state")).toBe("chain-declined")
		expect(banner().attributes("data-variant")).toBe("info")
		expect(bannerText().title).toBe("Runs on Local Network")
	})

	test("multi-signer: every signer named, no action to toggle", async () => {
		await open([sendFrom(MAIN.address), sendFrom(SAVINGS.address)])
		expect(banner().attributes("data-state")).toBe("multi-signer")
		expect(bannerText()).toEqual({
			title: "Signed by 2 accounts",
			body: "Main, Savings. Each operation is signed by its own account; your wallet stays where it is.",
		})
		expect(action().exists()).toBe(false)
	})

	test("a padded read does not hide the account state", async () => {
		await open([sendFrom(MAIN.address), readFrom(SAVINGS.address)])
		expect(banner().attributes("data-state")).toBe("account")
	})

	test("no banner while the active scope is unresolved; it appears once both rows are known", async () => {
		appStoreMock.account = undefined
		await open([sendFrom(MAIN.address)])
		expect(banner().exists()).toBe(false)
		appStoreMock.account = SAVINGS
		await flushPromises()
		expect(banner().attributes("data-state")).toBe("account")
	})
})

describe("execute window — the follow after Confirm", () => {
	test("a confirmed chain mismatch moves the network row, then the account pointer, inside the lock, and closes the window", async () => {
		opsNetwork = LOCAL
		await open([sendFrom(MAIN.address)])
		await vm().approve()
		expect(approveInteractionMock).toHaveBeenCalledTimes(1)
		expect(locksRequestMock).toHaveBeenCalledWith("nulo:scope-follow", expect.any(Function))
		// The guard is read right after, so the follow's re-read must invalidate the cache.
		expect(appStoreMock.refreshInFlight).toHaveBeenCalledWith({ invalidate: true })
		expect(setActiveNetworkMock).toHaveBeenCalledWith(LOCAL.id)
		expect(accountWrites()).toEqual([MAIN.address])
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
		// The durable pointers moved; this realm's store did not.
		expect(appStoreMock.network).toEqual(TESTNET)
		expect(appStoreMock.account).toEqual(SAVINGS)
	})

	test("a confirmed account mismatch writes the pointer only", async () => {
		await open([sendFrom(MAIN.address)])
		await vm().approve()
		expect(setActiveNetworkMock).not.toHaveBeenCalled()
		expect(accountWrites()).toEqual([MAIN.address])
	})

	test("the banner action is inert once Confirm is in flight: the copy cannot promise a decline the follow will not honour", async () => {
		let settleApproval!: () => void
		approveInteractionMock.mockImplementationOnce(
			() => new Promise<undefined>((resolve) => (settleApproval = () => resolve(undefined))),
		)
		await open([sendFrom(MAIN.address)])
		const approving = vm().approve()
		await flushPromises()
		await action().trigger("click")
		expect(banner().attributes("data-state")).toBe("account")
		settleApproval()
		await approving
		expect(accountWrites()).toEqual([MAIN.address])
	})

	test("declined, rejected, or a failed approval: nothing moves", async () => {
		await open([sendFrom(MAIN.address)])
		await action().trigger("click")
		await vm().approve()
		expect(approveInteractionMock).toHaveBeenCalledTimes(1)
		expect(accountWrites()).toEqual([])
		w!.unmount()

		await open([sendFrom(MAIN.address)])
		await vm().reject()
		expect(accountWrites()).toEqual([])
		w!.unmount()

		approveInteractionMock.mockRejectedValueOnce(new Error("execution refused"))
		await open([sendFrom(MAIN.address)])
		await vm().approve()
		expect(vm().processingError?.title).toBe("Processing error.")
		expect(accountWrites()).toEqual([])
	})

	test("a follow that throws still reports a successful approval and still closes the window", async () => {
		opsNetwork = LOCAL
		setActiveNetworkMock.mockRejectedValueOnce(new Error("persist failed"))
		await open([sendFrom(MAIN.address)])
		await vm().approve()
		expect(vm().processingError).toBeUndefined()
		expect(windowsRemoveMock).toHaveBeenCalledTimes(1)
		expect(accountWrites()).toEqual([]) // the account never moves without the network
	})

	test("a lock that lands while the approval is in flight aborts the whole follow", async () => {
		let settleApproval!: () => void
		approveInteractionMock.mockImplementationOnce(
			() => new Promise<undefined>((resolve) => (settleApproval = () => resolve(undefined))),
		)
		await open([sendFrom(MAIN.address)])
		const approving = vm().approve()
		await flushPromises()
		appStoreMock.isLogined = false
		settleApproval()
		await approving
		expect(accountWrites()).toEqual([])
	})

	test("a profile change that lands while the approval is in flight aborts the whole follow", async () => {
		let settleApproval!: () => void
		approveInteractionMock.mockImplementationOnce(
			() => new Promise<undefined>((resolve) => (settleApproval = () => resolve(undefined))),
		)
		await open([sendFrom(MAIN.address)])
		const onProfileChanged = onActiveProfileChangedAddMock.mock.calls[0][0] as (p?: { id: string }) => void
		const approving = vm().approve()
		await flushPromises()
		onProfileChanged(undefined)
		settleApproval()
		await approving
		expect(accountWrites()).toEqual([])
	})
})
