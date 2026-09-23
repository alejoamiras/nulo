/**
 * The one place a stored dApp request becomes an operation. Both the silent auto-approve path and
 * the service worker's popup-approval path call `materializeRequest(req, deps)` and get the same
 * `DraftOperation` shape after CAIP resolution; `feeSettings` is honestly optional on a draft.
 *
 * The silent path narrows Draft → executable `Operation` with `assertSilentExecutable` (it only
 * ever sees self-fee'd requests — `isConfirmationNeeded` gates the rest — so a non-executable draft
 * there is a drift alarm). The popup path materializes for display; the executable operation is
 * rebuilt SW-side from the stored request at confirm, and the popup supplies only a per-index fee
 * selection, never an operation.
 *
 * Network/account resolution is injected via `MaterializeDeps` so the function is unit-testable
 * without service-collection setup.
 */

import type { Account } from "@/wallet/services/account/service"
import type { Network } from "@/wallet/services/network/service"
import type { DraftOperation, Operation } from "@nulo/wallet-bridge"
import { isEmbeddedFeePayment } from "@nulo/wallet-bridge"
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
			// A requested self-pay (the account named as payer with no fee call) starts with NO
			// settings: the fee card, locked to Fee Juice, derives them only once a verified balance
			// can pay — a pre-filled method would leave Confirm live over an empty or unread balance.
			return {
				...request,
				networkId: network.id,
				accountAddress: account.address,
				feeSettings: isEmbeddedFeePayment(request) ? { paymentMethod: { kind: "embedded" } } : undefined,
			} as DraftOperation
		}
		case "send_transaction": {
			const [network, account] = await deps.resolveNetworkAndAccount(request.account)
			return {
				...request,
				networkId: network.id,
				accountAddress: account.address,
				feeSettings: isEmbeddedFeePayment(request) ? { paymentMethod: { kind: "embedded" } } : undefined,
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
