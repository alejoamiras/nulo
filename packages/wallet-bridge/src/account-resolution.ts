/**
 * Which account a dApp request acts as.
 *
 * The dispatcher resolves this when it executes a request, and the journal
 * resolves it when the request arrives, to record which account the operation
 * belongs to. Those two answers MUST agree: if they diverge, the operation is
 * filed under one account and sent from another, and the activity feed shows it
 * in the wrong place.
 *
 * They used to be separate rules — the journal took `session.accounts[0]` while
 * the dispatcher scanned wallet-ordered accounts — so a multi-account session
 * disagreed with itself. This is the one rule both call.
 */

/** The minimum an account needs for resolution. Wallet order is the caller's. */
export interface ResolvableAccount {
	address: string
}

export type AccountResolution<T extends ResolvableAccount> =
	| { ok: true; account: T }
	/** No account satisfies the request; the caller decides whether that is an error or a skip. */
	| { ok: false; reason: "not-authorized" | "no-session-account" }

export interface ResolveAuthorizedAccountInput<T extends ResolvableAccount> {
	/**
	 * The wallet's accounts in the order the wallet presents them — index-sorted,
	 * as `AccountService.getAccounts` returns. This ordering is what makes the
	 * default account deterministic across fresh and restored profiles, so it is
	 * the order the default must follow.
	 */
	walletAccounts: readonly T[]
	/** Addresses the session is authorized for. */
	sessionAddresses: ReadonlySet<string>
	/** An explicitly requested sender, if the request named one. */
	requestedFrom?: string
}

/**
 * Resolve the account a request acts as.
 *
 * An explicit `from` must be session-authorized: an unauthorized one is refused
 * rather than quietly downgraded to the default, which would both ignore the
 * dApp's choice and send from an account the request never named. With no
 * explicit `from`, the default is the first WALLET-ordered account the session
 * authorizes — not the first the session happens to list, which is arbitrary.
 */
export function resolveAuthorizedSessionAccount<T extends ResolvableAccount>({
	walletAccounts,
	sessionAddresses,
	requestedFrom,
}: ResolveAuthorizedAccountInput<T>): AccountResolution<T> {
	if (requestedFrom !== undefined) {
		const requested = walletAccounts.find((account) => account.address === requestedFrom && sessionAddresses.has(account.address))
		return requested ? { ok: true, account: requested } : { ok: false, reason: "not-authorized" }
	}

	const fallback = walletAccounts.find((account) => sessionAddresses.has(account.address))
	return fallback ? { ok: true, account: fallback } : { ok: false, reason: "no-session-account" }
}
