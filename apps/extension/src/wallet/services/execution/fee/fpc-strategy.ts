/**
 * FpcStrategy — external FPC (Fee Payment Contract) fee payment (kind "fpc").
 *
 * TWO shapes, selected per resolved FPC row:
 *
 * ## Canonical-Sponsored fast path (single-pass)
 *
 * Eligibility (all wallet-side facts, never dApp input): handler type
 * DefaultSponsoredFpc AND `isProtocol` (the row's address equals the pinned
 * canonical SponsoredFPC address — artifact-derived, recomputed at read time
 * from the row's own chain; a cold protocol-address cache decorates
 * `isProtocol: false` and falls safely to two-pass) AND the operation carries
 * NO dApp-supplied gas limits (`op.fee.gasLimits`/`teardownGasLimits` — a
 * custom limit would constrain app+FPC here where the two-pass constrains the
 * app only, a behavior change; such ops stay two-pass).
 *
 * Why single-pass is byte-honest for this contract and only this contract:
 * `sponsor_unconditionally` takes no arguments and reads nothing from the
 * transaction's gas-settings envelope (verified against the Noir source), so
 * simulating it under `forEstimation` limits measures the same gas as under
 * Pass-1-derived limits, and the `maxFee` handed to `getFeePayload` is inert
 * (`args: []`). NOTE the shipped two-pass never rebuilt after its final
 * splice either — built bytes have never carried a post-sim `maxFee` — so the
 * placeholder-`maxFee` build is the status quo, not a relaxation. A
 * budget-asserting `fpc`-kind contract (the embedded-cap class) would fail
 * estimation loudly under the huge `forEstimation` envelope — fail-loud is
 * the accepted posture; PrivateFPC never reaches this path at all.
 *
 * ## Two-pass (PrivateFPC + every non-canonical/user-added FPC)
 *
 *   Pass 1: build + simulate with FeeJuice to get total gas used
 *   Between: fetch baseFees (with priority multiplier), compute maxFee,
 *     prepend FPC fee payload to op.actions
 *   Pass 2: re-build + re-simulate with External + override gasSettings
 *   Finish: re-compute maxFee with padded gas, splice in final fee payload
 *
 * Pass 1 is LOAD-BEARING for PrivateFPC: its Noir `pay_fee` computes
 * `max_gas_cost` from the transaction's gas-settings envelope, so the FPC
 * call must simulate under the bounded Pass-1-derived envelope, never under
 * `forEstimation` limits. Do NOT extend the fast path to it.
 *
 * ## Folded (probed) runs — dApp estimate paths only
 *
 * When `ctx.probe` is set (exclusively by the `DiscoveryAwareEstimator` fold
 * routing), the FIRST sim of either path runs STUBBED (+`skipTxValidation`)
 * and doubles as authwit discovery — the standalone discovery sim disappears.
 * B1 measured the stub's gas as byte-identical to validated on live testnet
 * (side-effect-priced gas; the stub only removes constraints). Safety rails:
 * - Two-pass P1 is FPC-payload-FREE, so stubbing it never stubs a
 *   payload-inclusive sim for a non-canonical row (the hard limit); Pass 2
 *   stays validated and verifies the freshly signed witnesses.
 * - Fast path (canonical Sponsored only): no effects ⇒ done in one stubbed
 *   sim; effects ⇒ validated rebuild + re-sim before any estimate leaves.
 * - Ops carrying pre-attached authwits never reach a probed run (F-4 guard
 *   upstream): a stub would mask a broken supplied witness.
 *
 * ## Finalization fidelity (both paths)
 *
 * `finalizeGasLimits(node, txRequest, sim, padding, baseFees)` — the
 * multiplier is pre-baked into `baseFees`, and there is deliberately NO
 * `customLimits`/`feeMultiplier` argument (fjwc's arg list would double-apply
 * the multiplier and newly honor `op.fee.gasLimits`).
 *
 * ## Action array mutation (CAUTION — audited)
 *
 * Both paths mutate `op.actions` (unshift, then `splice(0, len, ...)` with
 * `originalActions` captured up front). This sequence is intentional and
 * load-bearing — the audit flagged it explicitly. Do NOT refactor to a
 * non-mutating shape without re-verifying the TxExecutionRequest bytes match
 * the original pipeline.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import { GasSettings } from "@aztec/stdlib/gas"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { predictedWorstMinFees } from "@nulo/bridge-core/fee-juice"
import type { Fpc } from "@/wallet/services/fpc/fpc"
import { FpcType } from "@/wallet/services/fpc/service"
import type { Action } from "../spec"
import type { FeeEstimate, FeeStrategy, FeeStrategyContext, FeeStrategyDeps } from "./fee-strategy"
import { DEFAULT_FEE_MULTIPLIER, finalizeGasLimits, probedFirstSimOpts, startEstimateTask, suggestGasLimits } from "./fee-strategy"

export class FpcStrategy implements FeeStrategy {
	public readonly kind = "fpc" as const

	public constructor(private readonly deps: FeeStrategyDeps) {}

	public async buildAndEstimate(ctx: FeeStrategyContext): Promise<FeeEstimate> {
		if (ctx.feeSettings.paymentMethod.kind !== "fpc") {
			throw new Error("FpcStrategy called with non-fpc payment method")
		}
		const { fpcId } = ctx.feeSettings.paymentMethod
		const fpc = await this.deps.fpcService.getFpcImpl(fpcId)
		if (this.isSponsoredFastPathEligible(fpc, ctx)) {
			return this.buildAndEstimateSponsoredFastPath(ctx, fpc)
		}
		return this.buildAndEstimateTwoPass(ctx, fpc)
	}

	/** Wallet-side discriminator — see the header. Optional chaining keeps
	 *  every undecorated/legacy shape on the conservative two-pass. */
	private isSponsoredFastPathEligible(fpc: Fpc, ctx: FeeStrategyContext): boolean {
		const info = fpc.infoData
		return (
			info?.type === FpcType.DefaultSponsoredFpc &&
			info.isProtocol === true &&
			ctx.op.fee?.gasLimits === undefined &&
			ctx.op.fee?.teardownGasLimits === undefined
		)
	}

	private async buildAndEstimateSponsoredFastPath(ctx: FeeStrategyContext, fpc: Fpc): Promise<FeeEstimate> {
		const originalActions = [...ctx.op.actions]
		const multiplier = ctx.feeMultiplier ?? DEFAULT_FEE_MULTIPLIER
		const task = startEstimateTask(this.deps.tasks, ctx.parentTask)

		try {
			// Payload included from the start (`maxFee` inert — args: []), so the
			// single sim measures app + FPC together, mirroring Pass 2's coverage.
			ctx.op.actions.unshift(...fpc.getFeePayload(ctx.op.accountAddress, Fr.ZERO))
			let built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.EXTERNAL, task)
			// The row's chain must equal the operation's resolved network —
			// `isProtocol` was decorated against the row's OWN chain, so a
			// cross-chain row selection would ride a stale eligibility signal.
			// Only knowable post-build (the strategy has no networkId→chainId
			// map); a mismatch restores the actions and takes the two-pass.
			if (fpc.infoData.chainId !== built.network.chainId) {
				ctx.op.actions.splice(0, ctx.op.actions.length, ...originalActions)
				task.complete()
				return this.buildAndEstimateTwoPass(ctx, fpc)
			}
			suggestGasLimits(built.txRequest, ctx.op.fee)
			let simulatedTx = await this.deps.simulateTxTask(
				built.pxe,
				built.txRequest,
				probedFirstSimOpts(ctx.probe, built.account.address),
				task,
			)
			// Folded discovery: the probed sim doubles as the discovery pass. A
			// no-effects op is done in ONE sim (stub gas == validated gas — the
			// measured B1 invariant); discovered effects force a validated
			// rebuild+re-sim so the fresh witnesses are actually VERIFIED before
			// any estimate leaves this method.
			let discovered: Action[] = []
			if (ctx.probe) {
				discovered = await ctx.probe.extractEffects(simulatedTx, { node: built.node, network: built.network })
				if (discovered.length) {
					ctx.op.actions.push(...discovered)
					if (ctx.signal?.aborted) throw new JobCancelledSentinel("")
					built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.EXTERNAL, task)
					suggestGasLimits(built.txRequest, ctx.op.fee)
					simulatedTx = await this.deps.simulateTxTask(
						built.pxe,
						built.txRequest,
						{ simulatePublic: true, skipFeeEnforcement: true, scopes: [built.account.address] },
						task,
					)
				}
			}
			const baseFees = (await predictedWorstMinFees(built.node)).mul(multiplier)
			const maxFee = simulatedTx.gasUsed.totalGas.mul(ctx.gasPadding).computeFee(baseFees)
			ctx.op.actions.splice(
				0,
				ctx.op.actions.length,
				...fpc.getFeePayload(ctx.op.accountAddress, maxFee),
				...originalActions,
				...discovered,
			)
			await finalizeGasLimits(built.node, built.txRequest, simulatedTx, ctx.gasPadding, baseFees)
			task.complete()
			return { ...built, feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL }
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private async buildAndEstimateTwoPass(ctx: FeeStrategyContext, fpc: Fpc): Promise<FeeEstimate> {
		const originalActions = [...ctx.op.actions]
		const multiplier = ctx.feeMultiplier ?? DEFAULT_FEE_MULTIPLIER
		const task = startEstimateTask(this.deps.tasks, ctx.parentTask)

		try {
			// first approach
			let built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE, task)
			suggestGasLimits(built.txRequest, ctx.op.fee)
			let simulatedTx = await this.deps.simulateTxTask(
				built.pxe,
				built.txRequest,
				probedFirstSimOpts(ctx.probe, built.account.address),
				task,
			)
			// Folded discovery: Pass 1 (stubbed under a probe) doubles as the
			// discovery pass — its build shape equals the standalone discovery
			// sim's (same PREEXISTING_FEE_JUICE build, same sim options), so the
			// extracted effect set is identical by construction. Discovered
			// actions land AFTER the originals — exactly where the standalone
			// discovery splice used to put them — and Pass 2 (validated)
			// verifies the freshly signed witnesses. Pass-1 gas feeding Pass 2's
			// envelope is unchanged by the stub (B1: side-effect-priced).
			let discovered: Action[] = []
			if (ctx.probe) {
				discovered = await ctx.probe.extractEffects(simulatedTx, { node: built.node, network: built.network })
				if (discovered.length) {
					ctx.op.actions.push(...discovered)
				}
			}
			// Fetch actual fees for FPC fee payload (with priority multiplier). Same
			// inclusion-safe predicted-worst basis as `finalizeGasLimits`.
			const baseFees = (await predictedWorstMinFees(built.node)).mul(multiplier)
			let maxFee = simulatedTx.gasUsed.totalGas.add(fpc.getTotalGas()).computeFee(baseFees)
			ctx.op.actions.unshift(...fpc.getFeePayload(ctx.op.accountAddress, maxFee))
			// A cancel landing during Pass 1's sim must not start Pass 2 —
			// the second full ACVM run is the whole cost being cancelled.
			if (ctx.signal?.aborted) throw new JobCancelledSentinel("")
			// precise estimation (rebuild — the rebinding of `built` is the
			// two-pass shape the byte-parity constraint freezes; the
			// gasSettings below deliberately reads the FIRST pass's sim)
			built = await this.deps.txBuilder.buildStandard(ctx.op, AccountFeePaymentMethodOptions.EXTERNAL, task)
			built.txRequest.txContext.gasSettings = new GasSettings(
				simulatedTx.gasUsed.totalGas.add(fpc.getTotalGas()),
				simulatedTx.gasUsed.teardownGas.add(fpc.getTeardownGas()),
				baseFees,
				built.txRequest.txContext.gasSettings.maxPriorityFeesPerGas,
			)
			simulatedTx = await this.deps.simulateTxTask(
				built.pxe,
				built.txRequest,
				{ simulatePublic: true, skipFeeEnforcement: true, scopes: [built.account.address] },
				task,
			)
			maxFee = simulatedTx.gasUsed.totalGas.mul(ctx.gasPadding).computeFee(baseFees)
			ctx.op.actions.splice(
				0,
				ctx.op.actions.length,
				...fpc.getFeePayload(ctx.op.accountAddress, maxFee),
				...originalActions,
				...discovered,
			)
			await finalizeGasLimits(built.node, built.txRequest, simulatedTx, ctx.gasPadding, baseFees)
			task.complete()
			return { ...built, feePaymentMethod: AccountFeePaymentMethodOptions.EXTERNAL }
		} catch (error) {
			task.fail(error)
			throw error
		}
	}
}
