/**
 * Unit tests for `AuthwitDiscoverer`.
 *
 * `discoverPrivateAuthwits` runs real Aztec authwit simulation + hash
 * computation; that path exercises Barretenberg WASM (poseidon2) and is
 * e2e-only. This suite covers:
 *   - The callback plumbing contract: `discoverPrivateAuthwits` invokes
 *     the provided `buildTxRequest` and feeds its output into
 *     `pxe.simulateTx` with the correct flags.
 *   - Empty-effects fast path: returns `[]` without doing hash work.
 *
 * The three `compute*MessageHash` methods call
 * `computeAuthWitMessageHash` from `@aztec/aztec.js/authorization` which
 * hits WASM. Unit-testing them here would reproduce the Barretenberg
 * error encountered with poseidon2; those paths are covered by the
 * network e2e (transfers + authwit flows).
 */

import { describe, expect, test, vi } from "vitest"
import type { ConfigProp, IConfig } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { EventHandler } from "@nulo/wallet-core/utils"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { AuthwitDiscoverer, type BuildTxRequestFn } from "./authwit-discoverer"
import type { Action } from "./spec"

function fakeLogger(): LoggerStore {
	const config: IConfig = {
		onUpdate: new EventHandler<ConfigProp>(),
		get: (() => false) as IConfig["get"],
	}
	return new LoggerStore(config)
}

function fakeBuildCtx() {
	// Shape matches what collectOffchainEffects walks:
	//   privateExecutionResult.entrypoint.{offchainEffects, nestedExecutionResults, publicInputs.callContext.contractAddress}
	const simulateTx = vi.fn(async () => ({
		privateExecutionResult: {
			entrypoint: {
				offchainEffects: [],
				nestedExecutionResults: [],
				publicInputs: { callContext: { contractAddress: { toString: () => "0xentry" } } },
			},
		},
	}))
	const getNodeInfo = vi.fn(async () => ({ l1ChainId: 31337, rollupVersion: 1 }))
	return {
		simulateTx,
		getNodeInfo,
		ctx: {
			txRequest: { txContext: {} },
			node: { getNodeInfo },
			pxe: { simulateTx },
			account: { address: { toString: () => "0xacc" } },
		},
	}
}

describe("AuthwitDiscoverer.discoverPrivateAuthwits", () => {
	test("invokes buildTxRequest with AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE", async () => {
		const disc = new AuthwitDiscoverer(fakeLogger())
		const op = { networkId: "net", accountAddress: "0xabc", actions: [] as Action[] }
		const { ctx, simulateTx } = fakeBuildCtx()
		const buildTxRequest: BuildTxRequestFn = vi.fn(async () => ctx as never)

		const result = await disc.discoverPrivateAuthwits(op, buildTxRequest)

		expect(buildTxRequest).toHaveBeenCalledWith(op, AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)
		expect(simulateTx).toHaveBeenCalled()
		const [, simulateOpts] = (simulateTx as ReturnType<typeof vi.fn>).mock.calls[0]
		expect(simulateOpts).toMatchObject({
			simulatePublic: true,
			skipTxValidation: true,
			skipFeeEnforcement: true,
		})
		expect(result).toEqual([])
	})

	test("returns [] on empty effects without touching getNodeInfo", async () => {
		const disc = new AuthwitDiscoverer(fakeLogger())
		const { ctx, getNodeInfo } = fakeBuildCtx()
		const result = await disc.discoverPrivateAuthwits(
			{ networkId: "n", accountAddress: "0xa", actions: [] as Action[] },
			async () => ctx as never,
		)
		expect(result).toEqual([])
		expect(getNodeInfo).not.toHaveBeenCalled()
	})

	test("propagates errors from the callback buildTxRequest", async () => {
		const disc = new AuthwitDiscoverer(fakeLogger())
		const buildTxRequest: BuildTxRequestFn = async () => {
			throw new Error("simulation failed")
		}
		await expect(disc.discoverPrivateAuthwits({ networkId: "n", accountAddress: "0xa", actions: [] }, buildTxRequest)).rejects.toThrow(
			/simulation failed/,
		)
	})
})

describe("AuthwitDiscoverer constructor", () => {
	test("can be instantiated with only a logger (no other deps)", () => {
		const disc = new AuthwitDiscoverer(fakeLogger())
		expect(disc).toBeDefined()
		expect(typeof disc.discoverPrivateAuthwits).toBe("function")
		expect(typeof disc.computeCallMessageHash).toBe("function")
		expect(typeof disc.computeEncodedCallMessageHash).toBe("function")
		expect(typeof disc.computeIntentMessageHash).toBe("function")
	})
})
