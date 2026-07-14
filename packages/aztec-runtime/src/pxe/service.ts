import type { PackedPrivateEvent, PXE } from "@aztec/pxe/client/bundle"
import { Fr } from "@aztec/foundation/curves/bn254"
import { type ContractArtifact, ContractArtifactSchema, EventSelector, FunctionCall } from "@aztec/stdlib/abi"
import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import {
	type ContractInstanceWithAddress,
	ContractInstanceWithAddressSchema,
	getContractInstanceFromInstantiationParams,
	type CompleteAddress,
	type PartialAddress,
} from "@aztec/stdlib/contract"
import { BlockParameterSchema } from "@aztec/stdlib/block"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { NoteDao } from "@aztec/stdlib/note"
import { deriveKeys } from "@aztec/stdlib/keys"
import type { NotesFilter } from "./spec"
import { assertNotUpgraded, hydratePreimage } from "./effective-class"
import {
	type BlockHeader,
	SimulationOverrides,
	TxExecutionRequest,
	type TxProvingResult,
	type TxSimulationResult,
	type UtilityExecutionResult,
	type TxProfileResult,
} from "@aztec/stdlib/tx"
import type { SimulateTxOpts, ExecuteUtilityOpts, ProfileTxOpts } from "@aztec/pxe/client/bundle"
import z from "zod"

const AccessScopesSchema = z.array(AztecAddress.schema)
import type { ServiceSpec } from "@nulo/wallet-core/base"
import { Service, defineRpcMethods } from "@nulo/extension-messaging/offscreen"
import type { ILogger } from "@nulo/wallet-core/logger"
import { ReadWriteGuard } from "@nulo/wallet-core/utils"
import type { NetworkInfo } from "./chain-runtime"
import { ChainRuntimeRegistry, ProductionPxeFactory, type PxeFactory } from "./chain-runtime"
import { PXE_DATA_DIR_ROOT, chainDataDir, chainDataDirPrefix, chainRegistryKey, chainRegistryKeyPrefix } from "./chain-coordinates"
import { listChainStoreDirs, removeChainStoreDir, removeProfileStoreDirs } from "./opfs-store"
import { ArtifactRegistry } from "./artifact-registry"
import { loadProductionKnownArtifacts } from "./known-artifacts"
import { loadProductionNoteSchemas, type NoteSchema } from "./note-schemas"
import { type Methods, PXE_SERVICE_NAME } from "./spec"
import { type PrivateEventFilter, PrivateEventFilterSchema } from "@aztec/aztec.js/wallet"
import { NotesFilterSchema } from "./schemas"

export * from "./spec"

/**
 * Minimal structural shape of profile-service surface this service uses.
 * Extension's `ProfileServiceClient` satisfies this via structural
 * subtyping.
 */
export interface IProfileReader {
	connect(): Promise<void>
	getProfiles(): Promise<Array<{ id: string }>>
	onProfileDeleted: { add(handler: (profile: { id: string }) => void): void }
	onActiveProfileChanged: { add(handler: (profile: unknown) => void): void }
}

export class PxeService extends Service<Methods> implements ServiceSpec<Methods> {
	public static name = PXE_SERVICE_NAME

	protected readonly rpcMethods = defineRpcMethods<Methods>()(
		"getContractInstance",
		"getContractArtifact",
		"getNoteSchemas",
		"registerAccount",
		"registerSender",
		"getSenders",
		"removeSender",
		"getRegisteredAccounts",
		"registerContractClass",
		"registerContract",
		"getContracts",
		"getNotes",
		"proveTx",
		"profileTx",
		"simulateTx",
		"executeUtility",
		"getPrivateEvents",
		"getSyncedBlockHeader",
		"getBlockTimestamp",
		"clearChainState",
		"clearProfileState",
		"provisionChainStoreKey",
	)

	private readonly profiles: IProfileReader
	/**
	 * Phase 2 Week 3: two-level concurrency model.
	 *
	 * - `chainGuards` (per-(profileId, chainId)) gates read/write on a
	 *   single chain. Two unrelated chains (different profile or different
	 *   chainId) run fully in parallel — a 10-minute prove on profile A /
	 *   sepolia no longer blocks a `getNotes` on profile B / sandbox.
	 *
	 * - `profileBarriers` (per-profileId) is a write-barrier acquired by
	 *   destructive profile-level ops (delete). Every chain op acquires
	 *   READ on the barrier before touching the chain guard; profile
	 *   delete acquires WRITE, which drains all in-flight chain ops on
	 *   that profile before disposing. No cross-profile contention.
	 *
	 * Guards are allocated lazily (the first op for a given key creates
	 * one) and `profileBarriers` entries are removed on profile delete.
	 * `chainGuards` entries are intentionally NOT removed on clearChainState —
	 * the same chain may be re-added and reusing the guard is harmless.
	 *
	 * Implication: a profile switch no longer disposes the prior profile's
	 * PXE runtimes. Phase 2's durable jobs require an in-flight prove on
	 * profile A to keep running when the user switches to profile B, so
	 * the result can be journalled when it finishes. The PXE for the
	 * inactive profile stays warm until profile delete; memory pressure
	 * across many profiles is a Week 4+ concern (resume policy + chain-
	 * scoped clear).
	 */
	private readonly chainGuards = new Map<string, ReadWriteGuard>()
	private readonly profileBarriers = new Map<string, ReadWriteGuard>()
	private readonly guardLogger: ILogger
	private readonly registry: ChainRuntimeRegistry
	private readonly artifacts: ArtifactRegistry
	/** Per-profile 32-byte store encryption keys, provisioned by the SW after unlock (and
	 *  re-provisioned on demand after an offscreen restart — in-memory only, never persisted).
	 *  Dropped on profile delete. */
	private readonly storeKeys = new Map<string, Uint8Array>()

	public constructor(profiles: IProfileReader, logger: ILogger, factory?: PxeFactory) {
		super(PXE_SERVICE_NAME, logger)
		this.profiles = profiles
		this.guardLogger = logger
		this.artifacts = new ArtifactRegistry(loadProductionKnownArtifacts, { logger, logSource: PXE_SERVICE_NAME })
		this.registry = new ChainRuntimeRegistry(factory ?? new ProductionPxeFactory())
	}

	private chainKey(profileId: string, chainId: number): string {
		return chainRegistryKey({ profileId, chainId })
	}

	private getChainGuard(profileId: string, chainId: number): ReadWriteGuard {
		const k = this.chainKey(profileId, chainId)
		let g = this.chainGuards.get(k)
		if (!g) {
			g = new ReadWriteGuard(`pxe[${k}]`, this.guardLogger)
			this.chainGuards.set(k, g)
		}
		return g
	}

	private getProfileBarrier(profileId: string): ReadWriteGuard {
		let g = this.profileBarriers.get(profileId)
		if (!g) {
			g = new ReadWriteGuard(`pxe-barrier[${profileId}]`, this.guardLogger)
			this.profileBarriers.set(profileId, g)
		}
		return g
	}

	protected async init() {
		// Orphan cleanup runs DEFERRED, never on the init path: this init can be triggered by a
		// deletion-driven offscreen boot, where the SW's deletion coordinator is awaiting our RPC
		// while holding the ProfileService lock — an init-time `profiles.getProfiles()` call
		// would deadlock the reset flow. The deferred sweep is race-safe against that in-flight
		// deletion: the profile row still exists while its purge runs (the coordinator deletes
		// the row LAST), so the sweep skips it; every removal is idempotent + NotFound-swallowed.
		void this.sweepOrphanStores().catch((err) =>
			this.logWarn("deferred orphan-store sweep failed", err instanceof Error ? err.message : String(err)),
		)

		// NOTE: PXE cleanup on profile deletion is NO LONGER a fire-and-forget
		// `onProfileDeleted` subscriber (it raced the cascade + unconditionally
		// deleted the shared keyval-store = cross-profile corruption, finding D).
		// The deletion coordinator now calls the awaited `clearProfileState`.
		this.profiles.onActiveProfileChanged.add(this.onActiveProfileChanged)
		await this.profiles.connect()
	}

	/**
	 * Orphan cleanup, both storage generations (deferred from init — see the deadlock note there):
	 *  - OPFS (the live 5.0.0 backend): the store registry IS the OPFS tree — enumerate
	 *    `pxe/<profileId>/<chainId>` dirs and remove any whose profile no longer exists. Needs no
	 *    live runtime (that is the point of the registry).
	 *  - IndexedDB (LEGACY, rc.2-era): one-way cleanup of pre-OPFS databases — not a fallback
	 *    backend and not a migration; the old data is unreadable by 5.0.0 anyway (upstream wiped
	 *    on schema bump) so only the bytes are being reclaimed. Sweeps them ALL, plus the shared
	 *    keyval-store once none remain.
	 */
	private async sweepOrphanStores(): Promise<void> {
		const opfsDirs = await listChainStoreDirs()
		const dbs = await indexedDB.databases()
		const pxes = dbs.filter((x) => x.name?.startsWith(PXE_DATA_DIR_ROOT))
		if (opfsDirs.length) {
			const profiles = await this.profiles.getProfiles()
			for (const coords of opfsDirs) {
				if (!profiles.some((x) => x.id === coords.profileId)) {
					this.logWarn(`sweep: removing orphan OPFS PXE store ${chainDataDir(coords)}`)
					await removeChainStoreDir(coords)
				}
			}
		}
		if (pxes.length) {
			for (let i = pxes.length - 1; i >= 0; i--) {
				await new Promise<void>((resolve, reject) => {
					const req = indexedDB.deleteDatabase(pxes[i].name!)
					req.onsuccess = () => resolve()
					req.onerror = () => reject(req.error)
					req.onblocked = () => {
						this.logWarn("deleteDatabase blocked (DB still in use):", pxes[i].name)
						resolve() // Skip — don't hang the sweep forever
					}
				})
				pxes.splice(i, 1)
			}
			if (!pxes.length) {
				const keyval = dbs.find((x) => x.name === "keyval-store")
				if (keyval) {
					await new Promise<void>((resolve, reject) => {
						const req = indexedDB.deleteDatabase(keyval.name!)
						req.onsuccess = () => resolve()
						req.onerror = () => reject(req.error)
						req.onblocked = () => {
							this.logWarn("deleteDatabase blocked (DB still in use): keyval-store")
							resolve()
						}
					})
				}
			}
		}
	}

	public async getContractInstance(
		network: NetworkInfo,
		address: AztecAddress,
		opts?: { pxeOnly?: boolean; nodeBestEffort?: boolean },
	): Promise<ContractInstanceWithAddress | undefined> {
		address = await AztecAddress.schema.parseAsync(address)
		return this.withPxeRead("getContractInstance", network, async (pxe, node) => {
			// 5.0.0: the PXE returns the address PREIMAGE (no currentContractClassId); the node
			// returns the full chain-derived instance. Both funnel through the effective-class
			// helper: node-sourced instances reject upgrades explicitly, PXE preimages hydrate
			// under the documented no-upgrades assumption.
			const preimage = await pxe.getContractInstance(address)
			let instance = preimage ? hydratePreimage(preimage) : undefined
			if (!instance && !opts?.pxeOnly) {
				try {
					const nodeInstance = await node.getContract(address)
					instance = nodeInstance ? assertNotUpgraded(nodeInstance) : undefined
				} catch (err) {
					if (!opts?.nodeBestEffort) throw err
					// Node hiccup on a best-effort lookup: degrade to "not found"
					// and continue the cascade so the local known-bundle still has a chance.
					this.logWarn(
						`getContractInstance: node lookup failed for ${address.toString()}, continuing cascade`,
						err instanceof Error ? err.message : String(err),
					)
					instance = undefined
				}
				if (!instance) {
					await this.artifacts.ensureKnown()
					instance = this.artifacts.getKnownInstance(address.toString())
				}
			}
			return instance
		})
	}

	public async getContractArtifact(network: NetworkInfo, id: Fr, opts?: { pxeOnly?: boolean }): Promise<ContractArtifact | undefined> {
		id = await Fr.schema.parseAsync(id)
		return this.withPxeRead("getContractArtifact", network, async (pxe) => {
			return this.artifacts.resolve(id, (classId) => pxe.getContractArtifact(classId), network, opts)
		})
	}

	public async getNoteSchemas(): Promise<Record<string, Record<string, NoteSchema>>> {
		const schemas = await loadProductionNoteSchemas()
		const out: Record<string, Record<string, NoteSchema>> = {}
		for (const [classId, slots] of schemas) {
			out[classId] = Object.fromEntries(slots)
		}
		return out
	}

	public async registerAccount(network: NetworkInfo, secretKey: Fr, partialAddress: PartialAddress): Promise<CompleteAddress> {
		return this.withPxeWrite("registerAccount", network, async (pxe) => {
			// The seam wire carries only the derived privacy SECRET KEY — never the account seed and
			// never the signing key (5.0.0 trust model: the PXE must not hold ownership material, and
			// the signing key is not recoverable from `secretKey`). Upstream now takes the explicit
			// `AccountPrivacyKeys` struct: the four privacy secrets + the message-signing/fallback
			// PUBLIC keys, all derived here from `secretKey`.
			const parsed = await Fr.schema.parseAsync(secretKey)
			const keys = await deriveKeys(parsed)
			return pxe.registerAccount(
				{
					masterNullifierHidingSecretKey: keys.masterNullifierHidingSecretKey,
					masterIncomingViewingSecretKey: keys.masterIncomingViewingSecretKey,
					masterOutgoingViewingSecretKey: keys.masterOutgoingViewingSecretKey,
					masterTaggingSecretKey: keys.masterTaggingSecretKey,
					masterMessageSigningPublicKey: keys.masterMessageSigningPublicKey,
					masterFallbackPublicKey: keys.masterFallbackPublicKey,
				},
				await Fr.schema.parseAsync(partialAddress),
			)
		})
	}

	public async registerSender(network: NetworkInfo, address: AztecAddress): Promise<AztecAddress> {
		// rc.2 folded senders into tagging-secret sources; `address-derived` carries the old sender
		// semantics. The new API returns void, so return the parsed address to keep this service's contract.
		return this.withPxeWrite("registerSender", network, async (pxe) => {
			const sender = await AztecAddress.schema.parseAsync(address)
			await pxe.registerTaggingSecretSource({ kind: "address-derived", sender })
			return sender
		})
	}

	public async getSenders(network: NetworkInfo): Promise<AztecAddress[]> {
		return this.withPxeRead("getSenders", network, async (pxe) =>
			(await pxe.getTaggingSecretSources({ kind: "address-derived" })).map((s) => s.sender),
		)
	}

	public async removeSender(network: NetworkInfo, address: AztecAddress): Promise<void> {
		return this.withPxeWrite("removeSender", network, async (pxe) =>
			pxe.removeTaggingSecretSource({ kind: "address-derived", sender: await AztecAddress.schema.parseAsync(address) }),
		)
	}

	public async getRegisteredAccounts(network: NetworkInfo): Promise<CompleteAddress[]> {
		return this.withPxeRead("getRegisteredAccounts", network, (pxe) => pxe.getRegisteredAccounts())
	}

	public async registerContractClass(network: NetworkInfo, artifact: ContractArtifact): Promise<void> {
		return this.withPxeWrite("registerContractClass", network, async (pxe) =>
			pxe.registerContractClass(await ContractArtifactSchema.parseAsync(artifact)),
		)
	}

	public async registerContract(
		network: NetworkInfo,
		contract: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact },
	): Promise<void> {
		// 5.0.0 split class and instance registration: our seam keeps the `{instance, artifact?}`
		// wire shape and performs both upstream calls. The upstream `registerContract` takes the
		// address PREIMAGE and returns the address it derived — asserting it against the supplied
		// instance's address makes a malformed preimage/address pair fail loudly at registration
		// instead of surfacing later as a wrong-contract identity.
		return this.withPxeWrite("registerContract", network, async (pxe) => {
			const instance = await ContractInstanceWithAddressSchema.parseAsync(contract.instance)
			const artifact = await ContractArtifactSchema.optional().parseAsync(contract.artifact)
			if (artifact) {
				await pxe.registerContractClass(artifact)
			}
			const derived = await pxe.registerContract(instance)
			if (!derived.equals(instance.address)) {
				throw new Error(
					`registerContract address mismatch: PXE derived ${derived.toString()} from the preimage, expected ${instance.address.toString()}`,
				)
			}
		})
	}

	public async getContracts(network: NetworkInfo): Promise<AztecAddress[]> {
		return this.withPxeRead("getContracts", network, (pxe) => pxe.getContracts())
	}

	public async getNotes(network: NetworkInfo, filter: NotesFilter): Promise<NoteDao[]> {
		return this.withPxeWrite("getNotes", network, async (pxe) => pxe.debug.getNotes(await NotesFilterSchema.parseAsync(filter)))
	}

	public async proveTx(network: NetworkInfo, txRequest: TxExecutionRequest, scopes: AztecAddress[]): Promise<TxProvingResult> {
		return this.withPxeWrite("proveTx", network, async (pxe, node) => {
			// DEBUG: log PXE sync state before proving
			try {
				const header = await pxe.getSyncedBlockHeader()
				const nodeTip = await node.getBlockNumber()
				this.logDebug(`[SYNC-DEBUG] proveTx: PXE anchor block=${header.getBlockNumber()}, node tip=${nodeTip}`)
			} catch (e) {
				this.logDebug(`[SYNC-DEBUG] proveTx: failed to read sync state: ${e}`)
			}

			// 5.0 tags private-log messages with the sender; PXE throws "Sender for tags is not set"
			// during private execution (before proving) when it is absent — so any private-note-emitting
			// tx (e.g. public→private shield) fails in witness-gen. The SDK's BaseWallet derives this from
			// `from`; we call proveTx directly, so mirror it: the first scope is the tx sender by our
			// convention (callers build scopes as `[account.address, ...]`).
			// INVARIANT: scopes[0] === the tx sender. Holds for every account-backed path (transfer,
			// dapp-send, view, authwit-discovery). The ONE exception is the NO_FROM discovery path
			// (dapp-send-executor's executeNoFromSendTx), which simulates with dapp-only scopes and no
			// signing account — there senderForTags is not the real sender. That path is public-only
			// today; a private-log-emitting NO_FROM flow must plumb an explicit sender first (codex
			// post-impl audit MEDIUM — tracked for a follow-up).
			const provedScopes = await z.array(AztecAddress.schema).parseAsync(scopes)
			return pxe.proveTx(await TxExecutionRequest.schema.parseAsync(txRequest), {
				scopes: provedScopes,
				senderForTags: provedScopes[0],
			})
		})
	}

	public async simulateTx(
		network: NetworkInfo,
		txRequest: TxExecutionRequest,
		opts: SimulateTxOpts,
		stubAccountAddresses?: string[],
	): Promise<TxSimulationResult> {
		return this.withPxeWrite("simulateTx", network, async (pxe, node) => {
			// DEBUG: log PXE sync state before simulation
			try {
				const header = await pxe.getSyncedBlockHeader()
				const nodeTip = await node.getBlockNumber()
				this.logDebug(`[SYNC-DEBUG] simulateTx: PXE anchor block=${header.getBlockNumber()}, node tip=${nodeTip}`)
			} catch (e) {
				this.logDebug(`[SYNC-DEBUG] simulateTx: failed to read sync state: ${e}`)
			}

			let overrides = await SimulationOverrides.schema.optional().parseAsync(opts.overrides)

			// Source the stub artifact from `@aztec/accounts/stub/schnorr`
			// (the canonical Aztec accounts package) instead of
			// `@aztec/noir-contracts.js/SimulatedSchnorrAccount`. Both
			// packages load the same `SimulatedSchnorrAccount.json`
			// underneath (verified against upstream source —
			// `@aztec/accounts/src/stub/schnorr/index.ts:7-12` does
			// `loadContractArtifact(SimulatedSchnorrAccountJson)`). ECDSA
			// support comes for free when Nulo grows it (sibling import:
			// `@aztec/accounts/ecdsa/stub`).
			if (stubAccountAddresses?.length) {
				const { StubSchnorrAccountContractArtifact } = await import("@aztec/accounts/schnorr/stub")
				const contracts: Record<string, { instance: ContractInstanceWithAddress; artifact: ContractArtifact }> = {}
				for (const addr of stubAccountAddresses) {
					const instance = await getContractInstanceFromInstantiationParams(StubSchnorrAccountContractArtifact, {
						salt: Fr.random(),
					})
					contracts[addr] = { instance, artifact: StubSchnorrAccountContractArtifact }
				}
				overrides = new SimulationOverrides({ ...(overrides?.contracts ?? {}), ...contracts })
			}

			// When we pass `overrides`, upstream PXE enforces
			// `skipKernels: true` (`@aztec/pxe@5.0.0` pxe.js:734 —
			// `if (hasOverriddenContracts && !skipKernels) throw`). Today
			// this works because upstream defaults `skipKernels` to true,
			// but riding a default is fragile: a future upstream change
			// could flip it and silently break overrides. Pass it
			// explicitly when we know we need it.
			const simScopes = await AccessScopesSchema.parseAsync(opts.scopes)
			return await pxe.simulateTx(await TxExecutionRequest.schema.parseAsync(txRequest), {
				simulatePublic: opts.simulatePublic,
				skipTxValidation: opts.skipTxValidation,
				skipFeeEnforcement: opts.skipFeeEnforcement,
				overrides,
				...(overrides ? { skipKernels: true } : {}),
				scopes: simScopes,
				// See proveTx: 5.0 requires the private-log sender or PXE throws "Sender for tags is not
				// set" during private execution. First scope is the tx sender by our convention.
				senderForTags: simScopes[0],
			})
		})
	}

	public async executeUtility(network: NetworkInfo, call: FunctionCall, opts: ExecuteUtilityOpts): Promise<UtilityExecutionResult> {
		return this.withPxeWrite("executeUtility", network, async (pxe) => {
			return await pxe.executeUtility(await FunctionCall.schema.parseAsync(call), {
				authwits: await z.array(AuthWitness.schema).optional().parseAsync(opts.authwits),
				scopes: await AccessScopesSchema.parseAsync(opts.scopes),
			})
		})
	}

	public async profileTx(network: NetworkInfo, txRequest: TxExecutionRequest, opts: ProfileTxOpts): Promise<TxProfileResult> {
		return this.withPxeWrite("profileTx", network, async (pxe) => {
			return await pxe.profileTx(await TxExecutionRequest.schema.parseAsync(txRequest), {
				profileMode: opts.profileMode,
				skipProofGeneration: opts.skipProofGeneration,
				scopes: await AccessScopesSchema.parseAsync(opts.scopes),
			})
		})
	}

	public async getPrivateEvents(
		network: NetworkInfo,
		eventSelector: EventSelector,
		filter: PrivateEventFilter,
	): Promise<PackedPrivateEvent[]> {
		return this.withPxeWrite("getPrivateEvents", network, async (pxe) =>
			pxe.getPrivateEvents(await EventSelector.schema.parseAsync(eventSelector), await PrivateEventFilterSchema.parseAsync(filter)),
		)
	}

	/** PXE's latest synchronized block header. Used by the fast path as
	 *  the anchor for `simulateViaNode` (mixed-payload merge needs both
	 *  arms to observe the same chain state). Mirrors upstream
	 *  `BaseWallet.simulateTx`. */
	public async getSyncedBlockHeader(network: NetworkInfo): Promise<BlockHeader> {
		return this.withPxeRead("getSyncedBlockHeader", network, (pxe) => pxe.getSyncedBlockHeader())
	}

	/**
	 * Chain-derived block timestamp for `blockNumber`. Falls back to
	 * `undefined` on any failure path so the consumer can degrade to a
	 * wall-clock fallback without crashing. Per-block lookup; callers
	 * should memoize across batches when scanning many notes.
	 */
	public async getBlockTimestamp(network: NetworkInfo, blockNumber: number): Promise<number | undefined> {
		return this.withPxeRead("getBlockTimestamp", network, async (_pxe, node) => {
			try {
				// `node.getBlock` expects BlockParameter which is a Zod-branded
				// union of BlockHash | BlockNumber | "latest". We have a plain
				// number; parse via the schema so the branded BlockNumber gets
				// produced.
				const blockParam = await BlockParameterSchema.parseAsync(blockNumber)
				const block = await node.getBlock(blockParam)
				if (!block) return undefined
				return Number(block.header.globalVariables.timestamp)
			} catch {
				return undefined
			}
		})
	}

	/**
	 * Dispose the runtime for `(profileId, chainId)` and delete its
	 * IndexedDB. Called by the SW-side `NetworkService.purgeChain`
	 * coordinator when a chain is removed.
	 *
	 * Runs under the same per-chain write-lock as proveTx/simulateTx so it
	 * cannot interleave with in-flight work on the same chain. Other
	 * chains (same or different profile) are unaffected.
	 */
	public async clearChainState(profileId: string, chainId: number): Promise<void> {
		const barrier = this.getProfileBarrier(profileId)
		const chainGuard = this.getChainGuard(profileId, chainId)
		await barrier.read(async () => {
			await chainGuard.write(async () => {
				// Dispose closes the owned store (releasing the SAH-pool lock), then the OPFS
				// directory removal reclaims the encrypted bytes — it needs NO live runtime, so
				// a chain whose PXE never booted this session purges identically. The key stays
				// with the profile (other chains share it); crypto-erase for the profile as a
				// whole happens in clearProfileState. The IndexedDB delete is the LEGACY
				// (rc.2-era) cleanup layer.
				await this.registry.dispose(profileId, chainId)
				await removeChainStoreDir({ profileId, chainId })
				await this.deleteDb(chainDataDir({ profileId, chainId }))
			})
		})
	}

	/**
	 * Profile-wide PXE erase (finding D). Deletes every PXE database for the
	 * profile by PREFIX — a per-chain `clearChainState` misses a DB on a chainId
	 * whose network row is gone — and the SHARED keyval-store only when no PXE DB
	 * survives for ANY profile. AWAITED + rejects on failure so the deletion
	 * coordinator can treat a rejection as a critical, retryable erasure failure.
	 */
	public async clearProfileState(profileId: string): Promise<void> {
		const barrier = this.getProfileBarrier(profileId)
		try {
			await barrier.enterWrite()
			await this.registry.disposeProfile(profileId)
			const guardPrefix = chainRegistryKeyPrefix(profileId)
			for (const k of Array.from(this.chainGuards.keys())) if (k.startsWith(guardPrefix)) this.chainGuards.delete(k)
			// Crypto-erase first (drop the in-memory key — the encrypted stores become
			// unreadable even if a removal below is interrupted), then reclaim the OPFS bytes
			// (registry-driven — covers chains whose network row or runtime is already gone),
			// then the LEGACY rc.2-era IndexedDB sweep.
			this.storeKeys.delete(profileId)
			await removeProfileStoreDirs(profileId)
			const dbPrefix = chainDataDirPrefix(profileId)
			for (const db of await indexedDB.databases()) {
				if (db.name?.startsWith(dbPrefix)) await this.deleteDb(db.name)
			}
			// keyval-store is SHARED across every profile's PXE DBs — deleting it
			// unconditionally corrupts a surviving profile's PXE (finding D). Only
			// delete it once NO PXE DB remains.
			const remaining = (await indexedDB.databases()).some((x) => x.name?.startsWith(PXE_DATA_DIR_ROOT))
			if (!remaining) {
				const keyval = (await indexedDB.databases()).find((x) => x.name === "keyval-store")
				if (keyval?.name) await this.deleteDb(keyval.name)
			}
		} finally {
			barrier.leaveWrite()
			this.profileBarriers.delete(profileId)
		}
	}

	/**
	 * Provision the per-profile 32-byte store encryption key (base64 over the wire; derived
	 * SW-side from the profile master via `derivePxeStoreKey` — the master itself never crosses).
	 * Held in memory only; a chain runtime cannot boot without it (fail-closed — see
	 * `PXE_STORE_KEY_MISSING` in chain-runtime.ts). Idempotent; re-provision after an offscreen
	 * restart is the expected path.
	 */
	public async provisionChainStoreKey(profileId: string, storeKeyBase64: string): Promise<void> {
		const key = Uint8Array.from(atob(storeKeyBase64), (c) => c.charCodeAt(0))
		if (key.length !== 32) {
			throw new Error(`provisionChainStoreKey: expected a 32-byte key, got ${key.length}`)
		}
		this.storeKeys.set(profileId, key)
	}

	/**
	 * Delete an IndexedDB database, AWAITED. `onerror` REJECTS (never
	 * false-success — a "deleted" profile must be verifiably erased). `onblocked`
	 * waits up to `timeoutMs` for the blocking connection to close (then
	 * `onsuccess` fires); if still blocked at the deadline, reject rather than
	 * hang forever or silently lie.
	 */
	private deleteDb(name: string, timeoutMs = 5_000): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const req = indexedDB.deleteDatabase(name)
			let timer: ReturnType<typeof setTimeout> | undefined
			const finish = (fn: () => void) => {
				if (timer) clearTimeout(timer)
				fn()
			}
			req.onsuccess = () => finish(resolve)
			req.onerror = () => finish(() => reject(req.error ?? new Error(`deleteDatabase failed: ${name}`)))
			req.onblocked = () => {
				this.logWarn("deleteDatabase blocked (waiting for close):", name)
				timer = setTimeout(() => reject(new Error(`deleteDatabase blocked past timeout: ${name}`)), timeoutMs)
			}
		})
	}

	private async withPxeRead<T>(label: string, network: NetworkInfo, fn: (pxe: PXE, node: AztecNode) => Promise<T>): Promise<T> {
		const start = Date.now()
		const barrier = this.getProfileBarrier(network.profileId)
		const chainGuard = this.getChainGuard(network.profileId, network.chainId)
		try {
			this.logDebug(`[DEBUG] [READ] ${label} starting`)
			const result = await barrier.read(async () => {
				return chainGuard.read(async () => {
					const runtime = await this.registry.getOrInit(network, this.storeKeys.get(network.profileId))
					return fn(runtime.pxe, runtime.node)
				})
			})
			this.logDebug(`[DEBUG] [READ] ${label} completed (${Date.now() - start}ms)`)
			return result
		} catch (err) {
			this.logError(`[READ] ${label} failed after ${Date.now() - start}ms`, err instanceof Error ? err.message : String(err))
			throw err
		}
	}

	private async withPxeWrite<T>(label: string, network: NetworkInfo, fn: (pxe: PXE, node: AztecNode) => Promise<T>): Promise<T> {
		const start = Date.now()
		const barrier = this.getProfileBarrier(network.profileId)
		const chainGuard = this.getChainGuard(network.profileId, network.chainId)
		try {
			this.logDebug(`[DEBUG] [WRITE] ${label} waiting for lock`)
			return await barrier.read(async () => {
				return chainGuard.write(async () => {
					const runtime = await this.registry.getOrInit(network, this.storeKeys.get(network.profileId))
					this.logDebug(`[DEBUG] [WRITE] ${label} lock acquired, executing`)
					const result = await fn(runtime.pxe, runtime.node)
					this.logDebug(`[DEBUG] [WRITE] ${label} completed (${Date.now() - start}ms)`)
					return result
				})
			})
		} catch (err) {
			this.logError(`[WRITE] ${label} failed after ${Date.now() - start}ms`, err instanceof Error ? err.message : String(err))
			throw err
		}
	}

	private readonly onActiveProfileChanged = async (): Promise<void> => {
		// Phase 2 Week 3 deliberately drops the pre-W3 behavior of clearing
		// all runtimes on profile switch. The durable-jobs design requires
		// the prior profile's PXE to keep running so an in-flight prove
		// finishes and journals its result; clearing here would abort that
		// work and surface as a `failed` job to the user. Other profiles'
		// PXEs stay warm until profile delete (or chain purge); memory
		// bounds are a Week 4 concern.
	}
}
