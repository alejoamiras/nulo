/**
 * Storage ownership for the incoming-transfer surface. Four independent EntityStorage tables under
 * the injected `browserApi.storage.local`:
 *   - `nulo:core:incoming-transfers` keyed by the record `id` (profile+network-scoped, `kind`-
 *     prefixed — `note:…` / `pub:…`; see `noteRecordId`/`publicRecordId`).
 *   - `nulo:core:incoming-trust` keyed by `${profileId}|${networkId}|${contract}`.
 *   - `nulo:core:incoming-public-cursors` keyed by `${profileId}|${networkId}|${contract}` (D3/D6).
 *   - `nulo:core:incoming-balance-outbox` keyed by
 *     `${profileId}|${networkId}|${accountAddress}|${tokenId}` (D4).
 *
 * Idempotent inserts are an emergent property of keying by a stable PK. Cleanup hooks
 * (`clearProfile`, `clearChain`) iterate the full key space and filter — fine at the cardinality we
 * expect (hundreds of rows per profile, not millions).
 */

import { EntityStorage } from "@/wallet/storage"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import {
	type IncomingBalanceOutboxRow,
	type IncomingTransferRecord,
	type IncomingTrustRecord,
	type IncomingTrustState,
	type PublicScanCursor,
	IncomingBalanceOutboxRowSchema,
	IncomingTransferRecordSchema,
	IncomingTrustRecordSchema,
	PublicScanCursorSchema,
	balanceOutboxKey,
	publicCursorKey,
} from "./spec"

const RECORDS_KEY = "nulo:core:incoming-transfers"
const TRUST_KEY = "nulo:core:incoming-trust"
const CURSORS_KEY = "nulo:core:incoming-public-cursors"
const OUTBOX_KEY = "nulo:core:incoming-balance-outbox"

/** Build a stable key for the trust table. Profile + network + contract are
 *  all stringified to defend against numeric drift. */
export function trustKey(profileId: string, networkId: string, contract: string): string {
	return `${profileId}|${networkId}|${contract}`
}

export class IncomingTransferRepository {
	private readonly records: EntityStorage<IncomingTransferRecord>
	private readonly trust: EntityStorage<IncomingTrustRecord>
	private readonly cursors: EntityStorage<PublicScanCursor>
	private readonly outbox: EntityStorage<IncomingBalanceOutboxRow>

	public constructor(browserApi: BrowserApi) {
		this.records = new EntityStorage<IncomingTransferRecord>(RECORDS_KEY, browserApi.storage.local, (raw) =>
			IncomingTransferRecordSchema.parse(raw),
		)
		this.trust = new EntityStorage<IncomingTrustRecord>(TRUST_KEY, browserApi.storage.local, (raw) =>
			IncomingTrustRecordSchema.parse(raw),
		)
		this.cursors = new EntityStorage<PublicScanCursor>(CURSORS_KEY, browserApi.storage.local, (raw) =>
			PublicScanCursorSchema.parse(raw),
		)
		this.outbox = new EntityStorage<IncomingBalanceOutboxRow>(OUTBOX_KEY, browserApi.storage.local, (raw) =>
			IncomingBalanceOutboxRowSchema.parse(raw),
		)
	}

	// --- Records (keyed by `id`) ---

	public async getRecord(id: string): Promise<IncomingTransferRecord | undefined> {
		return this.records.get(id)
	}

	public async hasRecord(id: string): Promise<boolean> {
		return this.records.contains(id)
	}

	public async upsertRecord(record: IncomingTransferRecord): Promise<void> {
		await this.records.set(record.id, record)
	}

	public async deleteRecord(id: string): Promise<void> {
		await this.records.delete(id)
	}

	public async listRecords(): Promise<IncomingTransferRecord[]> {
		return this.records.getValues()
	}

	public async listForAccount(profileId: string, networkId: string, accountAddress: string): Promise<IncomingTransferRecord[]> {
		const all = await this.records.getValues()
		return all.filter((r) => r.profileId === profileId && r.networkId === networkId && r.accountAddress === accountAddress)
	}

	public async listByTxHash(profileId: string, networkId: string, txHash: string): Promise<IncomingTransferRecord[]> {
		const all = await this.records.getValues()
		return all.filter((r) => r.profileId === profileId && r.networkId === networkId && r.txHash === txHash)
	}

	public async listByContract(profileId: string, networkId: string, contract: string): Promise<IncomingTransferRecord[]> {
		const all = await this.records.getValues()
		return all.filter((r) => r.profileId === profileId && r.networkId === networkId && r.contract === contract)
	}

	// --- Trust ---

	public async getTrust(profileId: string, networkId: string, contract: string): Promise<IncomingTrustRecord | undefined> {
		return this.trust.get(trustKey(profileId, networkId, contract))
	}

	public async setTrust(profileId: string, networkId: string, contract: string, state: IncomingTrustState): Promise<IncomingTrustRecord> {
		const record: IncomingTrustRecord = { profileId, networkId, contract, state, updatedAt: Date.now() }
		await this.trust.set(trustKey(profileId, networkId, contract), record)
		return record
	}

	public async listTrust(): Promise<IncomingTrustRecord[]> {
		return this.trust.getValues()
	}

	// --- Public-event cursors (D3/D6) ---

	public async getCursor(profileId: string, networkId: string, contract: string): Promise<PublicScanCursor | undefined> {
		return this.cursors.get(publicCursorKey(profileId, networkId, contract))
	}

	public async setCursor(profileId: string, networkId: string, contract: string, cursor: PublicScanCursor): Promise<void> {
		await this.cursors.set(publicCursorKey(profileId, networkId, contract), cursor)
	}

	public async deleteCursor(profileId: string, networkId: string, contract: string): Promise<void> {
		await this.cursors.delete(publicCursorKey(profileId, networkId, contract))
	}

	public async listCursors(): Promise<Array<[string, PublicScanCursor]>> {
		return this.cursors.getAll()
	}

	// --- Balance-refresh outbox (D4) ---

	public async getOutbox(
		profileId: string,
		networkId: string,
		accountAddress: string,
		tokenId: number,
	): Promise<IncomingBalanceOutboxRow | undefined> {
		return this.outbox.get(balanceOutboxKey(profileId, networkId, accountAddress, tokenId))
	}

	public async setOutbox(
		profileId: string,
		networkId: string,
		accountAddress: string,
		tokenId: number,
		row: IncomingBalanceOutboxRow,
	): Promise<void> {
		await this.outbox.set(balanceOutboxKey(profileId, networkId, accountAddress, tokenId), row)
	}

	public async deleteOutbox(profileId: string, networkId: string, accountAddress: string, tokenId: number): Promise<void> {
		await this.outbox.delete(balanceOutboxKey(profileId, networkId, accountAddress, tokenId))
	}

	public async listOutbox(): Promise<Array<[string, IncomingBalanceOutboxRow]>> {
		return this.outbox.getAll()
	}

	// --- Cleanup ---

	/** Delete every record / trust / cursor / outbox row belonging to `profileId`. Profile-delete fanout. */
	public async clearProfile(profileId: string): Promise<void> {
		await this.deleteWhere(this.records, (r) => r.profileId === profileId)
		await this.deleteWhere(this.trust, (r) => r.profileId === profileId)
		await this.deleteKeysWhere(this.cursors, (key) => key.startsWith(`${profileId}|`))
		await this.deleteKeysWhere(this.outbox, (key) => key.startsWith(`${profileId}|`))
	}

	/** Delete every record / trust / cursor / outbox row belonging to `(profileId, networkId)`. Chain-purge fanout. */
	public async clearChain(profileId: string, networkId: string): Promise<void> {
		await this.deleteWhere(this.records, (r) => r.profileId === profileId && r.networkId === networkId)
		await this.deleteWhere(this.trust, (r) => r.profileId === profileId && r.networkId === networkId)
		await this.deleteKeysWhere(this.cursors, (key) => key.startsWith(`${profileId}|${networkId}|`))
		await this.deleteKeysWhere(this.outbox, (key) => key.startsWith(`${profileId}|${networkId}|`))
	}

	private async deleteWhere<T extends { profileId: string }>(store: EntityStorage<T>, pred: (row: T) => boolean): Promise<void> {
		for (const key of await store.getKeys()) {
			const row = await store.get(key)
			if (row && pred(row)) await store.delete(key)
		}
	}

	/**
	 * Delete cursor/outbox rows by KEY prefix. Their keys embed `profileId|networkId|…`, so a
	 * key-prefix match is exact — and it survives a row that failed codec validation (which
	 * `get` reads as `undefined`), where a value-predicate sweep would silently skip it.
	 */
	private async deleteKeysWhere<T>(store: EntityStorage<T>, pred: (key: string) => boolean): Promise<void> {
		for (const key of await store.getKeys()) {
			if (pred(key)) await store.delete(key)
		}
	}
}
