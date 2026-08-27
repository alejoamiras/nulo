import type { Fr } from "@aztec/foundation/curves/bn254"
import type { AuthWitness } from "@aztec/stdlib/auth-witness"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { CompleteAddress } from "@aztec/stdlib/contract"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { ExecutionPayload, TxExecutionRequest } from "@aztec/stdlib/tx"
import type { DefaultAccountEntrypointOptions } from "@aztec/entrypoints/account"
import type { ChainInfo } from "@aztec/entrypoints/interfaces"
import type { IPXE } from "../pxe/ipxe"
import type { PartialGasSettingsRPC } from "./fee-options"

export * from "./nulo-account"
export * from "./fee-options"
export * from "./address-freeze"
export * from "./frozen-artifact"
export * from "./instantiation-descriptor"
export * from "./account-export"

export interface IAccountContract {
	readonly address: AztecAddress

	ensureRegistered(pxe: IPXE): Promise<void>

	ensureContractRegistered(pxe: IPXE): Promise<void>

	getCompleteAddress(): Promise<CompleteAddress>

	createAuthWit(messageHash: Fr): Promise<AuthWitness>

	/** `outMeta`, when supplied, receives build provenance the request object
	 *  itself cannot carry (`TxExecutionRequest` is an upstream class):
	 *  `initializesAccount` is set true iff THIS build wrapped the account
	 *  constructor (first-tx multicall). An out-param rather than a widened
	 *  return: the request flows through many downstream consumers typed on
	 *  the upstream shape, and only the send-path error classifier needs the
	 *  flag. */
	buildTxExecutionRequest(
		node: AztecNode,
		pxe: IPXE,
		payload: ExecutionPayload,
		options: DefaultAccountEntrypointOptions,
		chainInfo: ChainInfo,
		gasSettings?: PartialGasSettingsRPC,
		outMeta?: { initializesAccount?: boolean },
	): Promise<TxExecutionRequest>

	/** Returns `true` when this account's on-chain init nullifier is NOT
	 *  yet present at "latest" head — i.e. the next tx through this
	 *  account will be wrapped via `DefaultMultiCallEntrypoint` to
	 *  combine deploy + first call. Used by the mixed-payload orchestrator
	 *  to skip the merge for the first-tx case (upstream's flat
	 *  `appCallOffset` model can't express the doubly-nested multicall
	 *  execution tree). */
	requiresInitialization(node: AztecNode): Promise<boolean>
}
