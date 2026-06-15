/**
 * Tests for `applyEmbeddedFpcGasCap`. The helper consolidates the 4
 * copies that existed across `service.ts` (sim / profileTx / NoFromSendTx)
 * and `embedded-strategy.ts`. These tests pin the behaviors the prior 4
 * copies all had — codex and opus 4.7 both flagged that the pre-existing
 * e2e tests accept ok/error so don't catch budget regressions.
 */
import { describe, expect, test, vi } from "vitest"
import { Fr } from "@aztec/foundation/curves/bn254"
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { TxContext, type TxExecutionRequest } from "@aztec/stdlib/tx"
import { applyEmbeddedFpcGasCap } from "./embedded-fpc-cap"
import type { FeeOptions } from "@/wallet/services/execution/client"

/** Build a TxExecutionRequest-shaped object covering only the fields the
 *  helper reads/writes (txContext.gasSettings). Cast at the boundary. */
function fakeTxRequest(initialGasSettings: GasSettings): TxExecutionRequest {
	return {
		txContext: new TxContext(new Fr(1n), new Fr(1n), initialGasSettings),
	} as unknown as TxExecutionRequest
}

function initialGasSettings(): GasSettings {
	// `1.5× minFees`-style settings — what `completeFeeOptions` would produce
	// for the default case. The cap helper should override these to `1.0×`.
	return GasSettings.forEstimation({
		gasLimits: Gas.from({ daGas: 1_000_000, l2Gas: 2_000_000 }),
		teardownGasLimits: Gas.from({ daGas: 100_000, l2Gas: 200_000 }),
		maxFeesPerGas: new GasFees(150n, 300n),
		maxPriorityFeesPerGas: new GasFees(5n, 10n),
	})
}

function fakeNode(minFees: GasFees = new GasFees(100n, 200n)): AztecNode & { getCurrentMinFees: ReturnType<typeof vi.fn> } {
	return {
		getCurrentMinFees: vi.fn(async () => minFees),
	} as unknown as AztecNode & { getCurrentMinFees: ReturnType<typeof vi.fn> }
}

describe("applyEmbeddedFpcGasCap", () => {
	test("1. fee.embeddedFeePayment undefined → no-op (gas settings unchanged, node NOT consulted)", async () => {
		const node = fakeNode()
		const txRequest = fakeTxRequest(initialGasSettings())
		const beforeMaxFees = txRequest.txContext.gasSettings.maxFeesPerGas
		const fee: FeeOptions = { gasPadding: 1 }
		await applyEmbeddedFpcGasCap(txRequest, fee, node)
		// Same object reference — no mutation
		expect(txRequest.txContext.gasSettings.maxFeesPerGas).toBe(beforeMaxFees)
		expect(node.getCurrentMinFees).not.toHaveBeenCalled()
	})

	test("2. embedded='fjwc', no explicit maxFeesPerGas → uses node.getCurrentMinFees() (1.0×, NOT 1.5×); other fields preserved verbatim", async () => {
		const node = fakeNode(new GasFees(100n, 200n))
		const initial = initialGasSettings()
		const txRequest = fakeTxRequest(initial)
		const fee: FeeOptions = { embeddedFeePayment: "fjwc", gasPadding: 1 }
		await applyEmbeddedFpcGasCap(txRequest, fee, node)

		const after = txRequest.txContext.gasSettings
		// maxFeesPerGas dropped from 1.5× (150, 300) to 1.0× (100, 200)
		expect(after.maxFeesPerGas.feePerDaGas).toBe(100n)
		expect(after.maxFeesPerGas.feePerL2Gas).toBe(200n)
		// Other fields untouched — regression pin for the 4 prior copies
		expect(after.gasLimits.daGas).toBe(initial.gasLimits.daGas)
		expect(after.gasLimits.l2Gas).toBe(initial.gasLimits.l2Gas)
		expect(after.teardownGasLimits.daGas).toBe(initial.teardownGasLimits.daGas)
		expect(after.teardownGasLimits.l2Gas).toBe(initial.teardownGasLimits.l2Gas)
		expect(after.maxPriorityFeesPerGas.feePerDaGas).toBe(initial.maxPriorityFeesPerGas.feePerDaGas)
		expect(after.maxPriorityFeesPerGas.feePerL2Gas).toBe(initial.maxPriorityFeesPerGas.feePerL2Gas)
		expect(node.getCurrentMinFees).toHaveBeenCalledOnce()
	})

	// This IS the private-fuel claim path: PrivateMintAndPayFeePaymentMethod sets feePayer=FPC (≠ from)
	// → embedded="fpc", and the faucet supplies explicit maxFeesPerGas + teardownGas=0 (plan L14), which
	// must pass through verbatim so mint_and_pay_fee's `gasLimits * maxFeesPerGas <= amount` assertion holds.
	test("3. embedded='fpc', dApp supplied explicit maxFeesPerGas → uses provided values; node NOT consulted (the private-fuel path)", async () => {
		const node = fakeNode()
		const txRequest = fakeTxRequest(initialGasSettings())
		const fee: FeeOptions = {
			embeddedFeePayment: "fpc",
			maxFeesPerGas: { feePerDaGas: "777", feePerL2Gas: "888" },
			gasPadding: 1,
		}
		await applyEmbeddedFpcGasCap(txRequest, fee, node)

		const after = txRequest.txContext.gasSettings
		expect(after.maxFeesPerGas.feePerDaGas).toBe(777n)
		expect(after.maxFeesPerGas.feePerL2Gas).toBe(888n)
		// teardownGasLimits pass through untouched — a dApp's explicit teardownGas (e.g. 0) survives.
		expect(after.teardownGasLimits.daGas).toBe(100_000)
		expect(after.teardownGasLimits.l2Gas).toBe(200_000)
		expect(node.getCurrentMinFees).not.toHaveBeenCalled()
	})
})
