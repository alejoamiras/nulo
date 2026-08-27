/**
 * `FeeStrategy` — fee-payment strategy family. Replaces the 4-way
 * switch inside `buildAndEstimateTxRequest` with a polymorphic strategy
 * interface. Each impl owns its own fee-payload injection +
 * simulate-and-finalize sequence:
 *
 *   - `FeeJuiceStrategy` (kind "fj") — plain FeeJuice, single-pass
 *   - `FeeJuiceWithClaimStrategy` (kind "fjwc") — prepend claim payload
 *   - `FpcStrategy` (kind "fpc") — two-pass: estimate with FJ first, then
 *     compute maxFee, prepend FPC fee payload, re-simulate with External
 *   - `EmbeddedStrategy` (kind "embedded") — dApp's own FPC, realistic
 *     maxFeesPerGas before simulation, 1x multiplier to stay within budget
 *
 * Shared helpers + the dispatch map live here. Per-strategy impls live
 * in `./{fee-juice,fee-juice-with-claim,fpc,embedded}-strategy.ts`.
 *
 * ## Return shape
 *
 * Strategies return a `FeeEstimate` — the `BuiltStandardTx` bundle plus
 * the `feePaymentMethod` the strategy resolved. Named fields are the
 * contract; the old positional 8-tuple was a silent-transposition hazard.
 *
 * ## Action array mutation (preserved)
 *
 * FJWC and FPC both mutate `ctx.op.actions` via `unshift` / `splice`.
 * That was intentional in the original code — the op passed in is
 * already a defensive clone done by the facade right before dispatch.
 * Strategies operate on the cloned array; caller-side state stays
 * untouched.
 *
 * ## Priority multiplier
 *
 * `feeSettings.priorityLevel` ("normal" / "fast" / "urgent") maps to
 * a numeric multiplier via `PRIORITY_MULTIPLIERS` in `models/fee.ts`.
 * All strategies get the pre-computed `feeMultiplier` in the context.
 * FJ / FJWC / Embedded pass it to `finalizeGasLimits`. FPC applies it
 * to `baseFees` BEFORE computing maxFee for the fee-payload actions.
 */

import { MAX_PROCESSABLE_L2_GAS, MAX_TX_DA_GAS } from "@aztec/constants"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { predictedWorstMinFees } from "@nulo/bridge-core/fee-juice"
import type { TxExecutionRequest, TxSimulationResult } from "@aztec/stdlib/tx"
import type { ILogger } from "@/wallet/logger"
import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { FpcService } from "@/wallet/services/fpc/service"
import type { IPXE } from "@/wallet/services/pxe/client"
import { StepContent, type TaskService, type WrappedTask } from "@/wallet/services/task/service"
import type { DiscoveryProbe } from "../discovery-aware-estimator"
import type { Action, FeeOptions, FeeSettings } from "../spec"
import type { BuiltStandardTx, TxRequestBuilder } from "../tx-request-builder"

/** Default multiplier for `maxFeesPerGas`. Production default is `2`.
 *  Overridable at build time via `VITE_NULO_FEE_MULTIPLIER` so e2e CI can
 *  widen the envelope when devnet base-fees drift on loaded GHA runners
 *  (a real cross-branch flake class — confirmed reproducible against
 *  `transfers.test.ts` and `concurrent-sendtx-confirm.test.ts` on a
 *  non-PR commit). Parsed once at module load; invalid / unset → 2. */
const VITE_FEE_MULTIPLIER_RAW = (import.meta.env?.VITE_NULO_FEE_MULTIPLIER ?? "") as string
const VITE_FEE_MULTIPLIER_PARSED = Number.parseFloat(VITE_FEE_MULTIPLIER_RAW)
export const DEFAULT_FEE_MULTIPLIER: number =
	Number.isFinite(VITE_FEE_MULTIPLIER_PARSED) && VITE_FEE_MULTIPLIER_PARSED >= 1 ? VITE_FEE_MULTIPLIER_PARSED : 2

/** Result returned by every strategy: the built tx plus the payment
 *  method the strategy resolved. Field names — not positions — are the
 *  contract; same-typed slots (gas/teardown/fee) made the old tuple a
 *  silent-transposition hazard. */
export interface FeeEstimate extends BuiltStandardTx {
	feePaymentMethod: AccountFeePaymentMethodOptions
}

/** Simulate callback — facade owns the TaskService wrapping so that
 *  strategies stay decoupled from task bookkeeping.
 *  `stubAccountAddresses` swaps those accounts for the stub artifact so
 *  unverifiable authwits surface as offchain effects instead of hard
 *  asserts; a stubbed sim MUST also pass `skipTxValidation: true` (the
 *  node's tx validator rejects the substituted class). Used only by
 *  probed (folded) strategy runs. */
export type SimulateTxFn = (
	pxe: IPXE,
	txRequest: TxExecutionRequest,
	opts: {
		simulatePublic: boolean
		skipFeeEnforcement: boolean
		skipTxValidation?: boolean
		scopes: AztecAddress[]
		stubAccountAddresses?: string[]
	},
	parentTask?: WrappedTask,
) => Promise<TxSimulationResult>

/** Everything a strategy needs to do its job. Packed as a struct for
 *  forward-compat — new fields land without re-signing every impl. */
export type FeeStrategyContext = {
	/** Op already cloned by the caller (actions[] is safe to mutate). */
	op: {
		networkId: string
		accountAddress: string
		actions: Action[]
		fee?: FeeOptions
	}
	feeSettings: FeeSettings
	/** Pre-computed from feeSettings.priorityLevel. Undefined if the
	 *  caller didn't set one (falls back to DEFAULT_FEE_MULTIPLIER). */
	feeMultiplier?: number
	/** From op.fee?.gasPadding, defaulted to 1.05 by caller. */
	gasPadding: number
	parentTask?: WrappedTask
	/** Estimate-cancellation signal. Multi-pass strategies check it between
	 *  passes and bail with `JobCancelledSentinel` — a sim already in flight
	 *  cannot be preempted, but the next pass must not start. */
	signal?: AbortSignal
	/** Discovery probe for FOLDED runs (dApp estimate paths only; set
	 *  exclusively by the `DiscoveryAwareEstimator` routing). When present, a
	 *  probe-aware strategy runs its first sim STUBBED (+ skipTxValidation)
	 *  and feeds it to `probe.extractEffects` — discovery and sizing collapse
	 *  into one sim. Absent on every non-dApp path (transfer, send,
	 *  embedded), which therefore keep byte-identical sim options. */
	probe?: DiscoveryProbe
}

/** Dependencies injected once at construction. */
export type FeeStrategyDeps = {
	txBuilder: TxRequestBuilder
	simulateTxTask: SimulateTxFn
	fpcService: FpcService
	tasks: TaskService
	logger: ILogger
}

/** Strategy contract. Each impl owns one fee kind end-to-end. */
export interface FeeStrategy {
	readonly kind: FeeSettings["paymentMethod"]["kind"]
	buildAndEstimate(ctx: FeeStrategyContext): Promise<FeeEstimate>
}

/** First-sim options shared by every probed (folded) strategy: stubbed
 *  (+`skipTxValidation` — the validator rejects the substituted class) under a
 *  probe, the shipped validated options byte-for-byte without one.
 *
 *  Stubbing is safe for DISCOVERY even on an initialization-wrapped build:
 *  the discovered authwit's inner hash is about the DELEGATED call (token /
 *  consumer), not the deploying account's constructor, so the classic
 *  standalone discovery has always stubbed undeployed accounts. What is NOT
 *  trustworthy for an init-wrapped build is the stub's GAS (stub constructor
 *  ≠ real constructor — the B1 exclusion) — so `isInitWrapped` forces a
 *  validated sizing re-sim there regardless of discovered effects. */
export function probedFirstSimOpts(
	probe: DiscoveryProbe | undefined,
	built: { account: { address: AztecAddress } },
): Parameters<SimulateTxFn>[2] {
	const address = built.account.address
	return probe
		? {
				simulatePublic: true,
				skipFeeEnforcement: true,
				skipTxValidation: true,
				scopes: [address],
				stubAccountAddresses: [address.toString()],
			}
		: { simulatePublic: true, skipFeeEnforcement: true, scopes: [address] }
}

/** True when the build wraps the account's own deployment (first tx): the
 *  request's `origin` is the multicall entrypoint, not the account. The
 *  stubbed first sim can still DISCOVER, but its gas reflects the STUB
 *  constructor — so a folded run must always take a validated sizing re-sim
 *  here (B1 excluded init-wrapped shapes from stub-gas parity). RPC-free. */
export function isInitWrapped(built: { txRequest: TxExecutionRequest; account: { address: AztecAddress } }): boolean {
	return built.txRequest.origin?.toString() !== built.account.address.toString()
}

/** Override gas limits on a pre-built tx request from a pending FeeOptions
 *  input. Used by FJ + FJWC + Embedded before simulation. Shared helper
 *  because all three need identical behavior.
 *
 *  Mutates `txRequest.txContext.gasSettings`. */
export function suggestGasLimits(txRequest: TxExecutionRequest, options?: FeeOptions): void {
	if (options?.gasLimits && options.teardownGasLimits) {
		txRequest.txContext.gasSettings = new GasSettings(
			new Gas(options.gasLimits.daGas, options.gasLimits.l2Gas),
			new Gas(options.teardownGasLimits.daGas, options.teardownGasLimits.l2Gas),
			txRequest.txContext.gasSettings.maxFeesPerGas,
			txRequest.txContext.gasSettings.maxPriorityFeesPerGas,
		)
	} else if (options?.gasLimits) {
		txRequest.txContext.gasSettings = new GasSettings(
			new Gas(options.gasLimits.daGas, options.gasLimits.l2Gas),
			txRequest.txContext.gasSettings.teardownGasLimits,
			txRequest.txContext.gasSettings.maxFeesPerGas,
			txRequest.txContext.gasSettings.maxPriorityFeesPerGas,
		)
	} else if (options?.teardownGasLimits) {
		txRequest.txContext.gasSettings = new GasSettings(
			txRequest.txContext.gasSettings.gasLimits,
			new Gas(options.teardownGasLimits.daGas, options.teardownGasLimits.l2Gas),
			txRequest.txContext.gasSettings.maxFeesPerGas,
			txRequest.txContext.gasSettings.maxPriorityFeesPerGas,
		)
	}
}

/** Effective per-tx admission cap: the node-advertised `txsLimits` further
 *  bounded by the protocol maxima on BOTH axes (mirrors upstream
 *  `get_gas_limits.ts` — a node advertising inflated limits must not widen
 *  what the protocol can process). */
export function admissionCap(txsLimits?: Gas): Gas | undefined {
	return txsLimits ? new Gas(Math.min(txsLimits.daGas, MAX_TX_DA_GAS), Math.min(txsLimits.l2Gas, MAX_PROCESSABLE_L2_GAS)) : undefined
}

/** Assert-and-throw for dApp-supplied custom limits against the admission
 *  cap, WITHOUT honoring them — for paths (FPC) whose finalize deliberately
 *  ignores custom limits in the committed gasSettings but still simulates
 *  under them via `suggestGasLimits`. Keeps the clamp contract uniform:
 *  over-cap custom limits throw everywhere, never silently vanish. */
export function assertCustomGasLimitsWithinCap(fee: FeeOptions | undefined, txsLimits?: Gas): void {
	const cap = admissionCap(txsLimits)
	if (!cap || !fee) {
		return
	}
	if (fee.gasLimits && (fee.gasLimits.daGas > cap.daGas || fee.gasLimits.l2Gas > cap.l2Gas)) {
		throw new Error(
			`Requested gasLimits (da=${fee.gasLimits.daGas}, l2=${fee.gasLimits.l2Gas}) exceed the network per-tx admission ` +
				`limit (da=${cap.daGas}, l2=${cap.l2Gas}).`,
		)
	}
	if (fee.teardownGasLimits && (fee.teardownGasLimits.daGas > cap.daGas || fee.teardownGasLimits.l2Gas > cap.l2Gas)) {
		throw new Error(
			`Requested teardownGasLimits (da=${fee.teardownGasLimits.daGas}, l2=${fee.teardownGasLimits.l2Gas}) exceed the ` +
				`network per-tx admission limit (da=${cap.daGas}, l2=${cap.l2Gas}).`,
		)
	}
}

/** Final gas-limit + maxFee calculation after a simulation. FJ / FJWC /
 *  Embedded call this; FPC has a custom post-simulation path.
 *
 *  `feeMultiplier` — when unset, falls back to `DEFAULT_FEE_MULTIPLIER`.
 *  Embedded passes 1 explicitly to stay within the dApp's budget.
 *
 *  `txsLimits` — the build-time-retained per-tx admission cap (further bounded
 *  by the protocol's `MAX_TX_DA_GAS` / `MAX_PROCESSABLE_L2_GAS`). When present:
 *  - measured usage already over the cap ⇒ THROW (the tx can never be
 *    admitted; an uncapped estimate would fail later, at the node, with a
 *    worse error);
 *  - auto-derived limits (measured × padding) are clamped to the cap — the
 *    padding is headroom, not a claim the tx needs that much;
 *  - dApp `customLimits` over the cap ⇒ THROW, never silently capped (a
 *    dApp-visible behavior contract; capping silently would commit different
 *    bytes than the dApp signed off on).
 *  Absent (defensive), behavior is unchanged. NO_FROM builds never reach this
 *  function — their gasSettings are capped by construction in the builder. */
export async function finalizeGasLimits(
	node: AztecNode,
	txRequest: TxExecutionRequest,
	simulatedTx: TxSimulationResult,
	gasPadding: number,
	maxFeesPerGas?: GasFees,
	customLimits?: FeeOptions,
	feeMultiplier?: number,
	txsLimits?: Gas,
): Promise<void> {
	const multiplier = feeMultiplier ?? DEFAULT_FEE_MULTIPLIER
	if (!maxFeesPerGas) {
		if (customLimits?.maxFeesPerGas) {
			maxFeesPerGas = new GasFees(BigInt(customLimits.maxFeesPerGas.feePerDaGas), BigInt(customLimits.maxFeesPerGas.feePerL2Gas))
		} else if (customLimits?.embeddedFeePayment) {
			// Embedded-FPC payments are pre-capped by `applyEmbeddedFpcGasCap` (to the dApp-supplied fee or
			// `getCurrentMinFees()`), and the FPC asserts `gasLimits·maxFeesPerGas <= budget`. Refetching +
			// re-multiplying here would commit a DIFFERENT ceiling than the one the FPC budget was reasoned
			// against — a post-simulation drift that can push the committed cost past the budgeted amount.
			// Reuse the already-committed cap verbatim. Non-embedded paths keep the refetch + general default.
			maxFeesPerGas = txRequest.txContext.gasSettings.maxFeesPerGas
		} else {
			// Inclusion-safe basis: the worst predicted min fee across upcoming slots, not the
			// current block's — a tx is proven seconds-to-minutes after estimation, and a cap
			// priced off a momentarily low current-min gets the tx dropped when the base fee
			// ticks up in that window. `maxFeesPerGas` is a cap, so the padding costs nothing
			// unless the base fee actually rises.
			maxFeesPerGas = await predictedWorstMinFees(node)
			maxFeesPerGas = maxFeesPerGas.mul(multiplier)
		}
	}

	const cap = admissionCap(txsLimits)
	if (cap) {
		const measured = simulatedTx.gasUsed.totalGas
		if (measured.daGas > cap.daGas || measured.l2Gas > cap.l2Gas) {
			throw new Error(
				`Simulated gas (da=${measured.daGas}, l2=${measured.l2Gas}) exceeds the network per-tx admission limit ` +
					`(da=${cap.daGas}, l2=${cap.l2Gas}) — this transaction cannot be included.`,
			)
		}
	}

	let gasLimits: Gas
	if (customLimits?.gasLimits) {
		gasLimits = new Gas(customLimits.gasLimits.daGas, customLimits.gasLimits.l2Gas)
		if (cap && (gasLimits.daGas > cap.daGas || gasLimits.l2Gas > cap.l2Gas)) {
			throw new Error(
				`Requested gasLimits (da=${gasLimits.daGas}, l2=${gasLimits.l2Gas}) exceed the network per-tx admission ` +
					`limit (da=${cap.daGas}, l2=${cap.l2Gas}).`,
			)
		}
	} else {
		const padded = simulatedTx.gasUsed.totalGas.mul(gasPadding)
		gasLimits = cap ? new Gas(Math.min(padded.daGas, cap.daGas), Math.min(padded.l2Gas, cap.l2Gas)) : padded
	}

	let teardownGasLimits: Gas
	if (customLimits?.teardownGasLimits) {
		teardownGasLimits = new Gas(customLimits.teardownGasLimits.daGas, customLimits.teardownGasLimits.l2Gas)
		if (cap && (teardownGasLimits.daGas > cap.daGas || teardownGasLimits.l2Gas > cap.l2Gas)) {
			throw new Error(
				`Requested teardownGasLimits (da=${teardownGasLimits.daGas}, l2=${teardownGasLimits.l2Gas}) exceed the ` +
					`network per-tx admission limit (da=${cap.daGas}, l2=${cap.l2Gas}).`,
			)
		}
	} else {
		const padded = simulatedTx.gasUsed.teardownGas.mul(gasPadding)
		teardownGasLimits = cap ? new Gas(Math.min(padded.daGas, cap.daGas), Math.min(padded.l2Gas, cap.l2Gas)) : padded
	}

	txRequest.txContext.gasSettings = new GasSettings(
		gasLimits,
		teardownGasLimits,
		maxFeesPerGas,
		txRequest.txContext.gasSettings.maxPriorityFeesPerGas,
	)
}

/** Wrap an estimate-fee block in a TaskService step for UI bookkeeping.
 *  Shared because every strategy does identical wrapping. */
export function startEstimateTask(tasks: TaskService, parentTask?: WrappedTask): WrappedTask {
	const step = new StepContent("Estimating fee")
	return parentTask ? parentTask.startSubtask(step) : tasks.startNewTask(step)
}
