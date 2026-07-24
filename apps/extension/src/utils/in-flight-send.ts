/**
 * Whether a send is currently in flight.
 *
 * A send reads the active profile and account while it builds and proves. If
 * the user could switch mid-flight, the work already under way would finish
 * against whatever became active — building, and signing, as the wrong account.
 * Rather than detect that drift and unwind it, the switch is blocked for the
 * few seconds a send is in flight, so the ground cannot move underneath it.
 *
 * The user is never stuck: cancelling the send terminalizes its record, which
 * clears the guard. Locking the wallet is deliberately NOT blocked — it is a
 * security action and must always work.
 */

import type { OperationRecord } from "@/wallet/services/operation-journal/spec"

/** Stages where a send is still deciding what to build, or has not yet been broadcast. */
const IN_FLIGHT_STAGES: ReadonlySet<string> = new Set(["queued", "pending", "simulating", "proving", "submitting"])

/** Operation kinds that actually send a transaction. */
const SENDING_KINDS: ReadonlySet<string> = new Set(["transfer", "dapp_execute"])

/** True when `op` is a send that has not reached a terminal stage. */
export function isInFlightSend(op: Pick<OperationRecord, "kind" | "progress">): boolean {
	return SENDING_KINDS.has(op.kind) && IN_FLIGHT_STAGES.has(op.progress?.stage)
}

/** The scope a block applies to — the one the user is looking at. */
export interface InFlightScope {
	profileId: string | undefined
	accountAddress: string | undefined
	networkId: string | undefined
}

/**
 * True when the CURRENTLY VIEWED account has a send in flight.
 *
 * Scoped to the account and network on screen, not merely the profile, because
 * the block must line up with the cancel affordance: in-flight cards render for
 * the active account + network, so a profile-wide block could refuse the switch
 * over a record the user cannot see — and therefore cannot cancel. A dApp can
 * journal a queued send before any approval, so that gap would hand any
 * connected site an indefinite hold on account switching.
 *
 * Records that name no account (legacy) are ignored rather than treated as
 * blocking, for the same reason: nothing renders for them.
 */
export function hasInFlightSend(ops: readonly OperationRecord[], scope: InFlightScope): boolean {
	const { profileId, accountAddress, networkId } = scope
	if (!profileId || !accountAddress) return false
	return ops.some((op) => {
		if (op.profileId !== profileId || !isInFlightSend(op)) return false
		if (op.accountAddress !== accountAddress) return false
		// Tolerant on a record that predates network scoping; strict when it has one.
		return !op.networkId || !networkId || op.networkId === networkId
	})
}
