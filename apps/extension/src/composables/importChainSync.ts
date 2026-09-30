/**
 * The import flow's bounded chain-registration tail: slice normalization, then one pipeline per
 * network with registrable work, all on ONE absolute deadline. A network this restore created is
 * probed first and registers as soon as its own probe answers, so a stalled node costs only its
 * own network. Every failure shape lands in `record(...)` (→ `restoreErrorLog` → the
 * Continue-gated errors screen); nothing here throws.
 *
 * A tail run records its outcomes exactly once, after every pipeline settled: no pipeline touches
 * the sink (`recordRestoreErrors` APPENDS, so a late loser reaching it would add contradictory
 * entries; keep it that way). Normalizer violations get their own earlier record. The SW keeps
 * enforcing its own copy of the deadline per registration launch, so an abandoned call stops
 * launching work too.
 */

import {
	ACCOUNT_STATE_SKIP_DEADLINE,
	ACCOUNT_STATE_SKIP_UNREACHABLE,
	ACCOUNT_STATE_SKIP_WRONG_NETWORK,
	isConnectivityErrorMessage,
	type NormalizedAccountStateItem,
	normalizeAccountStateSlice,
	registrableNetworkIds,
	skippedNetworkRecord,
} from "@/wallet/services/account-state/normalize"
import type { NodeStatus } from "@/wallet/services/network/spec"
import { preflightNetworkConnectivity, realSleep } from "./importPreflight"

/** The whole tail (preflight + registrations) shares this wall-clock budget. */
export const IMPORT_CHAIN_SYNC_TOTAL_BUDGET_MS = 45_000
/** The preflight's own cap within the shared budget. */
export const IMPORT_PREFLIGHT_BUDGET_MS = 21_000
/** The registration leg's cap within the shared budget (< the 60s popup→SW
 *  request ceiling, so THIS timeout — not a transport error — decides). */
export const IMPORT_REGISTRATION_BUDGET_MS = 30_000

export interface ImportChainSyncDeps {
	/** The backup's raw account-state slice (attacker-controlled). */
	slice: unknown
	/** Ids of the networks THIS restore created (probe-able). */
	createdNetworkIds: string[]
	/** `AccountStateServiceClient.restore`-shaped call, deadline included; one network per call. */
	restore: (items: unknown[], deadlineMs: number) => Promise<unknown>
	/** `NetworkServiceClient.probeNodeStatus`-shaped probe. */
	probe: (networkId: string, timeoutMs: number) => Promise<NodeStatus>
	/** `recordRestoreErrors(ACCOUNT_STATE_SERVICE_NAME, ...)`-shaped sink. The kind keeps the two
	 *  apart: a Retry replaces only "outcomes", since no registration brings back what the
	 *  normalizer discarded. */
	record: (records: unknown[], kind: "violations" | "outcomes") => void
}

interface NetworkOutcome {
	item: NormalizedAccountStateItem
	records: unknown[]
	retryable: boolean
}

interface TailClock {
	preflightAt: number
	deadlineAt: number
}

/** Resolves with the normalized items a Retry may replay: networks that ran out of time, whose
 *  call rejected, whose node could not be reached, or whose result reports either. */
export async function runImportChainSync(deps: ImportChainSyncDeps): Promise<NormalizedAccountStateItem[]> {
	const deadlineAt = Date.now() + IMPORT_CHAIN_SYNC_TOTAL_BUDGET_MS

	const normalized = normalizeAccountStateSlice(deps.slice)
	if (normalized.violations.length) deps.record(normalized.violations, "violations")

	const withWork = new Set(registrableNetworkIds(normalized))
	const created = new Set(deps.createdNetworkIds)
	const clock = { preflightAt: Math.min(Date.now() + IMPORT_PREFLIGHT_BUDGET_MS, deadlineAt), deadlineAt }
	const outcomes = await Promise.all(
		normalized.items
			.filter((item) => withWork.has(item.networkId))
			.map((item) => syncOneNetwork(deps, item, created.has(item.networkId), clock)),
	)

	const records = outcomes.flatMap((o) => o.records)
	if (records.length) deps.record(records, "outcomes")
	return outcomes.filter((o) => o.retryable).map((o) => o.item)
}

async function syncOneNetwork(
	deps: ImportChainSyncDeps,
	item: NormalizedAccountStateItem,
	created: boolean,
	clock: TailClock,
): Promise<NetworkOutcome> {
	if (!created) {
		// A network this restore never created answers "Network not found", dialing nothing, however
		// often it is retried.
		return { ...(await registerOneNetwork(deps, item, clock.deadlineAt)), retryable: false }
	}
	const verdicts = await preflightNetworkConnectivity({
		networkIds: [item.networkId],
		probe: deps.probe,
		deadlineAt: clock.preflightAt,
	})
	const verdict = verdicts.get(item.networkId)
	if (verdict === "wrong-network") return skipOutcome(item, ACCOUNT_STATE_SKIP_WRONG_NETWORK, false)
	if (verdict !== "go") return skipOutcome(item, ACCOUNT_STATE_SKIP_UNREACHABLE, true)
	return registerOneNetwork(deps, item, clock.deadlineAt)
}

async function registerOneNetwork(
	deps: ImportChainSyncDeps,
	item: NormalizedAccountStateItem,
	deadlineAt: number,
): Promise<NetworkOutcome> {
	const remaining = Math.max(0, Math.min(IMPORT_REGISTRATION_BUDGET_MS, deadlineAt - Date.now()))
	if (remaining === 0) return skipOutcome(item, ACCOUNT_STATE_SKIP_DEADLINE, true)
	// Raced at the EXACT remainder: the deadline is absolute (the service enforces its own copy per
	// launch, so nothing useful runs past it). A rejection's message never reaches a record.
	const result = await Promise.race([deps.restore([item], remaining).catch(() => undefined), realSleep(remaining).then(() => undefined)])
	if (!Array.isArray(result)) return skipOutcome(item, ACCOUNT_STATE_SKIP_DEADLINE, true)
	return { item, records: result, retryable: result.some(reportsNetworkFailure) }
}

function skipOutcome(item: NormalizedAccountStateItem, message: string, retryable: boolean): NetworkOutcome {
	return { item, records: [skippedNetworkRecord(item.networkId, message)], retryable }
}

/** The service resolves, never rejects, on a registration failure, so a node that passed the
 *  probe and then failed shows up here: a deadline on the item, or a child that could not reach
 *  the node. A payload failure (a parse error, a refused artifact) is not the network's. */
function reportsNetworkFailure(record: unknown): boolean {
	const { restoreError, senders, contracts } = (record ?? {}) as { restoreError?: unknown; senders?: unknown; contracts?: unknown }
	if (typeof restoreError === "string" && restoreError.startsWith(ACCOUNT_STATE_SKIP_DEADLINE)) return true
	return [senders, contracts].some((children) => Array.isArray(children) && children.some(isConnectivityFailure))
}

function isConnectivityFailure(child: unknown): boolean {
	const error = (child as { restoreError?: unknown } | null)?.restoreError
	return typeof error === "string" && (error === ACCOUNT_STATE_SKIP_UNREACHABLE || isConnectivityErrorMessage(error))
}
