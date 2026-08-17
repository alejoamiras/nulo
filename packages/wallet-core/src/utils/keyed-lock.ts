import type { ILogger } from "../logger/interfaces"
import { Lock } from "./lock"

export interface KeyedLockOptions {
	name?: string
	logger?: ILogger
	/**
	 * Forwarded to each per-key {@link Lock}'s force-release watchdog. Omit for
	 * Lock's default 5-minute net; pass `null` to DISABLE it — for a caller
	 * replacing a watchdog-less hand-rolled `prev.then(op)` chain that must stay
	 * byte-for-byte equivalent (a wedged op then blocks only its own key, until
	 * the SW dies, exactly as before).
	 */
	maxHoldMs?: number | null
}

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
 * `prev.then(op)` promise chains). Each adopter chooses its watchdog via
 * `maxHoldMs` so the migration is byte-zero-delta: `coordinator` keeps `Lock`'s
 * default 5-minute force-release (its prior `new Lock()` had it), while the two
 * raw-chain sites pass `{ maxHoldMs: null }` to disable it (their chains had no
 * watchdog).
 */
export class KeyedLock {
	readonly #locks = new Map<string, Lock>()
	readonly #name?: string
	readonly #logger?: ILogger
	readonly #maxHoldMs?: number | null

	/** `name`/`logger` are forwarded to each per-key {@link Lock} (omit both to
	 *  match the silent, un-named locks the hand-rolled sites used); `maxHoldMs`
	 *  controls the per-key watchdog — see {@link KeyedLockOptions}. */
	public constructor(opts: KeyedLockOptions = {}) {
		this.#name = opts.name
		this.#logger = opts.logger
		this.#maxHoldMs = opts.maxHoldMs
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
			// `#maxHoldMs === undefined` → Lock's default watchdog; `null` → disabled.
			lock = new Lock(this.#name, this.#logger, this.#maxHoldMs)
			this.#locks.set(key, lock)
		}
		return lock
	}
}
