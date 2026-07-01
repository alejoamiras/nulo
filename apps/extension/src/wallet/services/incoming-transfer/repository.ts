/**
 * Storage ownership for `IncomingTransferRecord` + `IncomingTrustRecord`.
 *
 * Two independent EntityStorage tables under the injected `browserApi.storage.local`:
 *   - `nulo:core:incoming-transfers` keyed by `siloedNullifier` (Fr string,
 *     cryptographically unique per note).
 *   - `nulo:core:incoming-trust` keyed by `${profileId}|${networkId}|${contract}`.
 *
 * The records repo uses `siloedNullifier` directly as the storage key — no
 * allocateId / numeric id surface. Idempotent inserts are an emergent property.
 *
 * Cleanup hooks (`clearProfile`, `clearChain`) iterate the full key space
 * and filter — fine at the cardinality we expect (hundreds of records per
 * profile, not millions).
 */

import { EntityStorage } from "@/wallet/storage"
import type { BrowserApi } from "@nulo/wallet-core/ports"
import {
	type IncomingTransferRecord,
	type IncomingTrustRecord,
	type IncomingTrustState,
	IncomingTransferRecordSchema,
	IncomingTrustRecordSchema,
} from "./spec"

const RECORDS_KEY = "nulo:core:incoming-transfers"
const TRUST_KEY = "nulo:core:incoming-trust"

/** Build a stable key for the trust table. Profile + network + contract are
 *  all stringified to defend against numeric drift. */
export function trustKey(profileId: string, networkId: string, contract: string): string {
	return `${profileId}|${networkId}|${contract}`
}

export class IncomingTransferRepository {
	private readonly records: EntityStorage<IncomingTransferRecord>
	private readonly trust: EntityStorage<IncomingTrustRecord>

	public constructor(browserApi: BrowserApi) {
		this.records = new EntityStorage<IncomingTransferRecord>(RECORDS_KEY, browserApi.storage.local, (raw) =>
			IncomingTransferRecordSchema.parse(raw),
		)
		this.trust = new EntityStorage<IncomingTrustRecord>(TRUST_KEY, browserApi.storage.local, (raw) =>
			IncomingTrustRecordSchema.parse(raw),
		)
	}

	// --- Records ---

	public async getRecord(siloedNullifier: string): Promise<IncomingTransferRecord | undefined> {
		return this.records.get(siloedNullifier)
	}

	public async hasRecord(siloedNullifier: string): Promise<boolean> {
		return (await this.records.get(siloedNullifier)) !== undefined
	}

	public async upsertRecord(record: IncomingTransferRecord): Promise<void> {
		await this.records.set(record.siloedNullifier, record)
	}

	public async deleteRecord(siloedNullifier: string): Promise<void> {
		await this.records.delete(siloedNullifier)
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

	// --- Cleanup ---

	/** Iterate all records + trust rows; delete any belonging to `profileId`.
	 *  Wired from the profile-delete fanout. */
	public async clearProfile(profileId: string): Promise<void> {
		const recordKeys = await this.records.getKeys()
		for (const key of recordKeys) {
			const record = await this.records.get(key)
			if (record?.profileId === profileId) await this.records.delete(key)
		}
		const trustKeys = await this.trust.getKeys()
		for (const key of trustKeys) {
			const record = await this.trust.get(key)
			if (record?.profileId === profileId) await this.trust.delete(key)
		}
	}

	/** Iterate all records + trust rows; delete any belonging to
	 *  `(profileId, networkId)`. Wired from chain-purge. */
	public async clearChain(profileId: string, networkId: string): Promise<void> {
		const recordKeys = await this.records.getKeys()
		for (const key of recordKeys) {
			const record = await this.records.get(key)
			if (record?.profileId === profileId && record?.networkId === networkId) await this.records.delete(key)
		}
		const trustKeys = await this.trust.getKeys()
		for (const key of trustKeys) {
			const record = await this.trust.get(key)
			if (record?.profileId === profileId && record?.networkId === networkId) await this.trust.delete(key)
		}
	}
}
