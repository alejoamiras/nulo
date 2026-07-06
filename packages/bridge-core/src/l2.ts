/**
 * L2 side of the bridge: consume an L1→L2 deposit (claim) and start an L2→L1
 * withdraw (exit) via the deployed `token_bridge`. Thin aztec.js wrappers — the
 * caller supplies a connected Wallet (EmbeddedWallet in tests, the Nulo
 * wallet-sdk in the app) + the send options (fee/from/wait). Validated by the
 * deposit→claim / withdraw→exit integration tests against the sandbox.
 *
 * Mirrors token_bridge/src/main.nr:
 *   claim_public(to, amount, secret, message_leaf_index)
 *   claim_private(recipient, amount, claim_salt, message_leaf_index)   ← recipient-committed
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

/**
 * The L1→L2 message consumption input.
 * - PUBLIC (`claimPublic`): `secret` is the raw message preimage (`claim_public` binds the recipient
 *   in its content hash, so the secret is not recipient-scoped).
 * - PRIVATE (`claimPrivate`): `secret` carries the per-deposit `claim_salt`; `claim_private` re-derives
 *   the actual consumption secret from `(claim_salt, recipient)` in-circuit (recipient-committed). A
 *   claim naming a different recipient derives a different secret and can't consume — so a relayer can
 *   submit this for the user without redirecting funds. NOT a bearer credential anymore.
 */
export interface ClaimParams {
	/** L2 recipient (AztecAddress hex). For private, the recipient is BOUND — a different one fails to consume. */
	recipient: string
	amount: bigint
	/** PUBLIC: the raw secret. PRIVATE: the `claim_salt` (the circuit derives the secret from it + recipient). */
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
	return Contract.at(AztecAddress.fromStringUnsafe(bridge), artifact, wallet)
}

/** Claim a PUBLIC L1→L2 deposit — mints to `recipient` publicly via the minter-proxy. */
export function claimPublic(bridge: ContractBase, p: ClaimParams, send: SendOpts) {
	return bridge.methods
		.claim_public(AztecAddress.fromStringUnsafe(p.recipient), p.amount, p.secret, new Fr(p.messageLeafIndex))
		.send(send as never)
}

/**
 * Claim a PRIVATE L1→L2 deposit — mints privately to `recipient`, recipient-committed. `p.secret`
 * carries the `claim_salt`; the circuit re-derives the consumption secret from `(claim_salt, recipient)`.
 * Works identically for a self-claim and a relayer-submitted claim (the sender is in `send.from`); a
 * relayer can finish the deposit but can never redirect it. See {@link submitPrivateClaim}.
 */
export function claimPrivate(bridge: ContractBase, p: ClaimParams, send: SendOpts) {
	return bridge.methods
		.claim_private(AztecAddress.fromStringUnsafe(p.recipient), p.amount, p.secret, new Fr(p.messageLeafIndex))
		.send(send as never)
}

/**
 * Submit a PRIVATE claim on behalf of a user (a relayer). Identical mechanics to {@link claimPrivate}
 * — the recipient-commitment means a wrong recipient can't consume, so this is safe for a third party
 * to run. `send.from` is the relayer's account; `p.recipient` is the (bound) user. Named distinctly so
 * relayer call sites read as intentional delegation, not a self-claim.
 */
export const submitPrivateClaim = claimPrivate

/**
 * A zero L1 recipient strands the withdraw: the L2 burn succeeds but the canonical
 * portal's underlying transfer reverts on the zero address, so the Outbox message
 * can never be consumed. Reject it here (mirrored by the Noir `assert` in the bridge).
 */
function assertExitRecipient(recipientL1: string): void {
	if (/^0x0{40}$/i.test(recipientL1)) {
		throw new Error("exit recipient must not be the zero address (would strand the withdraw)")
	}
}

/** Burn PUBLICLY + create the L2→L1 withdraw message (consumed on L1 via the Outbox). */
export function exitToL1Public(bridge: ContractBase, p: ExitParams, send: SendOpts) {
	assertExitRecipient(p.recipientL1)
	return bridge.methods
		.exit_to_l1_public(EthAddress.fromString(p.recipientL1), p.amount, EthAddress.fromString(p.callerOnL1), p.authwitNonce)
		.send(send as never)
}

/** Burn PRIVATELY + create the L2→L1 withdraw message. */
export function exitToL1Private(bridge: ContractBase, p: ExitParams, send: SendOpts) {
	assertExitRecipient(p.recipientL1)
	return bridge.methods
		.exit_to_l1_private(EthAddress.fromString(p.recipientL1), p.amount, EthAddress.fromString(p.callerOnL1), p.authwitNonce)
		.send(send as never)
}
