/**
 * Pure helper that simulates a batch of view-shaped calls. Extracted from the
 * former `ExecutionService.executeSimulateViews` so it can be unit-tested in
 * isolation and called directly by internal consumers (balance projector,
 * gas-balance read) without going through the operation-dispatch path.
 *
 * The historical Nulo-custom `simulate_views` op kind was retired in #56;
 * this helper is the structurally-equivalent replacement.
 *
 * ## Four concurrency arms
 *
 *   1. UTILITY calls: launched eagerly via `pxe.executeUtility`, awaited
 *      serially AFTER the tx-arm settles. JS-side launches early; actual
 *      execution serializes through upstream PXE's `SerialQueue`.
 *   2. PUBLIC+isStatic LEADING PREFIX: bypasses upstream PXE entirely and
 *      goes direct-to-node via `simulateViaNode` (`@aztec/wallet-sdk/base-
 *      wallet`). This is the "fast arm" — the only path that escapes
 *      upstream's queue.
 *   3. Remaining tx-typed (everything after the fast prefix breaks):
 *      bundled into one `ExecutionPayload` and sent through
 *      `pxe.simulateTx({ simulatePublic: true })`. The "slow arm".
 *   4. Decode + per-index assembly: encoded[]/decoded[] arrays in input
 *      order.
 *
 * ## Why a LEADING PREFIX (not arbitrary filter)
 *
 * Mirrors upstream's `extractOptimizablePublicStaticCalls`. Any earlier
 * non-static call could affect later calls' observed state; routing
 * later-position public-static calls direct-to-node would observe a
 * different chain state than the slow arm. Caller (`balance-projector`)
 * is responsible for enqueueing in fast-friendly order — two-pass: all
 * PUBLIC first across the chunk, then all PRIVATE.
 *
 * The prefix also breaks at the first call with `hideMsgSender === true`,
 * since `simulateViaNode` ignores that flag when building
 * `PublicCallRequest` (`@aztec/wallet-sdk/base-wallet/utils.ts:93`). We
 * route hideMsgSender calls through the slow arm to preserve the
 * caller-supplied flag honor.
 *
 * ## Concurrency invariants (preserved verbatim from pre-extraction)
 *
 *   - PUBLIC + PRIVATE tx-typed calls on the slow arm: one
 *     `ExecutionPayload`, one `pxe.simulateTx`, kernel splits internally.
 *   - `account.buildTxExecutionRequest` opts:
 *       { cancellable: false, txNonce: Fr.random(),
 *         feePaymentMethodOptions: PREEXISTING_FEE_JUICE }
 *   - `pxe.simulateTx` opts:
 *       { simulatePublic: true, skipFeeEnforcement: true,
 *         scopes: [account.address] }
 *   - Private-return unpacking depends on whether
 *     `txRequest.origin.toString() === account.address.toString()`:
 *       same    → `simulatedTx.getPrivateReturnValues().nested`
 *       different → `simulatedTx.getPrivateReturnValues().nested[1].nested`
 *   - `FunctionCall.hideMsgSender` constructor arg:
 *       'call' kind          → `call.hideSender === true`
 *       'encoded_call' kind  → `call.hideMsgSender === true`
 *       UTILITY (either kind) → always `false`
 *   - Error strings preserved verbatim: "Contract not found",
 *     "Contract artifact not found", "Method not found".
 *   - Decode failures are isolated per-call: `decodeFromAbi` errors are
 *     logged but don't blow up sibling decodes.
 *
 * ## Fallback policy — pre-dispatch vs post-dispatch
 *
 * Pre-dispatch failures (before either tx arm starts):
 *   - **Anchor unavailable** (both `pxe.getSyncedBlockHeader` and
 *     `node.getBlockHeader` fail): WARN-log; demote `leadingFast` into
 *     `slow` so a single combined `pxe.simulateTx` runs the whole batch.
 *     No second pass.
 *   - **`completeFeeOptions` throws**: same WARN-log + demote-then-single-
 *     slow-pass behavior. Different log message.
 *   - **`node.getNodeInfo()` throws**: **propagate**. Shared-fate with the
 *     standard path (`buildTxExecutionRequest` uses it transitively),
 *     so no point catching here. Matches `fast-path.ts:170`.
 *
 * Post-dispatch failures (after both arms have launched in parallel):
 *   - **`SimulationError`** from `simulateViaNode` (real contract revert):
 *     **propagate**. Replaying through PXE produces the same error 3-5s
 *     later. Launched utility promises are left un-awaited — matches
 *     pre-PR behavior for any throw before the utility-await loop.
 *   - **Generic `Error`** from `simulateViaNode` (network blip, RPC
 *     mismatch, etc.): WARN-log + **full rerun** through standard
 *     `pxe.simulateTx` over `allTxCalls` (leadingFast ++ slow). Utility
 *     queue is NOT re-launched — original `utilityLaunched` promises are
 *     awaited once at end.
 *
 * ## Upstream PXE serialization (for future contributors)
 *
 * Every PXE method (`simulateTx`, `executeUtility`, `getSyncedBlockHeader`,
 * `proveTx`, `profileTx`) goes through a single upstream `SerialQueue`
 * (`@aztec/pxe@4.2.0/src/pxe.ts:328-336`). The upstream comment
 * (`pxe.ts:1058-1060`): *"we disable concurrent executions since those
 * might execute oracles which read and write to the PXE stores (e.g. to
 * the capsules), and we need to prevent concurrent runs from interfering
 * with one another."* Aztec issue #12636 tracks any future relaxation.
 *
 * Implication: do NOT attempt to downgrade Nulo's outer
 * `withPxeWrite` on `executeUtility` to `withPxeRead` — the upstream
 * queue serializes regardless AND utility calls can mutate PXE state per
 * the upstream comment.
 *
 * The only concurrency win in this helper is the fast arm (PUBLIC+
 * isStatic leading prefix), which bypasses the upstream queue entirely
 * by calling `node.simulatePublicCalls` directly.
 *
 * ## Dependency injection
 *
 * Callers resolve PXE / node / account / contractResolver themselves (via
 * `getViewSimulationDeps`) and pass them in. This keeps the helper pure and
 * trivially testable by stubbing the four dependencies. `chainInfo`,
 * `gasSettings`, and `getContractName` are derived inside the helper on
 * the fast-arm path only — no caller-side deps inflation.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import {
	type AbiDecoded,
	type AbiType,
	type ContractArtifact,
	FunctionCall,
	FunctionSelector,
	FunctionType,
	decodeFromAbi,
	encodeArguments,
} from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { ChainInfo } from "@aztec/entrypoints/interfaces"
import { SimulationError } from "@aztec/stdlib/errors"
import { ExecutionPayload, type TxSimulationResult, type UtilityExecutionResult } from "@aztec/stdlib/tx"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { simulateViaNode } from "@aztec/wallet-sdk/base-wallet"
import { completeFeeOptions } from "@nulo/aztec-runtime/account"
import type { IAccountContract } from "@nulo/aztec-runtime/account"
import type { IPXE } from "@nulo/aztec-runtime/pxe"
import { assertLiveChainIdentity, chainInfoFrom } from "@nulo/aztec-runtime/utils"
import type { CallAction, EncodedCallAction } from "@nulo/wallet-bridge"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { type ILogger, LogLevel } from "@/wallet/logger"
import { type ContractResolver, findFunctionByName, findFunctionBySelector } from "../contract-resolver"
import { getBlockHeaderAnchor } from "./block-header-anchor"

const LOG_SOURCE = "batched-view-simulation"

export interface BatchedViewSimulationDeps {
	readonly pxe: IPXE
	readonly node: AztecNode
	/** Stored chain identity for the user-selected network. Passed so the
	 *  caller's `node.getNodeInfo()` consumption can rebind via
	 *  `assertLiveChainIdentity` before deriving `chainInfo` (F-012 / A-01). */
	readonly network: { chainId: number }
	readonly account: IAccountContract
	readonly contractResolver: ContractResolver
	readonly logger?: ILogger
}

export interface BatchedViewSimulationResult {
	readonly encoded: Fr[][]
	readonly decoded: AbiDecoded[]
}

/** Tuple: [FunctionCall, originalIndex, slowArmSlotIndex (re-numbered per arm), returnTypes]. */
type TxTuple = [FunctionCall, number, number, AbiType[]]

export async function batchedViewSimulation(
	calls: ReadonlyArray<CallAction | EncodedCallAction>,
	deps: BatchedViewSimulationDeps,
): Promise<BatchedViewSimulationResult> {
	const encoded: Fr[][] = []
	const decoded: AbiDecoded[] = []
	if (calls.length === 0) return { encoded, decoded }

	const { pxe, node, network, account, contractResolver, logger } = deps

	// Resolve contract instances + artifacts up-front.
	const contractAddresses = contractResolver.extractContracts([...calls])
	const instances = await contractResolver.resolveInstances(pxe, contractAddresses)
	const artifacts = await contractResolver.resolveArtifacts(pxe, instances)

	// Register any contract PXE doesn't already know about.
	await contractResolver.ensureContractsRegistered(pxe, instances, artifacts, {
		onRegister: (contract) => logger?.log(LOG_SOURCE, LogLevel.Debug, `Register contract ${contract}`),
	})

	await account.ensureRegistered(pxe)

	// Classify into utility + tx-typed pools. UTILITY is built but NOT launched
	// here — we defer launch until after the anchor read (see partition below).
	type ClassifiedUtility = { kind: "utility"; functionCall: FunctionCall; returnTypes: AbiType[]; originalIndex: number }
	type ClassifiedTx = { kind: "tx"; functionCall: FunctionCall; returnTypes: AbiType[]; originalIndex: number }
	const allTxCalls: ClassifiedTx[] = []
	const allUtility: ClassifiedUtility[] = []

	for (let i = 0; i < calls.length; i++) {
		const c = await classifyCall(calls[i], instances, artifacts)
		if (c.kind === "utility") {
			allUtility.push({ ...c, originalIndex: i })
		} else {
			allTxCalls.push({ ...c, originalIndex: i })
		}
	}

	// Partition tx-typed pool into [leadingFast (PUBLIC+isStatic+!hideMsgSender)
	// prefix, slow (the rest)]. Mirrors upstream `extractOptimizablePublicStaticCalls`
	// — any earlier non-static call can affect later calls' observed state, so we
	// stop at the first non-eligible call.
	let boundary = 0
	for (const t of allTxCalls) {
		const fc = t.functionCall
		if (fc.type === FunctionType.PUBLIC && fc.isStatic && fc.hideMsgSender !== true) {
			boundary++
		} else {
			break
		}
	}
	let leadingFast: ClassifiedTx[] = allTxCalls.slice(0, boundary)
	let slow: ClassifiedTx[] = allTxCalls.slice(boundary)

	// Acquire the block-header anchor BEFORE launching eager utility writes.
	// Read-lock-after-queued-writers is the rw-guard hazard codex H2 flagged.
	// If anchor unavailable → silent FULL fallback: route everything through slow.
	let blockHeader: Awaited<ReturnType<typeof getBlockHeaderAnchor>>
	let chainInfo: ChainInfo | undefined
	let gasSettings: Awaited<ReturnType<typeof completeFeeOptions>> | undefined
	if (leadingFast.length > 0) {
		blockHeader = await getBlockHeaderAnchor(pxe, node)
		if (!blockHeader) {
			logger?.log(LOG_SOURCE, LogLevel.Warn, "fast arm: anchor unavailable, falling back to standard path")
			slow = allTxCalls.slice()
			leadingFast = []
		} else {
			// `node.getNodeInfo()` is shared-fate with the slow arm
			// (`buildTxExecutionRequest` uses it transitively). Don't catch —
			// propagate per plan §1c, mirroring `fast-path.ts:170`.
			const nodeInfo = await node.getNodeInfo()
			// F-012 / A-01 V-01: rebind live chain identity to the stored
			// network before deriving chainInfo. A drifted RPC must be rejected
			// before any merge/sim that depends on chainInfo runs.
			assertLiveChainIdentity(network, nodeInfo)
			chainInfo = {
				chainId: new Fr(nodeInfo.l1ChainId),
				version: new Fr(nodeInfo.rollupVersion),
			}
			try {
				// For views, no caller opts.fee → undefined → defaults. completeFeeOptions
				// mirrors upstream `BaseWallet.completeFeeOptions` byte-for-byte.
				gasSettings = await completeFeeOptions({ node, gasSettings: undefined, forEstimation: true })
			} catch (err) {
				logger?.log(
					LOG_SOURCE,
					LogLevel.Warn,
					`fast arm: completeFeeOptions failed, falling back to standard path: ${getErrorMessage(err)}`,
				)
				slow = allTxCalls.slice()
				leadingFast = []
				blockHeader = undefined
				chainInfo = undefined
			}
		}
	}

	// Re-number slow-arm slot indices separately (each arm has its own
	// publicCallIndex/privateCallIndex space).
	const slowTuples: TxTuple[] = []
	{
		let slowPublicIdx = 0
		let slowPrivateIdx = 0
		for (const t of slow) {
			const slotIndex = t.functionCall.type === FunctionType.PUBLIC ? slowPublicIdx++ : slowPrivateIdx++
			slowTuples.push([t.functionCall, t.originalIndex, slotIndex, t.returnTypes])
		}
	}

	// Launch utility eagerly NOW (anchor read complete). One promise per utility
	// call; the array is constructed exactly once and is NEVER re-launched on
	// fast-arm rerun (pinned by unit test).
	const utilityLaunched: Array<[Promise<UtilityExecutionResult>, number, AbiType[]]> = allUtility.map((u) => [
		pxe.executeUtility(u.functionCall, { scopes: [account.address] }),
		u.originalIndex,
		u.returnTypes,
	])

	// Tx arm dispatch. Use Promise.allSettled so the slow arm result is
	// available even when the fast arm rejects (so we can decide between
	// propagating vs falling back without leaking unhandled rejections).
	const fastArmPromise: Promise<TxSimulationResult[]> =
		leadingFast.length > 0 && blockHeader && chainInfo && gasSettings
			? runFastArm(leadingFast, blockHeader, chainInfo, gasSettings, node, account.address)
			: Promise.resolve([])
	const slowArmPromise: Promise<{ simulatedTx: SlowArmResult; txRequest: TxRequestLike } | null> =
		slowTuples.length > 0 ? runSlowArm(slowTuples, account, node, pxe) : Promise.resolve(null)

	const [fastSettled, slowSettled] = await Promise.allSettled([fastArmPromise, slowArmPromise])

	let fastResults: TxSimulationResult[] | null = null
	let slowResult: { simulatedTx: SlowArmResult; txRequest: TxRequestLike } | null = null
	let rerunNeeded = false

	if (fastSettled.status === "fulfilled") {
		fastResults = fastSettled.value
	} else if (fastSettled.reason instanceof SimulationError) {
		// Real revert from a public-static call — same outcome the slow path
		// would produce. Propagate; utility queue left un-awaited (matches
		// pre-PR behavior for any throw before utility-await loop).
		throw fastSettled.reason
	} else {
		// Infra: simulateViaNode rejected (network blip, RPC mismatch, malformed
		// node response). Pre-dispatch failures (anchor missing /
		// completeFeeOptions throw) are handled above without ever invoking
		// runFastArm, so we never see them on this branch. WARN + full rerun.
		const firstFast = leadingFast[0]
		const fastContract = firstFast ? firstFast.functionCall.to.toString() : "<empty>"
		const fastSelector = firstFast ? firstFast.functionCall.selector.toString() : "<empty>"
		const chainIdLog = chainInfo ? chainInfo.chainId.toString() : "<unknown>"
		logger?.log(
			LOG_SOURCE,
			LogLevel.Warn,
			`fast arm rejected (non-SimulationError); rerunning through standard path. chainId=${chainIdLog} firstContract=${fastContract} firstSelector=${fastSelector} reason=${getErrorMessage(fastSettled.reason)}`,
		)
		rerunNeeded = true
	}

	if (!rerunNeeded) {
		if (slowSettled.status === "fulfilled") {
			slowResult = slowSettled.value
		} else {
			// Slow arm rejected on its own (no fast-arm fallback path taken).
			// Propagate.
			throw slowSettled.reason
		}
	}

	if (rerunNeeded) {
		// Rebuild combined payload from leadingFast + slow. Re-number slot indices
		// across the combined set (publicCallIndex/privateCallIndex per type).
		const combined: TxTuple[] = []
		let publicIdx = 0
		let privateIdx = 0
		for (const t of allTxCalls) {
			const slotIndex = t.functionCall.type === FunctionType.PUBLIC ? publicIdx++ : privateIdx++
			combined.push([t.functionCall, t.originalIndex, slotIndex, t.returnTypes])
		}
		slowResult = await runSlowArm(combined, account, node, pxe)
		// Wipe fast results — combined slow arm covers everything now.
		fastResults = null
		// Replace slowTuples so unpack reads from the combined indexing.
		slowTuples.length = 0
		slowTuples.push(...combined)
	}

	// Unpack fast arm (if any).
	if (fastResults && leadingFast.length > 0) {
		// `simulateViaNode` returns one TxSimulationResult per upstream-internal
		// batch of MAX_ENQUEUED_CALLS_PER_CALL (=32 in @aztec/constants@4.2.0).
		// With our typical batch sizes (≤12 from balance-projector, 1 from
		// gas-balance) we get fastResults.length === 1, but flatMap is defensive
		// against future BATCH_SIZE bumps.
		const fastReturns = fastResults.flatMap((r) => r.publicOutput?.publicReturnValues ?? [])
		for (let k = 0; k < leadingFast.length; k++) {
			const tuple = leadingFast[k]
			const values = fastReturns[k]?.values ?? []
			encoded[tuple.originalIndex] = values
			try {
				decoded[tuple.originalIndex] = decodeFromAbi(tuple.returnTypes, values)
			} catch (error) {
				logger?.log(
					LOG_SOURCE,
					LogLevel.Error,
					"Failed to decode fast-arm simulation results",
					tuple.returnTypes,
					values,
					getErrorMessage(error),
				)
			}
		}
	}

	// Unpack slow arm (if any).
	if (slowResult && slowTuples.length > 0) {
		const { simulatedTx, txRequest } = slowResult
		const publicReturn = simulatedTx.getPublicReturnValues()
		// Origin-dependent nested-shape unpacking. After partition the slow-arm
		// payload may be private-only / public-only / mixed — origin equality
		// still holds because Nulo's `DefaultAccountEntrypoint` produces
		// `origin === account.address` regardless of payload composition.
		const privateReturn =
			txRequest.origin.toString() === account.address.toString()
				? simulatedTx.getPrivateReturnValues().nested
				: simulatedTx.getPrivateReturnValues().nested[1].nested

		for (const [call, i, j, types] of slowTuples) {
			const values = (call.type === FunctionType.PUBLIC ? publicReturn[j] : privateReturn[j]).values ?? []
			encoded[i] = values
			try {
				decoded[i] = decodeFromAbi(types, values)
			} catch (error) {
				logger?.log(LOG_SOURCE, LogLevel.Error, "Failed to decode simulation results", types, values, getErrorMessage(error))
			}
		}
	}

	// Serially await utility promises (kicked off eagerly above; ran in
	// parallel with tx-arm dispatch). Order of awaits doesn't affect
	// throughput — only the final per-index assignment ordering.
	for (const [promise, i, types] of utilityLaunched) {
		const { result: values } = await promise
		try {
			decoded[i] = decodeFromAbi(types, values)
		} catch (error) {
			logger?.log(LOG_SOURCE, LogLevel.Error, "Failed to decode utility simulation results", types, values, getErrorMessage(error))
		}
		encoded[i] = values
	}

	return { encoded, decoded }
}

// ── Internal helpers ────────────────────────────────────────────────────

type SlowArmResult = Awaited<ReturnType<IPXE["simulateTx"]>>
type TxRequestLike = Awaited<ReturnType<IAccountContract["buildTxExecutionRequest"]>>

/** Standard arm: bundle slow tuples into one ExecutionPayload and dispatch via
 *  `pxe.simulateTx({ simulatePublic: true })`. The opts are byte-equivalent
 *  to pre-PR behavior. */
async function runSlowArm(
	slowTuples: TxTuple[],
	account: IAccountContract,
	node: AztecNode,
	pxe: IPXE,
): Promise<{ simulatedTx: SlowArmResult; txRequest: TxRequestLike }> {
	const payload = new ExecutionPayload(
		slowTuples.map((x) => x[0]),
		[],
		[],
		[],
	)
	const txRequest = await account.buildTxExecutionRequest(
		node,
		pxe,
		payload,
		{
			cancellable: false,
			txNonce: Fr.random(),
			feePaymentMethodOptions: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE,
		},
		chainInfoFrom(await node.getNodeInfo()),
	)
	const simulatedTx = await pxe.simulateTx(txRequest, {
		simulatePublic: true,
		skipFeeEnforcement: true,
		scopes: [account.address],
	})
	return { simulatedTx, txRequest }
}

/** Fast arm: takes pre-resolved chainInfo + gasSettings + blockHeader (the
 *  caller did the prep so any throw from `node.getNodeInfo` propagates
 *  outside the Promise.allSettled wrapper). Bypasses PXE entirely. */
async function runFastArm(
	leadingFast: Array<{ functionCall: FunctionCall }>,
	blockHeader: NonNullable<Awaited<ReturnType<typeof getBlockHeaderAnchor>>>,
	chainInfo: ChainInfo,
	gasSettings: Awaited<ReturnType<typeof completeFeeOptions>>,
	node: AztecNode,
	fromAddr: AztecAddress,
): Promise<TxSimulationResult[]> {
	// `getContractName` is only used by upstream for debug-log strings
	// (`base-wallet/utils.ts:152`). Hardcoded undefined matches the existing
	// fast-path call site in `service.ts:1576`.
	const getContractName = async () => undefined
	return simulateViaNode(
		node,
		leadingFast.map((t) => t.functionCall),
		fromAddr,
		chainInfo,
		gasSettings,
		blockHeader,
		true, // skipFeeEnforcement
		getContractName,
	)
}

type ClassifiedCall =
	| { kind: "utility"; functionCall: FunctionCall; returnTypes: AbiType[] }
	| { kind: "tx"; functionCall: FunctionCall; returnTypes: AbiType[] }

/** Build the `FunctionCall` for a single user-supplied call. Splits into
 *  utility (built but NOT launched — caller decides launch timing) vs tx
 *  (queued for fast/slow arm partitioning). */
async function classifyCall(
	call: CallAction | EncodedCallAction,
	instances: Map<string, ContractInstanceWithAddress>,
	artifacts: Map<string, ContractArtifact>,
): Promise<ClassifiedCall> {
	if (call.kind === "call") {
		const instance = instances.get(call.contract)
		if (!instance) throw new Error("Contract not found")
		const artifact = artifacts.get(instance.currentContractClassId.toString())
		if (!artifact) throw new Error("Contract artifact not found")
		const fn = findFunctionByName(artifact, call.method)
		if (!fn) throw new Error("Method not found")
		const fnSelector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
		const encodedArgs = encodeArguments(fn, call.args)

		if (fn.functionType === FunctionType.UTILITY) {
			const functionCall = new FunctionCall(
				fn.name,
				AztecAddress.fromStringUnsafe(call.contract),
				fnSelector,
				fn.functionType,
				false, // hideMsgSender hardcoded false for utility calls (parity)
				fn.isStatic,
				encodedArgs,
				fn.returnTypes,
			)
			return { kind: "utility", functionCall, returnTypes: fn.returnTypes }
		}

		return {
			kind: "tx",
			functionCall: new FunctionCall(
				fn.name,
				AztecAddress.fromStringUnsafe(call.contract),
				fnSelector,
				fn.functionType,
				call.hideSender === true, // 'call' kind uses hideSender (parity)
				fn.isStatic,
				encodedArgs,
				fn.returnTypes,
			),
			returnTypes: fn.returnTypes,
		}
	}

	// encoded_call kind
	const instance = instances.get(call.to)
	if (!instance) throw new Error("Contract not found")
	const artifact = artifacts.get(instance.currentContractClassId.toString())
	if (!artifact) throw new Error("Contract artifact not found")
	const fn = await findFunctionBySelector(artifact, call.selector)
	if (!fn) throw new Error("Method not found")

	if (fn.functionType === FunctionType.UTILITY) {
		const functionCall = new FunctionCall(
			fn.name,
			AztecAddress.fromStringUnsafe(call.to),
			FunctionSelector.fromString(call.selector),
			fn.functionType,
			false, // hideMsgSender hardcoded false for utility calls (parity)
			fn.isStatic,
			call.args.map((x) => Fr.fromString(x)),
			fn.returnTypes,
		)
		return { kind: "utility", functionCall, returnTypes: fn.returnTypes }
	}

	return {
		kind: "tx",
		functionCall: new FunctionCall(
			fn.name,
			AztecAddress.fromStringUnsafe(call.to),
			FunctionSelector.fromString(call.selector),
			fn.functionType,
			call.hideMsgSender === true, // 'encoded_call' kind uses hideMsgSender (parity)
			fn.isStatic,
			call.args.map((x) => Fr.fromString(x)),
			fn.returnTypes,
		),
		returnTypes: fn.returnTypes,
	}
}
