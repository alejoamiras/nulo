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

export interface IAccountContract {
	readonly address: AztecAddress

	ensureRegistered(pxe: IPXE): Promise<void>

	ensureContractRegistered(pxe: IPXE): Promise<void>

	getCompleteAddress(): Promise<CompleteAddress>

	createAuthWit(messageHash: Fr): Promise<AuthWitness>

	buildTxExecutionRequest(
		node: AztecNode,
		pxe: IPXE,
		payload: ExecutionPayload,
		options: DefaultAccountEntrypointOptions,
		chainInfo: ChainInfo,
		gasSettings?: PartialGasSettingsRPC,
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
