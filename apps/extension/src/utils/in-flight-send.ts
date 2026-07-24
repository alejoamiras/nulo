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

/**
 * True when the profile has a send in flight.
 *
 * Scoped to one profile: another profile's in-flight work is not a reason to
 * block this one, and with the wallet locked between profiles it cannot be
 * observed here anyway.
 */
export function hasInFlightSend(ops: readonly OperationRecord[], profileId: string | undefined): boolean {
	if (!profileId) return false
	return ops.some((op) => op.profileId === profileId && isInFlightSend(op))
}
