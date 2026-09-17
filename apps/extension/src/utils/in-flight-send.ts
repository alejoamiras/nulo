/**
 * Whether the wallet's own send is in flight.
 *
 * A popup transfer snapshots the popup's active account and network into its
 * arguments when the user presses Send, so the only thing that can move the
 * ground under it is that same popup changing scope. The guard holds the scope
 * still until the send is broadcast or terminal.
 *
 * dApp sends are not counted. They carry their own account and network, and
 * they fail closed when the session that authorized them ends, so the guard
 * has nothing to protect — and counting them would hand any connected site a
 * hold on the user's switching for the life of its transaction.
 *
 * Cancelling a send terminalizes its record, which clears the guard. Locking
 * the wallet is never blocked — it is a security action and must always work.
 */

import type { OperationRecord } from "@/wallet/services/operation-journal/spec"

/** Stages where a send is still deciding what to build, or has not yet been broadcast. */
const IN_FLIGHT_STAGES: ReadonlySet<string> = new Set(["queued", "pending", "simulating", "proving", "submitting"])

/** Stages between a send starting to execute and its `submitting` write. */
const APPROVED_UNBROADCAST_STAGES: ReadonlySet<string> = new Set(["pending", "simulating", "proving"])

/** Operation kinds that actually send a transaction. */
const SENDING_KINDS: ReadonlySet<string> = new Set(["transfer", "dapp_execute"])

/** True when `op` is a send the popup started that has not reached a terminal stage. */
export function isInFlightSend(op: Pick<OperationRecord, "kind" | "origin" | "progress">): boolean {
	return SENDING_KINDS.has(op.kind) && op.origin === "popup" && IN_FLIGHT_STAGES.has(op.progress?.stage)
}

/** True when `op` is a send, from any origin, that has started executing and has not reached
 *  `submitting`: the stages that hold an expiring session open and that the lock dialog counts,
 *  since a lock cancels dApp sends too. `queued` is excluded, approved or not, so a waiting request
 *  can neither keep the wallet unlocked nor make a lock ask. */
export function isApprovedSendInFlight(op: Pick<OperationRecord, "kind" | "progress">): boolean {
	return SENDING_KINDS.has(op.kind) && APPROVED_UNBROADCAST_STAGES.has(op.progress?.stage)
}

/** How many approved sends `profileId` has running, on any account: a lock cancels all of them. */
export function approvedSendsInFlight(ops: readonly OperationRecord[], profileId: string | undefined): number {
	if (!profileId) return 0
	return ops.filter((op) => op.profileId === profileId && isApprovedSendInFlight(op)).length
}

/** The scope a block applies to — the one the user is looking at. */
export interface InFlightScope {
	profileId: string | undefined
	accountAddress: string | undefined
	networkId: string | undefined
}

/**
 * True when the CURRENTLY VIEWED account has a popup send in flight.
 *
 * Scoped to the account and network on screen, not merely the profile, because
 * the block must line up with the cancel affordance: in-flight cards render for
 * the active account + network, so a profile-wide block could refuse the switch
 * over a record the user cannot see — and therefore cannot cancel.
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
