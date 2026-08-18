/**
 * Phase 2 Week 4: durable-job reaper.
 *
 * MV3 service-worker suspend is unobservable to in-flight work. If the
 * SW dies mid-prove and the offscreen survives, the prove completes
 * but the SW (a fresh instance after wake) has no record of the
 * pending request — the offscreen's response message is dropped on
 * arrival because no `requestId` matches. The journal record sits in
 * `proving` forever.
 *
 * The reaper closes that loop with TWO sweep modes:
 *
 * 1. **Boot sweep** (aggressive, `unconditional: true`): runs once at
 *    `start()`. Marks EVERY non-terminal record as failed, ignoring
 *    grace windows. The rationale: a fresh SW has an empty pending-
 *    request map, so any record in proving/submitting from a previous
 *    SW lifetime is unrecoverable regardless of how recently it started.
 *    Error kind = `sw_restart_post_prove` (proving) / `stale_on_resume`
 *    (others) per the documented `JobError.kind` set.
 *
 * 2. **Periodic tick** (chrome.alarms, every 1 min): respects the
 *    per-stage grace windows. Catches records that get stuck within
 *    a single SW lifetime — rare, but possible if a downstream call
 *    hangs without throwing. Error kind = `stuck_proving` (proving) /
 *    `stale_on_resume` (others).
 *
 * Either way, the popup observes the transition via the journal
 * client's `subscribeJob` and shows the user a real terminal state
 * instead of an indefinite "Proving…" spinner.
 *
 * The reaper never tries to RECOVER lost work — Aztec proofs are
 * block-anchored, the offscreen instance that held the proof artifact
 * may have died too, and even if alive its in-memory state isn't
 * addressable from a fresh SW. Marking the record `failed` is the
 * honest outcome.
 *
 * Cleanup: chain-scoped journal purge already runs via
 * `OperationJournalService.clearChainState` (W1, wired into
 * `NetworkService.purgeChain`'s cascade). The reaper doesn't duplicate
 * that — it only reaps stuck records, not chain-removed ones.
 */

import type { JobStage } from "@nulo/wallet-core/jobs"
import type { AlarmsPort } from "@nulo/wallet-core/ports"
import { AlarmDispatcher, getErrorMessage } from "@nulo/wallet-core/utils"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@nulo/wallet-core/logger"
import type { OperationJournalService } from "./service"

export const JOURNAL_REAPER_ALARM_NAME = "nulo:journal:reap"

/** Chrome enforces a 1-minute production minimum floor on alarm periods.
 *  Reap once per minute — fine-grained enough that a stuck record clears
 *  within ~one grace-window of its own stage's deadline. */
export const REAP_PERIOD_MINUTES = 1

/**
 * Per-stage grace windows. A non-terminal record older than its window
 * is declared lost.
 *
 * - `pending` should transition near-instantly to `simulating`; a long
 *   stall here means the SW died between `createOperation` and the
 *   first markJournal.
 * - `simulating` can be slow when fee strategies require a chain RPC,
 *   but 10 min is a generous upper bound for anything reachable.
 * - `proving` is the longest legitimately-long stage (BB.wasm prove can
 *   take tens of minutes); 35 min comfortably covers the 30-min PXE
 *   client timeout + SW restart slack.
 * - `submitting` is short: once the tx is broadcast the node returns
 *   the answer within seconds; 5 min is a safety margin for slow nodes.
 */
const STAGE_GRACE_MS: Readonly<Record<Exclude<JobStage, "succeeded" | "failed" | "cancelled">, number>> = {
	// Matches the wallet-sdk dApp-interaction popup timeout (INTERACTION_TIMEOUT_MS).
	// A queued record that survives 10 minutes means background.ts either crashed
	// or somehow lost the handler — sweep it so the activity feed doesn't show a
	// permanently-stuck "Queued..." card.
	queued: 10 * 60_000,
	pending: 2 * 60_000,
	simulating: 10 * 60_000,
	proving: 35 * 60_000,
	submitting: 5 * 60_000,
}

const LOG_SOURCE = "JournalReaper"

/**
 * Watches the operation journal for non-terminal records that have
 * exceeded their stage's grace window and transitions them to `failed`
 * with a `lost_during_suspend` error kind.
 *
 * Not a Service — pure SW-internal runtime component. Wired by
 * `runtime.ts` after `services.start()`. One instance per SW lifetime.
 */
export class JournalReaper {
	private readonly journal: OperationJournalService
	private readonly logger: ILogger
	// Q-05: the name-guarded create/clear/dispatch ritual is owned by the shared
	// AlarmDispatcher; the boot sweep (with its distinct `{unconditional,
	// bootCutoff}` args) and the periodic no-arg tick stay local — the two call
	// shapes genuinely differ, so the wrapper deliberately doesn't own them.
	private readonly dispatcher: AlarmDispatcher
	/** Per-instance now-source. Real `Date.now()` in production; injectable
	 *  via the optional 4th ctor arg for unit tests using fake clocks. */
	private readonly now: () => number
	/** B-03: the boot-sweep cutoff. When the composition root supplies it (captured
	 *  BEFORE `services.start()`), it protects even ops created by a popup-RPC
	 *  replayed during service startup — records with `createdAt >= bootCutoff` are
	 *  this-lifetime and live. When omitted (unit tests / legacy), `start()` falls
	 *  back to `this.now()` at its first statement. */
	private readonly bootCutoff?: number

	public constructor(journal: OperationJournalService, alarms: AlarmsPort, logger: ILogger, now?: () => number, bootCutoff?: number) {
		this.journal = journal
		this.logger = logger
		this.dispatcher = new AlarmDispatcher(JOURNAL_REAPER_ALARM_NAME, alarms)
		this.now = now ?? (() => Date.now())
		this.bootCutoff = bootCutoff
	}

	/**
	 * Register the periodic alarm + boot-time sweep. Idempotent within a
	 * single SW lifetime — calling twice replaces the alarm registration
	 * (chrome.alarms.create semantics) and stacks the listener (avoid
	 * calling twice in production; the `alarmUnsubscribe` capture is
	 * a defensive seam for tests).
	 */
	public async start(): Promise<void> {
		// B-03: capture the boot cutoff as the FIRST synchronous statement so it
		// precedes the delayed alarm-create await + RPC-listener install. Prefer the
		// composition-root-supplied cutoff (captured before services.start(), so it
		// also predates any popup-RPC replayed mid-startup).
		const bootCutoff = this.bootCutoff ?? this.now()
		// The caller owns the diagnostic, so this stays byte-identical to the
		// pre-adoption `reap().catch(err => log("reap tick threw", …))`.
		this.dispatcher.listen(
			() => this.reap(),
			(err) => this.logger.log(LOG_SOURCE, LogLevel.Error, "reap tick threw", getErrorMessage(err)),
		)
		await this.dispatcher.create({ periodInMinutes: REAP_PERIOD_MINUTES })

		// Aggressive boot sweep: any non-terminal record at SW startup is
		// from a previous SW lifetime by construction (a fresh SW has an
		// empty activeControllers map + no pending requests in any client).
		// Even if the offscreen prove finishes, its response will be dropped
		// when it arrives because no requestId in the new SW matches it.
		// So at boot we transition EVERY in-flight record to `failed` with
		// `sw_restart_post_prove` (proving) / `stale_on_resume` (others) —
		// no grace window to wait for, since recovery is impossible.
		try {
			await this.reap({ unconditional: true, bootCutoff })
		} catch (err) {
			this.logger.log(LOG_SOURCE, LogLevel.Error, "boot-reap threw; continuing", getErrorMessage(err))
		}
	}

	public async stop(): Promise<void> {
		await this.dispatcher.stop()
	}

	/**
	 * Single reap pass. Reads all non-terminal records via
	 * `getOperations({ isTerminal: false })` and transitions each one
	 * that has exceeded its stage's grace window.
	 *
	 * Per-record errors are logged but do not abort the pass — a stale
	 * record disappearing between read and transition is expected
	 * (terminated in another flow), not a failure.
	 *
	 * `unconditional: true` skips the grace-window gate — used by the
	 * boot sweep, where every non-terminal record is by construction from
	 * a previous SW lifetime and unrecoverable (the new SW has an empty
	 * pending-request map). Error kind reflects the post-prove SW restart
	 * cause: `sw_restart_post_prove` for the proving stage, `stale_on_resume`
	 * for the others. Periodic ticks (the normal path) keep the grace
	 * window — a proving op started 10s ago in THIS SW instance should
	 * NOT be reaped.
	 */
	public async reap(opts?: { unconditional?: boolean; bootCutoff?: number }): Promise<void> {
		const inflight = await this.journal.getOperations({ isTerminal: false })
		const now = this.now()
		const unconditional = opts?.unconditional === true
		const bootCutoff = opts?.bootCutoff
		for (const op of inflight) {
			const stage = op.progress.stage
			if (stage === "succeeded" || stage === "failed" || stage === "cancelled") continue
			// B-03: the aggressive boot sweep must NOT fail a record created in THIS
			// SW lifetime (createdAt >= bootCutoff) — e.g. by the request that woke
			// the SW. Such an op is live; the pipeline still owns it. Prior-lifetime
			// records (createdAt < bootCutoff) are unrecoverable and swept as before.
			// `>=` errs toward NOT sweeping (clock skew / same-ms) — the periodic
			// tick catches genuine intra-lifetime staleness under its grace window.
			if (unconditional && bootCutoff !== undefined && op.createdAt >= bootCutoff) continue
			const grace = STAGE_GRACE_MS[stage]
			const age = now - op.updatedAt
			if (!unconditional && age < grace) continue
			// Map stage → canonical error kind documented on JobError.kind.
			// Boot sweep uses `sw_restart_post_prove` for proving — the exact
			// post-SW-restart-mid-prove case where the new SW can't deliver
			// the offscreen's prove result (no matching requestId).
			// Periodic ticks use `stuck_proving` — the proving op exceeded its
			// 35-min sanity ceiling within THIS SW's lifetime; rare in practice.
			let kind: string
			if (stage === "proving") {
				kind = unconditional ? "sw_restart_post_prove" : "stuck_proving"
			} else if (stage === "queued") {
				// Plan §14: queued records that exceed their grace window are
				// "stuck" rather than "stale-on-resume" — they never made it
				// past the message-arrival surface (background.ts somehow lost
				// the handler). Tagged distinctly for observability.
				kind = "stuck_queued"
			} else {
				kind = "stale_on_resume"
			}
			const reason = unconditional
				? `SW restart with non-terminal record in ${stage} — unrecoverable`
				: `${stage} stage exceeded grace window (${age}ms ≥ ${grace}ms)`
			try {
				await this.journal.transitionOperation(
					op.id,
					{ stage: "failed" },
					{ kind, message: `Job declared lost: ${reason}`, normalizedRaw: null },
				)
				this.logger.log(LOG_SOURCE, LogLevel.Warn, `reaped ${op.id} (${stage}, ${kind}, age=${age}ms)`)
			} catch (err) {
				// Most common cause: the record was terminated by its
				// owning flow between getOperations and transitionOperation
				// (e.g. cancelJob landed first). Log + move on.
				this.logger.log(LOG_SOURCE, LogLevel.Debug, `reap skipped ${op.id}: ${getErrorMessage(err)}`)
			}
		}
	}
}
