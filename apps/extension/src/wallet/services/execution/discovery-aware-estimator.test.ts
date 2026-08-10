import { describe, expect, test, vi } from "vitest"
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { DiscoveryAwareEstimator } from "./discovery-aware-estimator"
import type { Action } from "./spec"

const CALL: Action = { kind: "call", contract: "0xtoken", method: "transfer", args: [] }
const OPERATION = { kind: "aztec_sendTx", networkId: "net-1", accountAddress: "0xacct" } as never
const FEE_SETTINGS = { paymentMethod: { kind: "fj" } } as never
const BUILT = { txRequest: { marker: "req" }, nonce: { toString: () => "1" } } as never

function makeEstimator(discovered: unknown[] = []) {
	const authwit = { discoverPrivateAuthwits: vi.fn(async () => discovered) }
	const buildAndEstimateValidated = vi.fn(async () => BUILT)
	const buildForDiscovery = vi.fn(async () => ({}) as never)
	const estimator = new DiscoveryAwareEstimator({
		authwit: authwit as never,
		buildAndEstimateValidated: buildAndEstimateValidated as never,
		buildForDiscovery: buildForDiscovery as never,
	})
	return { estimator, authwit, buildAndEstimateValidated, buildForDiscovery }
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
