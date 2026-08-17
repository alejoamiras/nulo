import { type ILogger, LogLevel } from "../logger/interfaces"
import type { AlarmCreateOptions, AlarmEvent, AlarmsPort, Unsubscribe } from "../ports"
import { getErrorMessage } from "./errors"

export interface AlarmDispatcherDeps {
	alarms: AlarmsPort
	logger: ILogger
	/** Log source tag for tick-error diagnostics. */
	logSource: string
}

/**
 * Q-05: thin shared wrapper for the `chrome.alarms` ritual that four SW
 * components hand-rolled independently — the alarm-name constant, `create`/
 * `clear`, and a name-filtered `onAlarm` dispatch whose async tick errors must
 * be caught (an unhandled rejection thrown from an alarm callback is swallowed
 * by chrome with no diagnostic).
 *
 * It owns ONLY that ritual: name + create/clear + name-guarded dispatch. The
 * scheduling shape (periodic `periodInMinutes` vs one-shot `when`), any
 * boot-time reconcile run, and any enabled-gating stay with the caller — those
 * differ per site and do not generalize (audit 2026-08-16 Q-05 verified: a
 * period-bundling `AlarmBackedTask` does NOT fit `session-manager`'s
 * `when`-based reschedule-under-lock). `create()` forwards the full
 * {@link AlarmCreateOptions} so a caller picks its own schedule; `listen()` is
 * optional (a caller with a centralized external dispatch path skips it).
 */
export class AlarmDispatcher {
	readonly #alarms: AlarmsPort
	readonly #name: string
	readonly #logger: ILogger
	readonly #logSource: string
	#unsubscribe?: Unsubscribe

	public constructor(name: string, deps: AlarmDispatcherDeps) {
		this.#name = name
		this.#alarms = deps.alarms
		this.#logger = deps.logger
		this.#logSource = deps.logSource
	}

	/**
	 * Subscribe a name-filtered handler. A foreign alarm is ignored; the tick's
	 * rejection is caught + logged and never escapes the alarm callback. Call
	 * once per lifetime (a second call stacks a listener); `stop()` detaches it.
	 */
	public listen(tick: () => Promise<void>): void {
		this.#unsubscribe = this.#alarms.onAlarm(this.#onAlarmFired(tick))
	}

	/** Register/replace the alarm. The caller owns the schedule shape. */
	public async create(options: AlarmCreateOptions): Promise<void> {
		await this.#alarms.create(this.#name, options)
	}

	/** Clear the alarm without detaching a `listen()` subscription. */
	public async clear(): Promise<void> {
		await this.#alarms.clear(this.#name)
	}

	/** Detach the `listen()` subscription (if any) + clear the alarm. */
	public async stop(): Promise<void> {
		this.#unsubscribe?.()
		this.#unsubscribe = undefined
		await this.#alarms.clear(this.#name)
	}

	readonly #onAlarmFired =
		(tick: () => Promise<void>) =>
		(alarm: AlarmEvent): void => {
			if (alarm.name !== this.#name) return
			tick().catch((err) => {
				this.#logger.log(this.#logSource, LogLevel.Error, "alarm tick threw", getErrorMessage(err))
			})
		}
}
