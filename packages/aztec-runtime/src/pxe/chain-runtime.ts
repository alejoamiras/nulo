import { getPXEConfig, type PXEConfig } from "@aztec/pxe/config"
import { createPXE, type PXE } from "@aztec/pxe/client/bundle"
import { createLogger } from "@aztec/foundation/log"
import type { AztecSQLiteOPFSStore } from "@aztec/kv-store/sqlite-opfs"
import { WASMSimulator } from "@aztec/simulator/client"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { PrestoProver, type PrestoPhase } from "@alejoamiras/presto"
import type { ProveBackend } from "@nulo/wallet-core/jobs"
import { AztecNodeFactoryAdapter } from "../adapters/aztec-node-factory-adapter"
import type { NodeFactory } from "../ports/node-factory-port"
import { chainDataDir, chainRegistryKey, chainRegistryKeyPrefix } from "./chain-coordinates"
import { openChainStore } from "./opfs-store"

/** Typed marker for "the per-profile store key was never provisioned to this offscreen" — the
 *  SW-side client recognizes it, re-provisions via its key provider, and retries once (covers
 *  offscreen-document restarts, which drop all in-memory state including the key map). */
export const PXE_STORE_KEY_MISSING = "PXE_STORE_KEY_MISSING"

/** Optional Presto endpoint. Orthogonal to the proving mode — meaningful only in
 *  non-proverless modes; ignored under `proverless`. Stays primitive (no `presto/config`
 *  import) so `@nulo/aztec-runtime` remains decoupled from the extension's `@/` alias. */
export interface PrestoEndpoint {
	host?: string
	port?: number
	httpsPort?: number
}

export type { ProveBackend }

/** The attempt currently proving on a runtime. `PxeService` sets and clears it inside the
 *  `proveTx` write lock; the runtime's `onPhase` advances `seq` and derives `backend`. */
export interface ActiveProve {
	proveId: string
	seq: number
	backend?: ProveBackend
}

/** One phase of a correlated prove attempt. `seq` strictly increases within an attempt, so a
 *  receiver can drop stale or reordered events; `backend` is the source's conclusion so far. */
export interface ProvePhaseEvent {
	proveId: string
	seq: number
	phase: PrestoPhase
	backend?: ProveBackend
}

export type ProvePhaseObserver = (event: ProvePhaseEvent) => void

/**
 * PXE factory options as a discriminated union over the proving mode, so the
 * previously-illegal `required` + `proverless` combination is unrepresentable
 * (it used to be a runtime throw in the constructor).
 *
 * - `default` (or `provingMode` omitted) — production: native proving via
 *   `PrestoProver` over HTTPS only, silent WASM fallback preserved, no preflight.
 * - `required` — CI-only (`VITE_NULO_PRESTO_REQUIRED=1`): plaintext HTTP to the
 *   headless server is derived from the mode, plus an eager `checkPrestoStatus()`
 *   preflight and an `onPhase` guard that throws on any fallback-class phase.
 * - `proverless` — E2E-only (double-opt-in `VITE_NULO_E2E_PROVERLESS`): builds
 *   the PXE with `proverEnabled: false` (no `PrestoProver`; the bundle prover's
 *   fakeProofs path emits a chonk proof the local network accepts). NEVER
 *   reaches a production build. The endpoint is ignored in this mode.
 */
export type ProductionPxeFactoryOptions =
	| (PrestoEndpoint & { provingMode?: "default"; onProvePhase?: ProvePhaseObserver })
	| (PrestoEndpoint & { provingMode: "required"; onProvePhase?: ProvePhaseObserver })
	| (PrestoEndpoint & { provingMode: "proverless" })

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
	/** The profile row's persisted 128-bit incarnation generation (#281 D4),
	 *  captured SW-side under the facade lock when the request is built and
	 *  verified offscreen-side inside the profile barrier. A retry reuses its
	 *  original capture, so an op that outlived a delete + same-id re-import is
	 *  rejected instead of running against the successor's store. Optional at
	 *  the type level (test fakes; the production client always attaches it). */
	pxeGeneration?: string
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

	/** Set by `PxeService` for the duration of one `proveTx`; advanced by the prover's phase
	 *  observer. Undefined outside a correlated attempt, when phases are not reportable. */
	public activeProve: ActiveProve | undefined

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
	private readonly httpsPort: number | undefined
	private readonly proverless: boolean
	private readonly onProvePhase: ProvePhaseObserver | undefined

	public constructor(nodeFactory?: NodeFactory, options?: ProductionPxeFactoryOptions) {
		this.nodeFactory = nodeFactory ?? new AztecNodeFactoryAdapter()
		const provingMode = options?.provingMode ?? "default"
		// `required` + `proverless` is unrepresentable in the union, so the old
		// runtime mutual-exclusion throw is no longer reachable.
		this.required = provingMode === "required"
		this.proverless = provingMode === "proverless"
		this.host = options?.host
		this.port = options?.port
		this.httpsPort = options?.httpsPort
		this.onProvePhase = options?.provingMode === "proverless" ? undefined : options?.onProvePhase
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
		// (via the SDK's `createLazySimulator`) fails under MV3
		// offscreen-document conditions even though the chunk is bundled,
		// throwing "No simulator provided and @aztec/simulator/client
		// could not be loaded." during `proveTx`. Static import makes the
		// simulator part of the main bundle graph and avoids that path.
		const simulator = new WASMSimulator()

		// E2E-only proverless: skip the BB SNARK. The PXE still runs kernel
		// simulation (real public inputs / nullifiers) and emits a random
		// chonk proof via the default bundle prover's fakeProofs path; the
		// local network accepts it. No PrestoProver, no onPhase, no
		// preflight. The `simulator` is still passed so kernel sim stays on
		// the bundled WASM path (same MV3 reason as above).
		if (this.proverless) {
			const pxe = await createPXE(node, config, { simulator, store })
			return new ChainRuntime(network.chainId, node, pxe, network.rpcUrl, store)
		}

		let runtime: ChainRuntime | undefined
		const onPhase = (phase: PrestoPhase) => {
			if (this.required) requiredModeGuard(phase)
			// Evidence is derived here, where every phase is seen in order; the observer is isolated
			// so a reporting failure can never fail a proof.
			const active = runtime?.activeProve
			if (!active || !this.onProvePhase) return
			try {
				this.onProvePhase(advanceProve(active, phase))
			} catch (error) {
				console.warn("[presto] prove-phase observer failed", { error })
			}
		}
		const prover = new PrestoProver({
			simulator,
			onPhase,
			presto: {
				...(this.host !== undefined && { host: this.host }),
				...(this.port !== undefined && { port: this.port }),
				...(this.httpsPort !== undefined && { httpsPort: this.httpsPort }),
				// Explicit on both arms: neither the SDK's runtime detection nor a `PRESTO_HTTPS_ONLY`
				// env may widen production to plaintext; the headless CI server is HTTP-only, so the
				// required mode is the one place plaintext is representable.
				httpsOnly: !this.required,
			},
		})

		// Required-mode preflight: fail at PXE-creation time rather than at first prove, so the
		// failure site is unambiguous. The SDK's 10 s status cache makes the first prove's own
		// probe free.
		if (this.required) await assertPrestoReady(prover)

		const pxe = await createPXE(node, config, { proverOrOptions: prover, simulator, store })
		runtime = new ChainRuntime(network.chainId, node, pxe, network.rpcUrl, store)
		return runtime
	}
}

/** `secure-connection-unavailable` and `version-mismatch` precede `fallback` on the paths that
 *  detect them (a legacy health-version mismatch reaches `fallback` without its own phase), so
 *  throwing on them is redundant but names the precise reason. */
const FALLBACK_CLASS_PHASES: ReadonlySet<PrestoPhase> = new Set(["fallback", "denied", "secure-connection-unavailable", "version-mismatch"])

/** CI guard: WASM proving is forbidden; a first-prove `bb` download is a warning. */
function requiredModeGuard(phase: PrestoPhase): void {
	if (FALLBACK_CLASS_PHASES.has(phase)) {
		throw new Error(
			`[presto-required] SDK emitted phase="${phase}" — proving was about to fall back to WASM. ` +
				"Forbidden in required-mode (VITE_NULO_PRESTO_REQUIRED=1).",
		)
	}
	if (phase === "downloading") {
		console.warn('[presto-required] SDK emitted phase="downloading" — first prove will be slow.')
	}
}

async function assertPrestoReady(prover: PrestoProver): Promise<void> {
	const status = await prover.checkPrestoStatus()
	if (!status.available) {
		const diagnosis = status.reason === "secure-connection-unavailable" ? ` diagnosis=${status.diagnosis}` : ""
		throw new Error(`[presto-required] presto-server unavailable: reason=${status.reason}${diagnosis}`)
	}
	if (status.needsDownload) {
		console.warn(
			`[presto-required] presto-server reports needsDownload=true for aztec_version=${status.sdkAztecVersion}. ` +
				"First prove will be slow.",
		)
	}
}

/** Advance an attempt's evidence by one phase. `transmit` selects Presto (the SDK emits it
 *  before the POST, so it is intent, not delivery); `fallback`/`denied` override it with the
 *  browser; completion phases preserve whichever was chosen. */
export function advanceProve(active: ActiveProve, phase: PrestoPhase): ProvePhaseEvent {
	active.seq += 1
	if (phase === "transmit") active.backend = "presto"
	else if (phase === "fallback" || phase === "denied") active.backend = "browser"
	return { proveId: active.proveId, seq: active.seq, phase, backend: active.backend }
}

/**
 * Per-(profileId, chainId) registry of `ChainRuntime` instances.
 *
 * Locking contract (enforced by the PxeService callers, not here):
 * `peek`/`peekMatching` are safe under the chain READ guard; `ensure`
 * (init or endpoint rebind — it may DISPOSE a live runtime) requires the
 * chain WRITE guard; `clear`/`dispose*` run under the profile write
 * barrier. Write exclusivity replaces the old shared-init-promise dedup:
 * two readers that both miss simply serialize through `ensure`, and the
 * second finds the runtime already bound.
 */
export class ChainRuntimeRegistry {
	private readonly runtimes = new Map<string, ChainRuntime>()

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

	/** URL-checked peek: the runtime for `network`'s coordinates, but only if it
	 *  is already bound to `network.rpcUrl`. `undefined` on a miss OR an endpoint
	 *  mismatch — the caller escalates to `ensure` under the chain WRITE guard.
	 *  Never mutates registry state, so it is safe under a chain READ. */
	public peekMatching(network: NetworkInfo): ChainRuntime | undefined {
		const existing = this.runtimes.get(this.key(network.profileId, network.chainId))
		return existing && existing.rpcUrl === network.rpcUrl ? existing : undefined
	}

	/** Init-or-rebind for `(network.profileId, network.chainId)`.
	 *
	 *  MUST be called under the chain WRITE guard (and the profile barrier read):
	 *  an endpoint rebind disposes the live runtime, which under a mere read lock
	 *  raced concurrent readers of the same chain and a third caller against the
	 *  not-yet-released SAH-pool lock (#281 D3). Write exclusivity also makes the
	 *  old shared-init-promise dedup unnecessary — and that map was itself a
	 *  hazard, keyed only by chain so a new-URL caller could inherit a stale-URL
	 *  init in flight.
	 *
	 *  Dispose-failure semantics mirror `settleDisposals`: the runtime reference
	 *  is dropped only AFTER a successful dispose — a failed `store.close()`
	 *  leaks the SAH lock, and the kept reference is the only retry handle.
	 *  `storeKey` is only consumed on an actual init (the production factory
	 *  fail-closes without it). */
	public async ensure(network: NetworkInfo, storeKey?: Uint8Array): Promise<ChainRuntime> {
		const k = this.key(network.profileId, network.chainId)
		const existing = this.runtimes.get(k)
		if (existing) {
			if (existing.rpcUrl === network.rpcUrl) return existing
			await existing.dispose()
			this.runtimes.delete(k)
		}
		const runtime = await this.factory.createChainRuntime(network, storeKey)
		this.runtimes.set(k, runtime)
		return runtime
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
		await this.settleDisposals(entries)
	}

	/** Dispose the single runtime (if any) for `(profileId, chainId)`. Must
	 *  be called under the PxeService write lock. No-op if no runtime
	 *  exists. */
	public async dispose(profileId: string, chainId: number): Promise<void> {
		const k = this.key(profileId, chainId)
		const runtime = this.runtimes.get(k)
		if (!runtime) return
		// Dispose BEFORE dropping the reference (mirrors `ensure` + `settleDisposals`):
		// a failed store.close() leaks the SAH-pool lock, and the kept entry is the
		// only retry handle — deleting first left the chain purge permanently wedged
		// with no recovery path (review finding).
		await runtime.dispose()
		this.runtimes.delete(k)
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
		await this.settleDisposals(victims)
	}
}
