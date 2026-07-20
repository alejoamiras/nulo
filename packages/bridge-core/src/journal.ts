/**
 * The in-flight bridge journal: every deposit/withdraw the user has started and not yet
 * cleared, multi-entry, device-local. Replaces the single-pending-per-direction records.
 *
 * Trust model (the part that must not regress):
 *  - Records persist MILESTONE FACTS only (tx hashes, leafIndex, completedAt) - display stages
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

/** Parse cap - storage-flooding guard. Eviction is prioritized: unfinished records survive
 *  first, then newest completed; junk can never evict a live record. */
export const MAX_RECORDS = 100

/** Pre-journal single-pending keys. Deleted on init - no migration (dev-phase decision, plan L15). */
export const LEGACY_KEYS = ["nulo-bridge-pending-deposit", "nulo-bridge-pending-withdraw"] as const

interface JournalBase {
	/** Record-shape version, distinct from the storage ENVELOPE version (which `write()` keeps at 1).
	 *  1 = original; 2 = carries the optional `fuel` block. For deposits it is redundant with `!!fuel`
	 *  (kept explicit for back-compat); withdraws are always 1. Private-fuel fields are additive WITHIN
	 *  schema 2 — no bump: an old client reads a private record as a public schema-2 record minus the
	 *  optional private fields. */
	schema: 1 | 2
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
	/** Deployment binding - a record from a different deployment refuses resume (stale-deployment). */
	chainId: number
	portal: string
	bridge: string
}

/** The fuel side of a fueled deposit (plan ledger L11/L14). All amounts base-unit decimal strings. */
export interface DepositFuelBlock {
	/** The AZLO slice swapped on L1 (display + total reconstruction; record.amount stays the TOKEN claim amount). */
	amount: string
	/** FJ claim secret - recipient-bound (gates WHO TRIGGERS the claim, never where funds land). Plaintext like public deposit secrets. */
	secret: string
	secretHashHex: string
	/** The SIGNED slippage floor that was in the witness. */
	minOutput: string
	/** From the BridgeWithFuel event. */
	leafIndex?: string
	/** The L1→L2 message key (inbox leaf hash) from `BridgeWithFuel.fuelKey`. The 5.0 readiness gate polls
	 *  `getL1ToL2MessageCheckpoint(messageHash)` on this — recomputing the leaf locally is fragile, and the
	 *  real key is exactly what the inbox inserted. */
	messageHash?: string
	/** fuelReceived from the event - the EXACT content-hash amount; the claim MUST use this, never a quote. */
	received?: string
	/** Epoch-ms of the LAST claim attempt latch. Missing on pre-fix records ⇒ treated as aged out,
	 *  so a receipt stuck in "pending" limbo (vanished tx, node that never reports "dropped") can
	 *  re-enter the retry path instead of waiting forever. */
	claimAttemptAt?: number
	/** Latched journal-first BEFORE any fjwc-embedded wallet call (L14 trigger 1 precondition). */
	claimAttempt?: boolean
	/** The fjwc attempt's tx hash, persisted as soon as the wallet returns it. */
	claimTxHash?: string
	/** Set when an fjwc-embedded claim tx reads INCLUDED (success OR app-revert) - the FJ message is consumed. */
	consumed?: boolean
	/** Set when a standalone sponsored FJ claim landed (the fee-spike path or the card's recovery
	 *  action). Distinguishes "fuel recovered separately" from "still stranded".
	 *  PUBLIC fuel only — the private path NEVER uses a sponsored/public standalone claim (privacy). */
	standaloneClaimed?: boolean
	/** PRIVATE fuel only — the per-deposit salt fed to `deriveBridgeSecret(salt, claimer)`; the claim
	 *  rebuilds the FJ secret from it. Random per deposit (the PrivateFPC nullifier binds it, so reuse
	 *  collides). DISTINCT from the FPC-ADDRESS salt (always `Fr.zero()`). For private records the
	 *  authoritative copy is sealed (recovery-crypto); this plaintext copy is a display/recovery hint. */
	bridgeSecretSalt?: string
	/** PRIVATE fuel only — the PrivateFPC L2 address the FJ was deposited to (`fuelRecipient`).
	 *  Persisted for post-hoc address-drift detection and to rebuild the claim. */
	fpc?: string
	/** PRIVATE fuel only — set when the last claim send threw the `mint_and_pay_fee` insufficiency assert
	 *  (the tx is INVALID pre-inclusion, so the FJ stays unconsumed). The ONE signal that authorises a
	 *  retry of the private claim without a tx hash (the narrow allow-list); cleared once a hash lands. */
	setupInsufficiency?: boolean
}

export interface DepositJournalRecord extends JournalBase {
	direction: "deposit"
	/** Which asset this deposit bridges. Absent ⇒ "bridge-token" (ADDITIVE — pre-Fuel records have no
	 *  field and the loader never gates on it). "fee-juice" = a direct Fuel bridge (L1 fee asset → L2 Fee
	 *  Juice via the canonical FeeJuicePortal); its deployment binding is {portal: FeeJuicePortal, bridge:
	 *  L2 FeeJuice address}, NOT the token bridge. */
	assetKind?: "bridge-token" | "fee-juice"
	/** Display + pre-unseal guard for private; claim arg for public (self-authenticating on-chain). */
	recipient: string
	/** PUBLIC only - recipient-bound by the L1 content hash (tamper ⇒ claim fails, never redirects). */
	secret?: string
	/** PRIVATE only - the AES-GCM envelope holding {secret, recipient, amount, sealerL1, leafIndex?}. */
	sealedEnvelope?: string
	secretHashHex: string
	/** Display copy of the sealing L1 account (authoritative copy lives inside the envelope). */
	sealerL1?: string
	/** Persisted the moment writeContract returns - leafIndex stays chain-recoverable. */
	depositTxHash?: string
	leafIndex?: string
	/** The token L1→L2 message key (inbox leaf hash) from `BridgeWithFuel.tokenKey` / the DepositToAztec
	 *  event. The 5.0 readiness gate polls `getL1ToL2MessageCheckpoint` on this before simulating the claim. */
	messageHash?: string
	claimTxHash?: string
	/** The Aztec block height when the L1 deposit confirmed - anchors the sync countdown
	 *  (display pacing only; the claim-simulate gate stays the consumability authority). */
	depositL2Block?: number
	/** Present ⟺ schema 2: the deposit bought fuel on the way in. */
	fuel?: DepositFuelBlock
}

export interface WithdrawJournalRecord extends JournalBase {
	direction: "withdraw"
	/** Bound in the L2→L1 message - tamper makes the consume revert. */
	recipientL1: string
	exitTxHash?: string
	exitBlock?: number
	consumeTxHash?: string
}

export type BridgeJournalRecord = DepositJournalRecord | WithdrawJournalRecord

/** The deposit's asset variant, defaulting to the legacy "bridge-token" for records written before Fuel
 *  existed (the field is additive; absent ⇒ token bridge). Withdraws are always token-bridge. The ONE
 *  place the default is decided, so every consumer (deploymentMatches, backup, receipt) agrees. */
export function assetKindOf(rec: BridgeJournalRecord): "bridge-token" | "fee-juice" {
	return rec.direction === "deposit" && rec.assetKind === "fee-juice" ? "fee-juice" : "bridge-token"
}

/** Canonical display stages - closed sets, stable for e2e selectors. */
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

/** Prioritized retention under MAX_RECORDS: unfinished records are NEVER evicted - an unfinished
 *  private deposit may hold the only sealed recovery blob, and an attacker who can flood storage
 *  with unfinished junk could otherwise use the cap itself as an eviction tool (worse than the
 *  deletion he can already do directly). The cap trims only completed records, newest first; a
 *  junk flood degrades the UI, never the data. */
export function capRecords(records: BridgeJournalRecord[]): BridgeJournalRecord[] {
	if (records.length <= MAX_RECORDS) return records
	const unfinished = records.filter((r) => !r.completedAt)
	const completed = records.filter((r) => r.completedAt).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
	return [...unfinished, ...completed.slice(0, Math.max(0, MAX_RECORDS - unfinished.length))]
}

export function loadJournal(kv: KV): BridgeJournalRecord[] {
	return parseRecords(kv.getItem(JOURNAL_KEY))
}

function write(kv: KV, records: BridgeJournalRecord[]): void {
	kv.setItem(JOURNAL_KEY, JSON.stringify({ schema: 1, records: capRecords(records) }))
}

/** Insert-or-replace by id - re-reads the journal first (per-record merge; see module header). */
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

/** Delete the pre-journal single-pending keys. No migration - plan L15 (dev phase). */
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
