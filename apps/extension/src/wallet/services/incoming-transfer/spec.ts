/**
 * `IncomingTransferService` surfaces notes that arrived on the user's account
 * from known fungible-token contracts. Bridges the gap between PXE's
 * decrypted-note view (already populated for balance display) and the
 * activity feed, which previously only showed outgoing tx records.
 *
 * Scope guarantees (locked at plan v2.1, audit A10/A13/A23):
 *   - Records are keyed by `siloedNullifier` — cryptographically unique per
 *     note, so duplicate inserts are idempotent.
 *   - Dedupe runs against three sources: prior records (siloedNullifier
 *     equality), the user's own outgoing tx hashes (TransactionService),
 *     and in-flight journal records with a `progress.txHash` (OperationJournal).
 *   - Pollution defense via the `IncomingTrustState` state machine:
 *     `unknown` → first note arrival → `pending` (record hidden, popup
 *     prompts user) → `trusted` (record visible + future receives auto-
 *     display) OR `blocked` (records stay hidden forever).
 *   - Scope is locked to fungible-token receives for tokens the user has
 *     explicitly added. NFTs + unknown-contract notes are out.
 */

export const INCOMING_TRANSFER_SERVICE_NAME = "incoming-transfer"

/** Trust-state per `(profileId, networkId, contract)`. Replaces the v1
 *  split-state shape (Token boolean + blocked Set + hidden flag) that left
 *  bursty-during-pending behaviour under-specified. */
import { z } from "zod"

export type IncomingTrustState = "unknown" | "pending" | "trusted" | "blocked"

import { type PublicEventCursor, PublicEventCursorSchema } from "@nulo/aztec-runtime/pxe/public-events"
export type { PublicEventCursor }

/** Discriminates the two receipt arms: privately-delivered notes vs public `Transfer` events. */
export type IncomingTransferKind = "note" | "public-event"

/** Fields common to BOTH record kinds. */
type IncomingTransferRecordCommon = {
	/**
	 * PRIMARY KEY + storage key. Profile+network scoped so the same seed in two profiles (or two
	 * networkIds on one chainId) can never collide. Built via {@link noteRecordId} /
	 * {@link publicRecordId}.
	 */
	id: string
	/** Profile owning the discovery surface. */
	profileId: string
	/** Network id (internal row id, not chainId) — matches `network.id` scoping. */
	networkId: string
	/** The user's account that received the transfer. */
	accountAddress: string
	/** Token contract address. */
	contract: string
	/** Token id in the local TokenService catalogue. Optional (user may remove the token). */
	tokenId?: number
	/** Amount as a u128 stringified decimal. */
	amountRaw: string
	/** The tx that produced this receipt (dedupe against outgoing + late-delete). */
	txHash: string
	/** Block height of the parent tx. Ordering field. */
	l2BlockNumber: number
	/** Index of the parent tx within the block. Ordering field. */
	txIndexInBlock: number
	/**
	 * Index within the parent tx — `noteIndexInTx` for notes, `logIndexWithinTx` for public
	 * events. Different index spaces, so within-tx ordering of a mixed note+public pair is
	 * arbitrary; the block+txIndex prefix keeps cross-tx ordering correct.
	 */
	indexInTx: number
	/** When `true`, suppressed from rendering (contract `pending` or `blocked`). */
	hidden: boolean
	/** Local Date.now() at first discovery. Fallback ordering tiebreak. */
	discoveredAt: number
	/**
	 * Chain-derived UTC seconds for the parent block. Optional (transient resolve failure /
	 * legacy). Activity-feed sort prefers `blockTimestamp ?? discoveredAt` so order survives
	 * token remove + re-add.
	 */
	blockTimestamp?: number
}

/** A privately-delivered note receipt (the pre-existing arm). */
export type IncomingNoteRecord = IncomingTransferRecordCommon & {
	kind: "note"
	/** Cryptographically-unique nullifier (`Fr` string) — the note's identity. */
	siloedNullifier: string
	/** Note's commitment hash (additional identity field). */
	noteHash: string
	/** Note's owner (the user's account at note-encoded time). */
	owner: string
}

/** A public `Transfer` event receipt (the new arm). */
export type IncomingPublicEventRecord = IncomingTransferRecordCommon & {
	kind: "public-event"
	/**
	 * Sender address. `PRIVATE_ADDRESS_MAGIC_VALUE` = came-from-private (private→public); the
	 * zero address = mint. Display-only — never an authz input.
	 */
	from: string
	/** Block hash — the D6 reorg-reconciliation key. */
	blockHash: string
}

/** Persisted shape per discovered incoming receipt (discriminated on `kind`). */
export type IncomingTransferRecord = IncomingNoteRecord | IncomingPublicEventRecord

/** Build the profile+network-scoped PK for a note record. */
export function noteRecordId(profileId: string, networkId: string, siloedNullifier: string): string {
	return `note:${profileId}|${networkId}|${siloedNullifier}`
}

/** Build the profile+network-scoped PK for a public-event record. */
export function publicRecordId(profileId: string, networkId: string, txHash: string, logIndexWithinTx: number): string {
	return `pub:${profileId}|${networkId}|${txHash}|${logIndexWithinTx}`
}

const incomingTransferRecordCommonShape = {
	id: z.string(),
	profileId: z.string(),
	networkId: z.string(),
	accountAddress: z.string(),
	contract: z.string(),
	tokenId: z.number().optional(),
	amountRaw: z.string(),
	txHash: z.string(),
	l2BlockNumber: z.number(),
	txIndexInBlock: z.number(),
	indexInTx: z.number(),
	hidden: z.boolean(),
	discoveredAt: z.number(),
	blockTimestamp: z.number().optional(),
} as const

/** Storage codec row schema — a discriminated union mirroring `IncomingTransferRecord` exactly. */
export const IncomingTransferRecordSchema: z.ZodType<IncomingTransferRecord> = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("note"),
		...incomingTransferRecordCommonShape,
		siloedNullifier: z.string(),
		noteHash: z.string(),
		owner: z.string(),
	}),
	z.object({
		kind: z.literal("public-event"),
		...incomingTransferRecordCommonShape,
		from: z.string(),
		blockHash: z.string(),
	}),
])

/** Trust-state row keyed by `(profileId, networkId, contract)`. */
export type IncomingTrustRecord = {
	profileId: string
	networkId: string
	contract: string
	state: IncomingTrustState
	/** Last transition timestamp. Debug + future analytics. */
	updatedAt: number
}

/** Storage codec row schema — mirrors `IncomingTrustRecord` exactly. */
export const IncomingTrustRecordSchema: z.ZodType<IncomingTrustRecord> = z.object({
	profileId: z.string(),
	networkId: z.string(),
	contract: z.string(),
	state: z.enum(["unknown", "pending", "trusted", "blocked"]),
	updatedAt: z.number(),
})

/**
 * Per-`(profileId, networkId, contract)` public-event scan cursor (D3/D6). The service is the SOLE
 * writer, only inside the service lock + epoch check.
 */
export type PublicScanCursor = {
	/** Last committed page position; `null` = never scanned (start from `startBlock`). */
	cursor: PublicEventCursor | null
	/** D6 reorg anchor — passed as `referenceBlock`; the node throws if this block was reorged out. */
	lastSyncedBlockHash: string | null
	/** D6 rewind FLOOR — the finalized tip AT the last successful scan (NOT the current finalized). */
	lastScanFinalized: number | null
	/** Retrofit seam for a future per-token backfill window. `0` in v1. */
	startBlock: number
	/**
	 * Closes the normal-scan record-before-cursor crash window (D3): written BEFORE a page's record
	 * writes, cleared after the cursor advance. On resume, the range is re-queried with
	 * `referenceBlock = upperHash` to detect a crash+reorg that stranded records on an orphaned fork.
	 */
	pendingPage?: {
		fromCursor: PublicEventCursor | null
		toScannedThrough: PublicEventCursor
		upperHash: string
	}
	/**
	 * Staged, resumable reorg-reconciliation marker (D6). Written BEFORE any mutation; `progress`
	 * resumes a multi-tick/crashed comparison, `seen` accumulates canonical (height, blockHash)
	 * pairs, `upperBoundHash` pins the fork so a mid-reconcile reorg is caught + restarts cleanly.
	 */
	reconciling?: {
		lowerBound: number
		upperBound: number
		upperBoundHash: string
		progress: PublicEventCursor | null
		seen: Array<[height: number, blockHash: string]>
	}
}

/** Build the storage key for a public-scan cursor row. */
export function publicCursorKey(profileId: string, networkId: string, contract: string): string {
	return `${profileId}|${networkId}|${contract}`
}

const pendingPageSchema = z.object({
	fromCursor: PublicEventCursorSchema.nullable(),
	toScannedThrough: PublicEventCursorSchema,
	upperHash: z.string(),
})

const reconcilingSchema = z.object({
	lowerBound: z.number(),
	upperBound: z.number(),
	upperBoundHash: z.string(),
	progress: PublicEventCursorSchema.nullable(),
	seen: z.array(z.tuple([z.number(), z.string()])),
})

/** Storage codec row schema — mirrors `PublicScanCursor` exactly. */
export const PublicScanCursorSchema: z.ZodType<PublicScanCursor> = z.object({
	cursor: PublicEventCursorSchema.nullable(),
	lastSyncedBlockHash: z.string().nullable(),
	lastScanFinalized: z.number().nullable(),
	startBlock: z.number(),
	pendingPage: pendingPageSchema.optional(),
	reconciling: reconcilingSchema.optional(),
})

/**
 * Balance-refresh outbox row (D4), keyed `${profileId}|${networkId}|${accountAddress}|${tokenId}`
 * (natural coalescing — N receipts for one balance = one row). Written for BOTH arms regardless of
 * trust state (a hidden receipt still changed the chain balance).
 */
export type IncomingBalanceOutboxRow = {
	/** When the balance was last marked dirty by a receipt. Overwritten by every new receipt. */
	dirtyAt: number
	/**
	 * The id of the FRESH refresh task anchored to this row (D4 causal ack). Present only when a
	 * fresh post-`dirtyAt` task was minted; the row deletes on THAT task's terminal-success.
	 */
	pendingTaskId?: string
}

/** Build the storage key for a balance-outbox row. */
export function balanceOutboxKey(profileId: string, networkId: string, accountAddress: string, tokenId: number): string {
	return `${profileId}|${networkId}|${accountAddress}|${tokenId}`
}

/** Storage codec row schema — mirrors `IncomingBalanceOutboxRow` exactly. */
export const IncomingBalanceOutboxRowSchema: z.ZodType<IncomingBalanceOutboxRow> = z.object({
	dirtyAt: z.number(),
	pendingTaskId: z.string().optional(),
})

/** Lightweight pending-prompt payload. The popup subscribes and prompts the
 *  user to Allow / Reject the contract. Multiple notes from the same contract
 *  while `state === "pending"` coalesce into ONE prompt — the popup only
 *  reacts to the FIRST pending event per contract; subsequent ones are
 *  no-ops because the contract is already pending. */
export type IncomingTransferPending = {
	profileId: string
	networkId: string
	accountAddress: string
	contract: string
	/** Token id if the user already has the token added (which is the gate
	 *  for any record creation). */
	tokenId?: number
	/** Display symbol from the token catalogue. */
	tokenSymbol?: string
	/** Display decimals from the token catalogue. Used to format amount. */
	tokenDecimals?: number
	/** Note amount (raw, in u128 stringified decimal). */
	amountRaw: string
}

export type Events = {
	onIncomingTransferAdded: IncomingTransferRecord
	onIncomingTransferUpdated: IncomingTransferRecord
	onIncomingTransferDeleted: IncomingTransferRecord
	/** Fires when a record is inserted as `hidden: true` AND the contract's
	 *  trust state transitions to `pending`. Coalesces — only the first per
	 *  contract per pending cycle. */
	onIncomingTransferPending: IncomingTransferPending
	onIncomingTrustChanged: IncomingTrustRecord
}

export type Methods = {
	/**
	 * Returns the visible incoming-transfer records for an account on a
	 * network. Records flagged `hidden: true` (pending / blocked) are
	 * filtered out by default.
	 */
	getIncomingTransfers(profileId: string, networkId: string, accountAddress: string, tokenId?: number): IncomingTransferRecord[]
	/** Trust state for a (profile, network, contract) triple. Returns
	 *  `unknown` for contracts that have never received an incoming note. */
	getTrustState(profileId: string, networkId: string, contract: string): IncomingTrustState
	/** User accepted the first-receive prompt: `pending → trusted`. Flips
	 *  all hidden records for this contract to visible; emits
	 *  `onIncomingTransferAdded` for each. Returns `false` when the contract
	 *  no longer has a token registration (stale-popup race: user deleted
	 *  the token between Pending emit and Allow click) — caller should
	 *  suppress the success toast in that case. */
	setTrustAllow(profileId: string, networkId: string, contract: string): boolean
	/** User rejected the first-receive prompt: `pending → blocked`. Same
	 *  `false`-on-stale-token contract as `setTrustAllow`. */
	setTrustReject(profileId: string, networkId: string, contract: string): boolean
	/** Clear all records + trust state for a profile. Called from the
	 *  profile-delete fanout. */
	clearProfile(profileId: string): void
	/** Clear all records + trust state for a chain (profile-scoped). Called
	 *  from the chain-purge fanout (mirrors `pxe.clearChainState`). */
	clearChain(profileId: string, networkId: string): void
	/** Re-emit `onIncomingTransferPending` for every contract currently in
	 *  pending trust state. Called by the popup-side `PopupManager` on
	 *  (re)connect so a user who closed the popup unresolved doesn't get
	 *  stuck — the next popup load re-prompts. */
	replayPendingPrompts(profileId: string, networkId: string, accountAddress: string): void
}
