/**
 * Fences the boot-time session check against the event path before it may lock the shell.
 *
 * Two writers own the popup's authenticated state: the event handler (`onActiveProfileChanged`,
 * sequenced by the event counter) and the boot run (`loadProfile`, sequenced by its own run
 * counter). A boot run that reads "no session" can be STALE by the time it acts — an unlock can
 * open a session and emit while the lookup is in flight — and the activation bootstrap that event
 * starts fences only its bookkeeping, never its mutations. So the boot path must never bump the
 * event counter; it captures the counter before its lookup and, immediately before the one
 * destructive action, requires both its own run and that counter to be unchanged. Any event in
 * between owns the outcome and the boot run only marks the session as checked.
 */

import type { LockLandingAction } from "./lock-landing"

export interface LockedBootDeps<R extends { kind: string }> {
	/** The event counter; read before the lookup and again before locking. */
	readEventSeq: () => number
	/** False once a newer boot run started. */
	isCurrent: () => boolean
	lookup: () => Promise<R>
	/** Read at action time, never earlier: it reflects whatever the event path did meanwhile. */
	decide: (result: R) => LockLandingAction
	act: {
		lock: (result: R) => void
		selectAndAuth: (result: R) => void
		settle: () => void
	}
}

export async function reconcileLockedBoot<R extends { kind: string }>(deps: LockedBootDeps<R>): Promise<R | { kind: "superseded" }> {
	const eventSeqAtStart = deps.readEventSeq()
	const result = await deps.lookup()
	if (!deps.isCurrent()) return { kind: "superseded" }
	if (result.kind !== "locked") return result
	const action = deps.decide(result)
	if (action === "passkey-hold") return result
	if (action === "select-and-auth") {
		deps.act.selectAndAuth(result)
		return result
	}
	if (action === "lock" && deps.readEventSeq() === eventSeqAtStart) {
		deps.act.lock(result)
		return result
	}
	deps.act.settle()
	return result
}
