import { type ILogger, LogLevel } from "../logger/interfaces"
import type { AlarmEvent, AlarmsPort, Unsubscribe } from "../ports"
import { getErrorMessage } from "./errors"

export interface AlarmBackedTaskOptions {
	/** Unique chrome.alarms name (also the dispatch filter). */
	name: string
	/** Period in minutes (`chrome.alarms.create` semantics). */
	periodInMinutes: number
	/** The work to run each tick (and, when `runOnStart`, once at boot). */
	tick: () => Promise<void>
	alarms: AlarmsPort
	logger: ILogger
	/** Log source tag for tick-error diagnostics. */
	logSource: string
	/**
	 * Run the tick once immediately in `start()` — the boot-reconcile every
	 * alarm consumer needs (a period-only alarm doesn't fire until one full
	 * period after registration, and a stray alarm from a previous SW lifetime
	 * must not be trusted to have already run). Default true.
	 */
	runOnStart?: boolean
}

/**
 * Q-05: shared "alarm-backed periodic task" primitive. `price/service.ts`,
 * `profile/session-manager.ts`, and the operation-journal `reaper`/`gc` each
 * hand-rolled the identical shape — an alarm-name constant, `create`/`clear`, a
 * boot-run, and a name-filtered dispatch handler — so a fix to one (e.g. the
 * "stray alarm from a previous SW lifetime" correctness requirement) had no
 * single place to land. This owns that lifecycle once; a consumer supplies a
 * name, period, and tick body. Tick errors are caught + logged (never allowed to
 * escape the alarm callback, which chrome would otherwise treat as unhandled).
 */
export class AlarmBackedTask {
	readonly #alarms: AlarmsPort
	readonly #name: string
	readonly #period: number
	readonly #tick: () => Promise<void>
	readonly #logger: ILogger
	readonly #logSource: string
	readonly #runOnStart: boolean
	#unsubscribe?: Unsubscribe

	public constructor(opts: AlarmBackedTaskOptions) {
		this.#alarms = opts.alarms
		this.#name = opts.name
		this.#period = opts.periodInMinutes
		this.#tick = opts.tick
		this.#logger = opts.logger
		this.#logSource = opts.logSource
		this.#runOnStart = opts.runOnStart ?? true
	}

	/** Register the periodic alarm + (by default) run the boot tick. Idempotent
	 *  within one SW lifetime — `chrome.alarms.create` replaces the registration. */
	public async start(): Promise<void> {
		this.#unsubscribe = this.#alarms.onAlarm(this.#onAlarmFired)
		await this.#alarms.create(this.#name, { periodInMinutes: this.#period })
		if (this.#runOnStart) {
			try {
				await this.#tick()
			} catch (err) {
				this.#logger.log(this.#logSource, LogLevel.Error, "boot tick threw; continuing", getErrorMessage(err))
			}
		}
	}

	/** Detach the listener + clear the alarm. */
	public async stop(): Promise<void> {
		this.#unsubscribe?.()
		this.#unsubscribe = undefined
		await this.#alarms.clear(this.#name)
	}

	readonly #onAlarmFired = (alarm: AlarmEvent): void => {
		if (alarm.name !== this.#name) return
		this.#tick().catch((err) => {
			this.#logger.log(this.#logSource, LogLevel.Error, "tick threw", getErrorMessage(err))
		})
	}
}
