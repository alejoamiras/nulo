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
export type IncomingTrustState = "unknown" | "pending" | "trusted" | "blocked"

/** Persisted shape per discovered incoming note. */
export type IncomingTransferRecord = {
	/** Cryptographically-unique key (`Fr` string). Same record under
	 *  multiple inserts is a no-op via the upsert layer. */
	siloedNullifier: string
	/** Profile owning the discovery surface. */
	profileId: string
	/** Network id (internal row id, not chainId) the note was discovered
	 *  on — matches `network.id` used by `appStore.transactions` scoping. */
	networkId: string
	/** The user's account that owns the note. */
	accountAddress: string
	/** Token contract address. */
	contract: string
	/** Token id in the local TokenService catalogue. Optional because the
	 *  user may have removed the token between discovery and read; the
	 *  renderer falls back gracefully. */
	tokenId?: number
	/** Note's owner (the user's account at note-encoded time). */
	owner: string
	/** Decoded `UintNote.value` as a u128 stringified decimal. */
	amountRaw: string
	/** Note's commitment hash (additional identity field; not the primary key). */
	noteHash: string
	/** The tx that minted this note (for dedupe against outgoing). */
	txHash: string
	/** Block height of the parent tx. Ordering field. */
	l2BlockNumber: number
	/** Index of the parent tx within the block. */
	txIndexInBlock: number
	/** Index of the note within the parent tx. */
	noteIndexInTx: number
	/** When `true`, the record is suppressed from rendering — either the
	 *  contract is `pending` (first-receive friction not yet resolved) or
	 *  `blocked`. Trust-state transitions flip this flag. */
	hidden: boolean
	/** Local Date.now() at first discovery. Fallback ordering when
	 *  multiple records share the same block-index tuple. */
	discoveredAt: number
	/**
	 * Chain-derived UTC seconds for the block that minted this note.
	 * Populated at scanContract-time via `noteService.getBlockTimestamp`.
	 * Optional because:
	 *   - Legacy records persisted before this field existed don't have it.
	 *   - PXE may transiently fail to resolve the block; we still persist
	 *     the record so the user doesn't lose discovery state.
	 * Activity-feed sort prefers `blockTimestamp ?? discoveredAt` so the
	 * order survives token remove + re-add (re-indexed records get
	 * identical chain timestamps from PXE).
	 */
	blockTimestamp?: number
}

/** Trust-state row keyed by `(profileId, networkId, contract)`. */
export type IncomingTrustRecord = {
	profileId: string
	networkId: string
	contract: string
	state: IncomingTrustState
	/** Last transition timestamp. Debug + future analytics. */
	updatedAt: number
}

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
	/** Transition the trust state. Use `setTrustAllow` / `setTrustReject`
	 *  wrappers for the canonical user-action paths. */
	setTrustState(profileId: string, networkId: string, contract: string, state: IncomingTrustState): void
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
