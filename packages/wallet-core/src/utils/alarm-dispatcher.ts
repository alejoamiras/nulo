import type { AlarmCreateOptions, AlarmsPort, Unsubscribe } from "../ports"

/**
 * Q-05: thin shared wrapper for the `chrome.alarms` ritual that four SW
 * components hand-rolled independently — the alarm-name constant, `create`/
 * `clear`, and a name-filtered `onAlarm` dispatch that routes the tick's
 * rejection to an error handler.
 *
 * It owns ONLY that ritual: name + create/clear + name-guarded dispatch wiring.
 * It is deliberately **logger-agnostic** — the caller supplies `onError`, so
 * each site keeps its own diagnostic verbatim (a shared generic message would
 * change observable behavior, and a generic backstop would double-report when a
 * caller's own error handler throws). Scheduling (periodic `periodInMinutes` vs
 * one-shot `when`), any boot-time reconcile run, and any enabled-gating stay
 * with the caller — those differ per site and do not generalize (audit
 * 2026-08-16 Q-05 verified: a period-bundling primitive does NOT fit
 * `session-manager`'s `when`-based reschedule-under-lock). `create()` forwards
 * the full {@link AlarmCreateOptions}; `listen()` is optional (a caller with a
 * centralized external dispatch path skips it).
 */
export class AlarmDispatcher {
	readonly #alarms: AlarmsPort
	readonly #name: string
	#unsubscribe?: Unsubscribe

	public constructor(name: string, alarms: AlarmsPort) {
		this.#name = name
		this.#alarms = alarms
	}

	/**
	 * Subscribe a name-filtered handler. A foreign alarm is ignored. The tick's
	 * returned-promise rejection is routed to `onError` — exactly the
	 * `tick().catch(onError)` shape each caller hand-rolled, so the caller owns
	 * its diagnostic (and, faithfully, any resulting unhandled rejection if
	 * `onError` itself throws). A synchronous throw from `tick` is NOT caught
	 * here (the real callers pass `async` ticks); the wrapper does not overstate
	 * that guarantee. Call once per lifetime (a second call stacks a listener);
	 * `stop()` detaches it.
	 */
	public listen(tick: () => Promise<void>, onError: (error: unknown) => void): void {
		this.#unsubscribe = this.#alarms.onAlarm((alarm) => {
			if (alarm.name !== this.#name) return
			tick().catch(onError)
		})
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
}
