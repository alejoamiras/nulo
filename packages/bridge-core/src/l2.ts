/**
 * L2 side of the bridge: consume an L1→L2 deposit (claim) and start an L2→L1
 * withdraw (exit) via the deployed `token_bridge`. Thin aztec.js wrappers — the
 * caller supplies a connected Wallet (EmbeddedWallet in tests, the Nulo
 * wallet-sdk in the app) + the send options (fee/from/wait). Validated by the
 * deposit→claim / withdraw→exit integration tests against the sandbox.
 *
 * Mirrors token_bridge/src/main.nr:
 *   claim_public(to, amount, secret, message_leaf_index)
 *   claim_private(recipient, amount, secret_for_L1_to_L2_message_consumption, message_leaf_index)
 *   exit_to_l1_public(recipient, amount, caller_on_l1, authwit_nonce)
 *   exit_to_l1_private(recipient, amount, caller_on_l1, authwit_nonce)
 */
import type { ContractArtifact } from "@aztec/aztec.js/abi"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, type ContractBase } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import type { Wallet } from "@aztec/aztec.js/wallet"
import { EthAddress } from "@aztec/foundation/eth-address"

/** Opaque send options (fee + from + wait); the shape varies by wallet. */
export type SendOpts = Record<string, unknown>

/** A claim secret is the L1→L2 message preimage; private claims are bearer credentials. */
export interface ClaimParams {
	/** L2 recipient (AztecAddress hex). For private, whoever holds the secret chooses this. */
	recipient: string
	amount: bigint
	secret: Fr
	messageLeafIndex: bigint
}

export interface ExitParams {
	/** L1 recipient (EthAddress hex). */
	recipientL1: string
	amount: bigint
	/** L1 caller authorized to consume the Outbox message (often the user's L1 address). */
	callerOnL1: string
	authwitNonce: Fr
}

export function bridgeAt(wallet: Wallet, bridge: string, artifact: ContractArtifact): ContractBase {
	return Contract.at(AztecAddress.fromString(bridge), artifact, wallet)
}

/** Claim a PUBLIC L1→L2 deposit — mints to `recipient` publicly via the minter-proxy. */
export function claimPublic(bridge: ContractBase, p: ClaimParams, send: SendOpts) {
	return bridge.methods
		.claim_public(AztecAddress.fromString(p.recipient), p.amount, p.secret, new Fr(p.messageLeafIndex))
		.send(send as never)
}

/** Claim a PRIVATE L1→L2 deposit — the secret bears the funds; mints privately to `recipient`. */
export function claimPrivate(bridge: ContractBase, p: ClaimParams, send: SendOpts) {
	return bridge.methods
		.claim_private(AztecAddress.fromString(p.recipient), p.amount, p.secret, new Fr(p.messageLeafIndex))
		.send(send as never)
}

/** Burn PUBLICLY + create the L2→L1 withdraw message (consumed on L1 via the Outbox). */
export function exitToL1Public(bridge: ContractBase, p: ExitParams, send: SendOpts) {
	return bridge.methods
		.exit_to_l1_public(EthAddress.fromString(p.recipientL1), p.amount, EthAddress.fromString(p.callerOnL1), p.authwitNonce)
		.send(send as never)
}

/** Burn PRIVATELY + create the L2→L1 withdraw message. */
export function exitToL1Private(bridge: ContractBase, p: ExitParams, send: SendOpts) {
	return bridge.methods
		.exit_to_l1_private(EthAddress.fromString(p.recipientL1), p.amount, EthAddress.fromString(p.callerOnL1), p.authwitNonce)
		.send(send as never)
}
