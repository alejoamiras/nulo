import type { MinimalStorageArea } from "@nulo/wallet-core/storage"
import { ValueStorage } from "@/wallet/storage"
import { LogLevel } from "@nulo/wallet-core/logger"
import type { ILogger } from "@/wallet/logger"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { DefaultTokenSeed } from "./default-tokens"
import type { TokenInterface } from "./spec"

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

/** Metadata bounds (seeding is zero-interaction — no preview popup guards it). */
const NAME_MAX_LENGTH = 80
const SYMBOL_MAX_LENGTH = 32
const DECIMALS_MAX = 18

export type SeedMarkerEntry = {
	attempts: number
	/** Extension version active when `attempts` hit the cap. */
	cappedAtVersion?: string
	/** Terminal outcomes. `deleted` is the user tombstone: it survives chain
	 *  purges — delete + network re-add must NOT resurrect the default. */
	outcome?: "seeded" | "deleted"
	/** Chain-observed decimals recorded at seed time (TOFU — see default-tokens.ts). */
	observedDecimals?: number
}

type SeedMarkerState = Record<string, SeedMarkerEntry>

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
		this.inflight = this.doRun()
			.catch((err) => {
				this.log(LogLevel.Warn, "seed pass threw", getErrorMessage(err))
			})
			.finally(() => {
				this.inflight = undefined
				if (this.rerunRequested) {
					this.rerunRequested = false
					void this.run()
				}
			})
		return this.inflight
	}

	/** User deleted a seeded token → permanent tombstone (survives chain purges). */
	public async markDeletedByUser(profileId: string, chainId: number, contract: string): Promise<void> {
		await this.updateMarker(profileId, seedKey(chainId, contract), (existing) => ({
			...existing,
			attempts: 0,
			outcome: "deleted",
		}))
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
	 */
	private updateMarker(profileId: string, key: string, update: (existing: SeedMarkerEntry) => SeedMarkerEntry): Promise<void> {
		return this.withMarkerLock(async () => {
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
		this.epoch += 1
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
		this.epoch += 1
		return this.withMarkerLock(() => this.markerStorage(profileId).delete())
	}

	private async doRun(): Promise<void> {
		const epoch = this.epoch
		const profile = await this.deps.getActiveProfile()
		if (!profile) return
		const network = await this.deps.getActiveNetwork()
		if (!network) return
		// Resolved per pass, not at construction: the e2e source reads a list the
		// test writes after deploying its per-run token. A purge landing during
		// this await can only make the READ stale — every write below is fenced
		// by `guardsHold`, which re-checks the epoch.
		const seeds = (await this.deps.getSeeds()).filter((s) => s.chainId === network.chainId)
		if (seeds.length === 0) return

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

		for (const seed of seeds) {
			const key = seedKey(seed.chainId, seed.contract)
			const entry = { ...(state[key] ?? { attempts: 0 }) }

			if (entry.outcome === "deleted" || entry.outcome === "seeded") continue
			if (entry.attempts >= SEED_ATTEMPT_CAP && entry.cappedAtVersion === version) continue
			if (entry.attempts >= SEED_ATTEMPT_CAP) {
				// New version → one fresh round.
				entry.attempts = 0
				entry.cappedAtVersion = undefined
			}

			if (await this.deps.isTokenPresent(profile.id, seed.chainId, seed.contract)) {
				if (!(await guardsHold())) return
				await this.updateMarker(profile.id, key, (existing) => ({ ...existing, outcome: "seeded" }))
				continue
			}

			// Zero accounts on this chain: metadata simulation is impossible.
			// Skip WITHOUT consuming an attempt; retried on the next trigger.
			if (!account) continue

			if (!(await guardsHold())) return
			// Attempt recorded BEFORE the risky work — a SW death mid-attempt
			// still counts toward the cap (no infinite crash-retry loops).
			entry.attempts += 1
			if (entry.attempts >= SEED_ATTEMPT_CAP) entry.cappedAtVersion = version
			await this.updateMarker(profile.id, key, () => ({ ...entry }))

			try {
				const preview = await this.previewOne(seed, network.id, account.address)
				if (!preview) continue
				// Lifecycle guard first: a purge or switch during the slow
				// preview aborts the whole pass.
				if (!(await guardsHold())) return
				// COMMIT happens inside ONE marker-lock critical section:
				// tombstone re-check, persist, and the seeded-marker write are
				// indivisible against concurrent marker mutations. Purges bump
				// the epoch BEFORE queueing on this same lock, so either we see
				// the bump and abort, or our whole commit lands before the
				// purge's cleanup (which then sweeps it) — no resurrection
				// window either way. Direct reads/writes here: updateMarker
				// would re-acquire the lock and deadlock the promise chain.
				const committed = await this.withMarkerLock(async () => {
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
					state[key] = { ...existing, outcome: "seeded", observedDecimals: preview.decimals }
					await this.markerStorage(profile.id).set(state)
					return true
				})
				if (!committed && this.epoch !== epoch) return
				// preview === undefined → pin/bounds rejection: hard skip. The
				// attempt stays counted; the cap (or a version bump after a
				// seed-list fix) governs retries.
			} catch (err) {
				// Transient failure (network down, RPC error): attempt counted,
				// retried next trigger until the cap.
				this.log(LogLevel.Warn, `seed ${key} failed`, getErrorMessage(err))
			}
		}
	}

	/**
	 * One seed's single-pass validated snapshot: the pin is enforced INSIDE
	 * `parseTokenInterface` on the one fetched instance (before any PXE
	 * registration) and the metadata simulates against THAT interface. The
	 * caller persists the exact returned snapshot — no refetch window anywhere.
	 * Returns undefined on a validation hard-skip.
	 */
	private async previewOne(seed: DefaultTokenSeed, networkId: string, accountAddress: string): Promise<SeedPreview | undefined> {
		let preview: SeedPreview
		try {
			preview = await this.deps.preview(networkId, accountAddress, seed.contract, seed.expectedClassId)
		} catch (err) {
			if (err instanceof PinMismatchError) {
				this.log(LogLevel.Warn, `seed ${seed.contract}: ${getErrorMessage(err)} — hard skip`)
				return undefined
			}
			throw err
		}
		if (!this.metadataValid(seed, preview)) {
			this.log(LogLevel.Warn, `seed ${seed.contract}: metadata failed pins/bounds — hard skip`)
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
		for (const [key, entry] of Object.entries(stored)) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
			if (typeof (entry as SeedMarkerEntry).attempts !== "number") continue
			state[key] = entry as SeedMarkerEntry
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
