import { z } from "zod"
import type { StorageArea } from "@nulo/wallet-core/ports"

export const PROFILE_TOMBSTONE_ROOT = "nulo:core:profile-tombstones"

/**
 * A profile-deletion tombstone: written UNDER the facade lock before the profile
 * row is deleted, cleared only after every purge succeeds. It reserves the
 * profile id against reuse and carries the exact `Account[]`/`Token[]`/`Network[]`
 * snapshot the coordinator needs to finish (or resume) cleanup even after the
 * source rows are gone.
 */
export const TombstoneSchema = z.object({
	profileId: z.string(),
	addresses: z.array(z.string()),
	tokenIds: z.array(z.number()),
	networkIds: z.array(z.string()),
	/** Deletion epoch captured when the tombstone was written (fencing + clear-guard). */
	epoch: z.number(),
})
export type Tombstone = z.infer<typeof TombstoneSchema>

/**
 * Durable delete-in-progress markers over RAW `storage.local`.
 *
 * Deliberately NOT an `EntityStorage`: its `getValues()`/`get()` call `decodeRow`,
 * which asynchronously REMOVES a syntax-invalid row — so a truncated/corrupt
 * tombstone would vanish and its id would stop being reserved (id-reuse fails
 * OPEN → successor-clobber). This repo NEVER removes a row it can't decode:
 * `reservedIds()` derives ids from RAW keys (no decode), so a corrupt tombstone
 * still reserves its id; only `validPayloads()` (valid rows) drive cleanup.
 */
export class TombstoneRepository {
	public constructor(private readonly storage: StorageArea) {}

	private key(id: string): string {
		return `${PROFILE_TOMBSTONE_ROOT}@${id}`
	}

	public async write(t: Tombstone): Promise<void> {
		await this.storage.set({ [this.key(t.profileId)]: JSON.stringify(t) })
	}

	public async get(id: string): Promise<Tombstone | undefined> {
		const res = await this.storage.get(this.key(id))
		return this.parse(res[this.key(id)])
	}

	/** Clear ONLY if the live tombstone still matches the epoch we wrote — a
	 *  concurrent re-deletion (new epoch) must not have its marker dropped. */
	public async clearIfSame(id: string, epoch: number): Promise<void> {
		const t = await this.get(id)
		if (t && t.epoch === epoch) await this.storage.remove(this.key(id))
	}

	/** RESERVED ids from RAW keys — NEVER decodes, so a corrupt tombstone still
	 *  reserves its id (fail-CLOSED against id-reuse). */
	public async reservedIds(): Promise<Set<string>> {
		const all = await this.storage.get()
		const prefix = `${PROFILE_TOMBSTONE_ROOT}@`
		const ids = new Set<string>()
		for (const k of Object.keys(all)) if (k.startsWith(prefix)) ids.add(k.slice(prefix.length))
		return ids
	}

	/** VALID payloads only (drives resume/cleanup) — skips a corrupt row but
	 *  NEVER removes it (it stays reserved + surfaces "deletion pending"). */
	public async validPayloads(): Promise<Tombstone[]> {
		const all = await this.storage.get()
		const prefix = `${PROFILE_TOMBSTONE_ROOT}@`
		const out: Tombstone[] = []
		for (const [k, v] of Object.entries(all)) {
			if (!k.startsWith(prefix)) continue
			const parsed = this.parse(v)
			if (parsed) out.push(parsed)
		}
		return out
	}

	/** TELEMETRY only: ids whose raw row EXISTS but can NOT be decoded — reserved
	 *  (the id stays locked, fail-CLOSED) but un-resumable, so cleanup can't finish
	 *  automatically. Surfaced at resume for manual recovery. It is NEVER dropped:
	 *  a corrupt tombstone whose profile row is absent is a phase-1-done,
	 *  purge-PENDING deletion (the tombstone is written BEFORE the row is deleted),
	 *  so auto-dropping it would fail OPEN — abandoning a real in-progress deletion
	 *  + reopening the id for reuse. Both plan auditors flagged auto-repair as unsafe. */
	public async corruptIds(): Promise<string[]> {
		const all = await this.storage.get()
		const prefix = `${PROFILE_TOMBSTONE_ROOT}@`
		const out: string[] = []
		for (const [k, v] of Object.entries(all)) {
			if (!k.startsWith(prefix)) continue
			if (!this.parse(v)) out.push(k.slice(prefix.length))
		}
		return out
	}

	private parse(raw: unknown): Tombstone | undefined {
		if (typeof raw !== "string") return undefined
		try {
			const p = TombstoneSchema.safeParse(JSON.parse(raw))
			return p.success ? p.data : undefined
		} catch {
			return undefined
		}
	}
}
