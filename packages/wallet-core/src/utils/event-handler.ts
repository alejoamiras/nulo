export interface IEventHandler<T> {
	add: (callback: (payload: T) => void) => void
	remove: (callback: (payload: T) => void) => void
}

/**
 * Reporter for a subscriber that threw during {@link EventHandler.invoke}.
 * A plain callback (NOT an `ILogger`) on purpose: `EventHandler` is a
 * foundational primitive and `logger/interfaces.ts` already imports it (for
 * `ILoggerStore.onLog`), so importing the logger contract back here would close
 * a module/type cycle — the exact smell this audit removes elsewhere. The
 * caller, which owns a logger, supplies a thin adapter.
 */
export type SubscriberErrorReporter = (error: unknown, eventName?: string) => void

export class EventHandler<T> implements IEventHandler<T> {
	#callbacks: ((payload: T) => void)[] = []
	readonly #name?: string
	readonly #onError?: SubscriberErrorReporter

	/**
	 * @param name     optional event name, passed to `onError` when a subscriber
	 *                 throws (helps identify WHICH pub/sub relationship broke).
	 * @param onError  optional reporter (Q-03). A throwing subscriber is still
	 *                 isolated from its siblings — the swallow is deliberate — but
	 *                 when a reporter is supplied the caught error is surfaced
	 *                 instead of vanishing silently.
	 */
	constructor(name?: string, onError?: SubscriberErrorReporter) {
		this.#name = name
		this.#onError = onError
	}

	public add(callback: (payload: T) => void) {
		if (!this.#callbacks.includes(callback)) {
			this.#callbacks.push(callback)
		}
	}

	public remove(callback: (payload: T) => void) {
		const index = this.#callbacks.indexOf(callback)
		if (index !== -1) {
			this.#callbacks.splice(index, 1)
		}
	}

	public invoke(payload: T) {
		for (const callback of this.#callbacks) {
			try {
				callback(payload)
			} catch (err) {
				// A throwing subscriber must NOT stop its siblings (one broken
				// listener can't take down the rest), so we keep swallowing — but
				// report it so it surfaces rather than vanishing. The report is
				// itself guarded: a throwing reporter must not break dispatch.
				try {
					this.#onError?.(err, this.#name)
				} catch {}
			}
		}
	}
}
