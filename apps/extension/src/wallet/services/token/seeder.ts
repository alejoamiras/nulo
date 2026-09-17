import type { MinimalStorageArea } from "@nulo/wallet-core/storage"
import { ValueStorage } from "@/wallet/storage"
import { LogLevel } from "@nulo/wallet-core/logger"
import type { ILogger } from "@/wallet/logger"
import type { DefaultTokenSeed } from "./default-tokens"
import type { SeedScope, SeedStatus, SeedStatusEntry, SeedStatusSnapshot, TokenInterface } from "./spec"

const LOG_SOURCE = "TokenSeeder"

/** Thrown by `parseTokenInterface` when a seed's TOFU pin fails — the seeder
 *  hard-skips (attempt stays counted) instead of retrying a hostile answer. */
export class PinMismatchError extends Error {
	public constructor(message: string) {
		super(`seed pin mismatch: ${message}`)
		this.name = "PinMismatchError"
	}
}

/** Failed attempts per entry before the seeder stops retrying — until the
 *  next extension version, which resets the cap (each release gets one fresh
 *  round, so transient RPC failures never permanently kill a default token). */
export const SEED_ATTEMPT_CAP = 3

/** Wait before the seeder retries a failed attempt on its own, indexed by the
 *  attempts already made. Bounded by the cap, so a dead node costs three tries. */
export const SEED_CONTINUATION_DELAYS_MS: readonly number[] = [15_000, 60_000]
const MAX_CONTINUATION_DELAY_MS = 60_000
/** Floor under every continuation timer, so no unforeseen non-consuming pass can spin. */
const MIN_CONTINUATION_DELAY_MS = 1_000

/** Metadata bounds (seeding is zero-interaction — no preview popup guards it). */
const NAME_MAX_LENGTH = 80
const SYMBOL_MAX_LENGTH = 32
const DECIMALS_MAX = 18

export type SeedMarkerEntry = {
	attempts: number
	/** Extension version active when `attempts` hit the cap. */
	cappedAtVersion?: string
	/** Extension version under which a pin or metadata bound rejected this seed.
	 *  Not retried until the version changes — a seed-list fix ships in a release. */
	rejectedAtVersion?: string
	/** When the seeder may try again by itself. Written WITH the attempt, before
	 *  the slow work, so a service worker that dies mid-attempt still resumes. */
	nextAttemptAt?: number
	/** Terminal outcomes. `deleted` is the user tombstone: it survives chain
	 *  purges — delete + network re-add must NOT resurrect the default. */
	outcome?: "seeded" | "deleted"
	/** Chain-observed decimals recorded at seed time (TOFU — see default-tokens.ts). */
	observedDecimals?: number
}

type SeedMarkerState = Record<string, SeedMarkerEntry>

/** One seeding pass's captured context: the profile/network it was resolved
 *  against and the lifecycle guard bound to that capture. */
type SeedPassContext = {
	epoch: number
	profile: { id: string }
	network: { id: string; chainId: number }
	seeds: readonly DefaultTokenSeed[]
	account: { address: string } | undefined
	state: SeedMarkerState
	version: string
	guardsHold: () => Promise<boolean>
}

/** Status of one default, or `undefined` once it is settled (seeded or user-deleted). */
export function deriveSeedStatus(entry: SeedMarkerEntry, version: string, inFlight: boolean): SeedStatus | undefined {
	if (entry.outcome !== undefined) return undefined
	if (entry.rejectedAtVersion === version) return "rejected"
	// Before `failed`: the capping attempt records the cap BEFORE it runs.
	if (inFlight) return "seeding"
	if (entry.attempts >= SEED_ATTEMPT_CAP && entry.cappedAtVersion === version) return "failed"
	return "pending"
}

/** Sync skip checks for one marker entry; an entry stopped under an OLDER
 *  version gets one fresh round (mutated in place). False = skip this seed. */
function prepareSeedEntry(entry: SeedMarkerEntry, version: string, now: number): boolean {
	if (entry.outcome !== undefined) return false
	if (entry.rejectedAtVersion === version) return false
	if (entry.attempts >= SEED_ATTEMPT_CAP && entry.cappedAtVersion === version) return false
	if (entry.rejectedAtVersion !== undefined || entry.attempts >= SEED_ATTEMPT_CAP) {
		// New version → one fresh round.
		entry.attempts = 0
		entry.cappedAtVersion = undefined
		entry.rejectedAtVersion = undefined
		entry.nextAttemptAt = undefined
		return true
	}
	return entry.nextAttemptAt === undefined || entry.nextAttemptAt <= now
}

const isOptionalString = (v: unknown): v is string | undefined => v === undefined || typeof v === "string"

/** One hostile marker entry → a clean one, or `undefined` to drop it. A valid
 *  tombstone survives any other corrupt field: losing it resurrects a token. */
function parseMarkerEntry(raw: unknown, now: number): SeedMarkerEntry | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
	const e = raw as Record<string, unknown>
	if (e.outcome === "deleted") return { attempts: 0, outcome: "deleted" }
	if (typeof e.attempts !== "number" || !Number.isInteger(e.attempts) || e.attempts < 0) return undefined
	if (e.outcome !== undefined && e.outcome !== "seeded") return undefined
	if (!isOptionalString(e.cappedAtVersion) || !isOptionalString(e.rejectedAtVersion)) return undefined
	const entry: SeedMarkerEntry = {
		attempts: e.attempts,
		outcome: e.outcome,
		cappedAtVersion: e.cappedAtVersion,
		rejectedAtVersion: e.rejectedAtVersion,
	}
	if (typeof e.observedDecimals === "number") entry.observedDecimals = e.observedDecimals
	if (e.nextAttemptAt === undefined) return entry
	if (typeof e.nextAttemptAt !== "number" || !Number.isFinite(e.nextAttemptAt) || e.nextAttemptAt < 0) return undefined
	// Beyond the longest wait the seeder ever writes, the value is not the seeder's (or the clock
	// went back): due now. Not dropped — the wake path resumes only entries that carry a due time —
	// and not clamped, since a clamp relative to each read never comes due.
	entry.nextAttemptAt = e.nextAttemptAt <= now + MAX_CONTINUATION_DELAY_MS ? e.nextAttemptAt : 0
	return entry
}

export type SeedPreview = { name: string; symbol: string; decimals: number; interface: TokenInterface }

/**
 * Narrow seam over TokenService + collaborators, so the seeder is unit-testable
 * without the PXE/simulation stack.
 */
export interface TokenSeederDeps {
	/** Resolved once per pass. Production returns `DEFAULT_TOKEN_SEEDS`; armed
	 *  e2e builds return a storage-backed list the running test writes. */
	getSeeds(): Promise<readonly DefaultTokenSeed[]>
	getActiveProfile(): Promise<{ id: string } | undefined>
	getActiveNetwork(): Promise<{ id: string; chainId: number } | null>
	getAccounts(profileId: string, chainId: number): Promise<{ address: string }[]>
	/** Single-pass parse + metadata simulation with the TOFU pin enforced ON
	 *  the fetched instance BEFORE anything registers in the PXE (throws
	 *  `PinMismatchError`). The returned interface derives from the same
	 *  fetch that passed the pin — no refetch window. */
	preview(networkId: string, accountAddress: string, contract: string, expectedClassId: string): Promise<SeedPreview>
	isTokenPresent(profileId: string, chainId: number, contract: string): Promise<boolean>
	/** Persist the EXACT validated snapshot — no internal metadata re-fetch. */
	persist(input: {
		profileId: string
		networkId: string
		accountAddress: string
		tokenInterface: TokenInterface
		name: string
		symbol: string
		decimals: number
	}): Promise<void>
	/** Fired only when a scope's derived statuses differ from the last ones announced. */
	onStatusChanged(scope: SeedScope): void
}

/**
 * Lazy default-token seeder. Runs after unlock / network-ready; single-flight;
 * every validation failure is a hard skip (nothing persisted or journaled).
 * See `default-tokens.ts` for the trust model.
 */
export class TokenSeeder {
	private readonly deps: TokenSeederDeps
	private readonly storageArea: MinimalStorageArea
	private readonly logger: ILogger
	private readonly getVersion: () => string
	private inflight: Promise<void> | undefined
	private markerLock: Promise<void> = Promise.resolve()
	/** Bumped by every external purge (profile deletion, chain purge). An
	 *  in-flight pass re-checks it before every write and aborts on change —
	 *  a pass captured against state that a purge since erased must not
	 *  resurrect tokens, journal rows, or the marker blob. */
	private epoch = 0
	/** A trigger arriving while a pass is in flight coalesces into it — but the
	 *  new trigger may be for a DIFFERENT profile/network. Run once more after
	 *  the pass so the coalesced context is never silently skipped (an extra
	 *  pass over settled markers is read-only + cheap). */
	private rerunRequested = false
	/** `${profileId}|${seedKey}` of every attempt currently running. */
	private readonly attempting = new Set<string>()
	/** Accepted retries whose pass has not reached the seed yet — what makes a
	 *  second retry of the same default a no-op instead of a second counter reset. */
	private readonly reserved = new Set<string>()
	/** Scopes `ensureSeeding` already kicked in this service-worker lifetime. */
	private readonly kicked = new Set<string>()
	private readonly lastAnnounced = new Map<string, string>()
	private continuation: ReturnType<typeof setTimeout> | undefined
	private armGeneration = 0
	private disposed = false

	public constructor(deps: TokenSeederDeps, storageArea: MinimalStorageArea, logger: ILogger, getVersion?: () => string) {
		this.deps = deps
		this.storageArea = storageArea
		this.logger = logger
		this.getVersion = getVersion ?? (() => chrome.runtime.getManifest().version)
	}

	/** Coalesce concurrent triggers (unlock + network-ready can race). */
	public run(): Promise<void> {
		if (this.inflight) {
			this.rerunRequested = true
			return this.inflight
		}
		let threw = false
		this.inflight = this.doRun()
			.catch((err) => {
				threw = true
				this.log(LogLevel.Warn, "seed pass threw", { category: errorCategory(err) })
			})
			.finally(() => {
				this.inflight = undefined
				if (this.rerunRequested) {
					this.rerunRequested = false
					void this.run()
					return
				}
				// A pass that threw may have consumed no attempt, leaving the same entry overdue:
				// the longest wait keeps a persistent storage fault from re-running it every second.
				void this.armContinuation(threw ? MAX_CONTINUATION_DELAY_MS : MIN_CONTINUATION_DELAY_MS)
			})
		return this.inflight
	}

	/**
	 * Not-yet-seeded defaults of the active profile on `chainId` (default: the active network's),
	 * with the scope they were read for. The popup names the chain because it switches its own view
	 * BEFORE this worker's active network follows; the profile is always this worker's. Reads only.
	 */
	public async getStatus(chainId?: number): Promise<SeedStatusSnapshot> {
		const profile = await this.deps.getActiveProfile()
		if (!profile) return { scope: undefined, entries: [] }
		const chain = chainId ?? (await this.deps.getActiveNetwork())?.chainId
		if (chain === undefined) return { scope: undefined, entries: [] }
		return { scope: { profileId: profile.id, chainId: chain }, entries: await this.statusFor(profile.id, chain) }
	}

	/**
	 * Recovery kick for a `pending` default nobody is working on (the service
	 * worker died mid-seeding and no trigger will fire again). Latched per scope
	 * for this service-worker lifetime, and only once an account exists: a
	 * zero-account pass consumes nothing, so an unlatched caller would loop on it.
	 */
	public async ensureSeeding(): Promise<void> {
		const profile = await this.deps.getActiveProfile()
		if (!profile) return
		const network = await this.deps.getActiveNetwork()
		if (!network) return
		const scope = scopeKey(profile.id, network.chainId)
		if (this.kicked.has(scope) || this.inflight) return
		if ((await this.deps.getAccounts(profile.id, network.chainId)).length === 0) return
		const entries = await this.statusFor(profile.id, network.chainId)
		if (!entries.some((e) => e.status === "pending")) return
		// Re-checked after the awaits: two callers must start one pass, not two.
		if (this.kicked.has(scope) || this.inflight) return
		this.kicked.add(scope)
		void this.run()
	}

	/**
	 * Fresh round of attempts for a `failed` default; `false` when refused. The
	 * whole decision — scope, membership, status, reservation, counter reset — is
	 * one marker-lock critical section, so two simultaneous retries accept one.
	 * The pass starts AFTER the lock is released: its own marker writes queue on it.
	 */
	public async retry(chainId: number, contract: string): Promise<boolean> {
		const epoch = this.epoch
		const key = seedKey(chainId, contract)
		const accepted = await this.withMarkerLock(async () => {
			const profile = await this.deps.getActiveProfile()
			const network = await this.deps.getActiveNetwork()
			if (!profile || network?.chainId !== chainId) return undefined
			const flight = flightKey(profile.id, key)
			if (this.reserved.has(flight)) return undefined
			const entries = await this.statusFor(profile.id, chainId)
			if (entries.find((e) => seedKey(e.chainId, e.contract) === key)?.status !== "failed") return undefined
			if (this.epoch !== epoch) return undefined
			const state = await this.readMarkerState(profile.id)
			state[key] = { attempts: 0 }
			await this.markerStorage(profile.id).set(state)
			this.reserved.add(flight)
			return { profileId: profile.id, flight }
		})
		if (!accepted) return false
		void this.announce(accepted.profileId, chainId)
		void this.runUntilIdle().finally(() => this.reserved.delete(accepted.flight))
		return true
	}

	/** Re-arms a persisted continuation — the wake path of a fresh service worker. */
	public resume(): Promise<void> {
		return this.armContinuation()
	}

	/** Stops self-scheduled retries for good. A pass already running still finishes. */
	public dispose(): void {
		this.disposed = true
		this.clearContinuation()
	}

	/** User deleted a seeded token → permanent tombstone (survives chain purges). */
	public async markDeletedByUser(profileId: string, chainId: number, contract: string): Promise<void> {
		await this.updateMarker(profileId, seedKey(chainId, contract), () => ({ attempts: 0, outcome: "deleted" }))
		await this.announce(profileId, chainId)
	}

	/**
	 * Serialize ALL marker mutations behind one promise chain: a re-read alone
	 * is not atomic — two interleaved read-modify-writes (a user deletion racing
	 * a seed pass's final write) could both read the pre-delete blob and the
	 * later write would resurrect the tombstone.
	 */
	private withMarkerLock<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.markerLock.then(fn)
		this.markerLock = run.then(
			() => undefined,
			() => undefined,
		)
		return run
	}

	/**
	 * Read-modify-write for ONE marker entry: every write re-reads the latest
	 * blob (never persists a stale whole-state snapshot) and a `deleted`
	 * tombstone is never clobbered by a concurrent seed pass finishing late.
	 * A pass hands in its captured `epoch`, checked INSIDE the lock: a purge
	 * bumps it before queueing here, so a write queued behind that purge is
	 * dropped instead of recreating the blob the purge just removed.
	 */
	private updateMarker(
		profileId: string,
		key: string,
		update: (existing: SeedMarkerEntry) => SeedMarkerEntry,
		epoch?: number,
	): Promise<void> {
		return this.withMarkerLock(async () => {
			if (epoch !== undefined && this.epoch !== epoch) return
			const state = await this.readMarkerState(profileId)
			const existing = state[key] ?? { attempts: 0 }
			const next = update(existing)
			if (existing.outcome === "deleted" && next.outcome !== "deleted") return
			state[key] = next
			await this.markerStorage(profileId).set(state)
		})
	}

	/** Chain purge: fresh chain, fresh attempts — but user tombstones survive. */
	public onChainPurged(profileId: string, chainId: number): Promise<void> {
		this.invalidate((scope) => scope === scopeKey(profileId, chainId))
		return this.withMarkerLock(async () => {
			const state = await this.readMarkerState(profileId)
			let changed = false
			for (const [key, entry] of Object.entries(state)) {
				if (!key.startsWith(`${chainId}:`)) continue
				if (entry.outcome === "deleted") continue
				delete state[key]
				changed = true
			}
			if (changed) await this.markerStorage(profileId).set(state)
		})
	}

	/** Profile deletion cascade: drop the whole marker blob. */
	public purgeForProfile(profileId: string): Promise<void> {
		this.invalidate((scope) => scope.startsWith(`${profileId}|`))
		return this.withMarkerLock(() => this.markerStorage(profileId).delete())
	}

	/** A purge fences every in-flight pass (epoch) and forgets what this lifetime
	 *  knew about the purged scopes, so a re-added chain is kicked and announced anew. */
	private invalidate(purged: (scope: string) => boolean): void {
		this.epoch += 1
		// Re-armed, not just cleared: the purged scope may not be the active one,
		// and no trigger follows a purge to restore the active scope's timer.
		void this.armContinuation()
		for (const scope of [...this.kicked]) if (purged(scope)) this.kicked.delete(scope)
		for (const scope of [...this.lastAnnounced.keys()]) if (purged(scope)) this.lastAnnounced.delete(scope)
	}

	private async doRun(): Promise<void> {
		const ctx = await this.resolveSeedContext()
		if (!ctx) return
		const now = Date.now()
		for (const seed of ctx.seeds) {
			const key = seedKey(seed.chainId, seed.contract)
			const entry = { ...(ctx.state[key] ?? { attempts: 0 }) }
			if (!prepareSeedEntry(entry, ctx.version, now)) continue
			if ((await this.seedOne(ctx, seed, key, entry)) === "abort") return
		}
	}

	/** The pass prelude — profile, network, the chain's seed list, the first
	 *  account, the marker blob, the version — plus the lifecycle guard BOUND to
	 *  this capture. `undefined` = nothing to do this pass. */
	private async resolveSeedContext(): Promise<SeedPassContext | undefined> {
		const epoch = this.epoch
		const profile = await this.deps.getActiveProfile()
		if (!profile) return undefined
		const network = await this.deps.getActiveNetwork()
		if (!network) return undefined
		// Resolved per pass, not at construction: the e2e source reads a list the
		// test writes after deploying its per-run token. A purge landing during
		// this await can only make the READ stale — every write below is fenced
		// by `guardsHold`, which re-checks the epoch.
		const seeds = (await this.deps.getSeeds()).filter((s) => s.chainId === network.chainId)
		if (seeds.length === 0) return undefined

		/** Lifecycle guard, re-checked before EVERY write: the pass's captured
		 *  profile/network must still be current, and no purge may have run
		 *  since — a paused pass resuming after a profile deletion (or switch,
		 *  or chain purge) must not resurrect tokens or the marker blob. */
		const guardsHold = async (): Promise<boolean> => {
			if (this.epoch !== epoch) return false
			const activeProfile = await this.deps.getActiveProfile()
			if (activeProfile?.id !== profile.id) return false
			const activeNetwork = await this.deps.getActiveNetwork()
			if (activeNetwork?.chainId !== network.chainId) return false
			// Re-check AFTER the awaited reads: a purge landing while we were
			// awaiting them would otherwise pass a guard that sampled the
			// epoch before it happened.
			return this.epoch === epoch
		}

		const accounts = await this.deps.getAccounts(profile.id, network.chainId)
		const account = accounts[0]

		const state = await this.readMarkerState(profile.id)
		const version = this.getVersion()
		return { epoch, profile, network, seeds, account, state, version, guardsHold }
	}

	/** One seed's pass, entered only after the sync skip checks — its first op is
	 *  the awaited presence read, so the caller's await replaces its own. "abort"
	 *  ends the whole pass (a lifecycle guard tripped). */
	private async seedOne(
		ctx: SeedPassContext,
		seed: DefaultTokenSeed,
		key: string,
		entry: SeedMarkerEntry,
	): Promise<"continue" | "abort"> {
		const { profile, account, guardsHold } = ctx
		if (await this.deps.isTokenPresent(profile.id, seed.chainId, seed.contract)) {
			if (!(await guardsHold())) return "abort"
			await this.updateMarker(
				profile.id,
				key,
				(existing) => ({ ...existing, outcome: "seeded", nextAttemptAt: undefined }),
				ctx.epoch,
			)
			await this.announce(profile.id, seed.chainId)
			return "continue"
		}

		// Zero accounts on this chain: metadata simulation is impossible.
		// Skip WITHOUT consuming an attempt; retried on the next trigger.
		if (!account) return "continue"

		if (!(await guardsHold())) return "abort"
		// Marked synchronously, BEFORE the attempt write queues on the marker lock:
		// a retry deciding inside that lock then always sees work already started.
		const flight = flightKey(profile.id, key)
		this.attempting.add(flight)
		this.reserved.delete(flight)
		try {
			return await this.attemptSeed(ctx, seed, key, entry, account)
		} finally {
			this.attempting.delete(flight)
			await this.announce(profile.id, seed.chainId)
		}
	}

	private async attemptSeed(
		ctx: SeedPassContext,
		seed: DefaultTokenSeed,
		key: string,
		entry: SeedMarkerEntry,
		account: { address: string },
	): Promise<"continue" | "abort"> {
		const { profile, network, version, guardsHold } = ctx
		// Attempt recorded BEFORE the risky work — a SW death mid-attempt
		// still counts toward the cap (no infinite crash-retry loops).
		entry.attempts += 1
		const capped = entry.attempts >= SEED_ATTEMPT_CAP
		if (capped) entry.cappedAtVersion = version
		entry.nextAttemptAt = capped ? undefined : Date.now() + continuationDelay(entry.attempts)
		await this.updateMarker(profile.id, key, () => ({ ...entry }), ctx.epoch)
		await this.announce(profile.id, seed.chainId)

		try {
			const preview = await this.previewOne(seed, key, network.id, account.address)
			if (!preview) {
				// A pin or bound rejected the answer: not retried under this version.
				await this.updateMarker(
					profile.id,
					key,
					(existing) => ({ ...existing, rejectedAtVersion: version, nextAttemptAt: undefined }),
					ctx.epoch,
				)
				return "continue"
			}
			// Lifecycle guard first: a purge or switch during the slow
			// preview aborts the whole pass.
			if (!(await guardsHold())) return "abort"
			const committed = await this.commitSeedResult(ctx, account, key, preview)
			if (!committed && this.epoch !== ctx.epoch) return "abort"
		} catch (err) {
			// Transient failure (network down, RPC error): attempt counted; the
			// continuation (or the next trigger) retries until the cap.
			this.log(LogLevel.Warn, "seed attempt failed", { seedKey: key, attempts: entry.attempts, category: errorCategory(err) })
		}
		return "continue"
	}

	/** COMMIT happens inside ONE marker-lock critical section: tombstone
	 *  re-check, persist, and the seeded-marker write are indivisible against
	 *  concurrent marker mutations. Purges bump the epoch BEFORE queueing on this
	 *  same lock, so either we see the bump and abort, or our whole commit lands
	 *  before the purge's cleanup (which then sweeps it) — no resurrection window
	 *  either way. Direct reads/writes here: updateMarker would re-acquire the
	 *  lock and deadlock the promise chain — never decompose this block further. */
	private commitSeedResult(ctx: SeedPassContext, account: { address: string }, key: string, preview: SeedPreview): Promise<boolean> {
		const { profile, network, epoch } = ctx
		return this.withMarkerLock(async () => {
			if (this.epoch !== epoch) return false
			const latest = await this.readMarkerState(profile.id)
			if (latest[key]?.outcome === "deleted") return false
			await this.deps.persist({
				profileId: profile.id,
				networkId: network.id,
				accountAddress: account.address,
				tokenInterface: preview.interface,
				name: preview.name,
				symbol: preview.symbol,
				decimals: preview.decimals,
			})
			const state = await this.readMarkerState(profile.id)
			const existing = state[key] ?? { attempts: 0 }
			state[key] = { ...existing, outcome: "seeded", observedDecimals: preview.decimals, nextAttemptAt: undefined }
			await this.markerStorage(profile.id).set(state)
			return true
		})
	}

	/**
	 * One seed's single-pass validated snapshot: the pin is enforced INSIDE
	 * `parseTokenInterface` on the one fetched instance (before any PXE
	 * registration) and the metadata simulates against THAT interface. The
	 * caller persists the exact returned snapshot — no refetch window anywhere.
	 * Returns undefined on a validation hard-skip.
	 */
	private async previewOne(
		seed: DefaultTokenSeed,
		key: string,
		networkId: string,
		accountAddress: string,
	): Promise<SeedPreview | undefined> {
		let preview: SeedPreview
		try {
			preview = await this.deps.preview(networkId, accountAddress, seed.contract, seed.expectedClassId)
		} catch (err) {
			if (err instanceof PinMismatchError) {
				this.log(LogLevel.Warn, "seed rejected", { seedKey: key, category: "pin-mismatch" })
				return undefined
			}
			throw err
		}
		if (!this.metadataValid(seed, preview)) {
			this.log(LogLevel.Warn, "seed rejected", { seedKey: key, category: "metadata-bounds" })
			return undefined
		}
		return preview
	}

	private metadataValid(seed: DefaultTokenSeed, preview: SeedPreview): boolean {
		if (preview.symbol !== seed.expectedSymbol) return false
		if (preview.name.length === 0 || preview.name.length > NAME_MAX_LENGTH) return false
		if (preview.symbol.length > SYMBOL_MAX_LENGTH) return false
		if (!Number.isInteger(preview.decimals) || preview.decimals < 0 || preview.decimals > DECIMALS_MAX) return false
		return true
	}

	private async statusFor(profileId: string, chainId: number): Promise<SeedStatusEntry[]> {
		const seeds = (await this.deps.getSeeds()).filter((s) => s.chainId === chainId)
		if (seeds.length === 0) return []
		const state = await this.readMarkerState(profileId)
		const version = this.getVersion()
		const entries: SeedStatusEntry[] = []
		for (const seed of seeds) {
			const key = seedKey(chainId, seed.contract)
			const status = deriveSeedStatus(state[key] ?? { attempts: 0 }, version, this.attempting.has(flightKey(profileId, key)))
			if (!status) continue
			entries.push({ chainId, contract: seed.contract, symbol: seed.expectedSymbol, displayName: seed.displayName, status })
		}
		return entries
	}

	/** Never throws: it runs in `finally` blocks and after user deletions. */
	private async announce(profileId: string, chainId: number): Promise<void> {
		try {
			const scope = scopeKey(profileId, chainId)
			const signature = (await this.statusFor(profileId, chainId)).map((e) => `${e.contract}=${e.status}`).join(",")
			if (this.lastAnnounced.get(scope) === signature) return
			this.lastAnnounced.set(scope, signature)
			this.deps.onStatusChanged({ profileId, chainId })
		} catch (err) {
			this.log(LogLevel.Debug, "seed status announce failed", { category: errorCategory(err) })
		}
	}

	/**
	 * One timer for the active scope's earliest due retry. Armed from the marker
	 * alone, so it resumes identically after a pass and in a fresh service worker.
	 * Only an attempt writes `nextAttemptAt`: a zero-account pass arms nothing,
	 * and with no account nothing is armed either — that pass would consume no
	 * attempt and re-arm an already-due timer forever.
	 */
	private async armContinuation(minDelayMs = MIN_CONTINUATION_DELAY_MS): Promise<void> {
		this.clearContinuation()
		if (this.disposed) return
		const generation = ++this.armGeneration
		try {
			const due = await this.earliestDueRetry()
			if (due === undefined || generation !== this.armGeneration) return
			const delay = Math.max(minDelayMs, due - Date.now())
			this.continuation = setTimeout(() => {
				this.continuation = undefined
				void this.run()
			}, delay)
		} catch (err) {
			this.log(LogLevel.Debug, "seed continuation not armed", { category: errorCategory(err) })
		}
	}

	private async earliestDueRetry(): Promise<number | undefined> {
		const profile = await this.deps.getActiveProfile()
		if (!profile) return undefined
		const network = await this.deps.getActiveNetwork()
		if (!network) return undefined
		const seeds = (await this.deps.getSeeds()).filter((s) => s.chainId === network.chainId)
		if (seeds.length === 0) return undefined
		if ((await this.deps.getAccounts(profile.id, network.chainId)).length === 0) return undefined
		const state = await this.readMarkerState(profile.id)
		const version = this.getVersion()
		let due: number | undefined
		for (const seed of seeds) {
			const entry = state[seedKey(seed.chainId, seed.contract)]
			if (entry?.nextAttemptAt === undefined) continue
			if (deriveSeedStatus(entry, version, false) !== "pending") continue
			due = Math.min(due ?? entry.nextAttemptAt, entry.nextAttemptAt)
		}
		return due
	}

	private clearContinuation(): void {
		this.armGeneration += 1
		if (this.continuation === undefined) return
		clearTimeout(this.continuation)
		this.continuation = undefined
	}

	/** Resolves once no pass is running or queued — a trigger that coalesced into
	 *  an in-flight pass is only served by the rerun that follows it. */
	private async runUntilIdle(): Promise<void> {
		await this.run()
		while (this.inflight) await this.inflight
	}

	private markerStorage(profileId: string): ValueStorage<SeedMarkerState> {
		return new ValueStorage<SeedMarkerState>(`nulo:core:token-seeded@${profileId}`, this.storageArea)
	}

	/**
	 * The marker blob lives in extension-shared storage — treat its shape as
	 * hostile. A non-object blob (e.g. `[]`, where assigned string keys are
	 * silently DROPPED by JSON.stringify) or a corrupt entry must neither
	 * throw (that would block token deletion from writing its tombstone) nor
	 * eat a tombstone write. Corrupt state resets to empty; corrupt entries
	 * are dropped.
	 */
	private async readMarkerState(profileId: string): Promise<SeedMarkerState> {
		let stored: unknown
		try {
			stored = await this.markerStorage(profileId).get()
		} catch {
			return {}
		}
		if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {}
		const state: SeedMarkerState = {}
		const now = Date.now()
		for (const [key, raw] of Object.entries(stored)) {
			const entry = parseMarkerEntry(raw, now)
			if (entry) state[key] = entry
		}
		return state
	}

	private log(level: LogLevel, ...args: unknown[]): void {
		this.logger.log(LOG_SOURCE, level, ...args)
	}
}

function seedKey(chainId: number, contract: string): string {
	return `${chainId}:${contract.toLowerCase()}`
}

function scopeKey(profileId: string, chainId: number): string {
	return `${profileId}|${chainId}`
}

function flightKey(profileId: string, key: string): string {
	return `${profileId}|${key}`
}

function continuationDelay(attempts: number): number {
	return SEED_CONTINUATION_DELAYS_MS[Math.min(attempts, SEED_CONTINUATION_DELAYS_MS.length) - 1] ?? MAX_CONTINUATION_DELAY_MS
}

/** An error's class name when it looks like one; `name` is writable, so anything else is "unknown". */
function errorCategory(err: unknown): string {
	return err instanceof Error && /^[A-Za-z]{1,40}$/.test(err.name) ? err.name : "unknown"
}
