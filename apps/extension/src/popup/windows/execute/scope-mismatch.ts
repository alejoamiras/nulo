import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import { type OperationLike, uniqueSignerAccounts } from "./signers"

/** An operation as the window resolved it: the row it runs on, the account that signs it. */
export interface ScopeOperation extends OperationLike {
	kind: string
}

/** Where the payload runs, against where the wallet is looking. */
export interface ScopeView {
	/** The operations' row. Sessions are single-chain, so every operation shares it. */
	network: Network
	/** Row identity, not chain id: the activity feed is keyed on the row, so two rows on one
	 *  chain are a mismatch, and a row deleted and recreated reads as one too. */
	networkMismatch: boolean
	signers: Account[]
	/** The account the wallet moves to after Confirm: the single signer, else the single account
	 *  that actually sends. Absent when several accounts send (each operation signs for itself)
	 *  and when the account is hidden (a hidden account is never followed). */
	followAccount?: Account
	/** `followAccount` exists, differs from the active account, and the row already matches. */
	accountMismatch: boolean
	/** No operation sends a transaction; there is nothing to watch afterwards. */
	readOnly: boolean
}

export type ScopeBannerState = "chain" | "chain-declined" | "account" | "account-declined" | "multi-signer"

const SEND_LIKE_KINDS: ReadonlySet<string> = new Set(["aztec_sendTx", "send_transaction"])

/** `undefined` while the active scope is unresolved or there are no operations: first paint must
 *  neither claim a mismatch that isn't nor hide one that is. */
export function resolveOperationScope(
	operations: readonly ScopeOperation[],
	active: { networkId?: string; accountAddress?: string },
): ScopeView | undefined {
	const first = operations[0]
	if (!first || !active.networkId || !active.accountAddress) return undefined
	const signers = uniqueSignerAccounts(operations)
	const followAccount = pickFollowAccount(operations, signers)
	const networkMismatch = first.network.id !== active.networkId
	return {
		network: first.network,
		networkMismatch,
		signers,
		followAccount,
		accountMismatch: !networkMismatch && !!followAccount && followAccount.address !== active.accountAddress,
		readOnly: !operations.some((op) => SEND_LIKE_KINDS.has(op.kind)),
	}
}

/** A second signer on a free read must not suppress the follow: only the accounts that send
 *  decide it, and only when exactly one does. */
function pickFollowAccount(operations: readonly ScopeOperation[], signers: Account[]): Account | undefined {
	const candidate = signers.length === 1 ? signers[0] : singleSendingSigner(operations)
	return candidate?.visible ? candidate : undefined
}

function singleSendingSigner(operations: readonly ScopeOperation[]): Account | undefined {
	const senders = new Map<string, Account>()
	for (const op of operations) {
		if (op.account && SEND_LIKE_KINDS.has(op.kind)) senders.set(op.account.address, op.account)
	}
	return senders.size === 1 ? [...senders.values()][0] : undefined
}

export function scopeBannerState(view: ScopeView | undefined, declined: boolean): ScopeBannerState | undefined {
	if (!view) return undefined
	if (view.networkMismatch) return declined ? "chain-declined" : "chain"
	if (view.accountMismatch) return declined ? "account-declined" : "account"
	if (view.signers.length > 1 && !view.followAccount) return "multi-signer"
	return undefined
}

export interface ScopeBannerCopy {
	title: string
	body: string
	/** Absent when the state offers no toggle. */
	action?: string
}

const NO_WATCH = "This still executes — you just won't see it in your balances or activity."

/** Names are the rows' own `name`, so a user's rename reads back as their own label. */
export function scopeBannerCopy(state: ScopeBannerState, view: ScopeView, active: { account: Account; network: Network }): ScopeBannerCopy {
	const watch = view.readOnly ? "" : ", so you can watch the transaction"
	const opAccount = view.followAccount?.name
	const here = opAccount ? `${active.account.name} · ${active.network.name}` : active.network.name
	const there = opAccount ? `${opAccount} · ${view.network.name}` : view.network.name
	switch (state) {
		case "chain":
			return {
				title: `Runs on ${view.network.name}`,
				body: `Your wallet is on ${here}. It switches to ${there} after you confirm${watch}.`,
				action: `Stay on ${active.network.name}`,
			}
		case "chain-declined":
			return {
				title: `Runs on ${view.network.name}`,
				body: `Your wallet stays on ${here}. ${NO_WATCH}`,
				action: "Switch after confirming",
			}
		case "account":
			return {
				title: `Signed by ${opAccount}`,
				body: `Your wallet is on ${active.account.name}. It switches to ${opAccount} after you confirm${watch}.`,
				action: `Stay on ${active.account.name}`,
			}
		case "account-declined":
			return {
				title: `Signed by ${opAccount}`,
				body: `Your wallet stays on ${active.account.name}. ${NO_WATCH}`,
				action: "Switch after confirming",
			}
		case "multi-signer":
			return {
				title: `Signed by ${view.signers.length} accounts`,
				body: `${view.signers.map((account) => account.name).join(", ")}. Each operation is signed by its own account; your wallet stays where it is.`,
			}
	}
}
