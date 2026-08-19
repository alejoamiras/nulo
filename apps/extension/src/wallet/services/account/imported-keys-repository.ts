import { EntityStorage } from "@/wallet/storage"
import type { StorageArea } from "@nulo/wallet-core/ports"
import {
	IMPORTED_KEYS_STORAGE_ROOT,
	ImportedAccountKeySchema,
	accountRowId,
	accountRowIdOf,
	parseAccountRowId,
	type ImportedAccountKey,
} from "./spec"

/**
 * Storage for imported accounts' encrypted signing keys, 1:1 with the `Account` rows they belong
 * to (same composite `accountRowId`). Kept separate from the Account root so the Account row stays
 * secret-free and the key store has its own backup-slice owner.
 */
export class ImportedKeysRepository {
	private readonly storage: EntityStorage<ImportedAccountKey>

	public constructor(storage: StorageArea) {
		this.storage = new EntityStorage<ImportedAccountKey>(IMPORTED_KEYS_STORAGE_ROOT, storage, (raw) =>
			ImportedAccountKeySchema.parse(raw),
		)
	}

	public async get(profileId: string, chainId: number, address: string): Promise<ImportedAccountKey | undefined> {
		const row = await this.storage.get(accountRowId(profileId, chainId, address))
		return row?.profileId === profileId && row.chainId === chainId && row.address === address ? row : undefined
	}

	public async set(row: ImportedAccountKey): Promise<void> {
		await this.storage.set(accountRowIdOf(row), row)
	}

	public async delete(profileId: string, chainId: number, address: string): Promise<void> {
		await this.storage.delete(accountRowId(profileId, chainId, address))
	}

	/** All key rows stored under their canonical composite key (ignores stray non-canonical keys). */
	public async liveRows(): Promise<ImportedAccountKey[]> {
		const rows: ImportedAccountKey[] = []
		for (const [key, row] of await this.storage.getAll()) {
			if (key === accountRowIdOf(row)) rows.push(row)
		}
		return rows
	}

	/** Every canonical composite key currently stored — for orphan reconciliation. */
	public async allRowIds(): Promise<Array<{ profileId: string; chainId: number; address: string }>> {
		const out: Array<{ profileId: string; chainId: number; address: string }> = []
		for (const [id] of await this.storage.rawStringEntries()) {
			const key = parseAccountRowId(id)
			if (key !== undefined) out.push(key)
		}
		return out
	}

	/** All key rows for a profile — used by profile-deletion purge. */
	public async forProfile(profileId: string): Promise<ImportedAccountKey[]> {
		return (await this.liveRows()).filter((r) => r.profileId === profileId)
	}

	/** Backup: dump this profile's imported-key rows. */
	public async backup(profileId: string): Promise<ImportedAccountKey[]> {
		return this.forProfile(profileId)
	}
}
