import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"
import type { GrantOutcome, ResolvedToken, SelectableToken, TokenBalances } from "@/lib/send-model"

// A stale mounted wizard still watches the shared journal refs and would adopt the next test's
// record — unmount between cases.
enableAutoUnmount(afterEach)

// `vi.hoisted`: the generation + wallet mocks are evaluated while the component under test imports
// them, which is before ordinary module-level consts exist.
const { FACTORY, IMPLEMENTATION, ERC20, L1_ADDRESS, AZTEC_ACCOUNT, L2_TOKEN, WORD } = vi.hoisted(() => ({
	FACTORY: "0x1111111111111111111111111111111111111111",
	IMPLEMENTATION: "0x2222222222222222222222222222222222222222",
	ERC20: "0x3333333333333333333333333333333333333333",
	L1_ADDRESS: "0x4444444444444444444444444444444444444444",
	AZTEC_ACCOUNT: `0x${"10".repeat(32)}`,
	L2_TOKEN: `0x${"aa".repeat(32)}`,
	WORD: `0x${"bb".repeat(32)}`,
}))
const ROUTE = { path: [{ currency0: ERC20, currency1: ERC20, fee: 500, tickSpacing: 10, hooks: ERC20 }], zeroForOnes: [true] }

const catalogTokens = ref<SelectableToken[]>([])
const search = ref("")
const catalogRefresh = vi.fn(async () => {})
const addPasted = vi.fn((address: string) => candidate(address))
const catalogDispose = vi.fn()

const selected = ref<ResolvedToken | null>(null)
const balances = ref<TokenBalances>({})
const selectionError = ref<string | null>(null)
const selectDispose = vi.fn()
const refreshBalances = vi.fn(async () => {})
let epoch = 0
/** What the next `select` resolves to; a case swaps it to drive first-time / fee-asset shapes. */
let nextResolved: (token: SelectableToken) => ResolvedToken = (token) => resolvedToken(token)
const selectFn = vi.fn(async (token: SelectableToken) => {
	epoch++
	selected.value = nextResolved(token)
})

const granted = ref<string[]>([])
let grantOutcome: GrantOutcome = "granted"
/** Whether the connected Aztec account holds gas; null = unknown. */
const gasHeld = ref<boolean | null>(null)
const ensureGranted = vi.fn(async (): Promise<GrantOutcome> => {
	if (grantOutcome === "granted") granted.value = [...granted.value, L2_TOKEN]
	return grantOutcome
})
const grantDispose = vi.fn()

const routeQuoted = ref<{ token: string; probeAmount: bigint; outcome: unknown } | null>(null)
const routeError = ref<string | null>(null)
const quoteFn = vi.fn(async () => {})
const routeDispose = vi.fn()

/** An answer the wizard will accept: tagged with the token on screen and its 1-unit probe (8 dec). */
const setRoute = (outcome: unknown, token: string = ERC20): void => {
	routeQuoted.value = outcome === null ? null : { token, probeAmount: 10n ** 8n, outcome }
}

const txTarget = ref(20)
const proposeFn = vi.fn(() => ({ fuelAmount: 2_000_000n, fuelFj: 5n * 10n ** 18n, capped: null }))
const gasShareDispose = vi.fn()

const records = ref<Record<string, unknown>[]>([])
/** Records THIS tab's engine created — the wizard's provenance test for adopting a run's record. */
const sessionLive = new Set<string>()
/** Provisional id → the id the record's transaction gave it. */
const rekeys = ref<Record<string, string>>({})
const activeFlowId = ref<string | null>(null)
const claimForeground = vi.fn((id: string) => {
	activeFlowId.value = id
})
const releaseForeground = vi.fn((id: string) => {
	if (activeFlowId.value === id) activeFlowId.value = null
})

const sendError = ref<string | null>(null)
const sendBusy = ref(false)
const sendFn = vi.fn(async (): Promise<string> => "")
const sendDispose = vi.fn()
const exitError = ref<string | null>(null)
const exitFn = vi.fn(async (): Promise<string> => "")
const exitDispose = vi.fn()

const readContract = vi.fn(async () => "0x0000000000000000000000000000000000000000")
const addTokenFn = vi.fn(async () => {})
const addTokenStatus = ref<{ kind: string; error?: { message: string } }>({ kind: "idle" })
const toasts: { kind: string; text: string }[] = []

vi.mock("@/contracts/bridge-generation", () => ({
	HUB: { toString: () => AZTEC_ACCOUNT },
	HUB_TOKEN_ARTIFACT: {},
	SEND_GENERATION: { factory: FACTORY, implementation: IMPLEMENTATION },
	SWAP: { slippageBps: 300, fjPerTx: "100000000000000000", fjRegister: "500000000000000000" },
	MANIFEST_TOKENS: [],
}))
vi.mock("@/composables/useL1Wallet", () => ({
	useL1Wallet: () => ({ address: ref(L1_ADDRESS), chainId: ref(31337), publicClient: { readContract } }),
}))
vi.mock("@/composables/useBridgeWallet", () => ({
	useBridgeWallet: () => ({ wallet: ref(null), selectedAccount: ref(AZTEC_ACCOUNT), status: ref("connected") }),
}))
vi.mock("@/composables/useBridgeJournal", () => ({
	useBridgeJournal: () => ({
		records,
		activeFlowId,
		runtime: ref({}),
		claimForeground,
		releaseForeground,
		isSessionLive: (id: string) => sessionLive.has(id),
		canonicalRecordId: (id: string) => rekeys.value[id] ?? id,
	}),
}))
vi.mock("@/composables/useBridgeBackup", () => ({ useBridgeBackup: () => ({ exportBridgeWithToast: vi.fn() }) }))
vi.mock("@/composables/useAddDripToken", () => ({
	useAddDripToken: () => ({ status: addTokenStatus, addToken: addTokenFn, isRegistered: vi.fn(), reset: vi.fn() }),
}))
vi.mock("@/composables/useToast", () => ({
	useToast: () => ({ push: (t: { kind: string; text: string }) => toasts.push(t) }),
}))
vi.mock("@/composables/useTokenCatalog", () => ({
	useTokenCatalog: () => ({
		tokens: catalogTokens,
		provenance: ref("fresh"),
		loading: ref(false),
		error: ref(null),
		search,
		filtered: catalogTokens,
		addPasted,
		refresh: catalogRefresh,
		dispose: catalogDispose,
	}),
}))
vi.mock("@/contracts/hub-binding", () => ({ readHubBinding: async () => undefined }))
vi.mock("@/composables/useGasHeld", () => ({
	useGasHeld: () => ({ held: gasHeld, refresh: vi.fn(async () => {}), dispose: vi.fn() }),
}))
vi.mock("@/composables/useAddressLookup", () => ({
	useAddressLookup: () => ({ state: ref(null), dispose: vi.fn() }),
}))
vi.mock("@/composables/useRowBalances", () => ({
	useRowBalances: () => ({ balances: ref({}), refresh: vi.fn(async () => {}), dispose: vi.fn() }),
}))
vi.mock("@/composables/useTokenSelection", () => ({
	useTokenSelection: () => ({
		selected,
		balances,
		loading: ref(false),
		error: selectionError,
		epoch: () => epoch,
		select: selectFn,
		refreshBalances,
		dispose: selectDispose,
	}),
}))
vi.mock("@/composables/useTokenGrant", () => ({
	useTokenGrant: () => ({
		isGranted: (l2Token: string) => granted.value.includes(l2Token),
		ensureGranted,
		dispose: grantDispose,
	}),
}))
vi.mock("@/composables/useRouteQuote", () => ({
	useRouteQuote: () => ({ quoted: routeQuoted, loading: ref(false), error: routeError, quote: quoteFn, dispose: routeDispose }),
}))
vi.mock("@/composables/useGasShare", () => ({
	useGasShare: () => ({
		txTarget,
		propose: proposeFn,
		floorFor: (q: bigint) => (q * 97n) / 100n,
		reset: () => {
			txTarget.value = 20
		},
		dispose: gasShareDispose,
	}),
}))
vi.mock("@/composables/useSend", () => ({
	useSend: () => ({ send: sendFn, stage: ref(null), busy: sendBusy, error: sendError, dispose: sendDispose }),
}))
vi.mock("@/composables/useHubExit", () => ({
	EXIT_TOKEN_NOT_REGISTERED: "The bridge hasn't registered this token on Aztec yet, so there is nothing here to withdraw.",
	useHubExit: () => ({ exit: exitFn, busy: ref(false), error: exitError, paused: ref(null), dispose: exitDispose }),
}))

import { predictPortal } from "@nulo/bridge-core"
import { EXIT_TOKEN_NOT_REGISTERED } from "@/composables/useHubExit"
import { TESTIDS } from "@/lib/testids"
import SendWizard from "./SendWizard.vue"

const stub = (name: string, props: string[]) => ({ name, props, template: "<div />" })
const stubs = {
	TokenStep: stub("TokenStep", [
		"direction",
		"tokens",
		"search",
		"loading",
		"catalogError",
		"lookup",
		"addError",
		"selected",
		"resolved",
		"resolving",
		"selectionError",
		"balances",
		"rowBalances",
	]),
	AmountStep: stub("AmountStep", [
		"direction",
		"token",
		"balances",
		"intent",
		"amount",
		"isPrivate",
		"gas",
		"routeKind",
		"routeLoading",
		"txTarget",
		"fjPerTx",
		"gasError",
		"blockedReason",
		"tokenOnlyBlocked",
	]),
	ReviewStep: stub("ReviewStep", [
		"plan",
		"portalVerified",
		"account",
		"signatureValiditySeconds",
		"slippageBps",
		"estimate",
		"grant",
		"busy",
		"error",
	]),
	StepStrip: stub("StepStrip", ["steps", "active", "completed"]),
	BridgeStepper: stub("BridgeStepper", ["record"]),
	BridgeReceipt: stub("BridgeReceipt", ["snapshot", "ctaLabel", "addTokenBusy"]),
}

function candidate(address = ERC20): SelectableToken {
	return {
		chainId: 1,
		address: address as `0x${string}`,
		symbol: "WBTC",
		name: "Wrapped BTC",
		decimals: 8,
		source: "list",
		logoKey: `1:${address}`,
	}
}

const REGISTRATION = {
	portal: FACTORY as `0x${string}`,
	decimals: 8,
	registerIndex: 3n,
	nameWord: WORD as `0x${string}`,
	symbolWord: WORD as `0x${string}`,
	registerKey: WORD as `0x${string}`,
}

/** Only a hub-registered token can be exited, so an exit case must resolve to one. */
const HUB_REGISTERED: ResolvedToken["state"] = { kind: "registered", registration: REGISTRATION, l2Token: L2_TOKEN as `0x${string}` }

function resolvedToken(token: SelectableToken, state: ResolvedToken["state"] = { kind: "first-time" }): ResolvedToken {
	return {
		...token,
		state,
		portal: FACTORY as `0x${string}`,
		words: { nameWord: WORD as `0x${string}`, symbolWord: WORD as `0x${string}` },
		l2Token: L2_TOKEN as `0x${string}`,
	}
}

function sendRecord(id: string, over: Record<string, unknown> = {}) {
	return {
		schema: 3,
		id,
		direction: "deposit",
		intent: "token",
		isPrivate: true,
		amount: "100000000",
		createdAt: 1_000,
		updatedAt: 1_000,
		chainId: 1,
		portal: FACTORY,
		bridge: AZTEC_ACCOUNT,
		recipient: AZTEC_ACCOUNT,
		secretHashHex: id,
		token: { erc20: ERC20, portal: FACTORY, l2Token: L2_TOKEN, nameWord: WORD, symbolWord: WORD, decimals: 8, displaySymbol: "WBTC" },
		...over,
	}
}

async function wizard() {
	const w = mount(SendWizard, { global: { stubs } })
	await flushPromises()
	return w
}

/** Walk the wizard to the review step with a resolved token and a valid amount. The stub stands in
 *  for the real step's own validation, which is what the wizard gates on. */
async function atReview(w: Awaited<ReturnType<typeof wizard>>, amount = "1") {
	w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
	await flushPromises()
	w.findComponent({ name: "TokenStep" }).vm.$emit("next")
	await flushPromises()
	w.findComponent({ name: "AmountStep" }).vm.$emit("update:amount", amount)
	w.findComponent({ name: "AmountStep" }).vm.$emit("update:valid", true)
	await flushPromises()
	w.findComponent({ name: "AmountStep" }).vm.$emit("next")
	await flushPromises()
	return w.findComponent({ name: "ReviewStep" })
}

describe("SendWizard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		catalogTokens.value = [candidate()]
		selected.value = null
		balances.value = { l1: 10n ** 9n, l2Public: 5n * 10n ** 8n, l2Private: 3n * 10n ** 8n }
		selectionError.value = null
		epoch = 0
		gasHeld.value = null
		rekeys.value = {}
		sessionLive.clear()
		nextResolved = (token) => resolvedToken(token)
		granted.value = [L2_TOKEN]
		grantOutcome = "granted"
		setRoute(null)
		routeError.value = null
		records.value = []
		sessionLive.clear()
		activeFlowId.value = null
		sendError.value = null
		sendBusy.value = false
		exitError.value = null
		addTokenStatus.value = { kind: "idle" }
		toasts.length = 0
		readContract.mockResolvedValue("0x0000000000000000000000000000000000000000")
		sendFn.mockResolvedValue("")
		exitFn.mockResolvedValue("")
		proposeFn.mockReturnValue({ fuelAmount: 2_000_000n, fuelFj: 5n * 10n ** 18n, capped: null })
	})

	it("opens on the token step and hands it the catalog", async () => {
		const w = await wizard()
		expect(catalogRefresh).toHaveBeenCalled()
		const token = w.findComponent({ name: "TokenStep" })
		expect(token.exists()).toBe(true)
		expect(token.props("tokens")).toEqual([candidate()])
		expect(w.findComponent({ name: "AmountStep" }).exists()).toBe(false)
	})

	it("selecting a token resolves it for the current direction and unlocks the amount step", async () => {
		const w = await wizard()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		expect(selectFn).toHaveBeenCalledWith(candidate(), "l1-to-l2")
		expect(w.findComponent({ name: "StepStrip" }).props("completed")).toBe(1)
	})

	it("the amount step owns the verdict on its field; the wizard only follows it", async () => {
		const w = await wizard()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		w.findComponent({ name: "TokenStep" }).vm.$emit("next")
		await flushPromises()
		const amount = w.findComponent({ name: "AmountStep" })
		amount.vm.$emit("update:amount", "1")
		await flushPromises()
		// No verdict yet — an amount the wizard cannot judge for itself keeps the review out of reach.
		expect(w.findComponent({ name: "StepStrip" }).props("completed")).toBe(1)
		amount.vm.$emit("update:valid", true)
		await flushPromises()
		expect(w.findComponent({ name: "StepStrip" }).props("completed")).toBe(2)
		amount.vm.$emit("update:valid", false)
		await flushPromises()
		expect(w.findComponent({ name: "StepStrip" }).props("completed")).toBe(1)
	})

	it("a cleared amount stands the review down even while the step's last verdict was yes", async () => {
		const w = await wizard()
		await atReview(w)
		expect(w.findComponent({ name: "StepStrip" }).props("completed")).toBe(2)
		w.findComponent({ name: "ReviewStep" }).vm.$emit("back")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:amount", "")
		await flushPromises()
		expect(w.findComponent({ name: "StepStrip" }).props("completed")).toBe(1)
	})

	it("token+gas has no gas plan to hand down until a route is quoted", async () => {
		const w = await wizard()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		w.findComponent({ name: "TokenStep" }).vm.$emit("next")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:amount", "1")
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:intent", "token+gas")
		await flushPromises()
		expect(w.findComponent({ name: "AmountStep" }).props("gas")).toBeNull()
		setRoute({ kind: "route", route: ROUTE, quoteOut: 10n ** 18n })
		await flushPromises()
		expect(w.findComponent({ name: "AmountStep" }).props("gas")?.route).toEqual(ROUTE)
	})

	it("the fee asset's gas leg is one-for-one with no pools and no slippage floor", async () => {
		const w = await wizard()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		w.findComponent({ name: "TokenStep" }).vm.$emit("next")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:amount", "1")
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:intent", "token+gas")
		setRoute({ kind: "identity" })
		await flushPromises()
		const gas = w.findComponent({ name: "AmountStep" }).props("gas")
		expect(gas.route).toEqual({ path: [], zeroForOnes: [] })
		expect(gas.minFuelOutput).toBe(gas.quote)
		expect(gas.quote).toBe(gas.fuelAmount)
	})

	it("a gas-only send routes the WHOLE amount through the swap", async () => {
		const w = await wizard()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		w.findComponent({ name: "TokenStep" }).vm.$emit("next")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:amount", "1")
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:intent", "gas")
		setRoute({ kind: "route", route: ROUTE, quoteOut: 10n ** 18n })
		await flushPromises()
		expect(w.findComponent({ name: "AmountStep" }).props("gas").fuelAmount).toBe(10n ** 8n)
	})

	it("a token-only send is blocked while the account is known to hold no gas, and released by adding gas", async () => {
		gasHeld.value = false
		const w = await wizard()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		w.findComponent({ name: "TokenStep" }).vm.$emit("next")
		await flushPromises()
		const amountStep = () => w.findComponent({ name: "AmountStep" })
		amountStep().vm.$emit("update:amount", "1")
		amountStep().vm.$emit("update:valid", true)
		await flushPromises()
		expect(amountStep().props("tokenOnlyBlocked")).toContain("holds no gas")
		// The wizard refuses the review on its own, whatever the step reported.
		amountStep().vm.$emit("next")
		await flushPromises()
		expect(w.findComponent({ name: "ReviewStep" }).exists()).toBe(false)

		amountStep().vm.$emit("update:intent", "token+gas")
		await flushPromises()
		expect(amountStep().props("tokenOnlyBlocked")).toBeNull()

		amountStep().vm.$emit("update:intent", "token")
		gasHeld.value = null
		await flushPromises()
		expect(amountStep().props("tokenOnlyBlocked")).toBeNull()
	})

	it("RUN IN BACKGROUND starts the wizard over and keeps a line on the send until it lands", async () => {
		// The send lane resolves only once the whole bridge is done: the record lands first, the
		// background happens while the lane is still open, and the lane resolves last.
		let releaseSend = (): void => {}
		sendFn.mockImplementation(async () => {
			sessionLive.add("rec-1")
			records.value = [...records.value, sendRecord("rec-1")]
			await new Promise<void>((resolve) => {
				releaseSend = resolve
			})
			return "rec-1"
		})
		const w = await wizard()
		const review = await atReview(w)
		review.vm.$emit("confirm")
		await flushPromises()
		expect(w.findComponent({ name: "BridgeStepper" }).exists()).toBe(true)

		w.findComponent({ name: "BridgeStepper" }).vm.$emit("background")
		await flushPromises()
		expect(releaseForeground).toHaveBeenCalledWith("rec-1")
		expect(w.findComponent({ name: "TokenStep" }).exists()).toBe(true)
		const strip = w.find(`[data-testid="${TESTIDS.sendBackgroundStrip}"]`)
		expect(strip.text()).toContain("is on its way")
		expect(strip.find(`[data-testid="${TESTIDS.sendBackgroundActivity}"]`).exists()).toBe(true)

		// The engine keeps writing the record: that must not take the wizard over again.
		records.value = records.value.map((r) => (r.id === "rec-1" ? { ...r, updatedAt: 1_500 } : r))
		await flushPromises()
		expect(w.findComponent({ name: "BridgeStepper" }).exists()).toBe(false)
		expect(claimForeground).toHaveBeenCalledTimes(1)

		// Nor may the lane resolving, nor the record completing: the finished send belongs to the
		// journal now, never to a receipt the wizard left behind.
		releaseSend()
		await flushPromises()
		records.value = records.value.map((r) => (r.id === "rec-1" ? { ...r, completedAt: 2_000 } : r))
		await flushPromises()
		expect(w.findComponent({ name: "BridgeStepper" }).exists()).toBe(false)
		expect(w.findComponent({ name: "BridgeReceipt" }).exists()).toBe(false)
		expect(w.find(`[data-testid="${TESTIDS.sendBackgroundStrip}"]`).exists()).toBe(false)
		expect(claimForeground).toHaveBeenCalledTimes(1)
	})

	it("a backgrounded send follows its record through a rekey, and the renamed record is never re-adopted", async () => {
		let releaseSend = (): void => {}
		sendFn.mockImplementation(async () => {
			sessionLive.add("dep-pending-1")
			records.value = [...records.value, sendRecord("dep-pending-1")]
			await new Promise<void>((resolve) => {
				releaseSend = resolve
			})
			return "0xfinal"
		})
		const w = await wizard()
		const review = await atReview(w)
		review.vm.$emit("confirm")
		await flushPromises()
		w.findComponent({ name: "BridgeStepper" }).vm.$emit("background")
		await flushPromises()
		expect(w.find(`[data-testid="${TESTIDS.sendBackgroundStrip}"]`).exists()).toBe(true)

		// The deposit transaction names the record: the journal rekeys it, session-live moves with it.
		sessionLive.delete("dep-pending-1")
		sessionLive.add("0xfinal")
		rekeys.value = { "dep-pending-1": "0xfinal" }
		records.value = records.value.map((r) => (r.id === "dep-pending-1" ? { ...r, id: "0xfinal" } : r))
		await flushPromises()
		expect(w.findComponent({ name: "BridgeStepper" }).exists()).toBe(false)
		expect(w.find(`[data-testid="${TESTIDS.sendBackgroundStrip}"]`).exists()).toBe(true)

		releaseSend()
		await flushPromises()
		expect(w.findComponent({ name: "BridgeStepper" }).exists()).toBe(false)
		expect(claimForeground).toHaveBeenCalledTimes(1)

		records.value = records.value.map((r) => (r.id === "0xfinal" ? { ...r, completedAt: 2_000 } : r))
		await flushPromises()
		expect(w.find(`[data-testid="${TESTIDS.sendBackgroundStrip}"]`).exists()).toBe(false)
		expect(w.findComponent({ name: "BridgeReceipt" }).exists()).toBe(false)
	})

	it("a no-gas verdict that lands under the frozen review stands it down, and confirm never signs past it", async () => {
		const w = await wizard()
		const review = await atReview(w)
		gasHeld.value = false
		await flushPromises()
		expect(w.findComponent({ name: "ReviewStep" }).exists()).toBe(false)
		expect(w.findComponent({ name: "AmountStep" }).props("tokenOnlyBlocked")).toContain("holds no gas")
		expect(w.find(`[data-testid="${TESTIDS.sendReviewStale}"]`).exists()).toBe(true)
		// A confirm the frozen review still had in flight sends nothing.
		review.vm.$emit("confirm")
		await flushPromises()
		expect(sendFn).not.toHaveBeenCalled()
	})

	it("NEW SEND re-resolves the token — a send that registered it must not be priced as first-time again", async () => {
		sendFn.mockImplementation(async () => {
			records.value = [...records.value, sendRecord("rec-1")]
			return "rec-1"
		})
		const w = await wizard()
		const review = await atReview(w)
		review.vm.$emit("confirm")
		await flushPromises()
		records.value = records.value.map((r) => (r.id === "rec-1" ? { ...r, completedAt: 2_000 } : r))
		await flushPromises()
		expect(w.findComponent({ name: "BridgeReceipt" }).exists()).toBe(true)
		expect(selectFn).toHaveBeenCalledTimes(1)
		w.findComponent({ name: "BridgeReceipt" }).vm.$emit("new-bridge")
		await flushPromises()
		expect(selectFn).toHaveBeenCalledTimes(2)
		expect(selectFn).toHaveBeenLastCalledWith(candidate(), "l1-to-l2")
		expect(w.findComponent({ name: "TokenStep" }).exists()).toBe(true)
	})

	it("a token-only review says the fee is the gas already held; adding gas names one transaction's cost out of it", async () => {
		const w = await wizard()
		let review = await atReview(w)
		expect(review.props("estimate")).toEqual({
			takes: expect.any(String),
			networkFee: "paid from the gas you already hold on Aztec",
			txCovered: null,
		})
		review.vm.$emit("back")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:intent", "token+gas")
		setRoute({ kind: "route", route: ROUTE, quoteOut: 10n ** 18n })
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("next")
		await flushPromises()
		review = w.findComponent({ name: "ReviewStep" })
		// The default token is first-time, so the claim also registers it: one transaction plus the
		// registration budget.
		expect(review.props("estimate").networkFee).toBe("≈ 0.6 FJ — the first of those 20, paid from that gas")
		expect(review.props("estimate").txCovered).toBe(20)
		expect(review.props("slippageBps")).toBe(300)
	})

	it("a registered token's fee is one transaction alone; a gas-only send counts what the quote divides into", async () => {
		nextResolved = (token) => resolvedToken(token, HUB_REGISTERED)
		const w = await wizard()
		let review = await atReview(w)
		review.vm.$emit("back")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:intent", "token+gas")
		setRoute({ kind: "route", route: ROUTE, quoteOut: 10n ** 18n })
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("next")
		await flushPromises()
		review = w.findComponent({ name: "ReviewStep" })
		expect(review.props("estimate").networkFee).toBe("≈ 0.1 FJ — the first of those 20, paid from that gas")

		review.vm.$emit("back")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:intent", "gas")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("next")
		await flushPromises()
		// 1 token (8 decimals) at 1 FJ per token = 1 FJ; 0.1 FJ per transaction.
		expect(w.findComponent({ name: "ReviewStep" }).props("estimate").txCovered).toBe(10)
	})

	it("the zero answer is `absent` — the state that means this send creates the clone", async () => {
		const w = await wizard()
		const review = await atReview(w)
		expect(review.props("portalVerified")).toBe("absent")
		expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "portalOf", args: [ERC20] }))
	})

	it("the derived address is `verified`, whatever case the node answers in", async () => {
		readContract.mockResolvedValue(predictPortal(FACTORY, IMPLEMENTATION, ERC20).toUpperCase())
		const w = await wizard()
		const review = await atReview(w)
		expect(review.props("portalVerified")).toBe("verified")
	})

	it("any OTHER clone is `mismatch`, never mistaken for a first-time send", async () => {
		readContract.mockResolvedValue(IMPLEMENTATION)
		const w = await wizard()
		const review = await atReview(w)
		expect(review.props("portalVerified")).toBe("mismatch")
	})

	it("a read that throws leaves the state `unknown` and reports the Error alone", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		readContract.mockRejectedValue(new Error("node unreachable"))
		const w = await wizard()
		const review = await atReview(w)
		expect(review.props("portalVerified")).toBe("unknown")
		expect(logged).toHaveBeenCalledWith(expect.any(Error))
		logged.mockRestore()
	})

	it("confirming a deposit sends the plan and the stepper adopts the record the run wrote", async () => {
		sendFn.mockImplementation(async () => {
			records.value = [...records.value, sendRecord("rec-1")]
			return "rec-1"
		})
		const w = await wizard()
		const review = await atReview(w)
		review.vm.$emit("confirm")
		await flushPromises()
		expect(sendFn).toHaveBeenCalledWith(
			expect.objectContaining({ direction: "l1-to-l2", intent: "token", amount: 10n ** 8n, isPrivate: true }),
		)
		expect(claimForeground).toHaveBeenCalledWith("rec-1")
		expect(w.findComponent({ name: "BridgeStepper" }).exists()).toBe(true)
	})

	it("a record another tab wrote mid-send is never adopted; the run's own id is", async () => {
		let releaseSend = (): void => {}
		sendFn.mockImplementation(async () => {
			await new Promise<void>((resolve) => {
				releaseSend = resolve
			})
			sessionLive.add("mine")
			records.value = [...records.value, sendRecord("mine")]
			return "mine"
		})
		const w = await wizard()
		const review = await atReview(w)
		review.vm.$emit("confirm")
		await flushPromises()

		// A foreign record lands while this send is still signing: send-shaped, brand new, not ours.
		records.value = [...records.value, sendRecord("foreign")]
		await flushPromises()
		expect(claimForeground).not.toHaveBeenCalled()
		expect(w.findComponent({ name: "BridgeStepper" }).exists()).toBe(false)

		releaseSend()
		await flushPromises()
		expect(claimForeground).toHaveBeenCalledTimes(1)
		expect(claimForeground).toHaveBeenCalledWith("mine")
	})

	it("the stepper adopts the run's own record as soon as the engine writes it", async () => {
		let releaseSend = (): void => {}
		sendFn.mockImplementation(async () => {
			sessionLive.add("mine")
			records.value = [...records.value, sendRecord("mine")]
			await new Promise<void>((resolve) => {
				releaseSend = resolve
			})
			return "mine"
		})
		const w = await wizard()
		const review = await atReview(w)
		review.vm.$emit("confirm")
		await flushPromises()
		expect(claimForeground).toHaveBeenCalledWith("mine")
		expect(w.findComponent({ name: "BridgeStepper" }).exists()).toBe(true)
		releaseSend()
		await flushPromises()
	})

	it("a route answer for another token prices nothing and leaves the review alone", async () => {
		const w = await wizard()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		w.findComponent({ name: "TokenStep" }).vm.$emit("next")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:amount", "1")
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:intent", "token+gas")
		await flushPromises()
		setRoute({ kind: "route", route: ROUTE, quoteOut: 10n ** 18n }, L1_ADDRESS)
		await flushPromises()
		expect(w.findComponent({ name: "AmountStep" }).props("gas")).toBeNull()
		expect(w.findComponent({ name: "AmountStep" }).props("routeKind")).toBeNull()
	})

	it("a change under the review stands it down, says why, and sends nothing", async () => {
		const w = await wizard()
		const review = await atReview(w)
		const reviewed = review.props("plan")

		// A quote lands after the review rendered: the gas leg moves under the frozen plan.
		setRoute({ kind: "route", route: ROUTE, quoteOut: 10n ** 18n })
		w.findComponent({ name: "WizardShell" }).vm.$emit("goto", 1)
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("update:intent", "token+gas")
		await flushPromises()
		w.findComponent({ name: "AmountStep" }).vm.$emit("next")
		await flushPromises()

		const fresh = w.findComponent({ name: "ReviewStep" })
		expect(fresh.props("plan")).not.toBe(reviewed)
		expect(fresh.props("plan").gas).toBeDefined()

		// Now move the plan while the review is up.
		setRoute(null)
		await flushPromises()
		expect(w.findComponent({ name: "ReviewStep" }).exists()).toBe(false)
		expect(w.find('[data-testid="tl-send-review-stale"]').exists()).toBe(true)
		expect(sendFn).not.toHaveBeenCalled()
	})

	it("a deposit whose grant never landed reports declined and leaves the wizard up", async () => {
		granted.value = []
		sendFn.mockResolvedValue("")
		const w = await wizard()
		const review = await atReview(w)
		review.vm.$emit("confirm")
		await flushPromises()
		expect(w.findComponent({ name: "ReviewStep" }).props("grant")).toBe("declined")
		expect(w.findComponent({ name: "BridgeStepper" }).exists()).toBe(false)
	})

	it("an exit asks for the grant at SELECTION and plans a TOKEN-only release to the L1 account", async () => {
		granted.value = []
		nextResolved = (token) => resolvedToken(token, HUB_REGISTERED)
		const w = await wizard()
		w.findComponent({ name: "WizardShell" }).vm.$emit("update:direction", "l2-to-l1")
		await flushPromises()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		expect(ensureGranted).toHaveBeenCalledTimes(1)
		const review = await atReview(w)
		expect(review.props("plan")).toEqual(expect.objectContaining({ direction: "l2-to-l1", recipientL1: L1_ADDRESS, amount: 10n ** 8n }))
		expect(review.props("plan").gas).toBeUndefined()
		review.vm.$emit("confirm")
		await flushPromises()
		expect(exitFn).toHaveBeenCalledTimes(1)
	})

	it("a grant outcome for a superseded selection is discarded", async () => {
		granted.value = []
		grantOutcome = "stale"
		nextResolved = (token) => resolvedToken(token, HUB_REGISTERED)
		const w = await wizard()
		w.findComponent({ name: "WizardShell" }).vm.$emit("update:direction", "l2-to-l1")
		await flushPromises()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		const review = await atReview(w)
		expect(review.props("grant")).toBe("pending")
	})

	it.each([
		["portal-only", { kind: "portal-only", registration: REGISTRATION } as const],
		["first-time", { kind: "first-time" } as const],
	])("an exit on a %s token builds no plan: the hub holds no binding it could burn", async (_label, state) => {
		nextResolved = (token) => resolvedToken(token, state)
		const w = await wizard()
		w.findComponent({ name: "WizardShell" }).vm.$emit("update:direction", "l2-to-l1")
		await flushPromises()
		const review = await atReview(w)
		// No plan means no review to confirm, so no burn authwit can be raised against it — and the
		// amount step is still the one on screen, saying why.
		expect(review.exists()).toBe(false)
		expect(w.findComponent({ name: "WizardShell" }).props("completed")).toBe(1)
		expect(w.findComponent({ name: "AmountStep" }).props("blockedReason")).toBe(EXIT_TOKEN_NOT_REGISTERED)
	})

	it("switching direction returns to the token step and re-resolves the same token", async () => {
		const w = await wizard()
		w.findComponent({ name: "TokenStep" }).vm.$emit("select", candidate())
		await flushPromises()
		w.findComponent({ name: "TokenStep" }).vm.$emit("next")
		await flushPromises()
		w.findComponent({ name: "WizardShell" }).vm.$emit("update:direction", "l2-to-l1")
		await flushPromises()
		expect(w.findComponent({ name: "TokenStep" }).exists()).toBe(true)
		expect(selectFn).toHaveBeenLastCalledWith(expect.objectContaining({ address: ERC20 }), "l2-to-l1")
	})

	it("a completed record becomes a receipt carrying the record's own token and the review's promise", async () => {
		sendFn.mockImplementation(async () => {
			records.value = [...records.value, sendRecord("rec-2")]
			return "rec-2"
		})
		const w = await wizard()
		const review = await atReview(w)
		review.vm.$emit("confirm")
		await flushPromises()
		records.value = [{ ...records.value[0], completedAt: 9_000 }]
		await flushPromises()
		const snapshot = w.findComponent({ name: "BridgeReceipt" }).props("snapshot")
		expect(snapshot.token).toEqual({
			erc20: ERC20,
			portal: FACTORY,
			l2Token: L2_TOKEN,
			nameWord: WORD,
			symbolWord: WORD,
			decimals: 8,
			displaySymbol: "WBTC",
		})
		expect(snapshot.reviewSaid).toBe("1 WBTC")
		expect(snapshot.addTokenLabel).toBe("ADD WBTC TO WALLET")
		expect(releaseForeground).toHaveBeenCalledWith("rec-2")
	})

	it("an address the catalog refuses surfaces on the token step and selects nothing", async () => {
		addPasted.mockImplementation(() => {
			throw new Error("The zero address is not a token.")
		})
		const w = await wizard()
		w.findComponent({ name: "TokenStep" }).vm.$emit("add", "0x0")
		await flushPromises()
		expect(w.findComponent({ name: "TokenStep" }).props("addError")).toBe("The zero address is not a token.")
		expect(selectFn).not.toHaveBeenCalled()
	})

	it("disposes every composable on unmount", async () => {
		const w = await wizard()
		w.unmount()
		for (const dispose of [exitDispose, sendDispose, gasShareDispose, routeDispose, grantDispose, selectDispose, catalogDispose]) {
			expect(dispose).toHaveBeenCalledTimes(1)
		}
	})
})
