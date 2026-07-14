import type { Fr } from "@aztec/foundation/curves/bn254"
import type { SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
import type { ContractArtifact, EventSelector, FunctionCall } from "@aztec/stdlib/abi"
import { ContractArtifactSchema } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import {
	CompleteAddress,
	type ContractInstanceWithAddress,
	type PartialAddress,
	ContractInstanceWithAddressSchema,
} from "@aztec/stdlib/contract"
import type { NoteDao } from "@aztec/stdlib/note"
import {
	BlockHeader,
	type TxExecutionRequest,
	TxProfileResult,
	TxProvingResult,
	TxSimulationResult,
	UtilityExecutionResult,
} from "@aztec/stdlib/tx"
import type { PrivateEventFilter } from "@aztec/aztec.js/wallet"
import type { PackedPrivateEvent } from "@aztec/pxe/client/bundle"
import z from "zod"
import type { ILogger } from "@nulo/wallet-core/logger"
import type { ServiceSpec } from "@nulo/wallet-core/base"
import { ServiceClient } from "@nulo/extension-messaging/offscreen"
import type { NetworkInfo } from "./chain-runtime"
import type { IPXE } from "./ipxe"
import type { Methods, NotesFilter, NoteSchema } from "./spec"
import { PXE_SERVICE_NAME } from "./spec"
import { NoteDaoSchema, PackedPrivateEventSchema } from "./schemas"
import { PXEProxy } from "./proxy"

/**
 * Base PXE service client. Chrome-agnostic: does no offscreen
 * bootstrap — that belongs to the embedder (extension subclass
 * overrides `onReady` to call `ensureOffscreenRunning`).
 *
 * Callers in aztec-runtime should accept this type; callers in the
 * extension should use the concrete `PxeServiceClient` subclass which
 * wires up the Chrome offscreen transport.
 */
/**
 * Per-method timeout overrides for the PXE transport.
 *
 * `proveTx` runs BB.wasm proving, which is uninterruptible and can take
 * many minutes (10+ on slow hardware for circuit-heavy txs). The default
 * 90s ceiling would fire mid-proof on those, surfacing a misleading
 * "timeout" error instead of letting the prove complete.
 *
 * Phase 2's `cancelJob` is the user-facing cancel path (lossy: SW journal
 * transitions to `cancelled` immediately; the in-flight offscreen prove
 * keeps running, but the result is silently dropped on arrival). With
 * that in place, the offscreen timeout no longer needs to act as a cancel
 * mechanism — it only needs to be a sanity ceiling for a *stuck* worker.
 *
 * 30 minutes is comfortably above any realistic prove duration while
 * still bounded.
 */
const PROVE_TX_TIMEOUT_MS = 30 * 60_000

export class PxeServiceClientBase extends ServiceClient<Methods> implements ServiceSpec<Methods> {
	public constructor(logger: ILogger) {
		super(PXE_SERVICE_NAME, logger)
	}

	protected override getRequestTimeoutMs(method: keyof Methods): number {
		if (method === "proveTx") return PROVE_TX_TIMEOUT_MS
		return super.getRequestTimeoutMs(method)
	}

	public getPXE(network: NetworkInfo): IPXE {
		return new PXEProxy(this, network)
	}

	public async getContractInstance(
		network: NetworkInfo,
		address: AztecAddress,
		opts?: { pxeOnly?: boolean; nodeBestEffort?: boolean },
	): Promise<ContractInstanceWithAddress | undefined> {
		const result = await this.request("getContractInstance", network, address, opts)
		return await ContractInstanceWithAddressSchema.optional().parseAsync(result)
	}

	public async getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): Promise<ContractArtifact | undefined> {
		const result = await this.request("getContractArtifact", network, id, opts)
		return await ContractArtifactSchema.optional().parseAsync(result)
	}

	public async getNoteSchemas(): Promise<Record<string, Record<string, NoteSchema>>> {
		const result = await this.request("getNoteSchemas")
		return (result ?? {}) as Record<string, Record<string, NoteSchema>>
	}

	public async registerAccount(network: NetworkInfo, secretKey: Fr, partialAddress: PartialAddress): Promise<CompleteAddress> {
		const result = await this.request("registerAccount", network, secretKey, partialAddress)
		return await CompleteAddress.schema.parseAsync(result)
	}

	public async registerSender(network: NetworkInfo, address: AztecAddress): Promise<AztecAddress> {
		const result = await this.request("registerSender", network, address)
		return await AztecAddress.schema.parseAsync(result)
	}

	public async getSenders(network: NetworkInfo): Promise<AztecAddress[]> {
		const result = await this.request("getSenders", network)
		return await z.array(AztecAddress.schema).parseAsync(result)
	}

	public async removeSender(network: NetworkInfo, address: AztecAddress): Promise<void> {
		await this.request("removeSender", network, address)
	}

	public async getRegisteredAccounts(network: NetworkInfo): Promise<CompleteAddress[]> {
		const result = await this.request("getRegisteredAccounts", network)
		return await z.array(CompleteAddress.schema).parseAsync(result)
	}

	public async registerContractClass(network: NetworkInfo, artifact: ContractArtifact): Promise<void> {
		await this.request("registerContractClass", network, artifact)
	}

	public async registerContract(
		network: NetworkInfo,
		contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact },
	): Promise<void> {
		await this.request("registerContract", network, contract)
	}

	public async getContracts(network: NetworkInfo): Promise<AztecAddress[]> {
		const result = await this.request("getContracts", network)
		return await z.array(AztecAddress.schema).parseAsync(result)
	}

	public async getNotes(network: NetworkInfo, filter: NotesFilter): Promise<NoteDao[]> {
		const result = await this.request("getNotes", network, filter)
		// Schema rehydrates data fields (Fr, AztecAddress, etc.) after JSON round-trip from offscreen,
		// but produces plain objects, not NoteDao class instances. Cast is safe because consumers
		// (NoteService) only access data properties, never class methods like toBuffer/equals.
		return (await z.array(NoteDaoSchema).parseAsync(result)) as unknown as NoteDao[]
	}

	public async proveTx(network: NetworkInfo, txRequest: TxExecutionRequest, scopes: AztecAddress[]): Promise<TxProvingResult> {
		const result = await this.request("proveTx", network, txRequest, scopes)
		return await TxProvingResult.schema.parseAsync(result)
	}

	public async profileTx(network: NetworkInfo, txRequest: TxExecutionRequest, opts: ProfileTxOpts): Promise<TxProfileResult> {
		const result = await this.request("profileTx", network, txRequest, opts)
		return await TxProfileResult.schema.parseAsync(result)
	}

	public async simulateTx(
		network: NetworkInfo,
		txRequest: TxExecutionRequest,
		opts: SimulateTxOpts,
		stubAccountAddresses?: string[],
	): Promise<TxSimulationResult> {
		const result = await this.request("simulateTx", network, txRequest, opts, stubAccountAddresses)
		return await TxSimulationResult.schema.parseAsync(result)
	}

	public async executeUtility(network: NetworkInfo, call: FunctionCall, opts: ExecuteUtilityOpts): Promise<UtilityExecutionResult> {
		const result = await this.request("executeUtility", network, call, opts)
		return await UtilityExecutionResult.schema.parseAsync(result)
	}

	public async getPrivateEvents(
		network: NetworkInfo,
		eventSelector: EventSelector,
		filter: PrivateEventFilter,
	): Promise<PackedPrivateEvent[]> {
		const result = await this.request("getPrivateEvents", network, eventSelector, filter)
		return await z.array(PackedPrivateEventSchema).parseAsync(result)
	}

	/** PXE's latest synchronized block header. Used as the fast-path
	 *  anchor for tx construction. */
	public async getSyncedBlockHeader(network: NetworkInfo): Promise<BlockHeader> {
		const result = await this.request("getSyncedBlockHeader", network)
		return await BlockHeader.schema.parseAsync(result)
	}

	/** Chain-derived UTC seconds for a specific L2 block. Returns
	 *  `undefined` when the node can't resolve it. Activity-feed consumers
	 *  use this to sort/render chronologically across remove+re-add cycles. */
	public async getBlockTimestamp(network: NetworkInfo, blockNumber: number): Promise<number | undefined> {
		const result = await this.request("getBlockTimestamp", network, blockNumber)
		if (result === undefined || result === null) return undefined
		return Number(result)
	}

	/** Dispose the offscreen runtime for `(profileId, chainId)` and delete
	 *  its IndexedDB. SW-side cascade entry-point for `NetworkService.purgeChain`. */
	public async clearChainState(profileId: string, chainId: number): Promise<void> {
		await this.request("clearChainState", profileId, chainId)
	}

	public async clearProfileState(profileId: string): Promise<void> {
		await this.request("clearProfileState", profileId)
	}
}
