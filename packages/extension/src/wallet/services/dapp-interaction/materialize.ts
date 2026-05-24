/**
 * Shared request→operation materializer (Phase 2 follow-up, Layer 4).
 *
 * Two callers used to duplicate this logic:
 *   - silentInteraction() in dapp-interaction/service.ts (auto-approve path)
 *   - the popup Execute window init() loop
 *
 * They diverged: the popup branch lied about `feeSettings` via
 * `undefined!`, the silent branch blanket-set `{ paymentMethod: { kind: "embedded" } }`.
 * That mismatch is exactly what caused the goswap `aztec_sendTx`
 * "Cannot read properties of undefined (reading 'priorityLevel')" crash.
 *
 * Now: both paths call `materializeRequest(req, deps)` and get the same
 * shape. Each caller layers its own policy on top of the materialized
 * result:
 *   - silent: completeForSilent(materialized) sets the embedded fee for
 *     send-likes (the silent path only sees self-fee'd dApp requests
 *     anyway — `isConfirmationNeeded` gates that), and casts to Operation.
 *   - popup: stores materialized rows as DraftUIOperation; user picks
 *     fee via FeeSettingsCard; approve() runs requiresFeeSelection +
 *     assertExecutableOperation before sending to the SW.
 *
 * The materializer is the ONE place where "what does kind X look like
 * after CAIP resolution + draft feeSettings policy" is defined.
 *
 * Network/account resolution is injected via `MaterializeDeps` so the
 * function is unit-testable without service-collection setup.
 */

import type { Account } from "@/wallet/services/account/service"
import type { Network } from "@/wallet/services/network/service"
import type { OperationRequest } from "./spec"

export type MaterializeDeps = {
	resolveNetwork(chain: string): Promise<Network>
	resolveNetworkAndAccount(account: string): Promise<[Network, Account]>
}

/**
 * Send-like draft shape: the wallet-bridge `Operation` requires feeSettings,
 * but the materializer leaves it undefined when the dApp didn't supply its
 * own fee path (popup-path consumer will fill it).
 */
type MaterializedSendLike = {
	kind: "aztec_sendTx" | "send_transaction"
	networkId: string
	accountAddress: string
	feeSettings?: { paymentMethod: { kind: "embedded" } }
	// All other fields preserved from the request; the caller spreads them.
} & Record<string, unknown>

/** Materialized non-send op: shape depends on the kind, but never carries
 *  `feeSettings`. */
type MaterializedNonSend = {
	kind: string
	networkId: string
	accountAddress?: string
} & Record<string, unknown>

/** Union returned by the materializer. The discriminant is `kind`. */
export type MaterializedOperation = MaterializedSendLike | MaterializedNonSend

/**
 * Run the request→operation switch in one place. Returns the executable
 * shape (with CAIP `chain`/`account` resolved to `networkId`/`accountAddress`)
 * with feeSettings populated only for self-fee'd send-like dApp requests
 * (`aztec_sendTx` with `executionMode === "default_entrypoint"` or
 * `exec.feePayer` set; `send_transaction` with `op.fee.embeddedFeePayment`
 * set).
 *
 * For send-likes that didn't pre-supply a fee path, the returned op has
 * `feeSettings === undefined`. The caller MUST decide how to complete it
 * (silent path: never see these by virtue of `isConfirmationNeeded`;
 * popup path: hold as draft until user picks).
 */
export async function materializeRequest(request: OperationRequest, deps: MaterializeDeps): Promise<MaterializedOperation> {
	switch (request.kind) {
		case "register_contract":
		case "register_sender":
		case "aztec_getContractClassMetadata":
		case "aztec_getContractMetadata":
		case "aztec_getChainInfo":
		case "aztec_registerSender":
		case "aztec_getAddressBook":
		case "aztec_registerContract":
		case "aztec_getPrivateEvents": {
			const network = await deps.resolveNetwork(request.chain)
			return { ...request, networkId: network.id } as MaterializedNonSend
		}
		case "register_token":
		case "simulate_transaction":
		case "simulate_utility":
		case "aztec_simulateTx":
		case "aztec_executeUtility":
		case "aztec_profileTx":
		case "aztec_createAuthWit": {
			const [network, account] = await deps.resolveNetworkAndAccount(request.account)
			return {
				...request,
				networkId: network.id,
				accountAddress: account.address,
			} as MaterializedNonSend
		}
		case "aztec_sendTx": {
			const [network, account] = await deps.resolveNetworkAndAccount(request.account)
			const isNoFrom = request.executionMode === "default_entrypoint"
			const hasEmbeddedFeePayer = request.exec?.feePayer !== undefined
			return {
				...request,
				networkId: network.id,
				accountAddress: account.address,
				feeSettings: isNoFrom || hasEmbeddedFeePayer ? { paymentMethod: { kind: "embedded" } } : undefined,
			} as MaterializedSendLike
		}
		case "send_transaction": {
			const [network, account] = await deps.resolveNetworkAndAccount(request.account)
			const hasEmbeddedFee = request.fee?.embeddedFeePayment !== undefined
			return {
				...request,
				networkId: network.id,
				accountAddress: account.address,
				feeSettings: hasEmbeddedFee ? { paymentMethod: { kind: "embedded" } } : undefined,
			} as MaterializedSendLike
		}
		default: {
			throw new Error(`materializeRequest: unknown operation kind: ${(request as { kind?: string }).kind}`)
		}
	}
}

/**
 * Silent-path completion: assert that any send-like that reached us has
 * its feeSettings set (it should — `isConfirmationNeeded` gates non-embedded
 * sends out of silent), and return the executable-shape value. Throws as
 * a drift alarm if the gate is ever bypassed.
 */
export function assertSilentExecutable(materialized: MaterializedOperation): void {
	if (
		(materialized.kind === "aztec_sendTx" || materialized.kind === "send_transaction") &&
		(materialized as MaterializedSendLike).feeSettings === undefined
	) {
		throw new Error(
			`silentInteraction: ${materialized.kind} reached the silent path with no feeSettings — ` +
				"isConfirmationNeeded gate broken or bypassed",
		)
	}
}
