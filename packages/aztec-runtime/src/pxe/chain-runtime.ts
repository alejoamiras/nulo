import { getPXEConfig, type PXEConfig } from "@aztec/pxe/config"
import { createPXE, type PXE } from "@aztec/pxe/client/bundle"
import { WASMSimulator } from "@aztec/simulator/client"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { AcceleratorProver, type AcceleratorPhase } from "@alejoamiras/aztec-accelerator"
import { AztecNodeFactoryAdapter } from "../adapters/aztec-node-factory-adapter"
import type { NodeFactory } from "../ports/node-factory-port"

/**
 * Optional accelerator-server policy for `ProductionPxeFactory`.
 *
 * Defaults (all fields omitted): silent-fallback behavior preserved
 * — the wallet constructs `AcceleratorProver` with no callback and no
 * preflight, so if the accelerator isn't reachable the SDK falls back to
 * WASM proving as it does in production today.
 *
 * `required: true` is CI-only. Set from the extension shell when
 * `VITE_NULO_ACCELERATOR_REQUIRED=1` is baked into the build. In this
 * mode `createChainRuntime` performs an eager `checkAcceleratorStatus()`
 * preflight and the prover's `onPhase` callback throws synchronously
 * whenever the SDK is about to fall back ("fallback"/"denied" phases).
 *
 * Fields stay primitive (no `accelerator/config` import here) so that
 * `@nulo/aztec-runtime` remains decoupled from the extension's `@/` alias.
 */
export interface ProductionPxeFactoryOptions {
	required?: boolean
	host?: string
	port?: number
}

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
	) {}

	/**
	 * Shut down the PXE. `pxe.stop()` drains the job queue rather than
	 * aborting in-flight work (verified against upstream @aztec/pxe); so
	 * correctness across profile switch comes from the ReadWriteGuard's
	 * drain-on-write semantics, not teardown. This method just releases
	 * handles after the guard has ensured no readers remain.
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
	}
}

/** Seam for unit tests: swap this out with a fake that returns a
 *  fixture `ChainRuntime` (e.g. with mock PXE / node) instead of
 *  running real PXE init. */
export interface PxeFactory {
	createChainRuntime(network: NetworkInfo): Promise<ChainRuntime>
}

export class ProductionPxeFactory implements PxeFactory {
	private readonly nodeFactory: NodeFactory
	private readonly required: boolean
	private readonly host: string | undefined
	private readonly port: number | undefined

	public constructor(nodeFactory?: NodeFactory, options?: ProductionPxeFactoryOptions) {
		this.nodeFactory = nodeFactory ?? new AztecNodeFactoryAdapter()
		this.required = options?.required ?? false
		this.host = options?.host
		this.port = options?.port
	}

	public async createChainRuntime(network: NetworkInfo): Promise<ChainRuntime> {
		const node = this.nodeFactory.createNode(network.rpcUrl)
		const config = {
			...getPXEConfig(),
			dataDirectory: `pxe/${network.profileId}/${network.chainId}`,
			proverEnabled: true,
		} as PXEConfig
		// Pass an explicit WASMSimulator into both the prover AND the PXE
		// config so neither falls back to dynamic-import
		// `@aztec/simulator/client` at runtime. The dynamic-import fallback
		// (via the accelerator's `createLazySimulator`) fails under MV3
		// offscreen-document conditions even though the chunk is bundled,
		// throwing "No simulator provided and @aztec/simulator/client
		// could not be loaded." during `proveTx`. Static import makes the
		// simulator part of the main bundle graph and avoids that path.
		const simulator = new WASMSimulator()

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
				throw new Error("[accelerator-required] accelerator-server unavailable. " + `Status: ${JSON.stringify(status)}`)
			}
			if (status.needsDownload) {
				console.warn(
					"[accelerator-required] accelerator-server reports needsDownload=true " +
						`for aztec_version=${status.sdkAztecVersion}. First prove will be slow.`,
				)
			}
		}

		const pxe = await createPXE(node, config, { proverOrOptions: prover, simulator })
		return new ChainRuntime(network.chainId, node, pxe, network.rpcUrl)
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
		return `${profileId}:${chainId}`
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
	 *  runtime is disposed and re-initialized under the new URL. */
	public async getOrInit(network: NetworkInfo): Promise<ChainRuntime> {
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
				.createChainRuntime(network)
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

	/** Dispose every runtime this registry owns. Must be called under
	 *  the PxeService write lock — otherwise concurrent reads may
	 *  observe a torn-down runtime. */
	public async clear(): Promise<void> {
		const runtimes = Array.from(this.runtimes.values())
		this.runtimes.clear()
		this.initPromises.clear()
		await Promise.all(runtimes.map((r) => r.dispose()))
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
		const prefix = `${profileId}:`
		const victims: ChainRuntime[] = []
		for (const [k, runtime] of this.runtimes) {
			if (k.startsWith(prefix)) {
				victims.push(runtime)
				this.runtimes.delete(k)
			}
		}
		for (const k of Array.from(this.initPromises.keys())) {
			if (k.startsWith(prefix)) this.initPromises.delete(k)
		}
		await Promise.all(victims.map((r) => r.dispose()))
	}
}
