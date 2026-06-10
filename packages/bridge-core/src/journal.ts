/**
 * The in-flight bridge journal: every deposit/withdraw the user has started and not yet
 * cleared, multi-entry, device-local. Replaces the single-pending-per-direction records.
 *
 * Trust model (the part that must not regress):
 *  - Records persist MILESTONE FACTS only (tx hashes, leafIndex, completedAt) — display stages
 *    are DERIVED at runtime, so storage cannot lie about progress, only about facts whose
 *    tampering is individually bounded (see the plan's Security section).
 *  - For PRIVATE deposits the plaintext `recipient`/`amount` are display-only; the authoritative
 *    copies live inside the AES-GCM sealed envelope (recovery-crypto). Public deposits and all
 *    withdraws are self-authenticating on-chain (their messages bind recipient+amount).
 *  - Writes are per-record read-merge-write: every mutation re-reads the journal and replaces
 *    only its own record, so a stale snapshot in another tab cannot erase an unrelated record
 *    (which for a private deposit would destroy the only sealed recovery blob).
 *
 * Storage is injected (`KV`) so this stays pure + unit-testable; the frontend passes
 * `window.localStorage`.
 */

export interface KV {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
}

export const JOURNAL_KEY = "nulo-bridge:journal:v1"

/** Parse cap — storage-flooding guard. Eviction is prioritized: unfinished records survive
 *  first, then newest completed; junk can never evict a live record. */
export const MAX_RECORDS = 100

/** Pre-journal single-pending keys. Deleted on init — no migration (dev-phase decision, plan L15). */
export const LEGACY_KEYS = ["nulo-bridge-pending-deposit", "nulo-bridge-pending-withdraw"] as const

interface JournalBase {
	schema: 1
	/** Deposits: secretHashHex (exists before any irreversible tx). Withdraws: exitTxHash, or a
	 *  provisional `wd-pending-<rand>` between send and receipt. */
	id: string
	direction: "deposit" | "withdraw"
	isPrivate: boolean
	/** Base units, decimal string. DISPLAY-ONLY for private deposits (authoritative copy sealed). */
	amount: string
	createdAt: number
	updatedAt: number
	/** Terminal: set only after the record's SPECIFIC tx passed the identity checks. */
	completedAt?: number
	/** Deployment binding — a record from a different deployment refuses resume (stale-deployment). */
	chainId: number
	portal: string
	bridge: string
}

export interface DepositJournalRecord extends JournalBase {
	direction: "deposit"
	/** Display + pre-unseal guard for private; claim arg for public (self-authenticating on-chain). */
	recipient: string
	/** PUBLIC only — recipient-bound by the L1 content hash (tamper ⇒ claim fails, never redirects). */
	secret?: string
	/** PRIVATE only — the AES-GCM envelope holding {secret, recipient, amount, sealerL1, leafIndex?}. */
	sealedEnvelope?: string
	secretHashHex: string
	/** Display copy of the sealing L1 account (authoritative copy lives inside the envelope). */
	sealerL1?: string
	/** Persisted the moment writeContract returns — leafIndex stays chain-recoverable. */
	depositTxHash?: string
	leafIndex?: string
	claimTxHash?: string
}

export interface WithdrawJournalRecord extends JournalBase {
	direction: "withdraw"
	/** Bound in the L2→L1 message — tamper makes the consume revert. */
	recipientL1: string
	exitTxHash?: string
	exitBlock?: number
	consumeTxHash?: string
}

export type BridgeJournalRecord = DepositJournalRecord | WithdrawJournalRecord

/** Canonical display stages — closed sets, stable for e2e selectors. */
export type DepositStage = "depositing" | "syncing" | "claimable" | "claiming" | "done"
export type WithdrawStage = "exiting" | "proving" | "consumable" | "consuming" | "done"

export function makeProvisionalWithdrawId(): string {
	return `wd-pending-${Math.random().toString(36).slice(2, 10)}`
}

export function isProvisionalWithdrawId(id: string): boolean {
	return id.startsWith("wd-pending-")
}

function parseRecords(raw: string | null): BridgeJournalRecord[] {
	if (!raw) return []
	try {
		const parsed = JSON.parse(raw) as { schema?: number; records?: unknown }
		if (parsed?.schema !== 1 || !Array.isArray(parsed.records)) return []
		const valid = parsed.records.filter(
			(r): r is BridgeJournalRecord =>
				!!r &&
				typeof r === "object" &&
				typeof (r as BridgeJournalRecord).id === "string" &&
				((r as BridgeJournalRecord).direction === "deposit" || (r as BridgeJournalRecord).direction === "withdraw"),
		)
		return capRecords(valid)
	} catch {
		return []
	}
}

/** Prioritized retention under MAX_RECORDS: unfinished first (newest-updated wins among them),
 *  then newest completed. Flooding with junk can therefore never evict a live record. */
export function capRecords(records: BridgeJournalRecord[]): BridgeJournalRecord[] {
	if (records.length <= MAX_RECORDS) return records
	const unfinished = records.filter((r) => !r.completedAt).sort((a, b) => b.updatedAt - a.updatedAt)
	const completed = records.filter((r) => r.completedAt).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
	return [...unfinished, ...completed].slice(0, MAX_RECORDS)
}

export function loadJournal(kv: KV): BridgeJournalRecord[] {
	return parseRecords(kv.getItem(JOURNAL_KEY))
}

function write(kv: KV, records: BridgeJournalRecord[]): void {
	kv.setItem(JOURNAL_KEY, JSON.stringify({ schema: 1, records: capRecords(records) }))
}

/** Insert-or-replace by id — re-reads the journal first (per-record merge; see module header). */
export function upsertRecord(kv: KV, rec: BridgeJournalRecord): void {
	const records = loadJournal(kv)
	const next = { ...rec, updatedAt: Date.now() }
	const i = records.findIndex((r) => r.id === rec.id)
	if (i >= 0) records[i] = next
	else records.push(next)
	write(kv, records)
}

/** Shallow-merge a patch into one record (re-read first). No-op if the id is gone. */
export function patchRecord(kv: KV, id: string, patch: Partial<BridgeJournalRecord>): BridgeJournalRecord | undefined {
	const records = loadJournal(kv)
	const i = records.findIndex((r) => r.id === id)
	if (i < 0) return undefined
	const next = { ...records[i], ...patch, id: records[i].id, updatedAt: Date.now() } as BridgeJournalRecord
	records[i] = next
	write(kv, records)
	return next
}

/** Replace a record under a NEW id (the provisional-withdraw → exitTxHash upgrade). */
export function rekeyRecord(kv: KV, oldId: string, next: BridgeJournalRecord): void {
	const records = loadJournal(kv).filter((r) => r.id !== oldId && r.id !== next.id)
	records.push({ ...next, updatedAt: Date.now() })
	write(kv, records)
}

export function removeRecord(kv: KV, id: string): void {
	const records = loadJournal(kv)
	const next = records.filter((r) => r.id !== id)
	if (next.length !== records.length) write(kv, next)
}

/** Drop completed records older than `olderThanMs` (the 7-day prune; only D4-verified
 *  completions ever carry `completedAt`, so this never destroys an unverified blob). */
export function pruneCompleted(kv: KV, olderThanMs: number, now = Date.now()): void {
	const records = loadJournal(kv)
	const next = records.filter((r) => !r.completedAt || now - r.completedAt < olderThanMs)
	if (next.length !== records.length) write(kv, next)
}

/** Delete the pre-journal single-pending keys. No migration — plan L15 (dev phase). */
export function clearLegacyKeys(kv: KV): void {
	for (const key of LEGACY_KEYS) kv.removeItem(key)
}

/** Runtime inputs the persisted facts can't know (live chain/PXE state picks within a pair). */
export interface DepositStageRuntime {
	/** True once the record's claim simulates cleanly (public) or is presumed ready (private). */
	claimable?: boolean
}
export interface WithdrawStageRuntime {
	/** True once the exit's block is covered by the proven chain tip. */
	proven?: boolean
}

export function deriveDepositStage(rec: DepositJournalRecord, runtime: DepositStageRuntime = {}): DepositStage {
	if (rec.completedAt) return "done"
	if (rec.claimTxHash) return "claiming"
	if (rec.leafIndex) return runtime.claimable ? "claimable" : "syncing"
	return "depositing"
}

export function deriveWithdrawStage(rec: WithdrawJournalRecord, runtime: WithdrawStageRuntime = {}): WithdrawStage {
	if (rec.completedAt) return "done"
	if (rec.consumeTxHash) return "consuming"
	if (rec.exitTxHash) return runtime.proven ? "consumable" : "proving"
	return "exiting"
}
