import type { ScopeView } from "./scope-mismatch"

/** One follow at a time across every extension realm: two windows confirming together write two
 *  whole (network, account) pairs in order instead of one window's network with the other's account. */
export const SCOPE_FOLLOW_LOCK = "nulo:scope-follow"

export interface ScopeFollowDeps {
	/** The tracker's re-read; the guard fails closed until it has answered. */
	refreshInFlight: () => Promise<void>
	hasInFlightSend: () => boolean
	/** The live row, read under the lock: a follow that ran before this one may have moved it. */
	getActiveNetworkId: () => Promise<string | undefined>
	setActiveNetwork: (networkId: string) => Promise<unknown>
	/** The durable pointer write; `unless` runs inside the facade, right before the write. */
	writeActiveAccount: (address: string, unless: () => boolean) => Promise<unknown>
}

/**
 * Moves the wallet to the scope a confirmed payload runs in — the network row, then the account
 * pointer — without ever touching this realm's store: the window is closing, and the shell's
 * network watcher would otherwise wake and stamp the pointer with an arbitrary account.
 *
 * The lifecycle generation is the fence. Every await here is a point where the wallet can lock or
 * switch profile; the shell rejects and closes but does not cancel this continuation, and the store
 * lags both events, so the handlers bump the generation synchronously and each step re-checks it.
 */
export function createScopeFollow(deps: ScopeFollowDeps) {
	let generation = 0

	/** Called synchronously from the profile-change and lock handlers and from dispose. */
	const invalidate = () => {
		generation++
	}

	/** Capture BEFORE the approval is awaited: a change that lands during it must abort the follow. */
	const capture = () => {
		const seen = generation
		return () => seen === generation
	}

	/** Never throws: a failed follow must not turn a successful approval into an error. */
	const follow = async (view: ScopeView | undefined, declined: boolean, stillOurs: () => boolean): Promise<void> => {
		if (!view || declined || !stillOurs()) return
		if (!view.networkMismatch && !view.accountMismatch) return
		try {
			await navigator.locks.request(SCOPE_FOLLOW_LOCK, () => followUnderLock(view, stillOurs))
		} catch {
			// A failure can leave the pair half-written; a rollback could overwrite a newer selection.
		}
	}

	const followUnderLock = async (view: ScopeView, stillOurs: () => boolean): Promise<void> => {
		await deps.refreshInFlight()
		if (!stillOurs() || deps.hasInFlightSend()) return
		const activeNetworkId = await deps.getActiveNetworkId()
		if (!stillOurs()) return
		// Network first: a failed network write must never leave a lone account write behind.
		if (activeNetworkId !== view.network.id) await deps.setActiveNetwork(view.network.id)
		if (!stillOurs() || !view.followAccount) return
		await deps.writeActiveAccount(view.followAccount.address, () => !stillOurs())
	}

	return { invalidate, capture, follow }
}
