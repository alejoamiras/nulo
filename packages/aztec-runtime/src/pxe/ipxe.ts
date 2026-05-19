/**
 * `IPXE` — the in-process facade a profile gets for a single network.
 *
 * `PxeServiceClient` in extension is the SW-side RPC transport;
 * `PXEProxy` (also in extension) wraps one PxeServiceClient + a Network
 * pair into an IPXE impl. Moving the interface to aztec-runtime lets
 * aztec-runtime-owned consumers (`IAccountContract`, NuloAccount) type
 * against it without circular-depending on extension.
 */

import type { Fr } from "@aztec/foundation/curves/bn254"
import type { NotesFilter, PackedPrivateEvent, SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
import type { ContractArtifact, EventSelector, FunctionCall } from "@aztec/stdlib/abi"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { CompleteAddress, ContractInstanceWithAddress, PartialAddress } from "@aztec/stdlib/contract"
import type { NoteDao } from "@aztec/stdlib/note"
import type {
	BlockHeader,
	TxExecutionRequest,
	TxProfileResult,
	TxProvingResult,
	TxSimulationResult,
	UtilityExecutionResult,
} from "@aztec/stdlib/tx"
import type { PrivateEventFilter } from "@aztec/aztec.js/wallet"

export interface IPXE {
	getContractInstance(address: AztecAddress): Promise<ContractInstanceWithAddress | undefined>
	getContractArtifact(id: Fr): Promise<ContractArtifact | undefined>
	registerAccount(secretKey: Fr, partialAddress: PartialAddress): Promise<CompleteAddress>
	registerSender(address: AztecAddress): Promise<AztecAddress>
	getSenders(): Promise<AztecAddress[]>
	removeSender(address: AztecAddress): Promise<void>
	getRegisteredAccounts(): Promise<CompleteAddress[]>
	registerContractClass(artifact: ContractArtifact): Promise<void>
	registerContract(contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact }): Promise<void>
	updateContract(contractAddress: AztecAddress, artifact: ContractArtifact): Promise<void>
	getContracts(): Promise<AztecAddress[]>
	getNotes(filter: NotesFilter): Promise<NoteDao[]>
	proveTx(txRequest: TxExecutionRequest, scopes: AztecAddress[]): Promise<TxProvingResult>
	profileTx(txRequest: TxExecutionRequest, opts: ProfileTxOpts): Promise<TxProfileResult>
	simulateTx(txRequest: TxExecutionRequest, opts: SimulateTxOpts, stubAccountAddresses?: string[]): Promise<TxSimulationResult>
	executeUtility(call: FunctionCall, opts: ExecuteUtilityOpts): Promise<UtilityExecutionResult>
	getPrivateEvents<_T>(eventSelector: EventSelector, filter: PrivateEventFilter): Promise<PackedPrivateEvent[]>
	/** Returns the PXE's latest synchronized block header. Used by the
	 *  fast path as the anchor for `simulateViaNode` so both arms of a
	 *  mixed simulation observe the same chain state. Mirrors upstream
	 *  `BaseWallet.simulateTx`'s try-PXE-first-then-node-fallback pattern. */
	getSyncedBlockHeader(): Promise<BlockHeader>
}
