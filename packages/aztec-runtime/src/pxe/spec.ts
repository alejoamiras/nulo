import type { PrivateEventFilter } from "@aztec/aztec.js/wallet"
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { PackedPrivateEvent, NotesFilter } from "@aztec/pxe/client/bundle"
export type { NotesFilter }
import type { SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
import type { ContractArtifact, EventSelector, FunctionCall } from "@aztec/stdlib/abi"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { CompleteAddress, ContractInstanceWithAddress, PartialAddress } from "@aztec/stdlib/contract"
import type { NoteSchema } from "./note-schemas"
export type { NoteSchema, NoteFieldSchema, NoteFieldType } from "./note-schemas"
import type { NoteDao } from "@aztec/stdlib/note"
import type {
	BlockHeader,
	TxExecutionRequest,
	TxProfileResult,
	TxProvingResult,
	TxSimulationResult,
	UtilityExecutionResult,
} from "@aztec/stdlib/tx"
import type { NetworkInfo } from "./chain-runtime"
import type { PublicScanTips, PublicTokenClassStatus, PublicTransferFetchArgs, PublicTransferPage } from "./public-events"
export type {
	PublicEventCursor,
	PublicScanTips,
	PublicTokenClassStatus,
	PublicTransferEvent,
	PublicTransferFetchArgs,
	PublicTransferPage,
} from "./public-events"

export const PXE_SERVICE_NAME = "pxe"

export type Methods = {
	/**
	 * `pxeOnly`: stop at the PXE-local index (no node lookup, no known-bundle fallback).
	 * `nodeBestEffort`: if the node leg throws, treat it as "not found" and continue
	 *   the cascade to the known-bundle fallback instead of propagating the error.
	 *   Pairs with `pxeOnly: true` as a no-op — `pxeOnly` short-circuits before the
	 *   node leg, so `nodeBestEffort` has nothing to soften.
	 */
	getContractInstance(
		network: NetworkInfo,
		address: AztecAddress,
		opts?: { pxeOnly?: boolean; nodeBestEffort?: boolean },
	): ContractInstanceWithAddress | undefined
	getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): ContractArtifact | undefined
	/** Returns the wallet's static map of `classId → storageSlotHex → NoteSchema`,
	 *  used by note-rendering callers to label fields. Only the bundled
	 *  standards have entries; absent entries fall back to raw rendering. */
	getNoteSchemas(): Record<string, Record<string, NoteSchema>>
	registerAccount(network: NetworkInfo, secretKey: Fr, partialAddress: PartialAddress): CompleteAddress
	registerSender(network: NetworkInfo, address: AztecAddress): AztecAddress
	getSenders(network: NetworkInfo): AztecAddress[]
	removeSender(network: NetworkInfo, address: AztecAddress): void
	getRegisteredAccounts(network: NetworkInfo): CompleteAddress[]
	registerContractClass(network: NetworkInfo, artifact: ContractArtifact): void
	registerContract(network: NetworkInfo, contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact }): void
	getContracts(network: NetworkInfo): AztecAddress[]
	getNotes(network: NetworkInfo, filter: NotesFilter): NoteDao[]
	proveTx(network: NetworkInfo, txRequest: TxExecutionRequest, scopes: AztecAddress[]): TxProvingResult
	profileTx(network: NetworkInfo, txRequest: TxExecutionRequest, opts: ProfileTxOpts): TxProfileResult
	simulateTx(
		network: NetworkInfo,
		txRequest: TxExecutionRequest,
		opts: SimulateTxOpts,
		stubAccountAddresses?: string[],
	): TxSimulationResult
	executeUtility(network: NetworkInfo, call: FunctionCall, opts: ExecuteUtilityOpts): UtilityExecutionResult
	getPrivateEvents<_T>(network: NetworkInfo, eventSelector: EventSelector, filter: PrivateEventFilter): PackedPrivateEvent[]
	/** PXE's latest synchronized block header. Used as the fast-path anchor
	 *  for the tx-construction fast path. */
	getSyncedBlockHeader(network: NetworkInfo): BlockHeader
	/**
	 * Chain-derived UTC seconds timestamp for an L2 block. Returns
	 * `undefined` when the node can't resolve the block (network error,
	 * unknown block number, etc.) — caller treats undefined as "fall back
	 * to wall-clock." Stable across PXE re-syncs; used by activity-feed
	 * consumers that need chronological order to survive token remove +
	 * re-add (the records get re-indexed from PXE but `Date.now()` would
	 * jump forward; this stays correct).
	 */
	getBlockTimestamp(network: NetworkInfo, blockNumber: number): number | undefined
	/**
	 * Fetch one page of decoded public `Transfer` events for `(network, contract)`, bounded to the
	 * checkpointed tip. `args.afterCursor` resumes pagination; `args.referenceBlock` is the D6 reorg
	 * anchor (the node THROWS if that block was reorged out). Returns the decoded+validated events,
	 * the `scannedThrough` cursor (last log of the page, full or partial; `null` when empty), and
	 * `hasMore` (the node page was exactly full). Node-only read; no PXE store mutation.
	 */
	getPublicTokenTransferEvents(network: NetworkInfo, contract: string, args: PublicTransferFetchArgs): PublicTransferPage
	/** Resolve the checkpointed (index bound) + finalized (D6 rewind floor) tips in one probe. */
	getPublicScanTips(network: NetworkInfo): PublicScanTips
	/**
	 * Node-direct contract-class gate (D2): is `contract`'s CURRENT class (at the finalized anchor)
	 * the bundled aztec-standards Token? `unresolved` = transient (fail closed, do not cache);
	 * `non-standard` = a resolved non-Token / upgraded class (fail closed, cacheable).
	 */
	getPublicTokenClassStatus(network: NetworkInfo, contract: string, checkpointHash: string): PublicTokenClassStatus
	/**
	 * Dispose any active runtime for `(profileId, chainId)` and delete its
	 * IndexedDB at `pxe/${profileId}/${chainId}`. Called by the SW-side
	 * NetworkService.purgeChain coordinator when a chain is removed.
	 */
	clearChainState(profileId: string, chainId: number): void
	/** Profile-wide PXE erase: deletes ALL of a profile's PXE databases by
	 *  prefix (catches orphan/network-less DBs a per-chain clear misses) and
	 *  the shared keyval-store only when no PXE DB survives. Awaited +
	 *  failure-propagating — the deletion coordinator treats a rejection as a
	 *  critical, retryable erasure failure. `generation` is the incarnation
	 *  being erased (from the tombstone carry): a late clear carrying a
	 *  superseded generation can never erase a live successor (#281 D4). */
	clearProfileState(profileId: string, generation: string): void
	/** Provision the per-profile 32-byte PXE store encryption key (base64). Derived SW-side
	 *  from the profile master; in-memory only offscreen-side; a chain runtime fail-closes
	 *  without it. Idempotent — re-provisioned after an offscreen restart. `generation` is
	 *  the profile row's incarnation generation, derived FRESH under the facade lock at
	 *  send time; the offscreen lifecycle fence rejects it for deleting/erased
	 *  incarnations (#281 D4). */
	provisionChainStoreKey(profileId: string, storeKeyBase64: string, generation: string): void
}
