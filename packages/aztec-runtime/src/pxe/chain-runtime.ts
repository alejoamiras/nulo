import { getPXEConfig, type PXEConfig } from "@aztec/pxe/config"
import { createPXE, type PXE } from "@aztec/pxe/client/bundle"
import { createLogger } from "@aztec/foundation/log"
import type { AztecSQLiteOPFSStore } from "@aztec/kv-store/sqlite-opfs"
import { WASMSimulator } from "@aztec/simulator/client"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { AcceleratorProver, type AcceleratorPhase } from "@alejoamiras/aztec-accelerator"
import { AztecNodeFactoryAdapter } from "../adapters/aztec-node-factory-adapter"
import type { NodeFactory } from "../ports/node-factory-port"
import { chainDataDir, chainRegistryKey, chainRegistryKeyPrefix } from "./chain-coordinates"
import { openChainStore } from "./opfs-store"

/** Typed marker for "the per-profile store key was never provisioned to this offscreen" — the
 *  SW-side client recognizes it, re-provisions via its key provider, and retries once (covers
 *  offscreen-document restarts, which drop all in-memory state including the key map). */
export const PXE_STORE_KEY_MISSING = "PXE_STORE_KEY_MISSING"

/** Optional accelerator-server endpoint. Orthogonal to the proving mode —
 *  meaningful only in non-proverless modes; ignored under `proverless`. Stays
 *  primitive (no `accelerator/config` import) so `@nulo/aztec-runtime` remains
 *  decoupled from the extension's `@/` alias. */
export interface AcceleratorEndpoint {
	host?: string
	port?: number
}

/**
 * PXE factory options as a discriminated union over the proving mode, so the
 * previously-illegal `required` + `proverless` combination is unrepresentable
 * (it used to be a runtime throw in the constructor).
 *
 * - `default` (or `provingMode` omitted) — production: real BB proving via
 *   `AcceleratorProver`, silent WASM fallback preserved, no preflight/onPhase.
 * - `required` — CI-only (`VITE_NULO_ACCELERATOR_REQUIRED=1`): same proving
 *   plus an eager `checkAcceleratorStatus()` preflight and an `onPhase` guard
 *   that throws synchronously on a silent fallback ("fallback"/"denied").
 * - `proverless` — E2E-only (double-opt-in `VITE_NULO_E2E_PROVERLESS`): builds
 *   the PXE with `proverEnabled: false` (no `AcceleratorProver`; the bundle
 *   prover's fakeProofs path emits a chonk proof the local network accepts).
 *   NEVER reaches a production build. `host`/`port` are ignored in this mode.
 */
export type ProductionPxeFactoryOptions =
	| (AcceleratorEndpoint & { provingMode?: "default" })
	| (AcceleratorEndpoint & { provingMode: "required" })
	| (AcceleratorEndpoint & { provingMode: "proverless" })

/**
 * Minimal structural shape of the network info required to bootstrap a
 * `ChainRuntime`. The extension's `Network` (from
 * `@/wallet/services/network/client`) satisfies this by having these
 * fields plus more.
 *
 * Declared inline (not imported from `@nulo/extension`) so this file
 * stays decoupled — the `@/` alias does not resolve inside
 * `@nulo/aztec-runtime`.
 */
export interface NetworkInfo {
	profileId: string
	chainId: number
	rpcUrl: string
}

/**
 * Holds the `AztecNode` + `PXE` pair for a single chain bound to a
 * single profile. Created lazily on first access; torn down via
 * `dispose()` when the profile changes or the profile is deleted.
 *
 * The `ChainRuntime` is owned by `ChainRuntimeRegistry`; callers should
 * not construct it directly.
 */
export class ChainRuntime {
	public constructor(
		public readonly chainId: number,
		public readonly node: AztecNode,
		public readonly pxe: PXE,
		public readonly rpcUrl: string,
		/** The injected per-(profile, chain) encrypted store. The runtime OWNS the handle:
		 *  dispose() closes it (releasing the SAH-pool directory lock), deleteStore() erases it.
		 *  Undefined only for test fakes. */
		private readonly store?: AztecSQLiteOPFSStore,
	) {}

	/**
	 * Shut down the PXE, then close the owned store. `pxe.stop()` drains the
	 * job queue rather than aborting in-flight work (verified against
	 * upstream @aztec/pxe); so correctness across profile switch comes from
	 * the ReadWriteGuard's drain-on-write semantics, not teardown. Closing
	 * the store releases the SAH-pool's exclusive directory lock — REQUIRED
	 * before the same (profile, chain) can be reopened or its directory
	 * removed. A failed close is rethrown (fail-closed): a silently-leaked
	 * lock would wedge every future open of this chain.
	 */
	public async dispose(): Promise<void> {
		const stoppable = this.pxe as unknown as { stop?: () => Promise<void> }
		if (typeof stoppable.stop === "function") {
			try {
				await stoppable.stop()
			} catch {
				// Swallow: the caller is tearing down regardless; a failed stop
				// is not actionable here.
			}
		}
		await this.store?.close()
	}
}

/** Seam for unit tests: swap this out with a fake that returns a
 *  fixture `ChainRuntime` (e.g. with mock PXE / node) instead of
 *  running real PXE init. `storeKey` is the per-profile 32-byte store
 *  encryption key (required by the production factory; fakes ignore it). */
export interface PxeFactory {
	createChainRuntime(network: NetworkInfo, storeKey?: Uint8Array): Promise<ChainRuntime>
}

export class ProductionPxeFactory implements PxeFactory {
	private readonly nodeFactory: NodeFactory
	private readonly required: boolean
	private readonly host: string | undefined
	private readonly port: number | undefined
	private readonly proverless: boolean

	public constructor(nodeFactory?: NodeFactory, options?: ProductionPxeFactoryOptions) {
		this.nodeFactory = nodeFactory ?? new AztecNodeFactoryAdapter()
		const provingMode = options?.provingMode ?? "default"
		// `required` + `proverless` is unrepresentable in the union, so the old
		// runtime mutual-exclusion throw is no longer reachable.
		this.required = provingMode === "required"
		this.proverless = provingMode === "proverless"
		this.host = options?.host
		this.port = options?.port
	}

	public async createChainRuntime(network: NetworkInfo, storeKey?: Uint8Array): Promise<ChainRuntime> {
		// Fail-closed: PXE state is encrypted at rest, so a chain runtime cannot boot without the
		// profile's store key (provisioned by the SW after unlock; re-provisioned on demand when
		// the offscreen restarts — the client recognizes this marker and retries once).
		if (!storeKey) {
			throw new Error(`${PXE_STORE_KEY_MISSING}: no store key provisioned for profile ${network.profileId}`)
		}
		const node = this.nodeFactory.createNode(network.rpcUrl)
		const config = {
			...getPXEConfig(),
			dataDirectory: chainDataDir(network),
			proverEnabled: !this.proverless,
		} as PXEConfig

		// The injected per-(profile, chain) ENCRYPTED store (see opfs-store.ts for why the
		// upstream default path must never ship). The rollup address scopes the wipe-on-reset
		// stamp to exactly this chain's store.
		const rollupAddress = (await node.getL1ContractAddresses()).rollupAddress?.toString()
		const store = await openChainStore({
			network,
			rollupAddress,
			storeKey,
			log: createLogger("pxe:data", { actor: chainDataDir(network) }),
		})
		// Once the store is open it holds the pool dir's EXCLUSIVE SAH lock, so ANY throw before a
		// ChainRuntime takes ownership (createPXE failure, the required-mode preflight) must close it
		// — otherwise the leaked lock permanently wedges every later open of this dir AND blocks the
		// purge's removeEntry. ChainRuntime.dispose() owns close() on the success path.
		try {
			return await this.buildRuntime(network, node, config, store)
		} catch (err) {
			await store.close().catch(() => {})
			throw err
		}
	}

	private async buildRuntime(
		network: NetworkInfo,
		node: AztecNode,
		config: PXEConfig,
		store: AztecSQLiteOPFSStore,
	): Promise<ChainRuntime> {
		// Pass an explicit WASMSimulator into both the prover AND the PXE
		// config so neither falls back to dynamic-import
		// `@aztec/simulator/client` at runtime. The dynamic-import fallback
		// (via the accelerator's `createLazySimulator`) fails under MV3
		// offscreen-document conditions even though the chunk is bundled,
		// throwing "No simulator provided and @aztec/simulator/client
		// could not be loaded." during `proveTx`. Static import makes the
		// simulator part of the main bundle graph and avoids that path.
		const simulator = new WASMSimulator()

		// E2E-only proverless: skip the BB SNARK. The PXE still runs kernel
		// simulation (real public inputs / nullifiers) and emits a random
		// chonk proof via the default bundle prover's fakeProofs path; the
		// local network accepts it. No AcceleratorProver, no onPhase, no
		// preflight. The `simulator` is still passed so kernel sim stays on
		// the bundled WASM path (same MV3 reason as above).
		if (this.proverless) {
			const pxe = await createPXE(node, config, { simulator, store })
			return new ChainRuntime(network.chainId, node, pxe, network.rpcUrl, store)
		}

		// Required-mode (CI only): the onPhase callback throws synchronously
		// when the SDK would silently fall back to WASM. "downloading" is a
		// warn — the proof still succeeds, just with a cold-start tax. In
		// non-required (production) mode, onPhase is undefined and the SDK
		// behaves exactly as before for end users without Aztec Accelerator.
		const onPhase = this.required
			? (phase: AcceleratorPhase) => {
					if (phase === "fallback" || phase === "denied") {
						throw new Error(
							`[accelerator-required] SDK emitted phase="${phase}" — proving was about ` +
								"to fall back to WASM. Forbidden in required-mode " +
								"(VITE_NULO_ACCELERATOR_REQUIRED=1).",
						)
					}
					if (phase === "downloading") {
						// First prove on a fresh runner without BB_BINARY_PATH set
						// pays a multi-minute bb-download tax. Warn so we surface it.
						console.warn(
							'[accelerator-required] SDK emitted phase="downloading" — first ' +
								"prove will be slow. Pre-warm BB_BINARY_PATH to avoid this.",
						)
					}
				}
			: undefined

		const accelerator = this.host !== undefined || this.port !== undefined ? { host: this.host, port: this.port } : undefined
		const prover = new AcceleratorProver({ simulator, onPhase, accelerator })

		// Required-mode preflight: fail at PXE-creation time rather than at
		// first prove, so the failure site is unambiguous. The status cache
		// inside AcceleratorProver (10s TTL) makes this cheap when called
		// again from the SDK at first prove.
		if (this.required) {
			const status = await prover.checkAcceleratorStatus()
			if (!status.available) {
				throw new Error(`[accelerator-required] accelerator-server unavailable. Status: ${JSON.stringify(status)}`)
			}
			if (status.needsDownload) {
				console.warn(
					"[accelerator-required] accelerator-server reports needsDownload=true " +
						`for aztec_version=${status.sdkAztecVersion}. First prove will be slow.`,
				)
			}
		}

		const pxe = await createPXE(node, config, { proverOrOptions: prover, simulator, store })
		return new ChainRuntime(network.chainId, node, pxe, network.rpcUrl, store)
	}
}

/**
 * Per-(profileId, chainId) registry of `ChainRuntime` instances. Owns
 * the dedup-on-concurrent-init promise map so two callers asking for
 * the same chain at once share the init, not double-init.
 *
 * The registry is intended to be called from INSIDE the PxeService
 * ReadWriteGuard's read lock. Under that contract, `clear()` (called
 * from the write lock on profile switch / delete) never runs
 * concurrently with `getOrInit`, so there is no separate stale-init
 * race to handle here — the guard serializes it.
 */
export class ChainRuntimeRegistry {
	private readonly runtimes = new Map<string, ChainRuntime>()
	private readonly initPromises = new Map<string, Promise<ChainRuntime>>()

	public constructor(private readonly factory: PxeFactory) {}

	private key(profileId: string, chainId: number): string {
		return chainRegistryKey({ profileId, chainId })
	}

	/** Returns the initialized runtime for `(profileId, chainId)` or
	 *  `undefined` if it hasn't been initialized yet. Never mutates
	 *  registry state. */
	public peek(profileId: string, chainId: number): ChainRuntime | undefined {
		return this.runtimes.get(this.key(profileId, chainId))
	}

	/** Lazy-init for `(network.profileId, network.chainId)`. Concurrent
	 *  callers share the same init promise. If the runtime exists but
	 *  its rpcUrl no longer matches (network re-bound), the existing
	 *  runtime is disposed and re-initialized under the new URL.
	 *  `storeKey` is only consumed on an actual init (the production
	 *  factory fail-closes without it). */
	public async getOrInit(network: NetworkInfo, storeKey?: Uint8Array): Promise<ChainRuntime> {
		const k = this.key(network.profileId, network.chainId)
		const existing = this.runtimes.get(k)
		if (existing && existing.rpcUrl === network.rpcUrl) {
			return existing
		}
		if (existing && existing.rpcUrl !== network.rpcUrl) {
			this.runtimes.delete(k)
			await existing.dispose()
		}

		let promise = this.initPromises.get(k)
		if (!promise) {
			promise = this.factory
				.createChainRuntime(network, storeKey)
				.then((runtime) => {
					this.runtimes.set(k, runtime)
					this.initPromises.delete(k)
					return runtime
				})
				.catch((err) => {
					this.initPromises.delete(k)
					throw err
				})
			this.initPromises.set(k, promise)
		}
		return promise
	}

	/**
	 * Dispose the given (key, runtime) pairs, tolerating individual failures:
	 *  - settle ALL (a failed close on one chain must not skip disposing the rest — `Promise.all`
	 *    would abandon the siblings on the first rejection, leaking their locks);
	 *  - RE-ADD any runtime whose `dispose()` threw (its `store.close()` failed → the SAH-pool lock
	 *    is leaked; keeping the reference is the ONLY retry handle — dropping it wedges every future
	 *    open of that chain forever, silently);
	 *  - propagate the collected failures as an `AggregateError` so the deletion coordinator treats
	 *    the erasure as INCOMPLETE + retryable, never falsely successful.
	 * Callers hold the PxeService write barrier, so a re-added poisoned entry can't be observed by a
	 * concurrent read.
	 */
	private async settleDisposals(entries: Array<[string, ChainRuntime]>): Promise<void> {
		const results = await Promise.allSettled(entries.map(([, r]) => r.dispose()))
		const errors: unknown[] = []
		results.forEach((res, i) => {
			if (res.status === "rejected") {
				errors.push(res.reason)
				const [k, runtime] = entries[i]
				this.runtimes.set(k, runtime)
			}
		})
		if (errors.length) {
			throw new AggregateError(errors, `${errors.length} PXE runtime(s) failed to dispose (store close failed — lock may be leaked)`)
		}
	}

	/** Dispose every runtime this registry owns. Must be called under
	 *  the PxeService write lock — otherwise concurrent reads may
	 *  observe a torn-down runtime. */
	public async clear(): Promise<void> {
		const entries = Array.from(this.runtimes.entries())
		this.runtimes.clear()
		this.initPromises.clear()
		await this.settleDisposals(entries)
	}

	/** Dispose the single runtime (if any) for `(profileId, chainId)`. Must
	 *  be called under the PxeService write lock. No-op if no runtime
	 *  exists. */
	public async dispose(profileId: string, chainId: number): Promise<void> {
		const k = this.key(profileId, chainId)
		const runtime = this.runtimes.get(k)
		this.runtimes.delete(k)
		this.initPromises.delete(k)
		if (runtime) await runtime.dispose()
	}

	/**
	 * Dispose every runtime owned by `profileId` (across all chainIds).
	 *
	 * Phase 2 Week 3 cascade entry-point for profile delete: the PxeService
	 * acquires the per-profile write barrier (which waits for any in-flight
	 * chain ops on this profile to drain), then calls this to tear down
	 * every `(profileId, *)` runtime in one pass.
	 *
	 * Other profiles' runtimes are untouched — that's the whole point of
	 * per-profile cascade vs. the global `clear()`.
	 */
	public async disposeProfile(profileId: string): Promise<void> {
		const prefix = chainRegistryKeyPrefix(profileId)
		const victims: Array<[string, ChainRuntime]> = []
		for (const [k, runtime] of this.runtimes) {
			if (k.startsWith(prefix)) {
				victims.push([k, runtime])
				this.runtimes.delete(k)
			}
		}
		for (const k of Array.from(this.initPromises.keys())) {
			if (k.startsWith(prefix)) this.initPromises.delete(k)
		}
		await this.settleDisposals(victims)
	}
}
