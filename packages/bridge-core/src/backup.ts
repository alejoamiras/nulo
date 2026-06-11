import type { EncryptionKey } from "@nulo/wallet-crypto"
import type { BridgeJournalRecord, DepositJournalRecord, WithdrawJournalRecord } from "./journal"
import { isProvisionalWithdrawId } from "./journal"
import { openSecret, sealSecret } from "./recovery-crypto"

/**
 * Per-bridge recovery file: ONE journal record, ALWAYS sealed (public deposits hold their claim
 * secret plaintext in the record - it must never touch disk readable). The header carries
 * routing/UX copies of a few fields; it is NOT authenticated, so every header field is re-checked
 * against the unsealed record on open, and an unseal failure cannot be attributed - it reads as
 * "wrong wallet OR tampered/corrupted file". v1-only open (the envelope's no-fallback rule).
 */

export const BACKUP_FORMAT = "nulo-bridge-backup"

export interface BridgeBackupFile {
	format: typeof BACKUP_FORMAT
	v: 1
	chainId: number
	portal: string
	bridge: string
	direction: "deposit" | "withdraw"
	id: string
	/** Captured at export (NOT a journal field for public/withdraw records) - display + routing only. */
	sealerL1: string
	blob: string
}

/** Parse + shape-check a candidate file. Throws specific, user-facing messages per ladder step. */
export function parseBackupFile(raw: unknown): BridgeBackupFile {
	let parsed: unknown = raw
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw)
		} catch {
			throw new Error("This is not a Nulo bridge recovery file.")
		}
	}
	const f = parsed as Partial<BridgeBackupFile> | null
	if (!f || typeof f !== "object" || f.format !== BACKUP_FORMAT) {
		throw new Error("This is not a Nulo bridge recovery file.")
	}
	if (f.v !== 1) {
		throw new Error("This recovery file was made by a newer version of the app - update and retry.")
	}
	if (
		typeof f.chainId !== "number" ||
		typeof f.portal !== "string" ||
		typeof f.bridge !== "string" ||
		(f.direction !== "deposit" && f.direction !== "withdraw") ||
		typeof f.id !== "string" ||
		f.id.length === 0 ||
		typeof f.sealerL1 !== "string" ||
		typeof f.blob !== "string" ||
		f.blob.length === 0
	) {
		throw new Error("This recovery file is malformed.")
	}
	if (isProvisionalWithdrawId(f.id)) {
		throw new Error("This file holds a half-started withdraw with nothing restorable in it.")
	}
	return f as BridgeBackupFile
}

const isDecimalString = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v)
const isOptionalString = (v: unknown): v is string | undefined => v === undefined || typeof v === "string"
const isOptionalNumber = (v: unknown): v is number | undefined => v === undefined || typeof v === "number"

/** STRICT per-direction guard for foreign input - the journal's shallow parse filter is for OUR
 *  own storage, never for a file someone handed us. */
export function validateBackupRecord(rec: unknown): BridgeJournalRecord {
	const r = rec as Partial<BridgeJournalRecord> | null
	if (
		!r ||
		typeof r !== "object" ||
		r.schema !== 1 ||
		typeof r.id !== "string" ||
		r.id.length === 0 ||
		typeof r.isPrivate !== "boolean" ||
		!isDecimalString(r.amount) ||
		typeof r.createdAt !== "number" ||
		typeof r.updatedAt !== "number" ||
		!isOptionalNumber(r.completedAt) ||
		typeof r.chainId !== "number" ||
		typeof r.portal !== "string" ||
		typeof r.bridge !== "string"
	) {
		throw new Error("The sealed contents are not a valid bridge record.")
	}
	if (r.direction === "deposit") {
		const d = r as Partial<DepositJournalRecord>
		if (
			typeof d.recipient !== "string" ||
			typeof d.secretHashHex !== "string" ||
			!isOptionalString(d.secret) ||
			!isOptionalString(d.sealedEnvelope) ||
			!isOptionalString(d.sealerL1) ||
			!isOptionalString(d.depositTxHash) ||
			!isOptionalString(d.leafIndex) ||
			!isOptionalString(d.claimTxHash) ||
			!isOptionalNumber(d.depositL2Block)
		) {
			throw new Error("The sealed contents are not a valid bridge record.")
		}
		return d as DepositJournalRecord
	}
	if (r.direction === "withdraw") {
		const w = r as Partial<WithdrawJournalRecord>
		if (
			typeof w.recipientL1 !== "string" ||
			!isOptionalString(w.exitTxHash) ||
			!isOptionalNumber(w.exitBlock) ||
			!isOptionalString(w.consumeTxHash) ||
			isProvisionalWithdrawId(r.id)
		) {
			throw new Error("The sealed contents are not a valid bridge record.")
		}
		return w as WithdrawJournalRecord
	}
	throw new Error("The sealed contents are not a valid bridge record.")
}

interface BackupPayload {
	bk: 1
	record: BridgeJournalRecord
}

/** Seal ONE record into a recovery file. Refuses records with nothing restorable in them:
 *  provisional withdraws, and private deposits whose envelope hasn't been sealed yet - a file
 *  without the recovery material would toast success today and strand the claim later. */
export async function sealBridgeBackup(key: EncryptionKey, record: BridgeJournalRecord, sealerL1: string): Promise<BridgeBackupFile> {
	if (isProvisionalWithdrawId(record.id)) {
		throw new Error("This withdraw has not reached its exit transaction yet - there is nothing restorable to save.")
	}
	if (record.direction === "deposit" && record.isPrivate && !record.sealedEnvelope) {
		throw new Error("This private deposit hasn't sealed its recovery secret yet - try again in a moment.")
	}
	const payload: BackupPayload = { bk: 1, record }
	return {
		format: BACKUP_FORMAT,
		v: 1,
		chainId: record.chainId,
		portal: record.portal,
		bridge: record.bridge,
		direction: record.direction,
		id: record.id,
		sealerL1,
		blob: await sealSecret(key, JSON.stringify(payload)),
	}
}

/** Unseal + deep-validate + header-cross-check. GCM failure throws the attribution-honest copy. */
export async function openBridgeBackup(key: EncryptionKey, file: BridgeBackupFile): Promise<BridgeJournalRecord> {
	let plaintext: string
	try {
		plaintext = await openSecret(key, file.blob)
	} catch {
		throw new Error("Couldn't open this file: it wasn't sealed by the connected Ethereum account, or the file is corrupted/tampered.")
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(plaintext)
	} catch {
		throw new Error("The sealed contents are not a valid bridge record.")
	}
	const payload = parsed as Partial<BackupPayload>
	if (payload?.bk !== 1 || !payload.record) {
		throw new Error("The sealed contents are not a valid bridge record.")
	}
	const record = validateBackupRecord(payload.record)
	// The header is unauthenticated routing data - the SEALED copies are authoritative. Every
	// header field with a sealed counterpart is re-checked (sealerL1 only exists inside private
	// deposit records); refuse on any edit rather than trust either side.
	if (
		record.id !== file.id ||
		record.direction !== file.direction ||
		record.chainId !== file.chainId ||
		record.portal !== file.portal ||
		record.bridge !== file.bridge ||
		(record.direction === "deposit" && record.sealerL1 !== undefined && record.sealerL1 !== file.sealerL1)
	) {
		throw new Error("This file's label doesn't match its sealed contents - it was modified. Refusing to restore.")
	}
	return record
}
