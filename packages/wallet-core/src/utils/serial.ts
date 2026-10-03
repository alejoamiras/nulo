/**
 * A promise-chain queue: each `run(op)` starts `op` only once every earlier op has settled.
 *
 * `run` is synchronous and adds no promise hop of its own, so a site that swaps its hand-written
 * `tail.then(op)` chain for this queue awaits the same graph. Prefer it to `Lock` where that
 * matters: `withLock` is `async` and costs extra hops.
 *
 * - No policy (propagate): `run` returns `op`'s own outcome, and the chain continues past a rejection.
 * - `{ onError }` (report): every rejection goes to `onError` and `run` resolves; `run(op)` is the
 *   new `tail`. A throwing `onError` rejects the tail, so the next op is skipped and `onError`
 *   receives the rethrow.
 */
export interface SerialQueue {
	run<T>(op: () => Promise<T>): Promise<T>
	/** The latest link: settles once every queued op has. Read it live; it moves on every `run`. */
	readonly tail: Promise<unknown>
}

export interface ReportingSerialQueue {
	// biome-ignore lint/suspicious/noConfusingVoidType: a failed op resolves to whatever onError returned, which the caller must ignore.
	run<T>(op: () => Promise<T>): Promise<T | void>
	/** The latest link: settles once every queued op has. Read it live; it moves on every `run`. */
	readonly tail: Promise<unknown>
}

export interface SerialQueuePolicy {
	onError: (error: unknown) => void
}

const noop = () => undefined

export function createSerialQueue(): SerialQueue
export function createSerialQueue(policy: SerialQueuePolicy): ReportingSerialQueue
export function createSerialQueue(policy?: SerialQueuePolicy): SerialQueue | ReportingSerialQueue {
	let tail: Promise<unknown> = Promise.resolve()
	if (policy) {
		return {
			run<T>(op: () => Promise<T>) {
				const link = tail.then(op).catch(policy.onError)
				tail = link
				return link
			},
			get tail() {
				return tail
			},
		}
	}
	return {
		run<T>(op: () => Promise<T>): Promise<T> {
			const link = tail.then(op)
			tail = link.then(noop, noop)
			return link
		},
		get tail() {
			return tail
		},
	}
}
