import type { EntityStorage } from "@/wallet/storage"
import { type ILogger, LogLevel } from "@/wallet/logger"
import { signDappSession, verifyDappSession } from "./integrity"
import type { DappSession } from "./spec"

/** Derives the per-profile MAC `CryptoKey`; throws when the profile is locked. */
type MacKeyProvider = (profileId: string) => Promise<CryptoKey>

/**
 * F-12: MAC-verifying wrapper over `EntityStorage<DappSession>`.
 *
 * Signs every row on write and verifies on read. A row that is **tampered**
 * (mac mismatch) or has **no mac** (pre-F-12 / wipe-reseed) is DROPPED and
 * quarantine-deleted — no legacy verifier, no repair from stored contents. When
 * the profile is **locked** (the key provider throws) the row is hidden
 * (returned absent) but NOT deleted, since it is legitimate and verifies again
 * after unlock — fail-closed: a locked read yields no sessions, never a
 * broadened grant.
 *
 * Presents exactly the subset of the `EntityStorage` surface that
 * `DappSessionService` uses, so its call sites are unchanged.
 */
export class DappSessionMacStorage {
	constructor(
		private readonly inner: EntityStorage<DappSession>,
		private readonly keyFor: MacKeyProvider,
		private readonly logger: ILogger,
	) {}

	public async set(id: string, session: DappSession): Promise<void> {
		const key = await this.keyFor(session.profileId)
		const { mac: _drop, ...signable } = session
		const mac = await signDappSession(key, signable)
		await this.inner.set(id, { ...signable, mac } as DappSession)
	}

	public async get(id: string): Promise<DappSession | undefined> {
		return this.verifyOrDrop(await this.inner.get(id))
	}

	public async getValues(): Promise<DappSession[]> {
		const out: DappSession[] = []
		for (const row of await this.inner.getValues()) {
			const verified = await this.verifyOrDrop(row)
			if (verified) out.push(verified)
		}
		return out
	}

	public async contains(id: string): Promise<boolean> {
		return (await this.get(id)) !== undefined
	}

	public delete(id: string): Promise<void> {
		return this.inner.delete(id)
	}

	/**
	 * Every row belonging to `profileId`, as `{storageId, row}`, for the
	 * profile-deletion cascade to purge. RAW, key-aware, MAC-free — three reasons
	 * the MAC view (`getValues()`) is unsafe for a delete-by-profile:
	 *
	 *  1. It runs the MAC key provider, which THROWS for an INACTIVE profile (the
	 *     common deletion case) → rows hidden, left behind, revived on re-import.
	 *  2. It runs the codec, which KEEPS-but-hides a schema-invalid row → a row
	 *     with `profileId=P` but e.g. a missing field survives the profile purge.
	 *  3. It has no key info, so a caller would delete by the row's SELF-REPORTED
	 *     `id`; a valid row copied to a different storage key (alias) would not be
	 *     removed and would re-verify after a same-secret re-import.
	 *
	 * `rawEntries()` sidesteps all three: raw JSON (no codec / no MAC) keyed by the
	 * TRUE storage id. Integrity is irrelevant for deletion — we match the raw
	 * `profileId` field and the caller deletes by `storageId`.
	 */
	public async rowsForProfile(profileId: string): Promise<Array<{ storageId: string; row: DappSession }>> {
		const out: Array<{ storageId: string; row: DappSession }> = []
		for (const [storageId, raw] of await this.inner.rawEntries()) {
			if (typeof raw === "object" && raw !== null && (raw as { profileId?: unknown }).profileId === profileId) {
				out.push({ storageId, row: raw as DappSession })
			}
		}
		return out
	}

	private async verifyOrDrop(row: DappSession | undefined): Promise<DappSession | undefined> {
		if (!row) return undefined
		const { mac, ...signable } = row
		if (!mac) {
			this.drop(row.id, "missing integrity mac")
			return undefined
		}
		let key: CryptoKey
		try {
			key = await this.keyFor(row.profileId)
		} catch {
			// Locked (or wrong active profile): can't verify → hide, but do NOT
			// delete (the row is legitimate and verifies after unlock).
			return undefined
		}
		if (!(await verifyDappSession(key, signable, mac))) {
			this.drop(row.id, "integrity mac mismatch (tampered)")
			return undefined
		}
		return row
	}

	private drop(id: string, reason: string): void {
		this.logger.log("dapp-session", LogLevel.Warn, `Dropping DappSession row "${id}" — ${reason} (F-12)`)
		void this.inner.delete(id).catch(() => {})
	}
}
