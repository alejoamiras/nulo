/**
 * The import flow's bounded chain-registration tail. Orchestrates, on ONE
 * absolute deadline: slice normalization → connectivity preflight (only
 * networks with registrable work) → the deadline-carrying registration call
 * → skip-record synthesis for everything that couldn't run. Every failure
 * shape lands in `record(...)` (→ `restoreErrorLog` → the Continue-gated
 * errors screen); nothing here throws.
 *
 * A SETTLED flag guards the record path: whichever side of the registration
 * race loses can no longer append (`recordRestoreErrors` APPENDS — a late
 * loser would add contradictory entries). The SW keeps enforcing its own
 * copy of the deadline per registration launch, so the abandoned side stops
 * launching work too.
 */

import type { NodeStatus } from "@/wallet/services/network/spec"
import {
	ACCOUNT_STATE_SKIP_DEADLINE,
	ACCOUNT_STATE_SKIP_UNREACHABLE,
	ACCOUNT_STATE_SKIP_WRONG_NETWORK,
	normalizeAccountStateSlice,
	registrableNetworkIds,
	skippedNetworkRecord,
} from "@/wallet/services/account-state/normalize"
import { preflightNetworkConnectivity } from "./importPreflight"

/** The whole tail (preflight + registrations) shares this wall-clock budget. */
export const IMPORT_CHAIN_SYNC_TOTAL_BUDGET_MS = 45_000
/** The preflight's own cap within the shared budget. */
export const IMPORT_PREFLIGHT_BUDGET_MS = 21_000
/** The registration leg's cap within the shared budget (< the 60s popup→SW
 *  request ceiling, so THIS timeout — not a transport error — decides). */
export const IMPORT_REGISTRATION_BUDGET_MS = 30_000
/** Page-side grace over the SW-enforced registration deadline. */
const REGISTRATION_RACE_GRACE_MS = 2_000

export interface ImportChainSyncDeps {
	/** The backup's raw account-state slice (attacker-controlled). */
	slice: unknown
	/** Ids of the networks THIS restore created (probe-able). */
	createdNetworkIds: string[]
	/** `AccountStateServiceClient.restore`-shaped call, deadline included. */
	restore: (items: unknown[], deadlineMs: number) => Promise<unknown>
	/** `NetworkServiceClient.probeNodeStatus`-shaped probe. */
	probe: (networkId: string, timeoutMs: number) => Promise<NodeStatus>
	/** `recordRestoreErrors(ACCOUNT_STATE_SERVICE_NAME, ...)`-shaped sink. */
	record: (records: unknown[]) => void
	now?: () => number
	sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function runImportChainSync(deps: ImportChainSyncDeps): Promise<void> {
	const now = deps.now ?? Date.now
	const sleep = deps.sleep ?? realSleep
	const deadlineAt = now() + IMPORT_CHAIN_SYNC_TOTAL_BUDGET_MS

	const normalized = normalizeAccountStateSlice(deps.slice)
	if (normalized.violations.length) deps.record(normalized.violations)
	if (!normalized.items.length) return

	// Probe only created networks with registrable work. Unknown networkIds
	// (not created by this restore) skip the probe and go straight to the
	// registration call, whose per-child "Network not found" errors are fast
	// and dial nothing — preserving the pre-existing unknown-network shape.
	const known = new Set(deps.createdNetworkIds)
	const registrable = registrableNetworkIds(normalized)
	const toProbe = registrable.filter((id) => known.has(id))

	const verdicts = toProbe.length
		? await preflightNetworkConnectivity({
				networkIds: toProbe,
				probe: deps.probe,
				deadlineAt: Math.min(now() + IMPORT_PREFLIGHT_BUDGET_MS, deadlineAt),
				now,
				sleep,
			})
		: new Map<string, "go" | "unreachable" | "wrong-network">()

	const skips: unknown[] = []
	for (const [networkId, verdict] of verdicts) {
		if (verdict === "unreachable") skips.push(skippedNetworkRecord(networkId, ACCOUNT_STATE_SKIP_UNREACHABLE))
		if (verdict === "wrong-network") skips.push(skippedNetworkRecord(networkId, ACCOUNT_STATE_SKIP_WRONG_NETWORK))
	}
	if (skips.length) deps.record(skips)

	// Everything not skipped still goes to the registration call: probed-GO
	// networks, unknown networks (fast per-child errors), and zero-work items
	// (no-ops that keep the result shape complete).
	const skippedIds = new Set([...verdicts.entries()].filter(([, v]) => v !== "go").map(([id]) => id))
	const items = normalized.items.filter((i) => !skippedIds.has(i.networkId))
	const registrableRemaining = items.some((i) => i.senders.length > 0 || i.contracts.length > 0)
	if (!items.length || !registrableRemaining) return

	const remaining = Math.max(0, Math.min(IMPORT_REGISTRATION_BUDGET_MS, deadlineAt - now()))
	const goIds = items.filter((i) => i.senders.length > 0 || i.contracts.length > 0).map((i) => i.networkId)
	if (remaining === 0) {
		deps.record(goIds.map((id) => skippedNetworkRecord(id, ACCOUNT_STATE_SKIP_DEADLINE)))
		return
	}

	let settled = false
	const outcome = await Promise.race([
		deps
			.restore(items, remaining)
			.then((result) => ({ kind: "result" as const, result }))
			.catch(() => ({ kind: "failed" as const })),
		sleep(remaining + REGISTRATION_RACE_GRACE_MS).then(() => ({ kind: "timeout" as const })),
	])
	if (settled) return
	settled = true

	if (outcome.kind === "result" && Array.isArray(outcome.result)) {
		deps.record(outcome.result)
	} else {
		deps.record(goIds.map((id) => skippedNetworkRecord(id, ACCOUNT_STATE_SKIP_DEADLINE)))
	}
}
