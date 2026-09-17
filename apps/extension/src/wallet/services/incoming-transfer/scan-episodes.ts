import type { StorageArea } from "@nulo/wallet-core/ports"
import { BACKOFF_CAP_MS, isScanFailure, isStalled, nextBackoffMs, type ScanEpisode, type ScanOutcome } from "./scan-health"

export const SCAN_EPISODES_KEY = "nulo:incoming:scan-episodes"

/** The backoff saturates long before this; the cap only keeps a stored count a safe integer. */
export const FAILURES_CAP = 1_000

/** An open failure episode. Healthy contracts have no entry at all. */
export interface StoredScanEpisode extends ScanEpisode {
	failingSince: number
	/** Earliest time the next scan may run; `0` = due now. */
	nextAttemptAt: number
}

/** The persisted shape: the open episodes, and the network prefixes whose stall was announced. */
interface StoredBlob {
	episodes: Record<string, StoredScanEpisode>
	announced: string[]
}

export function scanEpisodeKey(profileId: string, networkId: string, contract: string): string {
	return `${profileId}|${networkId}|${contract}`
}

export function scanEpisodeNetworkPrefix(profileId: string, networkId: string): string {
	return `${profileId}|${networkId}|`
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Validate one stored episode field by field. A streak that cannot be trusted (`failures`,
 *  `failingSince`) drops the entry — a fresh episode under-reports, it never invents a stall. A bad
 *  `nextAttemptAt` only loses its gate: due now, or clamped to the longest backoff from `now`. */
export function parseStoredEpisode(raw: unknown, now: number): StoredScanEpisode | undefined {
	if (!isRecord(raw)) return undefined
	const { failures, failingSince, nextAttemptAt } = raw
	if (!isCount(failures) || failures === 0) return undefined
	if (!isTime(failingSince) || failingSince > now) return undefined
	const gate = isTime(nextAttemptAt) ? Math.min(nextAttemptAt, now + BACKOFF_CAP_MS) : 0
	return { failures: Math.min(failures, FAILURES_CAP), failingSince, nextAttemptAt: gate }
}

/**
 * Failure episodes of the public scan, keyed `${profileId}|${networkId}|${contract}`, plus which
 * networks' stall has already been announced.
 *
 * Memory is the source of truth and every mutation is synchronous; the session area is a write-behind
 * copy so an alarm-woken worker resumes the streak — and does not re-announce the stall — instead of
 * starting over on every wake. Writes are chained, each carrying the full snapshot taken at mutation
 * time, so within a running worker a removal can never be overtaken by an older write. A write that
 * fails, or a worker that dies first, leaves the previous snapshot; hydration re-validates whatever it
 * finds. The blob names which (profile, network, contract) triples are failing and nothing else.
 */
export class ScanEpisodeStore {
	private readonly episodes = new Map<string, StoredScanEpisode>()
	private readonly announced = new Set<string>()
	private writeChain: Promise<void> = Promise.resolve()

	public constructor(
		private readonly area: StorageArea,
		private readonly onPersistError: (error: unknown) => void,
	) {}

	/** Load the stored state. Must settle before the first poll reads a gate. A repair is written back
	 *  before this resolves: a clamp that lived only in memory would be recomputed from every restart's own clock,
	 *  and a worker that restarts more often than the clamp would never reach the gate. */
	public async hydrate(now: number): Promise<void> {
		let blob: unknown
		try {
			blob = (await this.area.get(SCAN_EPISODES_KEY))[SCAN_EPISODES_KEY]
		} catch (error) {
			this.onPersistError(error)
			return
		}
		if (blob === undefined) return
		const stored = isRecord(blob) ? blob : {}
		for (const [key, raw] of Object.entries(isRecord(stored.episodes) ? stored.episodes : {})) {
			const episode = parseStoredEpisode(raw, now)
			if (episode) this.episodes.set(key, episode)
		}
		for (const prefix of Array.isArray(stored.announced) ? stored.announced : []) {
			if (typeof prefix === "string" && this.hasEpisodeUnder(prefix)) this.announced.add(prefix)
		}
		if (JSON.stringify(this.snapshot()) === JSON.stringify(blob)) return
		this.persist()
		await this.writeChain
	}

	public has(key: string): boolean {
		return this.episodes.has(key)
	}

	public isBackingOff(key: string, now: number): boolean {
		const episode = this.episodes.get(key)
		return episode !== undefined && episode.nextAttemptAt > now
	}

	/** Apply one tick's outcome: a failure opens or extends the episode, anything else ends it. */
	public record(key: string, outcome: ScanOutcome, now: number): void {
		if (!isScanFailure(outcome)) {
			this.deleteWhere((candidate) => candidate === key)
			return
		}
		const prior = this.episodes.get(key)
		const failures = Math.min((prior?.failures ?? 0) + 1, FAILURES_CAP)
		this.episodes.set(key, { failures, failingSince: prior?.failingSince ?? now, nextAttemptAt: now + nextBackoffMs(failures) })
		this.persist()
	}

	public deleteWhere(matches: (key: string) => boolean): void {
		let removed = false
		for (const key of [...this.episodes.keys()]) {
			if (!matches(key)) continue
			this.episodes.delete(key)
			removed = true
		}
		if (removed) this.persist()
	}

	/** Let the next tick run now. The streak is untouched: a retry is not evidence of recovery. */
	public clearRetryGate(prefix: string): void {
		let changed = false
		for (const [key, episode] of this.episodes) {
			if (!key.startsWith(prefix) || episode.nextAttemptAt === 0) continue
			this.episodes.set(key, { ...episode, nextAttemptAt: 0 })
			changed = true
		}
		if (changed) this.persist()
	}

	/** Health of every episode under `prefix`: stalled if any is, since the oldest stalled one began. */
	public health(prefix: string, now: number): { stalled: boolean; since: number | null } {
		let since: number | null = null
		for (const [key, episode] of this.episodes) {
			if (!key.startsWith(prefix) || !isStalled(episode, now)) continue
			since = since === null ? episode.failingSince : Math.min(since, episode.failingSince)
		}
		return { stalled: since !== null, since }
	}

	/** Network prefixes whose stall has been announced and not yet taken back. */
	public announcedPrefixes(): string[] {
		return [...this.announced]
	}

	/** Record what was last announced for `prefix`. Returns whether that changed anything. */
	public setAnnounced(prefix: string, stalled: boolean): boolean {
		if (this.announced.has(prefix) === stalled) return false
		if (stalled) this.announced.add(prefix)
		else this.announced.delete(prefix)
		this.persist()
		return true
	}

	/** Resolves once every queued write has landed. */
	public settled(): Promise<void> {
		return this.writeChain
	}

	private hasEpisodeUnder(prefix: string): boolean {
		for (const key of this.episodes.keys()) if (key.startsWith(prefix)) return true
		return false
	}

	private snapshot(): StoredBlob {
		return { episodes: Object.fromEntries(this.episodes), announced: [...this.announced] }
	}

	private persist(): void {
		const snapshot = this.snapshot()
		const isEmpty = this.episodes.size === 0 && this.announced.size === 0
		const write = () => (isEmpty ? this.area.remove(SCAN_EPISODES_KEY) : this.area.set({ [SCAN_EPISODES_KEY]: snapshot }))
		this.writeChain = this.writeChain.then(write).catch((error) => this.onPersistError(error))
	}
}
