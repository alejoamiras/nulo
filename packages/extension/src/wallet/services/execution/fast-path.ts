/**
 * Public-static fast path for dApp `aztec_simulateTx`.
 *
 * Three pieces:
 *
 *   - `rehydrateOptimizablePrefix`: cheap data-only scan for the
 *     boundary between the optimizable public-static prefix and the
 *     remainder; rehydrates ONLY the prefix into real `FunctionCall`
 *     instances (the remainder stays raw — the standard arm closure
 *     re-rehydrates via `planner.processAztecJsPayload` internally).
 *
 *   - `wrapStandardArmForMixedMerge`: wraps a `TxSimulationResult`
 *     from `executeAztecSimulateTxStandard` into the
 *     `TxSimulationResultWithAppOffset` shape upstream's
 *     `buildMergedSimulationResult` expects. Offset is hardcoded to 1
 *     because Nulo's `DefaultAccountEntrypoint` has no wallet-prepended
 *     fee calls (fee mode is encoded in entrypoint args).
 *
 *   - `runFastPath`: orchestrates the optimized public sim against the
 *     node (`@aztec/wallet-sdk/base-wallet`'s `simulateViaNode`) in
 *     parallel with the standard arm, then merges via upstream
 *     `buildMergedSimulationResult`.
 *
 * Both helpers and orchestrator are pure-ish (no chrome.*, no service-
 * container access) so the fast-path logic is unit-testable without
 * instantiating `ExecutionService` and its 20-dep graph.
 *
 * Pure-public-static prefix only. Mixed payloads (prefix + non-static
 * remainder) ARE supported. The first-tx multicall init case is
 * excluded upstream in the orchestrator caller (`executeAztecSimulateTx`
 * in `service.ts`) via `IAccountContract.requiresInitialization` — the
 * doubly-nested execution tree from `DefaultMultiCallEntrypoint` is not
 * expressible by upstream's flat `appCallOffset` model.
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import { FunctionCall, FunctionType } from "@aztec/stdlib/abi"
import type { TxSimulationResult } from "@aztec/stdlib/tx"
import { SimulationError } from "@aztec/stdlib/errors"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { ChainInfo } from "@aztec/entrypoints/interfaces"
import type { SimulateOptions } from "@aztec/aztec.js/wallet"
import { TxSimulationResultWithAppOffset } from "@aztec/aztec.js/wallet"
import type { ContractNameResolver } from "@aztec/pxe/client/lazy"
import { buildMergedSimulationResult, simulateViaNode } from "@aztec/wallet-sdk/base-wallet"
import { completeFeeOptions, type PartialGasSettingsRPC } from "@nulo/aztec-runtime/account"
import type { IPXE } from "@nulo/aztec-runtime/pxe"

/**
 * For Nulo's `DefaultAccountEntrypoint` standard path: the flattened
 * call tree is `root = entrypoint`, `nested[0..] = app calls`. Upstream's
 * `appCallOffset` semantics: `0 = root is app`, `N = nested[N-1]` is the
 * first app call. So offset is 1 — entrypoint hop precedes the app.
 *
 * Nulo's `DefaultAccountEntrypoint` does NOT prepend wallet-side fee
 * calls (fee mode is encoded in entrypoint args), so we DON'T add
 * `feeCalls.length` like upstream's `computeAppCallOffset` does.
 *
 * The first-tx multicall init case (where the tree is doubly nested:
 * `multicall → [ctor, entrypoint → [appCalls]]`) is excluded by the
 * caller via `IAccountContract.requiresInitialization`. We never reach
 * the merge with that tree shape.
 */
const NULO_ENTRYPOINT_APP_OFFSET = 1

/**
 * Scans `calls` for the boundary at the first non-public-static call,
 * rehydrates ONLY the prefix into real `FunctionCall` instances.
 * Returns `null` when there's no optimizable prefix at all (calls is
 * empty / not an array / fully private / starts with public-non-static).
 *
 * Why the boundary scan first: rehydrating a fully-private payload only
 * to throw it away would force the standard path to re-parse via
 * `planner.processAztecJsPayload` — double work.
 *
 * Accepts `readonly unknown[] | undefined` because `op.exec.calls`
 * arrives unvalidated at the SW boundary (the wallet-bridge dispatcher
 * just casts dApp args through — `dispatcher.ts:671-678`).
 *
 * Does NOT support already-hydrated `FunctionCall` instances —
 * `FunctionCall.schema` uses hex-string nested parsers that reject
 * rich types. In production the SW always receives RPC-shaped input,
 * so this restriction is fine.
 */
export function rehydrateOptimizablePrefix(
	calls: readonly unknown[] | undefined,
): { optimizableCalls: FunctionCall[]; remainingRaw: unknown[] } | null {
	if (!Array.isArray(calls) || calls.length === 0) return null

	// Data-only scan — `FunctionType` is string-backed upstream
	// (`@aztec/stdlib/abi/abi.ts:166-170`) so `=== FunctionType.PUBLIC`
	// survives JSON round-trip without rehydrating the call.
	let boundary = 0
	for (const c of calls) {
		if (typeof c !== "object" || c === null) break
		const obj = c as { type?: unknown; isStatic?: unknown }
		if (obj.type !== FunctionType.PUBLIC || obj.isStatic !== true) break
		boundary++
	}
	if (boundary === 0) return null // No optimizable prefix; caller falls through to standard.

	// Rehydrate ONLY the prefix. Remainder stays raw — caller's standard-arm
	// closure re-rehydrates via `planner.processAztecJsPayload`. Zod throws
	// on malformed inputs (schema drift, missing fields); caller treats null
	// as "fall back to standard path".
	try {
		const optimizableCalls = calls.slice(0, boundary).map((c) => FunctionCall.schema.parse(c))
		return { optimizableCalls, remainingRaw: calls.slice(boundary) }
	} catch {
		return null
	}
}

/**
 * Wrap a standard-path `TxSimulationResult` into the
 * `TxSimulationResultWithAppOffset` shape upstream's
 * `buildMergedSimulationResult` expects. Offset is 1 — see
 * `NULO_ENTRYPOINT_APP_OFFSET` JSDoc.
 *
 * Caller must ensure the standard arm did NOT go through the multicall
 * init path (`IAccountContract.requiresInitialization === false`).
 */
export function wrapStandardArmForMixedMerge(result: TxSimulationResult): TxSimulationResultWithAppOffset {
	return TxSimulationResultWithAppOffset.fromResultAndOffset(result, NULO_ENTRYPOINT_APP_OFFSET)
}

export interface FastPathDeps {
	node: AztecNode
	pxe: IPXE
	fromAddr: AztecAddress
	opts: SimulateOptions
	optimizableCalls: FunctionCall[]
	remainingRaw: unknown[]
	/** Closure into Nulo's standard PXE path. Caller (`service.ts`)
	 *  hands us a function bound to its `executeAztecSimulateTxStandard`
	 *  + the relevant `op`. Returns plain `TxSimulationResult`; we wrap
	 *  it via `wrapStandardArmForMixedMerge` before merging. */
	runStandardArm: (rawCalls: unknown[]) => Promise<TxSimulationResult>
	getContractName: ContractNameResolver
	logError: (msg: string, err: unknown) => void
}

/**
 * Run the optimized public-static prefix sim against the node, in
 * parallel with the standard arm for the remainder. Merge via upstream
 * `buildMergedSimulationResult`.
 *
 * Returns:
 *   - `TxSimulationResult` on success (actually a
 *     `TxSimulationResultWithAppOffset` since `extends TxSimulationResult`)
 *   - `null` on any infra fallback signal (no synced block, node RPC
 *     failure, malformed gas-settings input, etc.) — caller falls
 *     back to the full standard PXE path.
 *
 * Throws:
 *   - `SimulationError` (contract revert from `simulateViaNode`) — the
 *     real sim outcome. Re-routing through the standard path would
 *     produce the same error 3-5 s later via PXE.
 *
 * The catch is narrowed to fast-path-EXCLUSIVE operations
 * (`getSyncedBlockHeader`/`getBlockHeader`, the gas-settings translator,
 * `simulateViaNode`, the standard-arm closure throw). Operations that
 * share fate with the standard path (`getNodeInfo` — standard path
 * needs the same node) and our own post-sim merge are NOT caught.
 */
export async function runFastPath(deps: FastPathDeps): Promise<TxSimulationResult | null> {
	const { node, pxe, fromAddr, opts, optimizableCalls, remainingRaw, runStandardArm, getContractName, logError } = deps

	// `getNodeInfo` shares fate with the standard PXE path — let it propagate.
	const nodeInfo = await node.getNodeInfo()
	const chainInfo: ChainInfo = {
		chainId: new Fr(nodeInfo.l1ChainId),
		version: new Fr(nodeInfo.rollupVersion),
	}

	let optimizedResults: TxSimulationResult[]
	let normalResult: TxSimulationResultWithAppOffset | null = null
	try {
		// Mirror upstream `BaseWallet.simulateTx`: prefer PXE synced
		// header, fall back to node head. Critical for mixed merge so
		// both arms anchor at the same chain state.
		let blockHeader
		try {
			blockHeader = await pxe.getSyncedBlockHeader()
		} catch {
			blockHeader = (await node.getBlockHeader()) ?? undefined
		}
		if (!blockHeader) return null

		const gasSettings = await completeFeeOptions({
			node,
			gasSettings: opts.fee?.gasSettings as PartialGasSettingsRPC | undefined,
			forEstimation: true,
		})

		const optimizedPromise =
			optimizableCalls.length > 0
				? simulateViaNode(
						node,
						optimizableCalls,
						fromAddr,
						chainInfo,
						gasSettings,
						blockHeader,
						opts.skipFeeEnforcement ?? true,
						getContractName,
					)
				: Promise.resolve([] as TxSimulationResult[])

		const normalPromise: Promise<TxSimulationResultWithAppOffset | null> =
			remainingRaw.length > 0 ? runStandardArm(remainingRaw).then(wrapStandardArmForMixedMerge) : Promise.resolve(null)

		;[optimizedResults, normalResult] = await Promise.all([optimizedPromise, normalPromise])
	} catch (err) {
		if (err instanceof SimulationError) throw err
		logError("[PR 8c] fast-path failed, falling back to standard path", err)
		return null
	}

	// Merge via upstream — `wrapStandardArmForMixedMerge` produces exactly
	// the input shape `buildMergedSimulationResult` expects. The merged
	// return is `TxSimulationResultWithAppOffset extends TxSimulationResult`,
	// so the caller's signature is satisfied. Local invariant violations
	// from the merge itself surface naturally (not caught).
	return buildMergedSimulationResult(optimizedResults, normalResult)
}
