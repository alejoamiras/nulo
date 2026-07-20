import type { StorageArea } from "@nulo/wallet-core/ports"
import { ACCOUNT_INTEGRITY_BLOCKED_ROOT, AccountIntegrityBlockedSchema, type AccountIntegrityBlocked } from "./types"

/**
 * Durable integrity-blocked markers over RAW `storage.local` (TombstoneRepository pattern —
 * deliberately NOT an `EntityStorage`, whose decode path auto-removes syntax-invalid rows; a
 * corrupt blocking record must KEEP blocking). `blockedProfileIds` derives from raw keys without
 * decoding; only an explicit green re-verification deletes a record.
 */
export class AccountIntegrityBlockedRepository {
	public constructor(private readonly storage: StorageArea) {}

	private key(profileId: string): string {
		return `${ACCOUNT_INTEGRITY_BLOCKED_ROOT}@${profileId}`
	}

	public async set(record: AccountIntegrityBlocked): Promise<void> {
		await this.storage.set({ [this.key(record.profileId)]: JSON.stringify(record) })
	}

	public async get(profileId: string): Promise<AccountIntegrityBlocked | undefined> {
		const res = await this.storage.get(this.key(profileId))
		const raw = res[this.key(profileId)]
		if (typeof raw !== "string") return undefined
		try {
			const parsed = AccountIntegrityBlockedSchema.safeParse(JSON.parse(raw))
			return parsed.success ? parsed.data : undefined
		} catch {
			return undefined
		}
	}

	/** Fail-closed: derived from RAW keys, so a corrupt record still blocks its profile. */
	public async isBlocked(profileId: string): Promise<boolean> {
		const res = await this.storage.get(this.key(profileId))
		return this.key(profileId) in res
	}

	/** Cleared ONLY by a green re-verification of the same profile. */
	public async clear(profileId: string): Promise<void> {
		await this.storage.remove(this.key(profileId))
	}
}
