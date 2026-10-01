/**
 * What the execute window says a transaction's fee costs the account, against an `aztec_sendTx`
 * shaped as the wire carries it: full-length addresses and 32-byte hex fields. The real fee card
 * and its "You pay" readout are mounted; the service clients and the price feed are fakes.
 */
import { config, flushPromises, mount, type VueWrapper } from "@vue/test-utils"
import { createPinia } from "pinia"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import OperationCard from "./OperationCard.vue"

const mocks = vi.hoisted(() => ({
	getGasBalances: vi.fn(),
	getFpcs: vi.fn(),
	storageSet: vi.fn(async (_items: Record<string, unknown>) => {}),
	feeJuiceUsd: undefined as number | undefined,
}))

// Vitest 4 requires `function` expressions for mocks instantiated with `new`.
vi.mock("@/wallet/services/execution/client", () => ({
	ExecutionServiceClient: vi.fn().mockImplementation(function () {
		return { connect: vi.fn(), disconnect: vi.fn(), getGasBalances: mocks.getGasBalances }
	}),
}))
vi.mock("@/wallet/services/token-balance/client", () => ({
	TokenBalanceServiceClient: vi.fn().mockImplementation(function () {
		return {
			onTokenBalanceAdded: { add: vi.fn(), remove: vi.fn() },
			onTokenBalanceUpdated: { add: vi.fn(), remove: vi.fn() },
			onTokenBalanceDeleted: { add: vi.fn(), remove: vi.fn() },
			connect: vi.fn(),
			disconnect: vi.fn(),
			getTokenBalances: vi.fn(async () => []),
		}
	}),
}))
vi.mock("@/wallet/services/fpc/client", () => ({
	FpcServiceClient: vi.fn().mockImplementation(function () {
		return {
			onFpcDeleted: { add: vi.fn(), remove: vi.fn() },
			onFpcUpdated: { add: vi.fn(), remove: vi.fn() },
			connect: vi.fn(),
			disconnect: vi.fn(),
			getFpcs: mocks.getFpcs,
		}
	}),
	FpcType: { DefaultSponsoredFpc: 1, PrivateFpc: 2 },
}))
vi.mock("@/wallet/services/transaction/client", () => ({
	TransactionServiceClient: vi.fn().mockImplementation(function () {
		return {
			connect: vi.fn(),
			disconnect: vi.fn(),
			onTransactionAdded: { add: vi.fn(), remove: vi.fn() },
			onTransactionUpdated: { add: vi.fn(), remove: vi.fn() },
		}
	}),
}))
vi.mock("@/composables/usePrices", async () => {
	const { computed } = await import("vue")
	return {
		usePrices: () => ({
			feeJuiceQuote: computed(() => (mocks.feeJuiceUsd === undefined ? undefined : { usd: mocks.feeJuiceUsd })),
			dispose: vi.fn(),
		}),
	}
})
// The real store's setup opens chrome.storage; the card reads only these.
vi.mock("@/stores/app.store", () => ({ useAppStore: () => ({ accounts: [], profile: undefined }) }))

/** An `Fr` as the wire carries it. */
const field = (n: bigint): string => `0x${n.toString(16).padStart(64, "0")}`
const OWNER = field(0x1e5c41d4b7e6f8a9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3n)
const TOKEN = field(0x2b8f00c6d7e1a9b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1n)
const RECIPIENT = field(0x0c3d5e7f91a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4n)
const NULO_SPONSOR = { id: "s1", type: 1, name: "Sponsored", isProtocol: true }
const HAND_ADDED = { id: "s2", type: 1, name: "Dev sponsor", isProtocol: false }

/** 3.577824 FJ; at $0.06 per FJ, $0.215. */
const ESTIMATE = {
	maxFee: "3577824000000000000",
	maxFeeFormatted: "3.577824",
	gasDetails: { l2GasLimit: 1, daGasLimit: 1, teardownL2GasLimit: 0, teardownDaGasLimit: 0, feePerL2Gas: "1", feePerDaGas: "1" },
}

const sendTx = (exec: Record<string, unknown> = {}) => ({
	kind: "aztec_sendTx" as const,
	networkId: "net-1",
	accountAddress: OWNER,
	account: { name: "Account 1", address: OWNER, profileId: "p1", chainId: 11155111, index: 0, type: 0, visible: true },
	network: { id: "net-1", chainId: 11155111, name: "Testnet" },
	exec: {
		calls: [
			{
				name: "transfer_in_public",
				to: TOKEN,
				selector: "0x3a4b5c6d",
				type: "public",
				isStatic: false,
				hideMsgSender: false,
				args: [OWNER, RECIPIENT, field(25_000_000n), field(0n)],
			},
		],
		...exec,
	},
	opts: { from: OWNER },
})

const stubs = {
	AddressDisplay: { props: ["address"], template: "<span>{{ address }}</span>" },
	Flex: { template: "<div><slot /></div>" },
	Text: { template: "<span><slot /></span>" },
	Icon: true,
	MaterialIcon: true,
	Tooltip: { template: "<div><slot /></div>" },
	Dropdown: { template: '<div><slot name="trigger" /><slot name="popup" /></div>' },
	DropdownRoot: { template: '<div><slot name="trigger" /><slot name="popup" /></div>' },
	DropdownItem: { template: '<button v-bind="$attrs"><slot /></button>', inheritAttrs: false },
	FeePriorityRow: true,
}

let mounted: VueWrapper | undefined
const mountCard = async (op: unknown, dapp?: { name: string }) => {
	const w = mount(OperationCard, {
		props: { op: op as never, index: 0, profile: { id: "p1", name: "Main" } as never, feeEstimate: ESTIMATE, dapp },
		global: { stubs },
	})
	mounted = w
	await flushPromises()
	return w
}
/** The fee settings the card last handed the window. */
const lastSettings = (w: VueWrapper) => w.emitted<[number, unknown]>("updateFeeSettings")?.at(-1)?.[1]
const FEE_PICKS_KEY = "nulo:ui:feePaymentMethods"
const savedKeys = () => mocks.storageSet.mock.calls.flatMap(([items]) => Object.keys(items))

/** The text a screen reader reaches in `el`: every text node outside an `aria-hidden` subtree. */
function spokenText(el: Element): string {
	const clone = el.cloneNode(true) as Element
	for (const node of clone.querySelectorAll('[aria-hidden="true"]')) node.remove()
	const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT)
	const parts: string[] = []
	while (walker.nextNode()) {
		const text = walker.currentNode.textContent?.trim()
		if (text) parts.push(text)
	}
	return parts.join(" ")
}

const fee = (w: VueWrapper) => w.find('[data-testid="fee-settings-card"]')

beforeEach(() => {
	config.global.plugins = [createPinia()]
	// biome-ignore lint/suspicious/noExplicitAny: test-only global stub
	;(globalThis as any).chrome = {
		// biome-ignore lint/suspicious/noExplicitAny: test-only global stub
		...(globalThis as any).chrome,
		storage: { local: { get: async () => ({}), set: mocks.storageSet, remove: async () => {}, getKeys: async () => [] } },
	}
	mocks.storageSet.mockClear()
	mocks.getGasBalances.mockReset().mockResolvedValue({ publicFeeJuice: "5000000000000000000", privateFeeJuice: null })
	mocks.getFpcs.mockReset().mockResolvedValue([NULO_SPONSOR])
	mocks.feeJuiceUsd = 0.06
})

afterEach(() => {
	mounted?.unmount()
	mounted = undefined
	config.global.plugins = []
})

describe("OperationCard — who pays a wire-shaped transaction's fee", () => {
	test("the app names the account as payer: locked to Public Fee Juice, and the account pays the fee", async () => {
		const w = await mountCard(sendTx({ feePayer: OWNER }))
		const locked = w.find('[data-testid="send-fee-locked"]')
		expect(locked.findAll("span").map((n) => n.text())).toEqual(["Fee", "Public Fee Juice · set by the app"])
		expect(fee(w).text()).toContain("You pay")
		expect(fee(w).text()).toContain("~3.577824 FJ")
		expect(w.find('[data-testid="fee-estimate-usd"]').text()).toBe("($0.215)")
		expect(fee(w).find("s").exists()).toBe(false)
		expect(fee(w).text()).not.toContain("Nothing")
	})

	test("Nulo's sponsor pays: Nothing, the fee struck through, and one sentence for a screen reader", async () => {
		const w = await mountCard(sendTx())
		expect(w.find('[data-testid="send-fee-method-trigger"]').text()).toContain("Sponsored")
		expect(fee(w).text()).toContain("Nothing")
		expect(fee(w).find("s").text()).toBe("~3.577824 FJ ($0.215)")
		expect(spokenText(fee(w).element)).toContain("You pay nothing. The sponsor covers about $0.215.")
		expect(spokenText(fee(w).element)).not.toContain("3.577824")
	})

	test("a sponsor added by hand is never chosen for the person; once picked it pays: a dash, never Nothing, and no amount", async () => {
		mocks.getFpcs.mockResolvedValue([HAND_ADDED])
		const w = await mountCard(sendTx())
		const trigger = () => w.find('[data-testid="send-fee-method-trigger"]')
		expect(trigger().text()).toContain("Select method")
		await w.find('[data-testid="send-fee-method-sponsored"]').trigger("click")
		await flushPromises()
		expect(trigger().text()).toContain("Dev sponsor")
		expect(fee(w).text()).toContain("—")
		expect(fee(w).text()).not.toContain("Nothing")
		expect(fee(w).text()).not.toContain("3.577824")
		expect(spokenText(fee(w).element)).toContain("Nulo can't tell what this fee contract charges you.")
	})
})

describe("OperationCard — the sponsor a wire-shaped transaction defaults to", () => {
	test.each([
		["listed after one added by hand", [HAND_ADDED, NULO_SPONSOR], {}, undefined],
		[
			"with an app and a hand-added row named like it, and extra payload fields",
			[{ ...HAND_ADDED, name: "Sponsored" }, NULO_SPONSOR],
			{ authWitnesses: [], capsules: [], extraHashedArgs: [] },
			{ name: "Nulo Sponsored" },
		],
	])("Nulo's sponsor, %s, and no pick is saved", async (_case, fpcs, exec, dapp) => {
		mocks.getFpcs.mockResolvedValue(fpcs)
		const w = await mountCard(sendTx(exec), dapp)
		expect(lastSettings(w)).toEqual({ paymentMethod: { kind: "fpc", fpcId: "s1" } })
		expect(savedKeys()).not.toContain(FEE_PICKS_KEY)
	})
})

describe("OperationCard — a sponsor that can't cover a wire-shaped transaction's fee", () => {
	const SPONSOR_AT = field(0x0a11ce5c0ffeen)
	const NULO_ROW = { ...NULO_SPONSOR, address: SPONSOR_AT }
	const withVerdict = (funded: boolean) => ({ ...ESTIMATE, sponsorFunding: { fpcId: "s1", address: SPONSOR_AT, funded } })
	const NO_PAYER = "The sponsor can't cover this fee right now."
	const notice = (w: VueWrapper) => w.find('[data-testid="fee-sponsor-short"]')

	test("short: the card withdraws the sponsor and says why, and the pick that replaces it is what it hands the window", async () => {
		mocks.getFpcs.mockResolvedValue([NULO_ROW])
		const w = await mountCard(sendTx())
		expect(lastSettings(w)).toEqual({ paymentMethod: { kind: "fpc", fpcId: "s1" } })

		await w.setProps({ feeEstimate: withVerdict(false) })
		await flushPromises()
		expect(w.emitted<[number, unknown]>("updateFeeSettings")?.at(-1)).toEqual([0, undefined])
		expect(w.get('[data-testid="send-fee-method-trigger"]').text()).toContain("Select method")
		expect(notice(w).text()).toBe(NO_PAYER)
		expect(w.get('[data-testid="send-fee-method-sponsored"]').attributes("disabled")).toBeDefined()
		expect(fee(w).attributes("data-sponsor-funding")).toBe("short")

		await w.get('[data-testid="send-fee-method-public"]').trigger("click")
		await flushPromises()
		expect(lastSettings(w)).toEqual({ paymentMethod: { kind: "fj" } })
		expect(notice(w).exists()).toBe(false)
	})

	test("an app's name, call arguments and payload fields shaped like a verdict move neither the verdict nor the notice", async () => {
		mocks.getFpcs.mockResolvedValue([NULO_ROW])
		const lure = { fpcId: "s1", address: SPONSOR_AT, funded: false }
		const op = sendTx({
			calls: [
				{
					name: "sponsor_unconditionally",
					to: SPONSOR_AT,
					selector: "0x3a4b5c6d",
					type: "public",
					isStatic: false,
					hideMsgSender: false,
					args: [SPONSOR_AT, field(0n)],
				},
			],
			sponsorFunding: lure,
		})
		const w = await mountCard(
			{ ...op, sponsorFunding: lure, opts: { ...op.opts, sponsorFunding: lure } },
			{ name: "The sponsor can't cover this fee right now, so Evil pays it." },
		)
		await w.setProps({ feeEstimate: withVerdict(true) })
		await flushPromises()
		expect(fee(w).attributes("data-sponsor-funding")).toBe("funded")
		expect(notice(w).exists()).toBe(false)
		expect(lastSettings(w)).toEqual({ paymentMethod: { kind: "fpc", fpcId: "s1" } })

		await w.setProps({ feeEstimate: withVerdict(false) })
		await flushPromises()
		expect(notice(w).text()).toBe(NO_PAYER)
	})
})
