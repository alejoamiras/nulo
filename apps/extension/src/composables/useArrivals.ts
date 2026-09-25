import { type InjectionKey, onScopeDispose, type Ref, ref, type ShallowRef, shallowRef, watch } from "vue"
import type { EventHandler } from "@nulo/wallet-core/utils"
import type { ToastOptions } from "@/composables/toast"
import { AUTH_ENTRY_ROUTES } from "@/popup/should-advance-to-general"
import { ADDED_COALESCE, coalesce } from "@/utils/coalesce"
import { formatSnackAmount } from "@/utils/snack-amount"
import { isValidDecimals } from "@/utils/token-amount"
import type { ConfigProp } from "@/wallet/config"
import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"
import { type ArrivalState, isArrivalEligible } from "@/wallet/services/incoming-transfer/arrival-state"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import type { IncomingScope } from "./useIncomingTransfers"

/**
 * The popup's one arrival coordinator. Home and History play a receipt on its row the first time
 * it renders eligible; any other screen gets one snack for a receipt that arrives while it is open.
 * The incoming-transfer service owns what has been played; this holds the view of it for the
 * active scope and asks the service to claim what it shows.
 */

/** The longest drawn arrival animation. A row's `arriving` is released after it, so hover works again. */
export const ARRIVAL_WINDOW_MS = 2_600

const HOME = "popup-general"
const HISTORY = "popup-activity"

export type ArrivalToken = { symbol: string; decimals: number }
/** Home's chip: `label` is null when the amount cannot be formatted, and then no chip shows. */
export type ArrivalChip = { id: string; label: string | null }

export interface ArrivalsServiceLike {
	getIncomingTransfers(profileId: string, networkId: string, account: string): Promise<IncomingTransferRecord[]>
	getArrivalState(profileId: string, networkId: string, account: string): Promise<ArrivalState>
	claimArrivals(profileId: string, networkId: string, account: string, ids: string[]): Promise<string[]>
	onIncomingTransferAdded: EventHandler<IncomingTransferRecord>
	onIncomingTransferDeleted: EventHandler<IncomingTransferRecord>
	onConnected: EventHandler<void>
}

export interface UseArrivalsOptions {
	incomingTransferService: ArrivalsServiceLike
	configService: { onUpdate: EventHandler<ConfigProp> }
	priceService: { onQuotesUpdated: EventHandler<unknown> }
	/** The logged-in session's complete scope, or undefined while locked or incomplete. */
	scope: () => IncomingScope | undefined
	/** `appStore.scopeEpoch`: moves on every lock and every scope change. */
	epoch: () => number
	routeName: () => unknown
	lookupToken: (record: IncomingTransferRecord) => Promise<ArrivalToken | undefined>
	accountName: () => string
	openToast: (options: ToastOptions) => void
	openReceipt: (id: string) => void
	now?: () => number
}

/** What the lists inject. Off Home and History `isArriving` is false and `present` does nothing. */
export interface Arrivals {
	isArriving: (record: IncomingTransferRecord) => boolean
	present: (records: IncomingTransferRecord[]) => void
	latest: Readonly<Ref<ArrivalChip | null>>
	load: (scope: IncomingScope) => Promise<void>
}

export const ARRIVALS_KEY: InjectionKey<Arrivals> = Symbol("arrivals")

type LoadOutcome = "ok" | "failed" | "dropped"
type Read = { gen: number; order: number; startedAt: number; ids?: Set<string> | "failed" }
type Judgement = { arriving: boolean; at: number; route: string }
type Pending = { record: IncomingTransferRecord; token: ArrivalToken; settledBy: number; claimed: boolean }

/** Everything that belongs to one epoch of one scope; a lock or a scope change replaces it whole. */
class ScopeRun {
	gen = 0
	order = 0
	state: ArrivalState | null = null
	suppressed = false
	readonly claimed = new Set<string>()
	readonly attempted = new Set<string>()
	/**
	 * Every id a read of this scope returned. Reads are route-blind, so the one an unlock starts on
	 * the lock screen seeds this; the first read to complete only seeds, and only receipts
	 * discovered after it started can be announced.
	 */
	readonly known = new Set<string>()
	/** Ids whose Added reached this page, by arrival order. Only the settling read decides an id. */
	readonly announced = new Map<string, number>()
	seededAt: number | null = null
	lastRead: Read | undefined
	readonly judged = new Map<string, Judgement>()
	readonly timers = new Set<ReturnType<typeof setTimeout>>()
	readonly settling = new Map<number, Promise<void>>()
	pending: Pending[] = []
	/** Candidates between settlement and the snack's decision, and those a delete vetoed. */
	readonly watching = new Set<string>()
	readonly vetoed = new Set<string>()

	constructor(
		readonly epoch: number,
		readonly scope: IncomingScope,
	) {}
}

const scopeKey = (s: IncomingScope) => `${s.profileId} ${s.networkId} ${s.account}`
const inScope = (s: IncomingScope, r: IncomingTransferRecord) =>
	r.profileId === s.profileId && r.networkId === s.networkId && r.accountAddress === s.account
const playsOn = (route: string) => route === HOME || route === HISTORY
const announcesOn = (route: string) =>
	route !== "" && !playsOn(route) && !(AUTH_ENTRY_ROUTES as readonly string[]).includes(route) && !route.startsWith("windows-")
const newestFirst = (a: IncomingTransferRecord, b: IncomingTransferRecord) =>
	b.l2BlockNumber - a.l2BlockNumber || b.txIndexInBlock - a.txIndexInBlock || b.indexInTx - a.indexInTx
const noop = () => {}

/** The snack's and the chip's amount, or null when the token's `decimals` or the raw amount is unusable. */
export function arrivalAmount(record: IncomingTransferRecord, token: ArrivalToken | undefined): string | null {
	if (!token || !isValidDecimals(token.decimals)) return null
	try {
		return formatSnackAmount(BigInt(record.amountRaw), token.decimals)
	} catch {
		return null
	}
}

export function arrivalChipLabel(record: IncomingTransferRecord, token: ArrivalToken | undefined): string | null {
	const amount = arrivalAmount(record, token)
	return amount === null || !token ? null : `+${amount} ${sanitizeWireString(token.symbol, 32)}`
}

class ArrivalCoordinator {
	readonly latest: ShallowRef<ArrivalChip | null> = shallowRef(null)
	readonly seeded = ref(false)
	private readonly version = ref(0)
	private run: ScopeRun | undefined
	private disposed = false
	private readonly now: () => number
	readonly addedRead = coalesce(() => this.startRead(), ADDED_COALESCE)

	constructor(private readonly deps: UseArrivalsOptions) {
		this.now = deps.now ?? Date.now
	}

	private live(r: ScopeRun): boolean {
		return !this.disposed && r === this.run && r.epoch === this.deps.epoch()
	}

	private route(): string {
		const name = this.deps.routeName()
		return typeof name === "string" ? name : ""
	}

	private get svc() {
		return this.deps.incomingTransferService
	}

	reset(scope: IncomingScope | undefined): ScopeRun | undefined {
		if (this.run) for (const t of this.run.timers) clearTimeout(t)
		this.addedRead.cancel()
		this.run = scope ? new ScopeRun(this.deps.epoch(), scope) : undefined
		this.seeded.value = false
		this.latest.value = null
		this.version.value++
		return this.run
	}

	isCurrent(r: ScopeRun | undefined): boolean {
		return r !== undefined && r === this.run
	}

	knownIds(): ReadonlySet<string> {
		return this.run?.known ?? new Set()
	}

	dispose(): void {
		this.reset(undefined)
		this.disposed = true
	}

	startRead(): void {
		const r = this.run
		if (!r || !this.live(r)) return
		const read: Read = { gen: ++r.gen, order: ++r.order, startedAt: this.now() }
		r.lastRead = read
		const loaded = this.readRecords(r, read)
		this.track(r, read.gen, loaded)
		void loaded.then((result) => {
			if (result) this.settle(r, read, result.records, result.outcome)
		})
	}

	/** A read is the records, then the state: every floor is written before the history it covers
	 *  is committed, so a state read after a records read covers every record that read returned. */
	private async readRecords(r: ScopeRun, read: Read) {
		const { profileId, networkId, account } = r.scope
		let records: IncomingTransferRecord[]
		try {
			records = await this.svc.getIncomingTransfers(profileId, networkId, account)
		} catch {
			if (this.live(r)) this.recordsFailed(r, read)
			return undefined
		}
		if (!this.live(r)) return undefined
		read.ids = new Set(records.map((x) => x.id))
		for (const id of read.ids) r.known.add(id)
		if (r.seededAt === null) this.seed(r, read)
		this.decide(r)
		const outcome = await this.loadState(r, read.gen)
		return this.live(r) ? { records, outcome } : undefined
	}

	private recordsFailed(r: ScopeRun, read: Read): void {
		read.ids = "failed"
		if (read.gen === r.gen) {
			r.suppressed = true
			this.settle(r, read, [], "failed")
		}
		this.decide(r)
	}

	private seed(r: ScopeRun, read: Read): void {
		r.seededAt = read.startedAt
		for (const [id, order] of r.announced) if (order < read.order) r.announced.delete(id)
		this.seeded.value = true
	}

	private async loadState(r: ScopeRun, gen: number): Promise<LoadOutcome> {
		const { profileId, networkId, account } = r.scope
		let state: ArrivalState
		try {
			state = await this.svc.getArrivalState(profileId, networkId, account)
		} catch {
			if (!this.live(r) || gen !== r.gen) return "dropped"
			r.suppressed = true
			return "failed"
		}
		if (!this.live(r) || gen !== r.gen) return "dropped"
		r.state = { ...state, played: [...new Set([...state.played, ...r.claimed])] }
		r.suppressed = false
		return "ok"
	}

	private track(r: ScopeRun, gen: number, settled: Promise<unknown>): void {
		const done = settled.then(noop, noop)
		r.settling.set(gen, done)
		void done.then(() => r.settling.delete(gen))
	}

	/** A dropped `load` returns only once every newer generation has settled, so a list assigns its
	 *  rows under the newest state (or at rest), never under the one that state replaced. */
	private async settledAfter(r: ScopeRun, gen: number): Promise<void> {
		for (;;) {
			const newer = [...r.settling].filter(([g]) => g > gen).map(([, p]) => p)
			if (newer.length === 0 || !this.live(r)) return
			await Promise.all(newer)
		}
	}

	async load(scope: IncomingScope): Promise<void> {
		const r = this.run
		if (!r || !this.live(r) || scopeKey(r.scope) !== scopeKey(scope)) return
		const gen = ++r.gen
		const settled = this.loadState(r, gen)
		this.track(r, gen, settled)
		if ((await settled) === "dropped") await this.settledAfter(r, gen)
	}

	/** Decides each announced id whose Added came before this read started. A read superseded by a
	 *  newer generation decides nothing, and one that failed decides every such id silent. */
	private settle(r: ScopeRun, read: Read, records: IncomingTransferRecord[], outcome: LoadOutcome): void {
		if (!this.live(r) || outcome === "dropped") return
		const candidates: IncomingTransferRecord[] = []
		for (const [id, order] of r.announced) {
			if (order > read.order) continue
			r.announced.delete(id)
			const record = outcome === "ok" ? records.find((x) => x.id === id) : undefined
			if (record && this.isCandidate(r, record)) candidates.push(record)
		}
		if (candidates.length > 0 && announcesOn(this.route())) void this.announce(r, read, candidates)
	}

	private isCandidate(r: ScopeRun, record: IncomingTransferRecord): boolean {
		return r.seededAt !== null && record.discoveredAt > r.seededAt && r.state !== null && isArrivalEligible(record, r.state)
	}

	private async announce(r: ScopeRun, read: Read, candidates: IncomingTransferRecord[]): Promise<void> {
		candidates.sort(newestFirst)
		for (const c of candidates) r.watching.add(c.id)
		const tokens = await Promise.all(candidates.map((c) => this.deps.lookupToken(c).catch(() => undefined)))
		const chosen = candidates.findIndex((c, i) => arrivalAmount(c, tokens[i]) !== null)
		for (const [i, c] of candidates.entries()) if (i !== chosen) this.unwatch(r, c.id)
		const record = candidates[chosen]
		const token = tokens[chosen]
		if (!record || !token || !this.live(r)) return
		if (r.vetoed.has(record.id) || !announcesOn(this.route())) return this.unwatch(r, record.id)
		const pending: Pending = { record, token, settledBy: read.gen, claimed: false }
		r.pending.push(pending)
		await this.claimFor(r, pending)
	}

	/** Once sent, a claim owns its id: only a lock, a scope change or disposal drops its result. A
	 *  newer read cannot, because a successful claim has already marked the receipt played. */
	private async claimFor(r: ScopeRun, pending: Pending): Promise<void> {
		const { profileId, networkId, account } = r.scope
		let ids: string[] = []
		try {
			ids = await this.svc.claimArrivals(profileId, networkId, account, [pending.record.id])
		} catch {
			// Unclaimed: the receipt stays unseen and plays where its row is first shown.
		}
		if (!this.live(r)) return
		if (!ids.includes(pending.record.id)) return this.drop(r, pending)
		this.markClaimed(r, [pending.record.id])
		pending.claimed = true
		this.decide(r)
	}

	private markClaimed(r: ScopeRun, ids: string[]): void {
		for (const id of ids) {
			r.claimed.add(id)
			if (r.state && !r.state.played.includes(id)) r.state.played.push(id)
		}
	}

	private decide(r: ScopeRun): void {
		for (const pending of [...r.pending]) {
			const verdict = this.verdictOf(r, pending)
			if (verdict === "wait") continue
			this.drop(r, pending)
			if (verdict === "open") this.openSnack(pending)
		}
	}

	/** The receipts of the newest coordinator read started after the settling one decide; with none,
	 *  the settling read, which returned the id, does. */
	private verdictOf(r: ScopeRun, pending: Pending): "wait" | "open" | "drop" {
		if (!pending.claimed) return "wait"
		if (r.vetoed.has(pending.record.id)) return "drop"
		const decider = r.lastRead && r.lastRead.gen > pending.settledBy ? r.lastRead : undefined
		if (decider && decider.ids === undefined) return "wait"
		if (decider && (decider.ids === "failed" || !decider.ids?.has(pending.record.id))) return "drop"
		return announcesOn(this.route()) ? "open" : "drop"
	}

	private drop(r: ScopeRun, pending: Pending): void {
		r.pending = r.pending.filter((p) => p !== pending)
		this.unwatch(r, pending.record.id)
	}

	private unwatch(r: ScopeRun, id: string): void {
		r.watching.delete(id)
		r.vetoed.delete(id)
	}

	private openSnack({ record, token }: Pending): void {
		const amount = arrivalAmount(record, token)
		if (amount === null) return
		const side = record.kind === "note" ? "Private" : "Public"
		this.deps.openToast({
			kind: "success",
			label: `Received ${amount} ${sanitizeWireString(token.symbol, 32)}`,
			sub: `${side} · ${sanitizeWireString(this.deps.accountName(), 32)}`,
			action: { label: "View", onSelect: () => this.deps.openReceipt(record.id) },
		})
	}

	readonly onAdded = (record: IncomingTransferRecord): void => {
		const r = this.run
		if (!r || !this.live(r) || !inScope(r.scope, record)) return
		r.announced.set(record.id, ++r.order)
		this.addedRead.trigger()
	}

	/** A receipt deleted before its snack opens gets none, whatever a read captured before the delete. */
	readonly onDeleted = (record: IncomingTransferRecord): void => {
		const r = this.run
		if (!r || !this.live(r)) return
		r.announced.delete(record.id)
		if (r.watching.has(record.id)) r.vetoed.add(record.id)
	}

	/**
	 * Synchronous, so a row carries `arriving` on its first paint. A judged id is never judged again:
	 * it answers from its window, on the route that judged it until that route is left, so a receipt
	 * another document claimed stops after its 2.6 s and a row first shown at rest never slides later.
	 */
	isArriving(record: IncomingTransferRecord): boolean {
		void this.version.value
		const r = this.run
		const route = this.route()
		if (!r || !this.live(r) || !playsOn(route) || !inScope(r.scope, record)) return false
		const judged = r.judged.get(record.id)
		if (judged) return judged.arriving && judged.route === route && this.now() - judged.at < ARRIVAL_WINDOW_MS
		const arriving = !r.suppressed && r.state !== null && isArrivalEligible(record, r.state)
		r.judged.set(record.id, { arriving, at: this.now(), route })
		if (arriving) this.arm(r)
		return arriving
	}

	private arm(r: ScopeRun): void {
		const t = setTimeout(() => {
			r.timers.delete(t)
			if (r === this.run) this.version.value++
		}, ARRIVAL_WINDOW_MS)
		r.timers.add(t)
	}

	present(records: IncomingTransferRecord[]): void {
		const r = this.run
		const route = this.route()
		if (!r || !this.live(r) || !playsOn(route)) return
		const shown = records.filter((x) => r.judged.get(x.id)?.arriving && !r.attempted.has(x.id) && inScope(r.scope, x))
		if (shown.length === 0) return
		for (const x of shown) r.attempted.add(x.id)
		void this.claimShown(r, shown, route)
	}

	private async claimShown(r: ScopeRun, shown: IncomingTransferRecord[], route: string): Promise<void> {
		const { profileId, networkId, account } = r.scope
		let ids: string[] = []
		try {
			ids = await this.svc.claimArrivals(
				profileId,
				networkId,
				account,
				shown.map((x) => x.id),
			)
		} catch {
			return
		}
		if (!this.live(r)) return
		this.markClaimed(r, ids)
		const newest = shown.filter((x) => ids.includes(x.id)).sort(newestFirst)[0]
		if (!newest || route !== HOME) return
		const token = await this.deps.lookupToken(newest).catch(() => undefined)
		if (this.live(r) && this.route() === HOME) this.latest.value = { id: newest.id, label: arrivalChipLabel(newest, token) }
	}

	/** Leaving a route retires its windows: a row that played there is at rest when the route returns. */
	readonly onRouteChanged = (): void => {
		const route = this.route()
		if (route !== HOME) this.latest.value = null
		for (const judged of this.run?.judged.values() ?? []) if (judged.route !== route) judged.arriving = false
	}
}

export function useArrivals(options: UseArrivalsOptions) {
	const c = new ArrivalCoordinator(options)
	const { incomingTransferService: svc, configService, priceService } = options
	const onConnected = () => c.startRead()
	const onQuotesUpdated = () => c.startRead()
	const onConfigUpdate = (prop: ConfigProp) => {
		if (prop.key === "incomingTransfersVisible" || prop.key === "incomingDustUsdThreshold") c.startRead()
	}

	const stopScopeWatch = watch(
		() => {
			const s = options.scope()
			return s ? `${options.epoch()} ${scopeKey(s)}` : ""
		},
		() => {
			const r = c.reset(options.scope())
			// Deferred a microtask: a lock moves the epoch before it clears the session.
			if (r) queueMicrotask(() => c.isCurrent(r) && c.startRead())
		},
		{ flush: "sync", immediate: true },
	)
	const stopRouteWatch = watch(options.routeName, c.onRouteChanged, { flush: "sync" })

	svc.onIncomingTransferAdded.add(c.onAdded)
	svc.onIncomingTransferDeleted.add(c.onDeleted)
	svc.onConnected.add(onConnected)
	configService.onUpdate.add(onConfigUpdate)
	priceService.onQuotesUpdated.add(onQuotesUpdated)

	let disposed = false
	const dispose = () => {
		if (disposed) return
		disposed = true
		stopScopeWatch()
		stopRouteWatch()
		c.dispose()
		svc.onIncomingTransferAdded.remove(c.onAdded)
		svc.onIncomingTransferDeleted.remove(c.onDeleted)
		svc.onConnected.remove(onConnected)
		configService.onUpdate.remove(onConfigUpdate)
		priceService.onQuotesUpdated.remove(onQuotesUpdated)
	}
	onScopeDispose(dispose)

	const arrivals: Arrivals = {
		isArriving: (record) => c.isArriving(record),
		present: (records) => c.present(records),
		latest: c.latest,
		load: (scope) => c.load(scope),
	}
	return { ...arrivals, seeded: c.seeded, knownIds: () => c.knownIds(), dispose }
}
