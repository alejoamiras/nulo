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
 * ## Return shape (minimal-diff)
 *
 * Strategies return the 8-tuple
 * `[txRequest, node, pxe, account, network, nonce, txCalls, feePaymentMethod]`.
 * Callers destructure all 8. Returning a narrower `FeeEstimateResult`
 * would force callers to re-fetch `node` / `pxe` / `account`, so the
 * tuple shape is preserved verbatim. The `ExecutionCoordinator` can
 * migrate to a typed bundle when it owns the post-send flush point.
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

import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { TxExecutionRequest, TxSimulationResult } from "@aztec/stdlib/tx"
import type { ILogger } from "@/wallet/logger"
import type { IAccountContract } from "@nulo/aztec-runtime/account"
import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { FpcService } from "@/wallet/services/fpc/service"
import type { Network } from "@/wallet/services/network/service"
import type { IPXE } from "@/wallet/services/pxe/client"
import { StepContent, type TaskService, type WrappedTask } from "@/wallet/services/task/service"
import type { TxCall } from "@/wallet/services/transaction/service"
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { Action, FeeOptions, FeeSettings } from "../spec"
import type { TxRequestBuilder } from "../tx-request-builder"

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

/** Tuple returned by every strategy. Matches the pre-split
 *  `buildAndEstimateTxRequest` return verbatim. */
export type FeeEstimateResult = [
	TxExecutionRequest,
	AztecNode,
	IPXE,
	IAccountContract,
	Network,
	Fr,
	TxCall[],
	AccountFeePaymentMethodOptions,
]

/** Simulate callback — facade owns the TaskService wrapping so that
 *  strategies stay decoupled from task bookkeeping. */
export type SimulateTxFn = (
	pxe: IPXE,
	txRequest: TxExecutionRequest,
	opts: { simulatePublic: boolean; skipFeeEnforcement: boolean; scopes: AztecAddress[] },
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
	deps: FeeStrategyDeps
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
	buildAndEstimate(ctx: FeeStrategyContext): Promise<FeeEstimateResult>
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

/** Final gas-limit + maxFee calculation after a simulation. FJ / FJWC /
 *  Embedded call this; FPC has a custom post-simulation path.
 *
 *  `feeMultiplier` — when unset, falls back to `DEFAULT_FEE_MULTIPLIER`.
 *  Embedded passes 1 explicitly to stay within the dApp's budget. */
export async function finalizeGasLimits(
	node: AztecNode,
	txRequest: TxExecutionRequest,
	simulatedTx: TxSimulationResult,
	gasPadding: number,
	maxFeesPerGas?: GasFees,
	customLimits?: FeeOptions,
	feeMultiplier?: number,
): Promise<void> {
	const multiplier = feeMultiplier ?? DEFAULT_FEE_MULTIPLIER
	if (!maxFeesPerGas) {
		if (customLimits?.maxFeesPerGas) {
			maxFeesPerGas = new GasFees(BigInt(customLimits.maxFeesPerGas.feePerDaGas), BigInt(customLimits.maxFeesPerGas.feePerL2Gas))
		} else {
			maxFeesPerGas = await node.getCurrentMinFees()
			maxFeesPerGas = maxFeesPerGas.mul(multiplier)
		}
	}

	const gasLimits = customLimits?.gasLimits
		? new Gas(customLimits.gasLimits.daGas, customLimits.gasLimits.l2Gas)
		: simulatedTx.gasUsed.totalGas.mul(gasPadding)

	const teardownGasLimits = customLimits?.teardownGasLimits
		? new Gas(customLimits.teardownGasLimits.daGas, customLimits.teardownGasLimits.l2Gas)
		: simulatedTx.gasUsed.teardownGas.mul(gasPadding)

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
