/**
 * No-server recovery: the in-flight bridge records that let a deposit/withdraw
 * resume after a page refresh. Stored device-locally under two keys (L1->L2
 * deposits, L2->L1 withdrawals).
 *
 * The claim secret is held as an OPAQUE encrypted blob (`encryptedSecret`) —
 * never plaintext. For PRIVATE transfers the secret is a *bearer credential*
 * (the content hash omits the recipient, so whoever holds the secret can claim
 * to themselves — R2 finding), so the encryption layer + the loud export
 * warning matter. This module owns only the schema + CRUD; the encryption
 * (reusing @nulo/wallet-crypto) and the L1-signature key live in a sibling.
 *
 * Storage is injected (`KV`) so this is pure + unit-testable without a DOM;
 * the frontend passes `window.localStorage`.
 */

export interface KV {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
}

export const DEPOSITS_KEY = "bridge:deposits:l1ToL2"
export const WITHDRAWALS_KEY = "bridge:withdrawals:l2ToL1"

export type DepositStage = "deposited" | "claiming" | "claimed"
export type WithdrawalStage = "burned" | "proving" | "proven" | "exited"

interface BaseRecord {
	/** Stable id — the L1->L2 / L2->L1 message hash. */
	id: string
	/** Base-unit amount as a decimal string (bigint-safe in JSON). */
	amount: string
	/** AES-GCM blob of the claim/exit secret. Never plaintext. Bearer for private. */
	encryptedSecret: string
	isPrivate: boolean
	createdAt: number
}

export interface DepositRecord extends BaseRecord {
	direction: "l1ToL2"
	token: string
	aztecRecipient: string
	secretHashHex: string
	messageLeafIndex?: string
	stage: DepositStage
}

export interface WithdrawalRecord extends BaseRecord {
	direction: "l2ToL1"
	recipientL1: string
	l2Block?: string
	stage: WithdrawalStage
}

type AnyRecord = DepositRecord | WithdrawalRecord

function keyFor(rec: AnyRecord): string {
	return rec.direction === "l1ToL2" ? DEPOSITS_KEY : WITHDRAWALS_KEY
}

function read<T>(kv: KV, key: string): T[] {
	const raw = kv.getItem(key)
	if (!raw) return []
	try {
		const parsed = JSON.parse(raw)
		return Array.isArray(parsed) ? (parsed as T[]) : []
	} catch {
		return []
	}
}

export function loadDeposits(kv: KV): DepositRecord[] {
	return read<DepositRecord>(kv, DEPOSITS_KEY)
}

export function loadWithdrawals(kv: KV): WithdrawalRecord[] {
	return read<WithdrawalRecord>(kv, WITHDRAWALS_KEY)
}

/** Insert or replace (by id) the record in its array. */
export function upsertRecord(kv: KV, rec: AnyRecord): void {
	const key = keyFor(rec)
	const list = read<AnyRecord>(kv, key)
	const i = list.findIndex((r) => r.id === rec.id)
	if (i >= 0) list[i] = rec
	else list.push(rec)
	kv.setItem(key, JSON.stringify(list))
}

/** Patch a record's stage (and optional fields). No-op if not found. */
export function updateRecord(kv: KV, key: string, id: string, patch: Partial<AnyRecord>): void {
	const list = read<AnyRecord>(kv, key)
	const i = list.findIndex((r) => r.id === id)
	if (i < 0) return
	list[i] = { ...list[i], ...patch } as AnyRecord
	kv.setItem(key, JSON.stringify(list))
}

/** Remove a record once its flow completes (and its secret is no longer needed). */
export function removeRecord(kv: KV, key: string, id: string): void {
	const list = read<AnyRecord>(kv, key)
	const next = list.filter((r) => r.id !== id)
	if (next.length !== list.length) kv.setItem(key, JSON.stringify(next))
}

export function findDeposit(kv: KV, id: string): DepositRecord | undefined {
	return loadDeposits(kv).find((r) => r.id === id)
}

export function findWithdrawal(kv: KV, id: string): WithdrawalRecord | undefined {
	return loadWithdrawals(kv).find((r) => r.id === id)
}
