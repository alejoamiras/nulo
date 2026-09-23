import { z } from "zod"
import type { StorageArea } from "@nulo/wallet-core/ports"
import { prefixedEntries } from "@nulo/wallet-core/storage"
import { decodeRow } from "@/wallet/utils/raw-row"

export const RESTORE_PENDING_ROOT = "nulo:core:restore-pending"

/**
 * A restore-in-progress marker: written UNDER the facade lock immediately
 * BEFORE the restored profile row lands, cleared at `finalizeRestore` ENTRY
 * (the call itself proves the storage-slice phase completed — clearing on
 * entry rather than on session-open success keeps finalize-throw survivors
 * on their documented unlock recovery). A marker still present at unlock
 * time means the popup/SW died mid-restore: the profile's slices may be
 * torn, and opening a session would let the bootstrap silently re-seed the
 * gaps (`ensureDefaultAccount` mints a fresh account where accounts are
 * missing) — so unlock is refused with a typed `RestoreTornError`.
 *
 * Generation-bound: a marker only blocks the incarnation it was written for
 * (`pxeGeneration` — same fencing vocabulary as the deletion tombstones); a
 * mismatching marker is a stale leftover and gets lazily purged.
 *
 * Same raw-`storage.local` discipline as `TombstoneRepository`: a row that
 * EXISTS but cannot be decoded is reported as `corrupt`, never silently
 * removed or treated as absent — fail-CLOSED at the unlock gate.
 */
export const RestorePendingSchema = z.object({
	profileId: z.string(),
	pxeGeneration: z.string(),
	at: z.number(),
})
export type RestorePendingMarker = z.infer<typeof RestorePendingSchema>

export type RestorePendingLookup = { kind: "absent" } | { kind: "valid"; marker: RestorePendingMarker } | { kind: "corrupt" }

export class RestorePendingRepository {
	public constructor(private readonly storage: StorageArea) {}

	private key(id: string): string {
		return `${RESTORE_PENDING_ROOT}@${id}`
	}

	public async write(marker: RestorePendingMarker): Promise<void> {
		await this.storage.set({ [this.key(marker.profileId)]: JSON.stringify(marker) })
	}

	public async get(id: string): Promise<RestorePendingLookup> {
		const key = this.key(id)
		const res = await this.storage.get(key)
		const row = decodeRow(RestorePendingSchema, res[key])
		return row.kind === "valid" ? { kind: "valid", marker: row.value } : row
	}

	public async delete(id: string): Promise<void> {
		await this.storage.remove(this.key(id))
	}

	/**
	 * Compare-and-delete: remove the marker ONLY if the currently-stored value
	 * still equals the observed tuple. An enumerate-then-delete sweep is
	 * otherwise non-atomic — a same-id restore can write a FRESH marker between
	 * the snapshot and the delete, and an unconditional delete would erase the
	 * live import's marker (recreating the immortal-orphan bug).
	 */
	public async deleteIfSame(observed: RestorePendingMarker): Promise<boolean> {
		const current = await this.get(observed.profileId)
		if (current.kind !== "valid") return false
		if (current.marker.pxeGeneration !== observed.pxeGeneration || current.marker.at !== observed.at) {
			return false
		}
		await this.storage.remove(this.key(observed.profileId))
		return true
	}

	/** All decodable markers (tombstone `validPayloads` discipline: only valid
	 *  rows drive cleanup; corrupt ones are surfaced separately, never dropped). */
	public async validMarkers(): Promise<RestorePendingMarker[]> {
		const out: RestorePendingMarker[] = []
		for (const [, , v] of prefixedEntries(await this.storage.get(), `${RESTORE_PENDING_ROOT}@`)) {
			const row = decodeRow(RestorePendingSchema, v)
			if (row.kind === "valid") out.push(row.value)
		}
		return out
	}

	/** TELEMETRY only: ids whose raw marker EXISTS but cannot be decoded — the
	 *  torn-import sweep must fail CLOSED on these (leave marker + row; log). */
	public async corruptIds(): Promise<string[]> {
		return prefixedEntries(await this.storage.get(), `${RESTORE_PENDING_ROOT}@`)
			.filter(([, , v]) => decodeRow(RestorePendingSchema, v).kind !== "valid")
			.map(([, id]) => id)
	}
}
