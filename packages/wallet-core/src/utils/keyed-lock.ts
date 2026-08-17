import type { ILogger } from "../logger/interfaces"
import { Lock } from "./lock"

/**
 * Q-08: per-key serialization. Holds one lazily-created {@link Lock} per key;
 * `withLock(key, fn)` runs `fn` only after every prior op for that SAME key has
 * settled (FIFO per key, independent across keys), releasing on every exit path
 * (via `Lock.withLock`, so a throwing `fn` still advances the key's queue and
 * the caller still receives `fn`'s result/throw).
 *
 * Generalizes the `Map<string, Lock>` + lazily-created-`lockFor` idiom that
 * `activity-protocol/coordinator`, `account`'s `serializePerTuple`, and the
 * wallet-sdk decrypt monkeypatch each hand-rolled (the latter two as raw
 * `prev.then(op)` promise chains). Adopting `Lock` also gains its best-effort
 * 5-minute force-release safety net — a wedged op no longer blocks the key's
 * queue forever, matching how `coordinator` already used `Lock`.
 */
export class KeyedLock {
	readonly #locks = new Map<string, Lock>()
	readonly #name?: string
	readonly #logger?: ILogger

	/** `name`/`logger` are forwarded to each per-key {@link Lock}; omit both to
	 *  match the silent, un-named locks the hand-rolled sites used. */
	public constructor(name?: string, logger?: ILogger) {
		this.#name = name
		this.#logger = logger
	}

	/** Run `fn` under `key`'s lock (FIFO per key). */
	public withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
		return this.#lockFor(key).withLock(fn)
	}

	/**
	 * Drop a key's lock (e.g. on session termination). Safe when absent. An
	 * in-flight op keeps its own reference and still completes; a later
	 * `withLock(key)` simply mints a fresh lock. Prevents unbounded growth for
	 * keys with a known end-of-life.
	 */
	public delete(key: string): void {
		this.#locks.delete(key)
	}

	#lockFor(key: string): Lock {
		let lock = this.#locks.get(key)
		if (!lock) {
			lock = new Lock(this.#name, this.#logger)
			this.#locks.set(key, lock)
		}
		return lock
	}
}
