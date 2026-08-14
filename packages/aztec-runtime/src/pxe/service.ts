import type { PackedPrivateEvent, PXE } from "@aztec/pxe/client/bundle"
import { Fr } from "@aztec/foundation/curves/bn254"
import { type ContractArtifact, ContractArtifactSchema, EventSelector, FunctionCall } from "@aztec/stdlib/abi"
import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import {
	type ContractInstanceWithAddress,
	ContractInstanceWithAddressSchema,
	getContractClassFromArtifact,
	type CompleteAddress,
	type PartialAddress,
} from "@aztec/stdlib/contract"
import { BlockParameterSchema } from "@aztec/stdlib/block"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { NoteDao } from "@aztec/stdlib/note"
import { deriveKeys } from "@aztec/stdlib/keys"
import type { NotesFilter } from "./spec"
import { ContractUpgradedError, assertNotUpgraded, hydratePreimage } from "./effective-class"
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
import { ChainRuntimeRegistry, ProductionPxeFactory, PXE_STORE_KEY_MISSING, type PxeFactory } from "./chain-runtime"
import { PXE_DATA_DIR_ROOT, chainDataDir, chainDataDirPrefix, chainRegistryKey, chainRegistryKeyPrefix } from "./chain-coordinates"
import { listChainStoreDirs, removeChainStoreDir, removeProfileStoreDirs } from "./opfs-store"
import { ArtifactRegistry } from "./artifact-registry"
import { loadProductionKnownArtifacts } from "./known-artifacts"
import { loadProductionNoteSchemas, type NoteSchema } from "./note-schemas"
import { type Methods, PXE_SERVICE_NAME } from "./spec"
import { type PrivateEventFilter, PrivateEventFilterSchema } from "@aztec/aztec.js/wallet"
import { NotesFilterSchema } from "./schemas"
import {
	type PublicScanTips,
	type PublicTokenClassStatus,
	type PublicTransferFetchArgs,
	type PublicTransferPage,
	PublicTransferFetchArgsSchema,
	fetchPublicTokenTransferEvents,
	getPublicScanTips,
	resolveTokenClassStatus,
} from "./public-events"

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
		"getPublicTokenTransferEvents",
		"getPublicScanTips",
		"getPublicTokenClassStatus",
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
	/** Per-chain purge epochs (#281 review): bumped by `clearChainState` so an
	 *  in-flight read op cannot RESURRECT a just-purged chain — its write-rebind
	 *  step would otherwise re-create the runtime + a fresh OPFS store dir for a
	 *  chain whose network row is gone (nothing ever removes that dir again). A
	 *  read that entered BEFORE the purge refuses to rebind; a new op after the
	 *  purge sees the new epoch at entry and may legitimately re-create. */
	private readonly chainPurgeEpochs = new Map<string, number>()
	private readonly profileBarriers = new Map<string, ReadWriteGuard>()
	private readonly guardLogger: ILogger
	private readonly registry: ChainRuntimeRegistry
	private readonly artifacts: ArtifactRegistry
	/** Per-profile 32-byte store encryption keys, provisioned by the SW after unlock (and
	 *  re-provisioned on demand after an offscreen restart — in-memory only, never persisted).
	 *  Dropped on profile delete. */
	private readonly storeKeys = new Map<string, Uint8Array>()
	/**
	 * Per-profile incarnation lifecycle (issue #281 D4), keyed by profileId:
	 * absent = `unseen` → `live(gen)` on provision → `deleting(gen)` marked
	 * SYNCHRONOUSLY when a clear starts → `deleted(gen)` on successful erase.
	 *
	 * `gen` is the profile row's persisted 128-bit `pxeGeneration`, minted fresh
	 * at every row creation (including a same-id re-import) and carried by the
	 * SW on provision/clear/ops. The map is in-memory only: an offscreen restart
	 * resets everything to `unseen`, which is safe because stale DELIVERY dies
	 * with the port and the SW re-validates gen-currency at every SEND — the map
	 * exists to fence SAME-incarnation resurrection: a key provider that captured
	 * the profile master before deletion cannot re-provision after the purge
	 * (its generation is the deleted one), so the missing-key retry can no longer
	 * recreate a deleted profile's runtime + OPFS store.
	 */
	private readonly profileLifecycles = new Map<string, { kind: "live" | "deleting" | "deleted"; gen: string }>()

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
			// Remove orphans whole-profile-at-a-time: the profile is POSITIVELY absent
			// from the profiles store (a chain can only open under an existing profile
			// row), so recursively dropping its dir cannot race a sibling-chain open —
			// unlike the removed per-chain empty-dir sweep (D7 TOCTOU).
			const orphanProfiles = [...new Set(opfsDirs.map((c) => c.profileId))].filter((id) => !profiles.some((x) => x.id === id))
			for (const profileId of orphanProfiles) {
				this.logWarn(`sweep: removing orphan OPFS PXE profile dir ${PXE_DATA_DIR_ROOT}/${profileId}`)
				await removeProfileStoreDirs(profileId)
			}
		}
		if (pxes.length) {
			for (let i = pxes.length - 1; i >= 0; i--) {
				const deleted = await new Promise<boolean>((resolve, reject) => {
					const req = indexedDB.deleteDatabase(pxes[i].name!)
					req.onsuccess = () => resolve(true)
					req.onerror = () => reject(req.error)
					req.onblocked = () => {
						this.logWarn("deleteDatabase blocked (DB still in use):", pxes[i].name)
						resolve(false) // Skip — don't hang the sweep forever
					}
				})
				// Only a REAL deletion clears the entry: a blocked DB survives, and the
				// shared keyval-store guard below must see it (review finding — the
				// unconditional splice made the emptiness check vacuous).
				if (deleted) pxes.splice(i, 1)
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
					// An upgrade rejection is a DEFINITIVE node answer, not a hiccup — re-throw it even in
					// best-effort mode, or the cascade would silently serve a stale known-bundle instance
					// for a contract the node says is unsupported.
					if (err instanceof ContractUpgradedError) throw err
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
		return this.withPxeWrite("proveTx", network, async (pxe) => {
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
		return this.withPxeWrite("simulateTx", network, async (pxe) => {
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
			//
			// Override mechanics mirror upstream `EmbeddedWallet.buildAccountOverrides`:
			// the stub CLASS is registered with the PXE (function artifacts are
			// resolved from the class store by `currentContractClassId`, so an
			// unregistered class makes every lookup come back empty), and each
			// entry keeps the account's REAL instance with only the class id
			// swapped — an instance derived from the stub artifact with a random
			// salt would carry an address preimage inconsistent with the map key.
			// The historical shape here (`new SimulationOverrides({...contracts})`,
			// spreading entries at the TOP level) parked the map outside the
			// `contracts` key, so the override never reached the simulator and
			// discovery ran UNSTUBBED — proven live on testnet against an
			// authwit-requiring op (single-sim-estimates B1, Finding 0).
			if (stubAccountAddresses?.length) {
				const stubClassId = await this.ensureStubClassRegistered(pxe)
				const contracts: Record<string, { instance: ContractInstanceWithAddress }> = {}
				for (const addr of stubAccountAddresses) {
					const address = await AztecAddress.schema.parseAsync(addr)
					const instance = await pxe.getContractInstance(address)
					if (!instance) {
						throw new Error(`stubAccountAddresses: no contract instance registered for ${addr}`)
					}
					contracts[addr] = { instance: { ...instance, currentContractClassId: stubClassId } }
				}
				overrides = new SimulationOverrides({ contracts: { ...(overrides?.contracts ?? {}), ...contracts } })
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

	/** Per-PXE memo of the stub-class registration: class hashing + the
	 *  registerContractClass round-trip are WASM-heavy and sit on the fee
	 *  estimation hot path — pay them once per PXE incarnation, not per sim.
	 *  Keyed by the PXE instance so a chain-runtime teardown/recreate
	 *  naturally re-registers against the fresh store. */
	private readonly stubClassRegistrations = new WeakMap<object, Promise<Fr>>()

	private ensureStubClassRegistered(pxe: PXE): Promise<Fr> {
		let pending = this.stubClassRegistrations.get(pxe)
		if (!pending) {
			pending = (async () => {
				const { StubSchnorrAccountContractArtifact } = await import("@aztec/accounts/schnorr/stub")
				await pxe.registerContractClass(StubSchnorrAccountContractArtifact)
				const { id } = await getContractClassFromArtifact(StubSchnorrAccountContractArtifact)
				return id
			})()
			// A failed registration must not poison the memo permanently.
			pending.catch(() => this.stubClassRegistrations.delete(pxe))
			this.stubClassRegistrations.set(pxe, pending)
		}
		return pending
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
	 * One page of decoded public `Transfer` events for `(network, contract)` (D1). Node-only read
	 * (no PXE store mutation), so `withPxeRead`. Args are zod-parsed here (the offscreen trust
	 * boundary re-validates node input); a `referenceBlock`-reorg throw propagates to the SW caller.
	 */
	public async getPublicTokenTransferEvents(
		network: NetworkInfo,
		contract: string,
		args: PublicTransferFetchArgs,
	): Promise<PublicTransferPage> {
		const parsedArgs = await PublicTransferFetchArgsSchema.parseAsync(args)
		return this.withPxeRead("getPublicTokenTransferEvents", network, (_pxe, node) =>
			fetchPublicTokenTransferEvents(node, contract, parsedArgs, (level, msg, ...rest) =>
				level === "warn" ? this.logWarn(msg, ...rest) : this.logDebug(msg, ...rest),
			),
		)
	}

	/** Resolve the checkpointed + finalized tips (D6 index bound + rewind floor). Node-only read. */
	public async getPublicScanTips(network: NetworkInfo): Promise<PublicScanTips> {
		return this.withPxeRead("getPublicScanTips", network, (_pxe, node) => getPublicScanTips(node))
	}

	/** Node-direct contract-class gate (D2). Node-only read. */
	public async getPublicTokenClassStatus(
		network: NetworkInfo,
		contract: string,
		checkpointHash: string,
	): Promise<PublicTokenClassStatus> {
		return this.withPxeRead("getPublicTokenClassStatus", network, (_pxe, node) =>
			resolveTokenClassStatus(node, contract, checkpointHash, (level, msg, ...rest) =>
				level === "warn" ? this.logWarn(msg, ...rest) : this.logDebug(msg, ...rest),
			),
		)
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
				this.chainPurgeEpochs.set(
					this.chainKey(profileId, chainId),
					(this.chainPurgeEpochs.get(this.chainKey(profileId, chainId)) ?? 0) + 1,
				)
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
	public async clearProfileState(profileId: string, generation: string): Promise<void> {
		if (!generation) throw new Error("clearProfileState: missing pxe generation")
		const current = this.profileLifecycles.get(profileId)
		// A late clear carrying a superseded generation must NEVER erase a live
		// successor (same-id re-import minted a fresh generation): reject before
		// touching any state. A same-gen clear after success is an idempotent
		// no-op — the erase already completed.
		if (current && current.gen !== generation) {
			throw new Error(
				`clearProfileState: generation mismatch for ${profileId} — a ${current.kind} incarnation with a different generation exists; refusing to erase`,
			)
		}
		if (current?.kind === "deleted") return
		// Mark `deleting` SYNCHRONOUSLY (before any await): a provision arriving
		// while we wait for the write barrier must already see the fence.
		this.profileLifecycles.set(profileId, { kind: "deleting", gen: generation })
		const barrier = this.getProfileBarrier(profileId)
		await barrier.enterWrite()
		try {
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
			// SUCCESS ONLY: drop the barrier so a re-added profile gets a fresh one. On FAILURE the
			// entry is RETAINED (this line is skipped by the throw) so the profile stays a known
			// being-deleted entity and a same-gen retry reuses the SAME barrier — deleting it on a
			// failed erase would let a read slip past the fence before the coordinator retries.
			this.profileBarriers.delete(profileId)
			// SUCCESS ONLY: `deleted(gen)` is retained (not removed) so a same-incarnation
			// stale provision replay of THIS generation is rejected forever; a re-imported
			// same-id profile provisions with a fresh generation and goes live over it.
			// On FAILURE the state stays `deleting(gen)` — provisions stay fenced, the
			// coordinator's same-gen retry is idempotent.
			this.profileLifecycles.set(profileId, { kind: "deleted", gen: generation })
		} finally {
			// Always release the write lock — retained-but-unlocked lets the retry re-acquire WRITE
			// (an unreleased write lock would deadlock the retry, not fence it).
			barrier.leaveWrite()
		}
	}

	/**
	 * Provision the per-profile 32-byte store encryption key (base64 over the wire; derived
	 * SW-side from the profile master via `derivePxeStoreKey` — the master itself never crosses).
	 * Held in memory only; a chain runtime cannot boot without it (fail-closed — see
	 * `PXE_STORE_KEY_MISSING` in chain-runtime.ts). Idempotent; re-provision after an offscreen
	 * restart is the expected path.
	 */
	public async provisionChainStoreKey(profileId: string, storeKeyBase64: string, generation: string): Promise<void> {
		const key = Uint8Array.from(atob(storeKeyBase64), (c) => c.charCodeAt(0))
		if (key.length !== 32) {
			throw new Error(`provisionChainStoreKey: expected a 32-byte key, got ${key.length}`)
		}
		if (!generation) throw new Error("provisionChainStoreKey: missing pxe generation")
		// The D4 resurrection fence. Atomicity with `clearProfileState` comes from
		// run-to-completion, NOT the profile barrier: the check+install below is one
		// synchronous block, and clear marks `deleting` synchronously before its
		// first await — so this either runs wholly before the marking (the clear
		// then erases the key, orderly) or wholly after (rejected). Taking the
		// WRITE barrier here instead would drain readers, stalling an unlock-time
		// re-provision behind a 30-minute in-flight prove on the same profile.
		//  - deleting(any):        the purge is in flight — no key may (re)install.
		//  - deleted(same gen):    a stale replay of the erased incarnation — rejected forever.
		//  - live(different gen):  a successor key while the predecessor is live — the SW
		//    must clear first; failing loudly beats silently swapping keys under a runtime.
		//  - unseen / live(same) / deleted(different gen): install (fresh incarnation,
		//    idempotent re-provision, or a re-imported profile going live over a dead one).
		const current = this.profileLifecycles.get(profileId)
		if (current?.kind === "deleting") {
			throw new Error(`provisionChainStoreKey: profile ${profileId} is being deleted — provision rejected`)
		}
		if (current?.kind === "deleted" && current.gen === generation) {
			throw new Error(`provisionChainStoreKey: profile ${profileId} generation was erased — stale provision rejected`)
		}
		if (current?.kind === "live" && current.gen !== generation) {
			throw new Error(`provisionChainStoreKey: profile ${profileId} is live under a different generation — clear it first`)
		}
		this.profileLifecycles.set(profileId, { kind: "live", gen: generation })
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

	/** Attempts before giving up on the read path's peek → write-rebind → re-peek
	 *  loop. Each miss means the runtime was (re)bound or torn down between our
	 *  write and re-entering read — more than a couple in a row is a live purge
	 *  or endpoint churn the caller should surface, not spin through. */
	private static readonly MAX_RUNTIME_BIND_ATTEMPTS = 3

	/**
	 * The op-level D4 fence, checked INSIDE the profile barrier: an op that
	 * carries a `pxeGeneration` capture may only run while its profile is
	 * `live` under that same generation. Absent captures pass — test fakes and
	 * the store-key fail-close cover them — and `unseen` passes so the
	 * missing-key retry can provision-then-retry. The error deliberately does
	 * NOT contain the PXE_STORE_KEY_MISSING marker: re-provisioning cannot
	 * rescue a stale-generation op, so the client must not retry it.
	 *
	 * ONE non-live case passes: `deleted` under a DIFFERENT generation than the
	 * capture. That op belongs to a same-id re-imported SUCCESSOR booting before
	 * its first provision — not to the erased incarnation. It must fall through
	 * to the missing-key path (the predecessor's key was crypto-erased, so the
	 * runtime bind throws PXE_STORE_KEY_MISSING) and the client's provision —
	 * which `provisionChainStoreKey` explicitly admits over deleted(other gen) —
	 * flips the lifecycle live. Hard-rejecting here deadlocked the successor
	 * forever: the only provision trigger is that retry marker, which this
	 * error path deliberately suppresses (delete profile → re-import same seed
	 * → every op rejected until the offscreen document restarted).
	 */
	private assertGenerationCurrent(network: NetworkInfo): void {
		const captured = network.pxeGeneration
		if (!captured) return
		const current = this.profileLifecycles.get(network.profileId)
		if (!current) return
		if (current.kind === "deleted" && current.gen !== captured) return
		if (current.kind !== "live" || current.gen !== captured) {
			throw new Error(
				`pxe op rejected: profile ${network.profileId} is ${current.kind} (generation ${current.gen === captured ? "matches" : "superseded"}) — the capture is stale`,
			)
		}
	}

	private async withPxeRead<T>(label: string, network: NetworkInfo, fn: (pxe: PXE, node: AztecNode) => Promise<T>): Promise<T> {
		const start = Date.now()
		const barrier = this.getProfileBarrier(network.profileId)
		const chainGuard = this.getChainGuard(network.profileId, network.chainId)
		try {
			this.logDebug(`[DEBUG] [READ] ${label} starting`)
			// Peek under READ; on a miss/mismatch, EXIT the read and (re)bind under
			// the chain WRITE guard, then re-enter read and retry. Rebinding (which
			// disposes a live runtime on endpoint switch) under a mere read lock
			// raced concurrent readers + the SAH-pool lock (#281 D3). The read is
			// fully released before the write is requested — no read→write upgrade.
			const missed = Symbol("runtime-miss")
			const purgeEpochAtEntry = this.chainPurgeEpochs.get(this.chainKey(network.profileId, network.chainId)) ?? 0
			for (let attempt = 0; attempt < PxeService.MAX_RUNTIME_BIND_ATTEMPTS; attempt++) {
				const result = await barrier.read(async () => {
					return chainGuard.read(async () => {
						this.assertGenerationCurrent(network)
						const runtime = this.registry.peekMatching(network)
						if (!runtime) return missed
						return fn(runtime.pxe, runtime.node)
					})
				})
				if (result !== missed) {
					this.logDebug(`[DEBUG] [READ] ${label} completed (${Date.now() - start}ms)`)
					return result as T
				}
				await barrier.read(async () => {
					await chainGuard.write(async () => {
						if ((this.chainPurgeEpochs.get(this.chainKey(network.profileId, network.chainId)) ?? 0) !== purgeEpochAtEntry) {
							throw new Error(`${label}: chain was purged mid-operation — refusing to re-create its runtime/store`)
						}
						await this.registry.ensure(network, this.storeKeys.get(network.profileId))
					})
				})
			}
			throw new Error(`${label}: chain runtime kept rebinding/vanishing after ${PxeService.MAX_RUNTIME_BIND_ATTEMPTS} attempts`)
		} catch (err) {
			this.logOpFailure("READ", label, start, err)
			throw err
		}
	}

	/**
	 * A `PXE_STORE_KEY_MISSING` rejection is a designed protocol step, not an
	 * incident: keys live in offscreen memory only, so the FIRST profile-scoped
	 * op after an offscreen boot misses and the SW client derives +
	 * re-provisions + retries once. Logging it at error painted three red lines
	 * on every cold start for a condition that self-heals in ~1s; a retry that
	 * ALSO fails still surfaces at the caller. Everything else stays error.
	 */
	private logOpFailure(kind: "READ" | "WRITE", label: string, start: number, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err)
		if (message.includes(PXE_STORE_KEY_MISSING)) {
			this.logDebug(`[${kind}] ${label} pre-provision miss after ${Date.now() - start}ms (client re-provisions + retries)`)
		} else {
			this.logError(`[${kind}] ${label} failed after ${Date.now() - start}ms`, message)
		}
	}

	private async withPxeWrite<T>(label: string, network: NetworkInfo, fn: (pxe: PXE, node: AztecNode) => Promise<T>): Promise<T> {
		const start = Date.now()
		const barrier = this.getProfileBarrier(network.profileId)
		const chainGuard = this.getChainGuard(network.profileId, network.chainId)
		const purgeEpochAtEntry = this.chainPurgeEpochs.get(this.chainKey(network.profileId, network.chainId)) ?? 0
		try {
			this.logDebug(`[DEBUG] [WRITE] ${label} waiting for lock`)
			return await barrier.read(async () => {
				return chainGuard.write(async () => {
					this.assertGenerationCurrent(network)
					// A write op that captured NetworkInfo before a mid-flight clearChainState must
					// NOT resurrect the purged chain by re-creating its runtime + a fresh OPFS store
					// (concurrency audit MED #4 — the read path fenced this but the write path called
					// ensure directly). Same epoch check as withPxeRead.
					if ((this.chainPurgeEpochs.get(this.chainKey(network.profileId, network.chainId)) ?? 0) !== purgeEpochAtEntry) {
						throw new Error(`${label}: chain was purged mid-operation — refusing to re-create its runtime/store`)
					}
					// Already under the chain WRITE guard — `ensure` may rebind here.
					const runtime = await this.registry.ensure(network, this.storeKeys.get(network.profileId))
					this.logDebug(`[DEBUG] [WRITE] ${label} lock acquired, executing`)
					const result = await fn(runtime.pxe, runtime.node)
					this.logDebug(`[DEBUG] [WRITE] ${label} completed (${Date.now() - start}ms)`)
					return result
				})
			})
		} catch (err) {
			this.logOpFailure("WRITE", label, start, err)
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
