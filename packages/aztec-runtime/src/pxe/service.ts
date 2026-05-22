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
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { NoteDao } from "@aztec/stdlib/note"
import type { NotesFilter } from "./spec"
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
import { Service } from "@nulo/extension-messaging/offscreen"
import type { ILogger } from "@nulo/wallet-core/logger"
import { ReadWriteGuard } from "@nulo/wallet-core/utils"
import type { NetworkInfo } from "./chain-runtime"
import { ChainRuntimeRegistry, ProductionPxeFactory, type PxeFactory } from "./chain-runtime"
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

	public constructor(profiles: IProfileReader, logger: ILogger, factory?: PxeFactory) {
		super(PXE_SERVICE_NAME, logger)
		this.profiles = profiles
		this.guardLogger = logger
		this.artifacts = new ArtifactRegistry(loadProductionKnownArtifacts, { logger, logSource: PXE_SERVICE_NAME })
		this.registry = new ChainRuntimeRegistry(factory ?? new ProductionPxeFactory())
	}

	private chainKey(profileId: string, chainId: number): string {
		return `${profileId}:${chainId}`
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
		// delete orphan PXE DBs
		const dbs = await indexedDB.databases()
		const pxes = dbs.filter((x) => x.name?.startsWith("pxe/"))
		if (pxes.length) {
			const profiles = await this.profiles.getProfiles()
			for (let i = pxes.length - 1; i >= 0; i--) {
				if (!profiles.some((x) => pxes[i].name!.startsWith(`pxe/${x.id}/`))) {
					await new Promise<void>((resolve, reject) => {
						const req = indexedDB.deleteDatabase(pxes[i].name!)
						req.onsuccess = () => resolve()
						req.onerror = () => reject(req.error)
						req.onblocked = () => {
							this.logWarn("deleteDatabase blocked (DB still in use):", pxes[i].name)
							resolve() // Skip — don't hang init forever
						}
					})
					pxes.splice(i, 1)
				}
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

		this.profiles.onProfileDeleted.add(this.onProfileDeleted)
		this.profiles.onActiveProfileChanged.add(this.onActiveProfileChanged)
		await this.profiles.connect()
	}

	public async getContractInstance(
		network: NetworkInfo,
		address: AztecAddress,
		opts?: { pxeOnly?: boolean; nodeBestEffort?: boolean },
	): Promise<ContractInstanceWithAddress | undefined> {
		address = await AztecAddress.schema.parseAsync(address)
		return this.withPxeRead("getContractInstance", network, async (pxe, node) => {
			let instance = await pxe.getContractInstance(address)
			if (!instance && !opts?.pxeOnly) {
				try {
					instance = await node.getContract(address)
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
		return this.withPxeWrite("registerAccount", network, async (pxe) =>
			pxe.registerAccount(await Fr.schema.parseAsync(secretKey), await Fr.schema.parseAsync(partialAddress)),
		)
	}

	public async registerSender(network: NetworkInfo, address: AztecAddress): Promise<AztecAddress> {
		return this.withPxeWrite("registerSender", network, async (pxe) =>
			pxe.registerSender(await AztecAddress.schema.parseAsync(address)),
		)
	}

	public async getSenders(network: NetworkInfo): Promise<AztecAddress[]> {
		return this.withPxeRead("getSenders", network, (pxe) => pxe.getSenders())
	}

	public async removeSender(network: NetworkInfo, address: AztecAddress): Promise<void> {
		return this.withPxeWrite("removeSender", network, async (pxe) => pxe.removeSender(await AztecAddress.schema.parseAsync(address)))
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
		return this.withPxeWrite("registerContract", network, async (pxe) =>
			pxe.registerContract({
				instance: await ContractInstanceWithAddressSchema.parseAsync(contract.instance),
				artifact: await ContractArtifactSchema.optional().parseAsync(contract.artifact),
			}),
		)
	}

	public async updateContract(network: NetworkInfo, contractAddress: AztecAddress, artifact: ContractArtifact): Promise<void> {
		return this.withPxeWrite("updateContract", network, async (pxe) =>
			pxe.updateContract(await AztecAddress.schema.parseAsync(contractAddress), await ContractArtifactSchema.parseAsync(artifact)),
		)
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

			return pxe.proveTx(await TxExecutionRequest.schema.parseAsync(txRequest), await z.array(AztecAddress.schema).parseAsync(scopes))
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
			// `@aztec/accounts/stub/ecdsa`).
			if (stubAccountAddresses?.length) {
				const { StubSchnorrAccountContractArtifact } = await import("@aztec/accounts/stub/schnorr")
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
			// `skipKernels: true` (`@aztec/pxe@4.2.0` pxe.js:627 —
			// `if (hasOverriddenContracts && !skipKernels) throw`). Today
			// this works because upstream defaults `skipKernels` to true,
			// but riding a default is fragile: a future upstream change
			// could flip it and silently break overrides. Pass it
			// explicitly when we know we need it.
			return await pxe.simulateTx(await TxExecutionRequest.schema.parseAsync(txRequest), {
				simulatePublic: opts.simulatePublic,
				skipTxValidation: opts.skipTxValidation,
				skipFeeEnforcement: opts.skipFeeEnforcement,
				overrides,
				...(overrides ? { skipKernels: true } : {}),
				scopes: await AccessScopesSchema.parseAsync(opts.scopes),
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
				await this.registry.dispose(profileId, chainId)
				const dbName = `pxe/${profileId}/${chainId}`
				await new Promise<void>((resolve) => {
					const req = indexedDB.deleteDatabase(dbName)
					req.onsuccess = () => resolve()
					req.onerror = () => resolve()
					req.onblocked = () => {
						this.logWarn("clearChainState: deleteDatabase blocked", dbName)
						resolve()
					}
				})
			})
		})
	}

	/**
	 * Failover-safe URL rebind. Acquires the same per-chain write guard as
	 * `clearChainState` (drains in-flight readers + writers on this chain
	 * first), then disposes the cached `ChainRuntime`. Critically, this
	 * does NOT delete the IndexedDB — chainId is unchanged, the DB stays
	 * valid; only the AztecNode (URL-bound) needs replacement.
	 *
	 * Triggered by the SW-side `NetworkService` after failover/snapback/
	 * promote that changed the active endpoint for the chain. The next
	 * `withPxeRead`/`withPxeWrite` re-initializes against the new URL via
	 * the standard `registry.getOrInit` path.
	 */
	public async rebindChain(profileId: string, chainId: number): Promise<void> {
		const barrier = this.getProfileBarrier(profileId)
		const chainGuard = this.getChainGuard(profileId, chainId)
		await barrier.read(async () => {
			await chainGuard.write(async () => {
				await this.registry.dispose(profileId, chainId)
			})
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
					const runtime = await this.registry.getOrInit(network)
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
					const runtime = await this.registry.getOrInit(network)
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

	private readonly onProfileDeleted = async (profile: { id: string }): Promise<void> => {
		const barrier = this.getProfileBarrier(profile.id)
		try {
			await barrier.enterWrite()
			// All chain ops on this profile have drained — safe to dispose.
			await this.registry.disposeProfile(profile.id)
			// Drop the per-chain guards for this profile. They're idle (drained
			// by the barrier above) so deletion is race-free.
			const prefix = `${profile.id}:`
			for (const k of Array.from(this.chainGuards.keys())) {
				if (k.startsWith(prefix)) this.chainGuards.delete(k)
			}
			// ArtifactRegistry stores compiled-in artifacts keyed by
			// content-addressed class id; not profile-scoped. Skipping the
			// clear here was a deliberate Week 3 change — `clear()` on
			// profile delete used to nuke the bundle for every surviving
			// profile too, causing a wasted reload on next access.
			for (const db of await indexedDB.databases()) {
				if (db.name?.startsWith(`pxe/${profile.id}/`) || db.name === "keyval-store") {
					const _ = indexedDB.deleteDatabase(db.name)
				}
			}
		} finally {
			barrier.leaveWrite()
			this.profileBarriers.delete(profile.id)
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
