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
	updateContract(network: NetworkInfo, contractAddress: AztecAddress, artifact: ContractArtifact): void
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
	 * Dispose any active runtime for `(profileId, chainId)` and delete its
	 * IndexedDB at `pxe/${profileId}/${chainId}`. Called by the SW-side
	 * NetworkService.purgeChain coordinator when a chain is removed.
	 */
	clearChainState(profileId: string, chainId: number): void
	/**
	 * Failover-safe URL rebind. Disposes the cached `ChainRuntime` for
	 * `(profileId, chainId)` under the per-chain write guard so any
	 * in-flight readers drain first. Does NOT delete the IndexedDB — the
	 * chain DB stays valid across endpoint changes because chainId is
	 * unchanged.
	 *
	 * Distinct from `clearChainState` in two ways:
	 *   - No IndexedDB delete (PXE notes/senders/contracts survive).
	 *   - Caller is the failover engine, not the chain-purge cascade.
	 *
	 * The next `withPxeRead`/`withPxeWrite` against this chain re-initializes
	 * the runtime against the new URL supplied in `NetworkInfo`.
	 */
	rebindChain(profileId: string, chainId: number): void
}
