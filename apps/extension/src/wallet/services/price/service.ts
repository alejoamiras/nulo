import type { AlarmCreateOptions, AlarmEvent, AlarmsPort, BrowserApi, Unsubscribe } from "@nulo/wallet-core/ports"
import type { ServiceCollection, ServiceSpec } from "@/wallet/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/background"
import type { ILogger } from "@/wallet/logger"
import { ConfigService } from "@/wallet/services/config/service"
import { ProfileService, type ProfileInfo } from "@/wallet/services/profile/service"
import { ValueStorage } from "@/wallet/storage"
import { EventHandler, getErrorMessage } from "@nulo/wallet-core/utils"
import { LogLevel } from "@nulo/wallet-core/logger"
import { allCoingeckoIds, getSanityBand } from "./price-map"
import {
	MAX_CLOCK_SKEW_MS,
	PRICE_SERVICE_NAME,
	QUOTE_TTL_MS,
	isQuoteFresh,
	type Events,
	type Methods,
	type PriceQuote,
	type PriceState,
} from "./spec"

export * from "./spec"

export const PRICE_REFRESH_ALARM_NAME = "nulo:price:refresh"

/** Chrome's production floor is 1 min; 3 min keeps traffic minimal while unlocked. */
export const PRICE_REFRESH_PERIOD_MINUTES = 3

const CACHE_STORAGE_KEY = "nulo:core:token-prices"

const API_BASE = "https://api.coingecko.com/api/v3"

/** Exponential backoff after failed fetches: 30s base, ×2 per consecutive
 *  failure, capped at the quote TTL. Jittered ±25% so a fleet of wallets
 *  behind one NAT doesn't retry in lockstep. */
const BACKOFF_BASE_MS = 30_000
const BACKOFF_CAP_MS = QUOTE_TTL_MS

const LOG_SOURCE = "PriceService"

type FetchLike = (
	input: string,
	init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
	ok: boolean
	status: number
	json(): Promise<unknown>
}>

/**
 * Background price feed. ONE batched CoinGecko request per refresh, always
 * for the full static id set (`price-map.ts`) — the query never varies with
 * holdings. Quotes are validated at write AND read time (shape + per-id
 * sanity bands), cached in `chrome.storage.local`, and treated as absent
 * after `QUOTE_TTL_MS`.
 *
 * Privacy posture: refreshes run only while a profile session is unlocked
 * (alarm created on unlock, cleared on lock), plus stale-on-connect via
 * `refreshIfStale`. Executors read `getUsableQuote` cache-or-nothing — no
 * fetch is ever triggered by transaction activity. The `showFiatValues`
 * config toggle disables everything and clears the cache.
 *
 * NOT exposed to dApps: this service is deliberately absent from the
 * wallet-sdk dispatcher wiring (pinned by `not-dapp-exposed.test.ts`).
 */
export class PriceService extends Service<Methods, Events> implements ServiceSpec<Methods, Events> {
	protected readonly rpcMethods = defineRpcMethods<Methods>()("getQuotes", "refreshIfStale")
	public static name = PRICE_SERVICE_NAME

	public readonly dependencies = [ConfigService.name, ProfileService.name] as const

	public readonly onQuotesUpdated = new EventHandler<PriceState>()

	private readonly cache: ValueStorage<PriceState>
	private readonly alarms: AlarmsPort
	private readonly fetchFn: FetchLike
	private readonly now: () => number

	private configService: ConfigService = null!
	private profileService: ProfileService = null!

	/** Bumped on every kill-switch flip; in-flight refreshes from an older
	 *  generation abort and never write. */
	private generation = 0
	private inflight: Promise<PriceState> | undefined
	private abortController: AbortController | undefined
	private consecutiveFailures = 0
	private nextAllowedFetchAt = 0
	/** Completed-fetch watermark (this SW lifetime). Guards `refreshIfStale`
	 *  against refetch-forever when a mapped id is PERMANENTLY absent from
	 *  the provider (delisted): completeness alone would fire a real network
	 *  request on every popup connect, and successful fetches keep resetting
	 *  the failure backoff. */
	private lastCompletedFetchAt = 0
	/** Serializes the cache-committing work of config flips so a rapid
	 *  disable↔enable can't interleave `cache.delete()` with a fresh `cache.set()`
	 *  (the last flip's work would otherwise race the prior flip's). The generation
	 *  bump stays synchronous at flip time; only the storage/emit tail is chained. */
	private configTransition: Promise<void> = Promise.resolve()

	public constructor(logger: ILogger, browserApi?: BrowserApi, opts?: { fetchFn?: FetchLike; now?: () => number }) {
		super(PRICE_SERVICE_NAME, logger)
		this.cache = browserApi
			? new ValueStorage<PriceState>(CACHE_STORAGE_KEY, browserApi.storage.local)
			: new ValueStorage<PriceState>(CACHE_STORAGE_KEY, chrome.storage.local)
		this.alarms = browserApi ? browserApi.alarms : new ChromeAlarmsFallback()
		this.fetchFn = opts?.fetchFn ?? ((input, init) => fetch(input, init))
		this.now = opts?.now ?? (() => Date.now())
	}

	protected async init(services: ServiceCollection): Promise<void> {
		this.configService = services.get(ConfigService.name)
		this.profileService = services.get(ProfileService.name)

		this.configService.onUpdate.add(this.onConfigUpdated)
		this.profileService.onActiveProfileChanged.add(this.onActiveProfileChanged)

		// Boot reconcile: the alarm must exist iff a session is unlocked AND
		// fiat display is enabled. A stray alarm from a previous SW lifetime
		// (lock happened while the SW was dead) gets cleared here.
		const enabled = await this.isEnabled()
		const profile = await this.profileService.getActiveProfile()
		if (enabled && profile) {
			await this.ensureAlarm()
		} else {
			await this.alarms.clear(PRICE_REFRESH_ALARM_NAME)
		}
	}

	// ── RPC surface ─────────────────────────────────────────────────────

	/** Usable quotes only: validated, fresh, and fiat display enabled. */
	public async getQuotes(): Promise<PriceState> {
		await this.ensureInitialized()
		if (!(await this.isEnabled())) return {}
		return this.readUsable()
	}

	/** Refresh when the cache is stale (popup-connect path), then return usable quotes. */
	public async refreshIfStale(): Promise<PriceState> {
		// Generation is captured BEFORE any await: a kill-switch flip while we
		// were reading config/cache must abort the refresh — capturing at
		// refresh() time would sample the post-flip generation and pass.
		const gen = this.generation
		await this.ensureInitialized()
		if (!(await this.isEnabled())) return {}
		const usable = await this.readUsable()
		if (allCoingeckoIds().every((id) => id in usable)) return usable
		// Incomplete cache: refetch only if we haven't completed a fetch
		// within the refresh period — a permanently-missing id must not turn
		// every component mount into a network request.
		if (this.now() - this.lastCompletedFetchAt < PRICE_REFRESH_PERIOD_MINUTES * 60_000) return usable
		return await this.refresh(gen)
	}

	// ── SW-internal surface ─────────────────────────────────────────────

	/**
	 * Cache-or-nothing read for SW-side consumers (fee executors). NEVER
	 * triggers a fetch — a request fired at transaction time would leak
	 * transaction timing to the network.
	 */
	public async getUsableQuote(coingeckoId: string): Promise<PriceQuote | undefined> {
		await this.ensureInitialized()
		if (!(await this.isEnabled())) return undefined
		return (await this.readUsable())[coingeckoId]
	}

	/** Alarm tick entry point — dispatched by the SW shell's module-scope
	 *  alarm listener (see wallet/index.ts). Not subscribed here to keep a
	 *  single dispatch path. */
	public async onAlarmTick(): Promise<void> {
		const gen = this.generation
		await this.ensureInitialized()
		if (!(await this.isEnabled())) {
			// Reconcile: a stray alarm surviving a missed kill-switch cleanup
			// must not tick forever.
			await this.alarms.clear(PRICE_REFRESH_ALARM_NAME)
			return
		}
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			// Locked while the alarm survived (e.g. lock raced the clear) —
			// reconcile instead of fetching.
			await this.alarms.clear(PRICE_REFRESH_ALARM_NAME)
			return
		}
		await this.refresh(gen).catch(() => {
			// refresh() already logged; alarm ticks must never throw.
		})
	}

	// ── Session / config wiring ─────────────────────────────────────────

	private readonly onActiveProfileChanged = (profile: ProfileInfo | undefined): void => {
		const gen = this.generation
		void (async () => {
			if (!(await this.isEnabled())) return
			if (profile) {
				await this.ensureAlarm()
				await this.refresh(gen).catch(() => {})
			} else {
				await this.alarms.clear(PRICE_REFRESH_ALARM_NAME)
			}
		})().catch((err) => this.log(LogLevel.Warn, "profile-change handling failed", getErrorMessage(err)))
	}

	private readonly onConfigUpdated = (prop: { key: string; value: unknown }): void => {
		if (prop.key !== "showFiatValues") return
		const enable = prop.value !== false
		// Bump SYNCHRONOUSLY so an in-flight refresh from the prior state is
		// invalidated immediately (its generation check now fails). Both directions
		// bump — a flip is a flip.
		this.generation += 1
		const myGen = this.generation
		if (!enable) {
			// Neutralize any in-flight refresh SYNCHRONOUSLY (outside the chain, and
			// even when this disable is later superseded): `refresh()` shares
			// `this.inflight` BEFORE its generation check, so a following enable would
			// otherwise adopt this stale run and never start a fresh fetch.
			this.abortController?.abort()
			this.inflight = undefined
		}
		// Chain the cache-committing tail so transitions run strictly one-at-a-time:
		// a disable's cache.delete can never interleave with an enable's cache.set.
		this.configTransition = this.configTransition
			.then(async () => {
				// A newer flip already superseded this one — the newest intent is the
				// truth, so skip this transition's storage/emit work wholesale.
				if (this.generation !== myGen) return
				if (!enable) {
					await this.alarms.clear(PRICE_REFRESH_ALARM_NAME)
					await this.cache.delete()
					this.emit("onQuotesUpdated", {})
				} else {
					const profile = await this.profileService.getActiveProfile()
					if (profile) {
						await this.ensureAlarm()
						await this.refresh(myGen).catch(() => {})
					}
				}
			})
			.catch((err) => this.log(LogLevel.Warn, "config-change handling failed", getErrorMessage(err)))
	}

	// ── Internals ───────────────────────────────────────────────────────

	private async isEnabled(): Promise<boolean> {
		return (await this.configService.getValue("showFiatValues")) === true
	}

	private async ensureAlarm(): Promise<void> {
		await this.alarms.create(PRICE_REFRESH_ALARM_NAME, { periodInMinutes: PRICE_REFRESH_PERIOD_MINUTES })
	}

	/** Read the cache and keep only entries that still validate and are fresh.
	 *  Read-time validation matters: `chrome.storage.local` is writable from
	 *  other extension contexts, so write-time checks alone are not a boundary. */
	private async readUsable(): Promise<PriceState> {
		let stored: PriceState | undefined
		try {
			stored = await this.cache.get()
		} catch {
			return {}
		}
		if (!stored || typeof stored !== "object") return {}
		const now = this.now()
		const usable: PriceState = {}
		for (const [id, quote] of Object.entries(stored)) {
			if (!this.isValidQuote(id, quote)) continue
			if (!isQuoteFresh(quote, now)) continue
			usable[id] = quote
		}
		return usable
	}

	private isValidQuote(id: string, quote: unknown): quote is PriceQuote {
		if (!quote || typeof quote !== "object") return false
		const q = quote as Partial<PriceQuote>
		if (q.coingeckoId !== id) return false
		if (typeof q.usd !== "number" || !Number.isFinite(q.usd) || q.usd <= 0) return false
		if (typeof q.fetchedAt !== "number" || !Number.isFinite(q.fetchedAt)) return false
		// Future-dated entries are rejected as INVALID (not merely stale):
		// they would out-"fresh" every legitimate quote forever and win every
		// monotonic merge, so an attacker-planted cache row could never be
		// repaired by refreshes.
		if (q.fetchedAt > this.now() + MAX_CLOCK_SKEW_MS) return false
		if (q.providerUpdatedAt !== null && (typeof q.providerUpdatedAt !== "number" || !Number.isFinite(q.providerUpdatedAt))) return false
		const band = getSanityBand(id)
		if (!band) return false
		return q.usd >= band.min && q.usd <= band.max
	}

	/** Serialized refresh: concurrent callers share one in-flight request.
	 *  `gen` is the caller's ENTRY-time generation — a kill-switch flip after
	 *  the caller started (but before the fetch) must abort. */
	private refresh(gen = this.generation): Promise<PriceState> {
		if (this.inflight) return this.inflight
		if (gen !== this.generation) return Promise.resolve({})
		const run = this.doRefresh(gen).finally(() => {
			// Clear ONLY if we're still the current in-flight run: a kill-switch
			// restart may have replaced `this.inflight` with a newer refresh, and
			// clearing that would let a third caller start a duplicate fetch.
			if (this.inflight === run) this.inflight = undefined
		})
		this.inflight = run
		return run
	}

	private async doRefresh(gen: number): Promise<PriceState> {
		const now = this.now()
		if (now < this.nextAllowedFetchAt) {
			this.log(LogLevel.Debug, "refresh suppressed by backoff window")
			return this.readUsable()
		}

		const ids = allCoingeckoIds()
		const url = `${API_BASE}/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_last_updated_at=true`
		const apiKey = import.meta.env.VITE_COINGECKO_API_KEY as string | undefined
		const headers: Record<string, string> = apiKey ? { "x-cg-demo-api-key": apiKey } : {}

		if (gen !== this.generation) return {}
		// Own the controller + timeout LOCALLY. A kill-switch restart installs a
		// newer refresh's controller into `this.abortController`; a shared closure
		// or an unconditional `finally` clear would then abort — or orphan — the
		// wrong fetch. Only touch the shared field to publish ourselves and, in
		// `finally`, to retract ourselves iff we're still the one published.
		const controller = new AbortController()
		this.abortController = controller
		const timeout = setTimeout(() => controller.abort(), 10_000)
		try {
			const response = await this.fetchFn(url, { signal: controller.signal, headers })
			if (!response.ok) {
				throw new Error(`price fetch failed: HTTP ${response.status}`)
			}
			const body = await response.json()
			if (gen !== this.generation) return {}

			const fetchedAt = this.now()
			const incoming = this.parseResponse(body, fetchedAt)
			if (Object.keys(incoming).length === 0) {
				throw new Error("price fetch returned no valid quotes")
			}

			const merged = await this.mergeMonotonic(incoming)
			if (gen !== this.generation) return {}
			await this.cache.set(merged)
			// A kill-switch flip DURING the cache write invalidates this run: don't
			// reset the backoff, refresh the watermark, or re-emit for a dead
			// generation (a stale success must not silence a newer disable's
			// protections). Leave the cache to the owning generation — deleting here
			// could wipe a newer refresh's fresh write; while disabled the row is
			// never read (every reader gates on isEnabled).
			if (gen !== this.generation) return {}
			this.consecutiveFailures = 0
			this.nextAllowedFetchAt = 0
			this.lastCompletedFetchAt = this.now()

			const usable = await this.readUsable()
			if (gen !== this.generation) return {}
			this.emit("onQuotesUpdated", usable)
			return usable
		} catch (error) {
			if (gen !== this.generation) return {}
			this.consecutiveFailures += 1
			const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1), BACKOFF_CAP_MS)
			const jitter = 0.75 + Math.random() * 0.5
			this.nextAllowedFetchAt = this.now() + Math.round(backoff * jitter)
			this.log(LogLevel.Warn, `refresh failed (attempt ${this.consecutiveFailures})`, getErrorMessage(error))
			return this.readUsable()
		} finally {
			clearTimeout(timeout)
			// Retract only our own controller — a newer refresh may have published its own.
			if (this.abortController === controller) this.abortController = undefined
		}
	}

	/** Validate the provider response per-id; invalid entries are dropped, never stored. */
	private parseResponse(body: unknown, fetchedAt: number): PriceState {
		const out: PriceState = {}
		if (!body || typeof body !== "object") return out
		for (const id of allCoingeckoIds()) {
			const row = (body as Record<string, unknown>)[id]
			if (!row || typeof row !== "object") continue
			const usd = (row as Record<string, unknown>).usd
			const lastUpdated = (row as Record<string, unknown>).last_updated_at
			const providerUpdatedAt = typeof lastUpdated === "number" && Number.isFinite(lastUpdated) ? lastUpdated * 1000 : null
			const quote: PriceQuote = {
				coingeckoId: id,
				usd: typeof usd === "number" ? usd : Number.NaN,
				fetchedAt,
				providerUpdatedAt,
			}
			if (this.isValidQuote(id, quote)) {
				out[id] = quote
			}
		}
		return out
	}

	/** Merge incoming quotes over stored ones; a newer stored entry is never
	 *  overwritten by an older response (late-arriving fetches). */
	private async mergeMonotonic(incoming: PriceState): Promise<PriceState> {
		let stored: PriceState | undefined
		try {
			stored = await this.cache.get()
		} catch {
			stored = undefined
		}
		const merged: PriceState = {}
		for (const [id, quote] of Object.entries(stored ?? {})) {
			if (this.isValidQuote(id, quote)) merged[id] = quote
		}
		for (const [id, quote] of Object.entries(incoming)) {
			const existing = merged[id]
			if (existing && existing.fetchedAt > quote.fetchedAt) continue
			merged[id] = quote
		}
		return merged
	}

	private log(level: LogLevel, ...args: unknown[]): void {
		this.logger.log(LOG_SOURCE, level, ...args)
	}
}

/** Direct-chrome fallback used when the composition root doesn't inject a
 *  BrowserApi (legacy path, mirrors ContactService's storage fallback). */
class ChromeAlarmsFallback implements AlarmsPort {
	public async create(name: string, options: AlarmCreateOptions): Promise<void> {
		await chrome.alarms.create(name, options)
	}
	public async clear(name: string): Promise<boolean> {
		return await chrome.alarms.clear(name)
	}
	public onAlarm(listener: (alarm: AlarmEvent) => void): Unsubscribe {
		const wrapped = (alarm: chrome.alarms.Alarm) => listener({ name: alarm.name, scheduledTime: alarm.scheduledTime })
		chrome.alarms.onAlarm.addListener(wrapped)
		return () => chrome.alarms.onAlarm.removeListener(wrapped)
	}
}
