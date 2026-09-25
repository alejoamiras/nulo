import { mount } from "@vue/test-utils"
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from "vitest"
import { defineComponent, effectScope, h, nextTick, type Ref, ref } from "vue"
import { EventHandler } from "@nulo/wallet-core/utils"
import { formatSnackAmount } from "@/utils/snack-amount"
import type { ConfigProp } from "@/wallet/config"
import { type ArrivalState, isArrivalEligible } from "@/wallet/services/incoming-transfer/arrival-state"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import { ARRIVAL_WINDOW_MS, type ArrivalToken, useArrivals } from "./useArrivals"
import type { IncomingScope } from "./useIncomingTransfers"

const HOME = "popup-general"
const HISTORY = "popup-activity"
const SETTINGS = "popup-settings"
const TOKEN_PAGE = "popup-tokens-id"
const SCOPE: IncomingScope = { profileId: "p", networkId: "n", account: "0xa" }
const OTHER: IncomingScope = { profileId: "p", networkId: "n", account: "0xb" }
const AMOUNT = formatSnackAmount(1_500_000n, 6)

let seq = 0
function receipt(block: number, over: Partial<IncomingTransferRecord> = {}): IncomingTransferRecord {
	seq++
	return {
		kind: "note",
		id: `note:p|n|${seq}`,
		profileId: "p",
		networkId: "n",
		accountAddress: "0xa",
		contract: "0xc",
		tokenId: 1,
		amountRaw: "1500000",
		txHash: `0x${seq}`,
		l2BlockNumber: block,
		txIndexInBlock: 0,
		indexInTx: 0,
		hidden: false,
		discoveredAt: Date.now(),
		siloedNullifier: `${seq}`,
		noteHash: "0x1",
		owner: "0xa",
		...over,
	} as IncomingTransferRecord
}

/** The service as the coordinator sees it: reads filter by visibility and dust, claims are atomic. */
function fakeService() {
	const store = {
		records: [] as IncomingTransferRecord[],
		visible: true,
		dust: new Set<string>(),
		sinceBlock: 10 as number | null,
		floors: {} as ArrivalState["floors"],
		played: [] as string[],
	}
	const snapshot = (): ArrivalState => ({ sinceBlock: store.sinceBlock, floors: { ...store.floors }, played: [...store.played] })
	const svc = {
		onIncomingTransferAdded: new EventHandler<IncomingTransferRecord>(),
		onIncomingTransferDeleted: new EventHandler<IncomingTransferRecord>(),
		onConnected: new EventHandler<void>(),
		getIncomingTransfers: vi.fn(async (_p: string, _n: string, account: string) =>
			store.visible ? store.records.filter((r) => r.accountAddress === account && !r.hidden && !store.dust.has(r.id)) : [],
		),
		getArrivalState: vi.fn(async (_p: string, _n: string, _a: string) => snapshot()),
		claimArrivals: vi.fn(async (_p: string, _n: string, _a: string, ids: string[]) => {
			const state = snapshot()
			const won = ids.filter((id) => {
				const r = store.records.find((x) => x.id === id)
				return r !== undefined && isArrivalEligible(r, state)
			})
			store.played.push(...won)
			return won
		}),
	}
	return { svc, store }
}

/** Holds the mock's next call after computing its answer at call time: `release` hands it over, `fail` rejects. */
function hold<A extends unknown[], R>(mock: Mock<(...args: A) => Promise<R>>) {
	const real = mock.getMockImplementation()
	if (!real) throw new Error("no implementation to hold")
	let release = () => {}
	let fail = () => {}
	const gate = new Promise<void>((resolve, reject) => {
		release = resolve
		fail = () => reject(new Error("held call failed"))
	})
	gate.catch(() => {})
	mock.mockImplementationOnce(async (...args: A) => {
		const out = await real(...args)
		await gate
		return out
	})
	return { release: () => release(), fail: () => fail() }
}

const settle = async () => {
	for (let i = 0; i < 60; i++) await Promise.resolve()
}

function setup(opts: { route?: string; fake?: ReturnType<typeof fakeService>; tokens?: Map<number, ArrivalToken> } = {}) {
	const fake = opts.fake ?? fakeService()
	const config = { onUpdate: new EventHandler<ConfigProp>() }
	const prices = { onQuotesUpdated: new EventHandler<unknown>() }
	const route = ref(opts.route ?? SETTINGS)
	const epoch = ref(0)
	const scope = ref<IncomingScope | undefined>({ ...SCOPE })
	const account = ref("Account 1")
	const tokens = opts.tokens ?? new Map<number, ArrivalToken>([[1, { symbol: "USDC", decimals: 6 }]])
	const openToast = vi.fn()
	const openReceipt = vi.fn()
	const lookupToken = vi.fn(async (r: IncomingTransferRecord) => (r.tokenId === undefined ? undefined : tokens.get(r.tokenId)))
	const effect = effectScope()
	const arrivals = effect.run(() =>
		useArrivals({
			incomingTransferService: fake.svc,
			configService: config,
			priceService: prices,
			scope: () => scope.value,
			epoch: () => epoch.value,
			routeName: () => route.value,
			lookupToken,
			accountName: () => account.value,
			openToast,
			openReceipt,
		}),
	)
	if (!arrivals) throw new Error("composable did not initialize")
	return { ...fake, config, prices, route, epoch, scope, account, openToast, openReceipt, lookupToken, effect, arrivals }
}
type Harness = ReturnType<typeof setup>

/** A list that renders each row's `arriving` the way the activity lists do. */
function list(c: Harness, rows: Ref<IncomingTransferRecord[]>) {
	return mount(
		defineComponent({
			setup: () => () =>
				h(
					"ul",
					rows.value.map((r) =>
						h("li", { key: r.id, "data-id": r.id, "data-arriving": c.arrivals.isArriving(r) ? "true" : undefined }),
					),
				),
		}),
	)
}
const arriving = (w: ReturnType<typeof list>, r: IncomingTransferRecord) => w.find(`[data-id="${r.id}"]`).attributes("data-arriving")

/** Persists a receipt, then emits its Added and runs the coalesced read. */
async function arrive(c: Harness, r: IncomingTransferRecord) {
	c.store.records.push(r)
	c.svc.onIncomingTransferAdded.invoke(r)
	vi.advanceTimersByTime(250)
	await settle()
}
const setVisible = (c: Harness, visible: boolean) => {
	c.store.visible = visible
	c.config.onUpdate.invoke({ key: "incomingTransfersVisible", value: visible } as ConfigProp)
}
const quote = (c: Harness) => c.prices.onQuotesUpdated.invoke(undefined)

/** A seeded coordinator whose clock has moved past its seeding read, so new receipts are announceable. */
async function seeded(opts: Parameters<typeof setup>[0] = {}) {
	const c = setup(opts)
	await settle()
	vi.advanceTimersByTime(10)
	return c
}

/** Home's judgement of `rows`, then the lists' `present`. */
async function showOnHome(c: Harness, rows: IncomingTransferRecord[]) {
	c.route.value = HOME
	await c.arrivals.load(SCOPE)
	const w = list(c, ref(rows))
	c.arrivals.present(rows)
	await settle()
	return w
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 1_750_000_000_000 })
})
afterEach(() => {
	vi.useRealTimers()
})

describe("useArrivals — rows", () => {
	test("a row eligible under the loaded state carries data-arriving from its first paint, before any claim answers, and loses it after 2.6 s", async () => {
		const c = await seeded({ route: HOME })
		const r = receipt(20)
		c.store.records.push(r)
		await c.arrivals.load(SCOPE)
		const claim = hold(c.svc.claimArrivals)
		const w = list(c, ref([r]))
		expect(arriving(w, r)).toBe("true")
		c.arrivals.present([r])
		vi.advanceTimersByTime(ARRIVAL_WINDOW_MS)
		await nextTick()
		expect(arriving(w, r)).toBeUndefined()
		claim.release()
	})

	test("on Home, present claims only the rendered rows and the chip names the newest claimed one", async () => {
		const c = await seeded({ route: HOME })
		const [older, newer, unrendered] = [receipt(20), receipt(21), receipt(22)]
		c.store.records.push(older, newer, unrendered)
		await c.arrivals.load(SCOPE)
		list(c, ref([older, newer]))
		c.arrivals.present([older, newer, unrendered])
		await settle()
		expect(c.svc.claimArrivals).toHaveBeenCalledWith("p", "n", "0xa", [older.id, newer.id])
		expect(c.arrivals.latest.value).toEqual({ id: newer.id, label: `+${AMOUNT} USDC` })
	})

	test("a claim that answers after Home was left sets no chip, and off Home and History present claims nothing", async () => {
		const c = await seeded({ route: HOME })
		const [first, second] = [receipt(20), receipt(21)]
		c.store.records.push(first, second)
		await c.arrivals.load(SCOPE)
		list(c, ref([first, second]))
		const claim = hold(c.svc.claimArrivals)
		c.arrivals.present([first])
		c.route.value = HISTORY
		claim.release()
		await settle()
		expect(c.arrivals.latest.value).toBeNull()
		c.route.value = SETTINGS
		c.arrivals.present([second])
		await settle()
		expect(c.svc.claimArrivals).toHaveBeenCalledTimes(1)
	})

	test("a row another document claimed gets no chip, stops after its 2.6 s for good and is not claimed again", async () => {
		const c = await seeded({ route: HOME })
		const r = receipt(20)
		c.store.records.push(r)
		await c.arrivals.load(SCOPE)
		const rows = ref([r])
		const w = list(c, rows)
		c.svc.claimArrivals.mockResolvedValueOnce([])
		c.arrivals.present([r])
		await settle()
		expect(c.arrivals.latest.value).toBeNull()
		expect(arriving(w, r)).toBe("true")
		vi.advanceTimersByTime(ARRIVAL_WINDOW_MS)
		await nextTick()
		expect(arriving(w, r)).toBeUndefined()
		rows.value = [...rows.value]
		await nextTick()
		expect(arriving(w, r)).toBeUndefined()
		c.arrivals.present([r])
		await settle()
		expect(c.svc.claimArrivals).toHaveBeenCalledTimes(1)
	})

	test.each([TOKEN_PAGE, HISTORY])("a row judged on Home does not slide again on %s inside its window", async (next) => {
		const c = await seeded({ route: HOME })
		const r = receipt(20)
		c.store.records.push(r)
		await c.arrivals.load(SCOPE)
		expect(arriving(list(c, ref([r])), r)).toBe("true")
		c.route.value = next
		expect(arriving(list(c, ref([r])), r)).toBeUndefined()
	})

	test("one play per receipt: a remount over the same service state replays nothing", async () => {
		const c = await seeded({ route: HOME })
		const r = receipt(20)
		c.store.records.push(r)
		expect(arriving(await showOnHome(c, [r]), r)).toBe("true")
		c.effect.stop()
		const again = await seeded({ route: HOME, fake: { svc: c.svc, store: c.store } })
		await again.arrivals.load(SCOPE)
		expect(arriving(list(again, ref([r])), r)).toBeUndefined()
	})

	test("two receipts discovered in the same millisecond, delivered separately, both play", async () => {
		const c = await seeded({ route: HOME })
		const first = receipt(20)
		const second = receipt(21, { discoveredAt: first.discoveredAt })
		c.store.records.push(first)
		expect(arriving(await showOnHome(c, [first]), first)).toBe("true")
		c.store.records.push(second)
		expect(arriving(await showOnHome(c, [second, first]), second)).toBe("true")
	})
})

describe("useArrivals — the state a list is judged under", () => {
	test("a held read, then a visibility-off read: no snack, no claim, the newer read's state, the held ids known", async () => {
		const c = await seeded()
		const r = receipt(20)
		const held = hold(c.svc.getIncomingTransfers)
		c.store.records.push(r)
		c.svc.onIncomingTransferAdded.invoke(r)
		vi.advanceTimersByTime(250)
		setVisible(c, false)
		await settle()
		c.store.sinceBlock = 5
		held.release()
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
		expect(c.arrivals.knownIds().has(r.id)).toBe(true)
		c.route.value = HOME
		expect(c.arrivals.isArriving(receipt(7))).toBe(false)
	})

	test("two list loads: the older resolves under the newer's state", async () => {
		const c = await seeded({ route: HOME })
		c.store.sinceBlock = 5
		const held = hold(c.svc.getArrivalState)
		const older = c.arrivals.load(SCOPE)
		await settle()
		c.store.sinceBlock = 10
		await c.arrivals.load(SCOPE)
		held.release()
		await older
		expect(c.arrivals.isArriving(receipt(7))).toBe(false)
	})

	test("an older load that fails after a newer one held its state suppresses nothing", async () => {
		const c = await seeded({ route: HOME })
		const held = hold(c.svc.getArrivalState)
		const older = c.arrivals.load(SCOPE)
		await c.arrivals.load(SCOPE)
		held.fail()
		await older
		expect(c.arrivals.isArriving(receipt(20))).toBe(true)
	})

	test("a state read that started before the snack's claim does not replay that receipt on Home", async () => {
		const c = await seeded()
		const r = receipt(20)
		const token = hold(c.lookupToken)
		await arrive(c, r)
		const state = hold(c.svc.getArrivalState)
		quote(c)
		await settle()
		token.release()
		await settle()
		expect(c.openToast).toHaveBeenCalledTimes(1)
		state.release()
		await settle()
		c.route.value = HOME
		expect(c.arrivals.isArriving(r)).toBe(false)
	})

	test("a list load a coordinator read overtook resolves only once that read's state is held; rows an Allow un-hid then stay at rest", async () => {
		const c = await seeded({ route: HOME })
		const loadHold = hold(c.svc.getArrivalState)
		let done = false
		const pending = c.arrivals.load(SCOPE).then(() => {
			done = true
		})
		await settle()
		const allowed = [receipt(15), receipt(16)]
		c.store.records.push(...allowed)
		c.store.floors["0xc"] = 20
		const readHold = hold(c.svc.getArrivalState)
		for (const r of allowed) c.svc.onIncomingTransferAdded.invoke(r)
		vi.advanceTimersByTime(250)
		await settle()
		loadHold.release()
		await settle()
		expect(done).toBe(false)
		readHold.release()
		await pending
		const w = list(c, ref(allowed))
		expect(allowed.map((r) => arriving(w, r))).toEqual([undefined, undefined])
	})

	test("the same race with the coordinator read failing: the load resolves after the failure, the scope is suppressed, nothing plays or is claimed", async () => {
		const c = await seeded({ route: HOME })
		const loadHold = hold(c.svc.getArrivalState)
		let done = false
		const pending = c.arrivals.load(SCOPE).then(() => {
			done = true
		})
		await settle()
		const allowed = [receipt(15), receipt(16)]
		c.store.records.push(...allowed)
		const readHold = hold(c.svc.getIncomingTransfers)
		for (const r of allowed) c.svc.onIncomingTransferAdded.invoke(r)
		vi.advanceTimersByTime(250)
		loadHold.release()
		await settle()
		expect(done).toBe(false)
		readHold.fail()
		await pending
		const w = list(c, ref(allowed))
		expect(allowed.map((r) => arriving(w, r))).toEqual([undefined, undefined])
		c.arrivals.present(allowed)
		await settle()
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
	})

	test("a state read that fails after an Allow: those rows stay at rest for good, and a later receipt plays", async () => {
		const c = await seeded({ route: HOME })
		await c.arrivals.load(SCOPE)
		const allowed = [receipt(15), receipt(16)]
		c.store.records.push(...allowed)
		c.store.floors["0xc"] = 20
		c.svc.getArrivalState.mockRejectedValueOnce(new Error("node down"))
		await c.arrivals.load(SCOPE)
		const rows = ref(allowed)
		const w = list(c, rows)
		expect(allowed.map((r) => arriving(w, r))).toEqual([undefined, undefined])
		c.arrivals.present(allowed)
		await c.arrivals.load(SCOPE)
		const later = receipt(25)
		rows.value = [later, ...allowed]
		await nextTick()
		expect([later, ...allowed].map((r) => arriving(w, r))).toEqual(["true", undefined, undefined])
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
	})

	test("with no earlier state, a failed state read plays nothing", async () => {
		const fake = fakeService()
		fake.svc.getArrivalState.mockRejectedValueOnce(new Error("node down"))
		const c = await seeded({ route: HOME, fake })
		expect(c.arrivals.isArriving(receipt(20))).toBe(false)
	})
})

describe("useArrivals — the first read seeds", () => {
	test.each([TOKEN_PAGE, SETTINGS])(
		"on %s the start read seeds silently; a new receipt gets the one snack; the rest play on Home",
		async (route) => {
			const fake = fakeService()
			const old = [receipt(20), receipt(21), receipt(22)]
			fake.store.records.push(...old)
			const c = await seeded({ route, fake })
			expect(c.arrivals.seeded.value).toBe(true)
			expect(c.openToast).not.toHaveBeenCalled()
			expect(c.svc.claimArrivals).not.toHaveBeenCalled()
			const fresh = receipt(23)
			await arrive(c, fresh)
			expect(c.openToast).toHaveBeenCalledTimes(1)
			expect(c.svc.claimArrivals).toHaveBeenCalledWith("p", "n", "0xa", [fresh.id])
			const w = await showOnHome(c, [fresh, ...old])
			expect([fresh, ...old].map((r) => arriving(w, r))).toEqual([undefined, "true", "true", "true"])
		},
	)

	test("an unlock seeds on the lock screen, before Home; a receipt that then arrives on Settings gets its snack", async () => {
		const c = await seeded()
		c.epoch.value++
		c.scope.value = undefined
		c.route.value = "popup-auth"
		expect(c.arrivals.seeded.value).toBe(false)
		c.store.records.push(receipt(20))
		c.scope.value = { ...SCOPE }
		await settle()
		expect(c.arrivals.seeded.value).toBe(true)
		expect(c.openToast).not.toHaveBeenCalled()
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
		c.route.value = HOME
		c.route.value = SETTINGS
		vi.advanceTimersByTime(10)
		await arrive(c, receipt(21))
		expect(c.openToast).toHaveBeenCalledTimes(1)
	})

	test.each(["popup-auth", "popup-register", "windows-execute"])(
		"on %s a new receipt opens nothing, is claimed by nobody, is known and plays on Home",
		async (route) => {
			const c = await seeded({ route })
			const r = receipt(20)
			await arrive(c, r)
			expect(c.openToast).not.toHaveBeenCalled()
			expect(c.svc.claimArrivals).not.toHaveBeenCalled()
			expect(c.lookupToken).not.toHaveBeenCalled()
			expect(c.arrivals.knownIds().has(r.id)).toBe(true)
			expect(arriving(await showOnHome(c, [r]), r)).toBe("true")
		},
	)

	test("an Added that reached the page before the seeding read started is never announced, whatever its discoveredAt", async () => {
		const c = setup()
		const r = receipt(20, { discoveredAt: Date.now() + 60_000 })
		c.store.records.push(r)
		c.svc.onIncomingTransferAdded.invoke(r)
		await settle()
		vi.advanceTimersByTime(250)
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
	})

	test("an Added for a receipt discovered before the seeding read started, as an Allow re-emits, opens nothing", async () => {
		const c = await seeded()
		await arrive(c, receipt(20, { discoveredAt: Date.now() - 60_000 }))
		expect(c.openToast).not.toHaveBeenCalled()
	})
})

describe("useArrivals — a receipt shown later than it arrived", () => {
	test.each(["a quote", "visibility"] as const)("revealed on Home by %s, it plays once", async (by) => {
		const c = await seeded({ route: HOME })
		const r = receipt(20)
		c.store.records.push(r)
		c.store.dust.add(r.id)
		if (by === "visibility") setVisible(c, false)
		await settle()
		c.store.dust.delete(r.id)
		if (by === "visibility") setVisible(c, true)
		else quote(c)
		await settle()
		expect(arriving(await showOnHome(c, [r]), r)).toBe("true")
		expect(c.store.played).toEqual([r.id])
	})

	test("visibility off at the seeding read, then on, on Settings: no snack, no claim, known, plays on Home", async () => {
		const fake = fakeService()
		const r = receipt(20)
		fake.store.records.push(r)
		fake.store.visible = false
		const c = await seeded({ fake })
		setVisible(c, true)
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
		expect(c.arrivals.knownIds().has(r.id)).toBe(true)
		expect(arriving(await showOnHome(c, [r]), r)).toBe("true")
	})

	test("a dust receipt a quote lifts on the token page: no snack, no claim, plays on Home", async () => {
		const fake = fakeService()
		const r = receipt(20)
		fake.store.records.push(r)
		fake.store.dust.add(r.id)
		const c = await seeded({ route: TOKEN_PAGE, fake })
		c.store.dust.delete(r.id)
		quote(c)
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
		expect(arriving(await showOnHome(c, [r]), r)).toBe("true")
	})
})

describe("useArrivals — the elsewhere snack, after seeding on Settings", () => {
	test("a new receipt read uncontended opens its snack", async () => {
		const c = await seeded()
		await arrive(c, receipt(20))
		expect(c.openToast).toHaveBeenCalledTimes(1)
	})

	test("a receipt discovered while hidden, with no Added, opens nothing when shown and plays on Home", async () => {
		const c = await seeded()
		setVisible(c, false)
		await settle()
		const r = receipt(20)
		c.store.records.push(r)
		setVisible(c, true)
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
		expect(arriving(await showOnHome(c, [r]), r)).toBe("true")
	})

	test("an Added whose settling read filters it as dust stays silent when a quote lifts it", async () => {
		const c = await seeded()
		const r = receipt(20)
		c.store.dust.add(r.id)
		await arrive(c, r)
		c.store.dust.delete(r.id)
		quote(c)
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
		expect(arriving(await showOnHome(c, [r]), r)).toBe("true")
	})

	test("a quote that lifts a dust receipt before its settling read starts lets that read announce it", async () => {
		const c = await seeded()
		const r = receipt(20)
		c.store.records.push(r)
		c.store.dust.add(r.id)
		c.svc.onIncomingTransferAdded.invoke(r)
		c.store.dust.delete(r.id)
		quote(c)
		vi.advanceTimersByTime(250)
		await settle()
		expect(c.openToast).toHaveBeenCalledTimes(1)
	})

	test("a read that started before the Added and returns the record decides nothing; the next read announces it", async () => {
		const c = await seeded()
		const r = receipt(20)
		c.store.records.push(r)
		const early = hold(c.svc.getIncomingTransfers)
		quote(c)
		c.svc.onIncomingTransferAdded.invoke(r)
		early.release()
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
		vi.advanceTimersByTime(250)
		await settle()
		expect(c.openToast).toHaveBeenCalledTimes(1)
	})

	test("a read that returned the record before its Added arrived does not silence it", async () => {
		const c = await seeded()
		const r = receipt(20)
		c.store.records.push(r)
		quote(c)
		await settle()
		expect(c.arrivals.knownIds().has(r.id)).toBe(true)
		c.svc.onIncomingTransferAdded.invoke(r)
		vi.advanceTimersByTime(250)
		await settle()
		expect(c.openToast).toHaveBeenCalledTimes(1)
	})

	test("a superseded read settles nothing; the newer one opens the snack once", async () => {
		const c = await seeded()
		const r = receipt(20)
		c.store.records.push(r)
		c.svc.onIncomingTransferAdded.invoke(r)
		const superseded = hold(c.svc.getArrivalState)
		quote(c)
		vi.advanceTimersByTime(250)
		await settle()
		superseded.release()
		await settle()
		expect(c.openToast).toHaveBeenCalledTimes(1)
		expect(c.svc.claimArrivals).toHaveBeenCalledTimes(1)
	})

	test("a settling read that fails opens nothing, then or later", async () => {
		const c = await seeded()
		c.svc.getIncomingTransfers.mockRejectedValueOnce(new Error("node down"))
		await arrive(c, receipt(20))
		quote(c)
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
	})

	test("a held claim, then a read that still shows the receipt: exactly one snack", async () => {
		const c = await seeded()
		const claim = hold(c.svc.claimArrivals)
		await arrive(c, receipt(20))
		quote(c)
		await settle()
		claim.release()
		await settle()
		expect(c.openToast).toHaveBeenCalledTimes(1)
	})

	test.each(["visibility off", "Home"] as const)(
		"a held claim, then a read after %s: no snack, and the id stays claimed",
		async (change) => {
			const c = await seeded()
			const claim = hold(c.svc.claimArrivals)
			const r = receipt(20)
			await arrive(c, r)
			if (change === "Home") {
				c.route.value = HOME
				quote(c)
			} else setVisible(c, false)
			await settle()
			claim.release()
			await settle()
			expect(c.openToast).not.toHaveBeenCalled()
			expect(c.store.played).toEqual([r.id])
		},
	)

	test.each([
		["turns visibility off", false, 0],
		["keeps the receipt", true, 1],
	] as const)(
		"a claim that returns while a newer read is in flight waits for it; one that %s decides",
		async (_name, visible, snacks) => {
			const c = await seeded()
			const claim = hold(c.svc.claimArrivals)
			await arrive(c, receipt(20))
			const newer = hold(c.svc.getIncomingTransfers)
			if (visible) quote(c)
			else setVisible(c, false)
			claim.release()
			await settle()
			expect(c.openToast).not.toHaveBeenCalled()
			newer.release()
			await settle()
			expect(c.openToast).toHaveBeenCalledTimes(snacks)
		},
	)

	test("a read that started before the settling one and leaves the id out decides nothing: one snack", async () => {
		const c = await seeded()
		const r = receipt(20)
		c.store.records.push(r)
		c.svc.onIncomingTransferAdded.invoke(r)
		c.store.visible = false
		const early = hold(c.svc.getIncomingTransfers)
		quote(c)
		c.store.visible = true
		const claim = hold(c.svc.claimArrivals)
		vi.advanceTimersByTime(250)
		await settle()
		early.release()
		await settle()
		claim.release()
		await settle()
		expect(c.openToast).toHaveBeenCalledTimes(1)
	})

	test("a claim that returns while a newer read is in flight that then fails opens nothing", async () => {
		const c = await seeded()
		const claim = hold(c.svc.claimArrivals)
		await arrive(c, receipt(20))
		const newer = hold(c.svc.getIncomingTransfers)
		quote(c)
		claim.release()
		await settle()
		newer.fail()
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
	})

	test("a held claim across Home's list load and back to Settings: exactly one snack", async () => {
		const c = await seeded()
		const claim = hold(c.svc.claimArrivals)
		await arrive(c, receipt(20))
		c.route.value = HOME
		await c.arrivals.load(SCOPE)
		c.route.value = SETTINGS
		claim.release()
		await settle()
		expect(c.openToast).toHaveBeenCalledTimes(1)
	})

	test("the same with visibility turned off after Home's load: its read decides, whatever load follows", async () => {
		const c = await seeded()
		const claim = hold(c.svc.claimArrivals)
		await arrive(c, receipt(20))
		c.route.value = HOME
		await c.arrivals.load(SCOPE)
		setVisible(c, false)
		await settle()
		await c.arrivals.load(SCOPE)
		c.route.value = SETTINGS
		claim.release()
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
	})

	test("a receipt deleted while its claim is held opens nothing; a delete of another id changes nothing", async () => {
		for (const deleteOther of [false, true]) {
			const c = await seeded()
			const r = receipt(20)
			const claim = hold(c.svc.claimArrivals)
			await arrive(c, r)
			const newer = hold(c.svc.getIncomingTransfers)
			quote(c)
			await settle()
			c.svc.onIncomingTransferDeleted.invoke(deleteOther ? receipt(99) : r)
			newer.release()
			claim.release()
			await settle()
			expect(c.openToast).toHaveBeenCalledTimes(deleteOther ? 1 : 0)
			c.effect.stop()
			c.svc.onIncomingTransferDeleted.invoke(r)
		}
	})

	test("three Added in one tick open one snack, for the newest", async () => {
		const c = await seeded()
		const batch = [receipt(20), receipt(21), receipt(22)]
		c.store.records.push(...batch)
		for (const r of batch) c.svc.onIncomingTransferAdded.invoke(r)
		vi.advanceTimersByTime(250)
		await settle()
		expect(c.openToast).toHaveBeenCalledTimes(1)
		expect(c.svc.claimArrivals).toHaveBeenCalledWith("p", "n", "0xa", [batch[2]?.id])
	})

	const moveTo = (c: Harness, scope: IncomingScope | undefined) => {
		c.scope.value = scope && { ...scope }
		c.epoch.value++
	}
	test.each([
		["a scope change", (c: Harness) => moveTo(c, OTHER)],
		["a lock", (c: Harness) => moveTo(c, undefined)],
		[
			"A → B → A",
			(c: Harness) => {
				moveTo(c, OTHER)
				moveTo(c, SCOPE)
			},
		],
	])("%s during the settling read drops it and claims nothing", async (_name, change) => {
		const c = await seeded()
		const r = receipt(20)
		c.store.records.push(r)
		const held = hold(c.svc.getIncomingTransfers)
		c.svc.onIncomingTransferAdded.invoke(r)
		vi.advanceTimersByTime(250)
		change(c)
		held.release()
		await settle()
		vi.advanceTimersByTime(250)
		await settle()
		expect(c.openToast).not.toHaveBeenCalled()
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
	})
})

describe("useArrivals — the snack's text", () => {
	test.each([
		["note", "Private"],
		["public-event", "Public"],
	] as const)("a %s reads Received, %s · account, and View opens the receipt, whatever its sender", async (kind, side) => {
		const c = await seeded()
		const labels: unknown[] = []
		for (const from of ["0xSENTINEL0001", "0xSENTINEL0002"]) {
			const r = receipt(20 + labels.length, { kind, from } as Partial<IncomingTransferRecord>)
			await arrive(c, r)
			const options = c.openToast.mock.lastCall?.[0]
			expect(options).toMatchObject({ kind: "success", label: `Received ${AMOUNT} USDC`, sub: `${side} · Account 1` })
			expect(JSON.stringify(c.openToast.mock.calls)).not.toContain("SENTINEL")
			options.action.onSelect()
			expect(c.openReceipt).toHaveBeenLastCalledWith(r.id)
			labels.push([options.label, options.sub])
		}
		expect(labels[0]).toEqual(labels[1])
	})

	test("a hostile symbol and account name arrive stripped of controls and cut at 32", async () => {
		const symbol = `<b>X</b>‮${"S".repeat(1_000)}`
		const c = await seeded({ tokens: new Map([[1, { symbol, decimals: 6 }]]) })
		c.account.value = `‮<i>n</i>${"n".repeat(1_000)}`
		await arrive(c, receipt(20))
		const { label, sub } = c.openToast.mock.lastCall?.[0] ?? {}
		expect(label).toBe(`Received ${AMOUNT} <b>X</b>${"S".repeat(24)}…`)
		expect(sub).toBe(`Private · <i>n</i>${"n".repeat(24)}…`)
	})

	test.each([-1, 1.5, 1_000])("a token with decimals %s opens no snack and claims nothing", async (decimals) => {
		const c = await seeded({ tokens: new Map([[1, { symbol: "BAD", decimals }]]) })
		await arrive(c, receipt(20))
		expect(c.openToast).not.toHaveBeenCalled()
		expect(c.svc.claimArrivals).not.toHaveBeenCalled()
	})
})

describe("useArrivals — triggers and disposal", () => {
	test("reads run on start, reconnect, scope change, coalesced Added, both config keys and quotes; a delete starts none", async () => {
		const c = await seeded()
		const reads = () => c.svc.getIncomingTransfers.mock.calls.length
		expect(reads()).toBe(1)
		c.svc.onConnected.invoke()
		c.scope.value = { ...OTHER }
		c.epoch.value++
		await settle()
		expect(reads()).toBe(3)
		for (const r of [receipt(20), receipt(21), receipt(22)]) c.svc.onIncomingTransferAdded.invoke({ ...r, accountAddress: "0xb" })
		vi.advanceTimersByTime(250)
		expect(reads()).toBe(4)
		for (const key of ["incomingTransfersVisible", "incomingDustUsdThreshold", "theme"])
			c.config.onUpdate.invoke({ key, value: 1 } as unknown as ConfigProp)
		quote(c)
		c.svc.onIncomingTransferDeleted.invoke(receipt(23))
		expect(reads()).toBe(7)
	})

	test("dispose removes every listener it added and clears its timers; nothing runs after it", async () => {
		const c = await seeded({ route: HOME })
		const handlers = [
			c.svc.onIncomingTransferAdded,
			c.svc.onIncomingTransferDeleted,
			c.svc.onConnected,
			c.config.onUpdate,
			c.prices.onQuotesUpdated,
		] as EventHandler<unknown>[]
		const removed = handlers.map((e) => vi.spyOn(e, "remove"))
		const r = receipt(20)
		c.store.records.push(r)
		await c.arrivals.load(SCOPE)
		list(c, ref([r]))
		c.svc.onIncomingTransferAdded.invoke(r)
		expect(vi.getTimerCount()).toBeGreaterThan(0)
		c.effect.stop()
		expect(vi.getTimerCount()).toBe(0)
		for (const spy of removed) expect(spy).toHaveBeenCalledTimes(1)
		const before = c.svc.getIncomingTransfers.mock.calls.length
		c.svc.onConnected.invoke()
		quote(c)
		await settle()
		expect(c.svc.getIncomingTransfers.mock.calls.length).toBe(before)
	})
})
