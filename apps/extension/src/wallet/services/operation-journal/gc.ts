/**
 * Terminal-record GC sweep for the operation journal.
 *
 * Carry #2 of the Phase 2 plan keeps terminal records (succeeded / failed /
 * cancelled) instead of auto-deleting them — tombstones serve idempotency
 * checks and the activity card history. With no bound, those tombstones
 * accumulate forever in `chrome.storage.local`. The UI caps the home-tab
 * preview at 5 rows, so the bloat is visually invisible up to thousands of
 * records, but the storage quota is finite.
 *
 * The GC sweep mirrors {@link JournalReaper} but watches the *terminal*
 * subset: it groups records by `(profileId, accountAddress ?? null)` and
 * enforces a per-scope cap, evicting the oldest by `terminalAt`. The
 * reaper handles non-terminal stuck records; the two paths never touch the
 * same record set.
 *
 * **Eviction policy** (QA feedback 2026-06-05): only `succeeded` records
 * are evictable. Failed and cancelled records have NO on-chain truth
 * elsewhere — they exist only in this journal, so losing them is real
 * data loss for the user. Succeeded records correspond to confirmed
 * on-chain transactions; their history is re-derivable from PXE + the
 * tx hash, so capping them keeps storage bounded without losing
 * irretrievable state. Failed/cancelled records still count toward the
 * group when grouping by scope, but are skipped during the eviction-
 * candidate selection.
 *
 * `accountAddress`-less terminal records (a failed token-import before the
 * account scope was set, for instance) cluster under a synthetic
 * `(profileId, null)` bucket with the same cap.
 */

import type { AlarmsPort } from "@nulo/wallet-core/ports"
import { AlarmBackedTask, getErrorMessage } from "@nulo/wallet-core/utils"
import { LogLevel } from "@nulo/wallet-core/logger"
import type { ILogger } from "@/wallet/logger"
import type { OperationJournalService } from "./service"

export const JOURNAL_GC_ALARM_NAME = "nulo:journal:gc"

/** Run hourly — bloat is slow, and a separate alarm avoids coupling to the
 *  reaper's 1-min cadence. */
export const JOURNAL_GC_PERIOD_MINUTES = 60

/** Per-(profile, accountAddress) terminal-record cap. 10× the home-tab UI
 *  budget; ample headroom for "I want to scroll back" while still bounding
 *  session storage. */
export const DEFAULT_TERMINAL_CAP_PER_SCOPE = 50

const LOG_SOURCE = "JournalGC"

/** Synthetic key for the "no account address" bucket. */
const NO_ACCOUNT = "<no-account>"

/**
 * Watches the operation journal for terminal records that exceed the
 * per-scope cap and deletes the oldest entries via
 * `OperationJournalService.deleteOperation` (which emits `onOperationDeleted`,
 * so any live subscribers — `RecentActivityView`, future tokens-view rows —
 * see the eviction the same way they see chain-purge deletes).
 *
 * Not a Service — pure SW-internal runtime component. Wired by
 * `runtime.ts` after `services.start()` alongside `JournalReaper`.
 */
export class JournalGC {
	private readonly journal: OperationJournalService
	private readonly alarms: AlarmsPort
	private readonly logger: ILogger
	private readonly capPerScope: number
	// Q-05: the alarm lifecycle (create / clear / boot-run / name-filtered
	// dispatch / tick error-catch) is owned by the shared AlarmBackedTask.
	private task?: AlarmBackedTask

	public constructor(journal: OperationJournalService, alarms: AlarmsPort, logger: ILogger, opts?: { capPerScope?: number }) {
		this.journal = journal
		this.alarms = alarms
		this.logger = logger
		this.capPerScope = opts?.capPerScope ?? DEFAULT_TERMINAL_CAP_PER_SCOPE
	}

	/**
	 * Register the periodic alarm + boot-time sweep. Idempotent within a
	 * single SW lifetime — calling twice replaces the alarm registration
	 * (chrome.alarms.create semantics).
	 */
	public async start(): Promise<void> {
		this.task = new AlarmBackedTask({
			name: JOURNAL_GC_ALARM_NAME,
			periodInMinutes: JOURNAL_GC_PERIOD_MINUTES,
			tick: () => this.sweep(),
			alarms: this.alarms,
			logger: this.logger,
			logSource: LOG_SOURCE,
		})
		await this.task.start()
	}

	public async stop(): Promise<void> {
		await this.task?.stop()
		this.task = undefined
	}

	/**
	 * Single sweep pass. Reads all terminal records via
	 * `getOperations({ isTerminal: true })`, groups by
	 * `(profileId, accountAddress ?? null)`, and deletes the oldest entries
	 * in any group whose size exceeds `capPerScope`.
	 *
	 * Per-record errors are logged but do not abort the pass (a record
	 * deleted by another flow between read and delete is expected).
	 */
	public async sweep(): Promise<void> {
		const terminal = await this.journal.getOperations({ isTerminal: true })
		if (terminal.length === 0) return

		const groups = new Map<string, typeof terminal>()
		for (const op of terminal) {
			const key = `${op.profileId}::${op.accountAddress ?? NO_ACCOUNT}`
			const bucket = groups.get(key)
			if (bucket) bucket.push(op)
			else groups.set(key, [op])
		}

		let evicted = 0
		for (const [key, bucket] of groups) {
			// Only `succeeded` records are evictable. Failed/cancelled exist
			// only here; losing them is real data loss (QA feedback 2026-06-05).
			const evictable = bucket.filter((op) => op.progress?.stage === "succeeded")
			if (evictable.length <= this.capPerScope) continue
			// Newest first; entries beyond the cap are the oldest by terminalAt.
			evictable.sort((a, b) => (b.terminalAt ?? 0) - (a.terminalAt ?? 0))
			for (const victim of evictable.slice(this.capPerScope)) {
				try {
					await this.journal.deleteOperation(victim.id)
					evicted++
				} catch (err) {
					this.logger.log(LOG_SOURCE, LogLevel.Debug, `evict skipped ${victim.id} (group=${key}): ${getErrorMessage(err)}`)
				}
			}
		}

		if (evicted > 0) {
			this.logger.log(LOG_SOURCE, LogLevel.Info, `evicted ${evicted} terminal record(s); cap=${this.capPerScope}/scope`)
		}
	}
}
