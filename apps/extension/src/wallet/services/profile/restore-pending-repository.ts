import { z } from "zod"
import type { StorageArea } from "@nulo/wallet-core/ports"

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
		const raw = res[key]
		if (raw === undefined) return { kind: "absent" }
		if (typeof raw === "string") {
			try {
				const parsed = RestorePendingSchema.safeParse(JSON.parse(raw))
				if (parsed.success) return { kind: "valid", marker: parsed.data }
			} catch {
				// fall through to corrupt
			}
		}
		return { kind: "corrupt" }
	}

	public async delete(id: string): Promise<void> {
		await this.storage.remove(this.key(id))
	}
}
