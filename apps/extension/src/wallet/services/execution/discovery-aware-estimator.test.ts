import { describe, expect, test, vi } from "vitest"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { DiscoveryAwareEstimator } from "./discovery-aware-estimator"
import type { Action } from "./spec"

const CALL: Action = { kind: "call", contract: "0xtoken", method: "transfer", args: [] }
const OPERATION = { kind: "aztec_sendTx", networkId: "net-1", accountAddress: "0xacct" } as never
// fjwc keeps the CLASSIC choreography (fold covers fpc + fj only), so the
// inertness pins below keep their meaning unchanged.
const FEE_SETTINGS = { paymentMethod: { kind: "fjwc" } } as never
const BUILT = { txRequest: { marker: "req" }, nonce: { toString: () => "1" } } as never

function makeEstimator(discovered: unknown[] = []) {
	const authwit = { discoverPrivateAuthwits: vi.fn(async () => discovered) }
	const buildAndEstimateValidated = vi.fn(async () => BUILT)
	const buildAndEstimateFolded = vi.fn(async () => BUILT)
	const buildForDiscovery = vi.fn(async () => ({}) as never)
	const estimator = new DiscoveryAwareEstimator({
		authwit: authwit as never,
		buildAndEstimateValidated: buildAndEstimateValidated as never,
		buildAndEstimateFolded: buildAndEstimateFolded as never,
		buildForDiscovery: buildForDiscovery as never,
	})
	return { estimator, authwit, buildAndEstimateValidated, buildAndEstimateFolded, buildForDiscovery }
}

describe("DiscoveryAwareEstimator (inert extraction pins)", () => {
	test("no effects: discovery once with a CLONED op, then ONE validated build with the original action set", async () => {
		const { estimator, authwit, buildAndEstimateValidated, buildForDiscovery } = makeEstimator()
		const actions = [CALL]
		const { built, discoveredActions } = await estimator.estimate(OPERATION, actions, undefined, FEE_SETTINGS)

		expect(built).toBe(BUILT)
		expect(discoveredActions).toEqual([])
		expect(authwit.discoverPrivateAuthwits).toHaveBeenCalledTimes(1)
		// The discoverer receives the injected discovery build callback — the
		// same seam the inline shape always fed it.
		expect((authwit.discoverPrivateAuthwits.mock.calls[0] as unknown[])[1]).toBe(buildForDiscovery)
		// Cloned, never the caller's array.
		const discoveredOp = (authwit.discoverPrivateAuthwits.mock.calls[0] as unknown[])[0] as { actions: Action[] }
		expect(discoveredOp.actions).not.toBe(actions)
		expect(discoveredOp.actions).toEqual(actions)

		expect(buildAndEstimateValidated).toHaveBeenCalledTimes(1)
		const builtOp = (buildAndEstimateValidated.mock.calls[0] as unknown[])[0] as { actions: Action[]; fee?: unknown }
		expect(builtOp.actions).toEqual(actions)
		expect("fee" in builtOp).toBe(false)
	})

	test("effects: discovered actions spliced AFTER the originals; caller's array untouched; surfaced to the caller", async () => {
		const extra = { kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "0xm" } }
		const { estimator, buildAndEstimateValidated } = makeEstimator([extra])
		const actions = [CALL]
		const { discoveredActions } = await estimator.estimate(OPERATION, actions, undefined, FEE_SETTINGS)

		expect(discoveredActions).toEqual([extra])
		expect(actions).toHaveLength(1)
		const builtOp = (buildAndEstimateValidated.mock.calls[0] as unknown[])[0] as { actions: Action[] }
		expect(builtOp.actions).toEqual([CALL, extra])
	})

	test("detectedFee folds into the built op exactly as the inline shape did", async () => {
		const { estimator, buildAndEstimateValidated } = makeEstimator()
		const fee = { gasPadding: 1.07 }
		await estimator.estimate(OPERATION, [CALL], fee as never, FEE_SETTINGS)
		const builtOp = (buildAndEstimateValidated.mock.calls[0] as unknown[])[0] as { fee?: unknown }
		expect(builtOp.fee).toBe(fee)
	})

	test("cancel landing during discovery: sentinel, and the sizing pipeline never starts", async () => {
		const controller = new AbortController()
		const authwit = {
			discoverPrivateAuthwits: vi.fn(async () => {
				controller.abort()
				return []
			}),
		}
		const buildAndEstimateValidated = vi.fn(async () => BUILT)
		const estimator = new DiscoveryAwareEstimator({
			authwit: authwit as never,
			buildAndEstimateValidated: buildAndEstimateValidated as never,
			buildAndEstimateFolded: (async () => BUILT) as never,
			buildForDiscovery: (async () => ({})) as never,
		})

		await expect(estimator.estimate(OPERATION, [CALL], undefined, FEE_SETTINGS, undefined, controller.signal)).rejects.toThrow(
			JobCancelledSentinel,
		)
		expect(buildAndEstimateValidated).not.toHaveBeenCalled()
	})

	test("signal + parentTask forwarded into the validated pipeline", async () => {
		const { estimator, buildAndEstimateValidated } = makeEstimator()
		const controller = new AbortController()
		const parentTask = { marker: "task" } as never
		await estimator.estimate(OPERATION, [CALL], undefined, FEE_SETTINGS, parentTask, controller.signal)
		const call = buildAndEstimateValidated.mock.calls[0] as unknown[]
		expect(call[2]).toBe(parentTask)
		expect(call[3]).toBe(controller.signal)
	})
})

const FPC_SETTINGS = { paymentMethod: { kind: "fpc", fpcId: 7 } } as never
const PRE_ATTACHED_AUTHWIT: Action = {
	kind: "add_private_authwit",
	content: { kind: "intent", consumer: "0xc", innerHash: "0xdead" },
} as never

describe("DiscoveryAwareEstimator (fold routing)", () => {
	test("fpc payment folds: ONE probed pipeline call, no standalone discovery, no validated call", async () => {
		const { estimator, authwit, buildAndEstimateValidated, buildAndEstimateFolded } = makeEstimator()
		const controller = new AbortController()
		const parentTask = { marker: "task" } as never

		const { built, discoveredActions } = await estimator.estimate(
			OPERATION,
			[CALL],
			undefined,
			FPC_SETTINGS,
			parentTask,
			controller.signal,
		)

		expect(built).toBe(BUILT)
		expect(discoveredActions).toEqual([])
		expect(authwit.discoverPrivateAuthwits).not.toHaveBeenCalled()
		expect(buildAndEstimateValidated).not.toHaveBeenCalled()
		expect(buildAndEstimateFolded).toHaveBeenCalledTimes(1)
		const call = buildAndEstimateFolded.mock.calls[0] as unknown[]
		// A per-estimate CollectingDiscoveryProbe rides in position 2; task +
		// signal keep flowing.
		expect(typeof (call[2] as { extractEffects: unknown }).extractEffects).toBe("function")
		expect(call[3]).toBe(parentTask)
		expect(call[4]).toBe(controller.signal)
		// Cloned op, never the caller's array; detectedFee absent stays absent.
		const op = call[0] as { actions: Action[]; fee?: unknown }
		expect(op.actions).toEqual([CALL])
		expect("fee" in op).toBe(false)
	})

	test("folded path surfaces the probe's collected actions as discoveredActions", async () => {
		const extra = { kind: "add_private_authwit", content: { kind: "message_hash", messageHash: "0xm" } }
		const { estimator, buildAndEstimateFolded } = makeEstimator()
		buildAndEstimateFolded.mockImplementation((async (...args: unknown[]) => {
			const probe = args[2] as { collected: unknown[] }
			probe.collected.push(extra)
			return BUILT
		}) as never)

		const { discoveredActions } = await estimator.estimate(OPERATION, [CALL], undefined, FPC_SETTINGS)

		expect(discoveredActions).toEqual([extra])
	})

	test("detectedFee folds into the folded op exactly like the classic path", async () => {
		const { estimator, buildAndEstimateFolded } = makeEstimator()
		const fee = { gasPadding: 1.07 }
		await estimator.estimate(OPERATION, [CALL], fee as never, FPC_SETTINGS)
		const op = (buildAndEstimateFolded.mock.calls[0] as unknown[])[0] as { fee?: unknown }
		expect(op.fee).toBe(fee)
	})

	test("F-4: a pre-attached add_private_authwit forces the CLASSIC choreography (no fold, any content kind)", async () => {
		const { estimator, authwit, buildAndEstimateValidated, buildAndEstimateFolded } = makeEstimator()

		const { built } = await estimator.estimate(OPERATION, [CALL, PRE_ATTACHED_AUTHWIT], undefined, FPC_SETTINGS)

		expect(built).toBe(BUILT)
		expect(buildAndEstimateFolded).not.toHaveBeenCalled()
		expect(authwit.discoverPrivateAuthwits).toHaveBeenCalledTimes(1)
		expect(buildAndEstimateValidated).toHaveBeenCalledTimes(1)
	})

	test("F-4 covers message_hash-content authwits too — any pre-attached kind blocks the fold", async () => {
		const { estimator, buildAndEstimateFolded, buildAndEstimateValidated } = makeEstimator()
		const preAttached: Action = {
			kind: "add_private_authwit",
			content: { kind: "message_hash", messageHash: "0xsupplied" },
		} as never

		await estimator.estimate(OPERATION, [CALL, preAttached], undefined, FPC_SETTINGS)

		expect(buildAndEstimateFolded).not.toHaveBeenCalled()
		expect(buildAndEstimateValidated).toHaveBeenCalledTimes(1)
	})

	test("fj payment folds too (probed pipeline, no standalone discovery)", async () => {
		const { estimator, authwit, buildAndEstimateValidated, buildAndEstimateFolded } = makeEstimator()

		await estimator.estimate(OPERATION, [CALL], undefined, { paymentMethod: { kind: "fj" } } as never)

		expect(buildAndEstimateFolded).toHaveBeenCalledTimes(1)
		expect(authwit.discoverPrivateAuthwits).not.toHaveBeenCalled()
		expect(buildAndEstimateValidated).not.toHaveBeenCalled()
	})

	test("non-foldable payment kinds (fjwc, embedded) keep the classic choreography untouched", async () => {
		for (const kind of ["fjwc", "embedded"] as const) {
			const { estimator, authwit, buildAndEstimateValidated, buildAndEstimateFolded } = makeEstimator()

			await estimator.estimate(OPERATION, [CALL], undefined, { paymentMethod: { kind } } as never)

			expect(buildAndEstimateFolded).not.toHaveBeenCalled()
			expect(authwit.discoverPrivateAuthwits).toHaveBeenCalledTimes(1)
			expect(buildAndEstimateValidated).toHaveBeenCalledTimes(1)
		}
	})
})
