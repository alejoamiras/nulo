/**
 * Fences the boot-time session check against the event path before it may act on "no session".
 *
 * Two writers own the popup's authenticated state: the event handler (`onActiveProfileChanged`,
 * sequenced by the event counter) and the boot run (`loadProfile`, sequenced by its own run
 * counter). A boot run that reads "no session" can be STALE by the time it acts — an unlock can
 * open a session and emit while the lookup is in flight, a lock in another window can delete the
 * profile the lookup listed — and the activation bootstrap an event starts fences only its
 * bookkeeping, never its mutations. So the boot path never bumps the event counter; it captures
 * the counter before its lookup and, immediately before acting on a `locked` result, requires
 * both its own run and that counter to be unchanged. An event in between owns the outcome: the
 * run reports `event-superseded` and the caller applies nothing from the stale result, not even
 * its profile list.
 */

import type { LockLandingAction } from "./lock-landing"

export interface LockedBootDeps<R extends { kind: string }> {
	/** The event counter; read before the lookup and again before acting. */
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

export type LockedBootOutcome<R> = R | { kind: "superseded" } | { kind: "event-superseded" }

export async function reconcileLockedBoot<R extends { kind: string }>(deps: LockedBootDeps<R>): Promise<LockedBootOutcome<R>> {
	const eventSeqAtStart = deps.readEventSeq()
	const result = await deps.lookup()
	if (!deps.isCurrent()) return { kind: "superseded" }
	if (result.kind !== "locked") return result
	if (deps.readEventSeq() !== eventSeqAtStart) return { kind: "event-superseded" }
	const action = deps.decide(result)
	if (action === "lock") deps.act.lock(result)
	else if (action === "select-and-auth") deps.act.selectAndAuth(result)
	else if (action === "settle") deps.act.settle()
	return result
}
