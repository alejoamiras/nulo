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
import {
	type PublicScanTips,
	type PublicTokenClassStatus,
	type PublicTransferFetchArgs,
	type PublicTransferPage,
	PublicScanTipsSchema,
	PublicTokenClassStatusSchema,
	PublicTransferPageSchema,
} from "./public-events"
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

/** What the SW-side store-key provider yields: the derived 32-byte key PLUS the
 *  profile row's current incarnation generation, both read under the facade lock
 *  at SEND time — a provision can never pair a fresh key with a stale generation
 *  (or vice versa), which is what lets the offscreen lifecycle fence reject
 *  resurrection attempts (#281 D4). */
export interface StoreKeyProvision {
	key: Uint8Array
	generation: string
}

export class PxeServiceClientBase extends ServiceClient<Methods> implements ServiceSpec<Methods> {
	/** SW-side derivation hook for the per-profile store encryption key (see
	 *  `setStoreKeyProvider`). Undefined until the embedder wires it at boot. */
	private storeKeyProvider?: (profileId: string) => Promise<StoreKeyProvision | undefined>
	/** SW-side lookup of the profile row's CURRENT incarnation generation, used to
	 *  stamp `pxeGeneration` onto outgoing ops' NetworkInfo (see `request`). Kept
	 *  separate from the key provider so op capture doesn't pay an HKDF per call. */
	private generationProvider?: (profileId: string) => Promise<string | undefined>

	public constructor(logger: ILogger) {
		super(PXE_SERVICE_NAME, logger)
	}

	protected override getRequestTimeoutMs(method: keyof Methods): number {
		// `proveTx` and the profile-destructive clears all DRAIN behind a proof: a delete
		// acquires the profile WRITE barrier, which waits for an in-flight ~30-minute proof
		// on that profile to finish. At the default ~90s these clears timed out behind a
		// legitimate proof, the deletion coordinator rejected, tombstone phase-3 never ran,
		// and the id stayed reserved forever (concurrency audit HIGH #2). Give them the same
		// envelope as the proof they wait on.
		if (method === "proveTx" || method === "clearChainState" || method === "clearProfileState") return PROVE_TX_TIMEOUT_MS
		return super.getRequestTimeoutMs(method)
	}

	/**
	 * Register the SW-side store-key derivation hook (typically `derivePxeStoreKey(master,
	 * profileId)` against the in-memory session, paired with the row's `pxeGeneration`, all
	 * under the facade lock). The offscreen holds provisioned keys in memory only, so an
	 * offscreen-document restart drops them; when a request then fails with the
	 * `PXE_STORE_KEY_MISSING` marker, this client derives + re-provisions + retries ONCE. The
	 * provider returning `undefined` (profile locked / row gone / tombstoned) lets the original
	 * error propagate — a locked or deleted profile cannot open its encrypted PXE store.
	 */
	public setStoreKeyProvider(provider: (profileId: string) => Promise<StoreKeyProvision | undefined>): void {
		this.storeKeyProvider = provider
	}

	/** Register the generation lookup for op capture. Optional: without it, ops go
	 *  out uncaptured and only the provision-time fence applies. */
	public setGenerationProvider(provider: (profileId: string) => Promise<string | undefined>): void {
		this.generationProvider = provider
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 21) — refactor when touched, never raise
	protected override async request<T extends keyof Methods>(
		method: T,
		...args: Parameters<Methods[T]>
	): Promise<Awaited<ReturnType<Methods[T]>>> {
		// Capture the incarnation generation ONCE per logical op, before the first
		// send: the missing-key retry below re-sends the SAME args, so the retry
		// REUSES the capture — an op that outlived a delete + same-id re-import
		// carries its original generation and is rejected offscreen-side instead
		// of silently running against the successor's store (#281 D4).
		const netArg = args[0] as (NetworkInfo & { pxeGeneration?: string }) | undefined
		if (
			netArg &&
			typeof netArg === "object" &&
			"profileId" in netArg &&
			"chainId" in netArg &&
			!netArg.pxeGeneration &&
			this.generationProvider
		) {
			const generation = await this.generationProvider(netArg.profileId)
			// A registered provider returning undefined means the profile row is GONE or
			// tombstoned — exactly the deletion window the fence exists for. Failing here
			// beats silently sending the op UNCAPTURED (which would bypass the op-level
			// fence and rely solely on the store-key fail-close; review finding).
			if (!generation) {
				throw new Error(`pxe op rejected: profile ${netArg.profileId} has no current incarnation (deleted or tombstoned)`)
			}
			args = [...args] as Parameters<Methods[T]>
			args[0] = { ...netArg, pxeGeneration: generation }
		}
		try {
			return await super.request(method, ...args)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			const profileId = (args[0] as NetworkInfo | undefined)?.profileId
			if (method === "provisionChainStoreKey" || !message.includes("PXE_STORE_KEY_MISSING") || !profileId || !this.storeKeyProvider) {
				throw err
			}
			// AUDIT D4-hardening: the recovery sequence is readiness ONCE, then
			// authority ONCE, then already-ready sends — no `onReady` (which can
			// recreate the offscreen document and reset its lifecycle map) may run
			// between the authority read and the wire, or a concurrent delete +
			// recreation could let a stale provision land on an empty map.
			await this.onReady()
			const provision = await this.storeKeyProvider(profileId)
			if (!provision) throw err
			try {
				// Capture-equality guard, POST-STAMP (the capture block above mutated
				// args[0]) and capture-conditional: an UNCAPTURED op keeps the
				// documented provision-then-retry contract, but a captured op whose
				// generation differs from the provider's current row must not
				// side-effect-install a newer key from its own error path — the
				// original error propagates untouched.
				const captured = (args[0] as { pxeGeneration?: string } | undefined)?.pxeGeneration
				if (captured && provision.generation !== captured) throw err
				// Revalidate the incarnation immediately before the wire: `onReady`
				// above can have REPLACED the offscreen document, and a deletion that
				// completed against the OLD document leaves the replacement's
				// lifecycle map empty — this stale provision would install the erased
				// generation as live (ghost profile; a later same-id re-import is
				// then wedged behind the live-under-different-generation rejection).
				// A gone or superseded row aborts with the original error.
				if (this.generationProvider) {
					const liveGeneration = await this.generationProvider(profileId)
					if (liveGeneration !== provision.generation) throw err
				}
				// The base64 wire copy cannot be zeroized (JS strings are
				// immutable); the key bytes below are, in every exit path.
				await this.requestAlreadyReady(
					"provisionChainStoreKey" as T,
					...([profileId, btoa(String.fromCharCode(...provision.key)), provision.generation] as unknown as Parameters<
						Methods[T]
					>),
				)
				// A provision/retry send failure propagates AS ITSELF (more
				// diagnostic than the original marker error), and the retry runs
				// exactly once — a second missing-key rejection is terminal.
				return await this.requestAlreadyReady(method, ...args)
			} finally {
				provision.key.fill(0)
			}
		}
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

	/** One page of decoded public `Transfer` events for `(network, contract)` (D1). */
	public async getPublicTokenTransferEvents(
		network: NetworkInfo,
		contract: string,
		args: PublicTransferFetchArgs,
	): Promise<PublicTransferPage> {
		const result = await this.request("getPublicTokenTransferEvents", network, contract, args)
		return await PublicTransferPageSchema.parseAsync(result)
	}

	/** The checkpointed + finalized tips for the D6 index bound + rewind floor. */
	public async getPublicScanTips(network: NetworkInfo): Promise<PublicScanTips> {
		const result = await this.request("getPublicScanTips", network)
		return await PublicScanTipsSchema.parseAsync(result)
	}

	/** Node-direct class gate (D2): whether `contract` is the bundled Token at the finalized anchor. */
	public async getPublicTokenClassStatus(
		network: NetworkInfo,
		contract: string,
		checkpointHash: string,
	): Promise<PublicTokenClassStatus> {
		const result = await this.request("getPublicTokenClassStatus", network, contract, checkpointHash)
		return await PublicTokenClassStatusSchema.parseAsync(result)
	}

	/** Dispose the offscreen runtime for `(profileId, chainId)` and delete
	 *  its IndexedDB. SW-side cascade entry-point for `NetworkService.purgeChain`. */
	public async clearChainState(profileId: string, chainId: number): Promise<void> {
		await this.request("clearChainState", profileId, chainId)
	}

	/** `generation` is the incarnation being erased, read from the tombstone carry —
	 *  NOT the row (the row is already gone by deletion time). */
	public async clearProfileState(profileId: string, generation: string): Promise<void> {
		await this.request("clearProfileState", profileId, generation)
	}

	/** Provision the per-profile PXE store encryption key (32 bytes, base64-encoded) under the
	 *  profile's current incarnation generation. Fired by the missing-key retry path. */
	public async provisionChainStoreKey(profileId: string, storeKeyBase64: string, generation: string): Promise<void> {
		await this.request("provisionChainStoreKey", profileId, storeKeyBase64, generation)
	}
}
