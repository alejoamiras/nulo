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
 * `DraftOperation` shape. Each caller narrows it to the executable `Operation`
 * with a TS assertion (no `as unknown as Operation` cast):
 *   - silent: `assertSilentExecutable(materialized)` — the silent path only sees
 *     self-fee'd dApp requests (`isConfirmationNeeded` gates the rest), so this is
 *     a drift alarm; it narrows Draft → Operation.
 *   - popup: stores rows as DraftUIOperation; user picks fee via FeeSettingsCard;
 *     approve() runs `requiresFeeSelection` + `assertExecutableOperation`
 *     (both shared from `@nulo/wallet-bridge`) before sending to the SW.
 *
 * The materializer is the ONE place where "what does kind X look like
 * after CAIP resolution + draft feeSettings policy" is defined.
 *
 * Network/account resolution is injected via `MaterializeDeps` so the
 * function is unit-testable without service-collection setup.
 */

import type { Account } from "@/wallet/services/account/service"
import type { Network } from "@/wallet/services/network/service"
import type { DraftOperation, Operation } from "@nulo/wallet-bridge"
import { isSelfPay } from "@nulo/wallet-bridge"
import type { OperationRequest } from "./spec"

export type MaterializeDeps = {
	resolveNetwork(chain: string): Promise<Network>
	resolveNetworkAndAccount(account: string): Promise<[Network, Account]>
}

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
export async function materializeRequest(request: OperationRequest, deps: MaterializeDeps): Promise<DraftOperation> {
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
			return { ...request, networkId: network.id } as DraftOperation
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
			} as DraftOperation
		}
		case "aztec_sendTx": {
			const [network, account] = await deps.resolveNetworkAndAccount(request.account)
			const isNoFrom = request.executionMode === "default_entrypoint"
			// A payer that is the account itself with no fee call asks for the wallet's own Fee Juice
			// method; a payer that carries its payment is embedded.
			const selfPay = isSelfPay(request.exec, request.opts?.from)
			const hasEmbeddedFeePayer = request.exec?.feePayer !== undefined && !selfPay
			return {
				...request,
				networkId: network.id,
				accountAddress: account.address,
				feeSettings:
					isNoFrom || hasEmbeddedFeePayer
						? { paymentMethod: { kind: "embedded" } }
						: selfPay
							? { paymentMethod: { kind: "fj" } }
							: undefined,
			} as DraftOperation
		}
		case "send_transaction": {
			const [network, account] = await deps.resolveNetworkAndAccount(request.account)
			const hasEmbeddedFee = request.fee?.embeddedFeePayment !== undefined
			return {
				...request,
				networkId: network.id,
				accountAddress: account.address,
				feeSettings: hasEmbeddedFee ? { paymentMethod: { kind: "embedded" } } : undefined,
			} as DraftOperation
		}
		default: {
			throw new Error(`materializeRequest: unknown operation kind: ${(request as { kind?: string }).kind}`)
		}
	}
}

/**
 * Silent-path completion: assert that any send-like that reached us has its
 * `feeSettings` set — `isConfirmationNeeded` should have gated non-embedded sends
 * out of the silent path. NARROWS the `DraftOperation` to the executable
 * `Operation` (so the caller pushes it with no cast), and throws a silent-path-
 * specific drift alarm if the gate was ever bypassed.
 */
export function assertSilentExecutable(materialized: DraftOperation): asserts materialized is Operation {
	if ((materialized.kind === "aztec_sendTx" || materialized.kind === "send_transaction") && materialized.feeSettings === undefined) {
		throw new Error(
			`silentInteraction: ${materialized.kind} reached the silent path with no feeSettings — ` +
				"isConfirmationNeeded gate broken or bypassed",
		)
	}
}
