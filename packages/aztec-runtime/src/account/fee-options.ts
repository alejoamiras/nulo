/**
 * Shared gas-settings completion for both tx-construction paths.
 *
 * The standard path (`nulo-account.ts:buildTxExecutionRequest`) and the
 * fast path (`extension/.../execution/fast-path.ts`) both call this to
 * translate partial RPC-shaped fee settings into a real `GasSettings`
 * instance. Centralizing the translator prevents drift between the two
 * paths — a previous bug had the standard path hardcoding `1e18 / 1e18`
 * max fees while the fast path defaulted to
 * `getCurrentMinFees().mul(1.5)`.
 *
 * Mirrors upstream `BaseWallet.completeFeeOptions({forEstimation, ...})`
 * byte-for-byte (`@aztec/wallet-sdk/base-wallet/base_wallet.js:128-160`).
 */
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"

/** Mirrors upstream's private `minFeePadding` (`base_wallet.ts:32`).
 *  `maxFeesPerGas` defaults to `node.getCurrentMinFees().mul(1 + this)`. */
export const MIN_FEE_PADDING = 0.5

/**
 * RPC-shaped `Partial<FieldsOf<GasSettings>>`. Field values are typed
 * `unknown` because at the SW boundary the wallet-bridge dispatcher
 * does not validate dApp payloads. The translator routes each field
 * through `Gas.from(...)` / `GasFees.from(...)` which throw on
 * malformed input — callers should let those propagate (they're real
 * errors, not recoverable infra failures).
 */
export type PartialGasSettingsRPC = {
	gasLimits?: unknown
	teardownGasLimits?: unknown
	maxFeesPerGas?: unknown
	maxPriorityFeesPerGas?: unknown
}

export interface CompleteFeeOptionsConfig {
	node: AztecNode
	gasSettings?: PartialGasSettingsRPC
	forEstimation: boolean
}

/**
 * Translate partial RPC-shaped fee settings into a real `GasSettings`.
 *
 * - `Gas.from(...)` / `GasFees.from(...)` rebuild the rich types from
 *   their hex-string RPC form.
 * - `maxFeesPerGas` defaults to `node.getCurrentMinFees() * 1.5` when
 *   the dApp didn't supply one (matches upstream).
 * - `maxPriorityFeesPerGas` defaults to `GasFees.empty()`.
 * - `forEstimation: true` → `GasSettings.forEstimation(...)` (high
 *   gas-limit padding for sim).
 * - `forEstimation: false` → `GasSettings.fallback(...)` (protocol-max
 *   limits the network will accept).
 *
 * Malformed inputs throw synchronously inside `Gas.from` / `GasFees.from`.
 */
export async function completeFeeOptions(config: CompleteFeeOptionsConfig): Promise<GasSettings> {
	const { node, gasSettings, forEstimation } = config

	const maxFeesPerGas = gasSettings?.maxFeesPerGas
		? GasFees.from(gasSettings.maxFeesPerGas as Parameters<typeof GasFees.from>[0])
		: (await node.getCurrentMinFees()).mul(1 + MIN_FEE_PADDING)

	const overrides = {
		gasLimits: gasSettings?.gasLimits ? Gas.from(gasSettings.gasLimits as Parameters<typeof Gas.from>[0]) : undefined,
		teardownGasLimits: gasSettings?.teardownGasLimits
			? Gas.from(gasSettings.teardownGasLimits as Parameters<typeof Gas.from>[0])
			: undefined,
		maxFeesPerGas,
		maxPriorityFeesPerGas: gasSettings?.maxPriorityFeesPerGas
			? GasFees.from(gasSettings.maxPriorityFeesPerGas as Parameters<typeof GasFees.from>[0])
			: GasFees.empty(),
	}

	return forEstimation ? GasSettings.forEstimation(overrides) : GasSettings.fallback(overrides)
}
