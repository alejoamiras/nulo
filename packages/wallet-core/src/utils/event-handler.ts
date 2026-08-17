import { type ILogger, LogLevel } from "../logger/interfaces"

export interface IEventHandler<T> {
	add: (callback: (payload: T) => void) => void
	remove: (callback: (payload: T) => void) => void
}

export class EventHandler<T> implements IEventHandler<T> {
	#callbacks: ((payload: T) => void)[] = []
	readonly #name?: string
	readonly #logger?: ILogger

	/**
	 * @param name    optional event name, included in the diagnostic when a
	 *                subscriber throws (helps identify WHICH pub/sub relationship).
	 * @param logger  optional reporter (Q-03). A throwing subscriber is still
	 *                isolated from its siblings — the swallow is deliberate — but
	 *                when a logger is supplied the caught error is surfaced instead
	 *                of vanishing silently. Mirrors `utils/lock.ts`'s pattern.
	 */
	constructor(name?: string, logger?: ILogger) {
		this.#name = name
		this.#logger = logger
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
				// report it so it surfaces in the log rather than vanishing. The
				// report is itself guarded: a throwing logger must not break dispatch.
				try {
					this.#logger?.log(
						"event-handler",
						LogLevel.Error,
						`EventHandler${this.#name ? `("${this.#name}")` : ""}: subscriber threw`,
						err,
					)
				} catch {}
			}
		}
	}
}
