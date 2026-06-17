import { LogLevel } from "@/wallet/logger"

/** One buffered log entry (context is bound by the forwarder's sink). */
export interface BatchEntry {
	source: string
	level: LogLevel
	data: unknown[]
}

export interface BatchingForwarderOptions {
	/** Debounce window (ms) for Info/Debug before a flush. Default 50. */
	flushMs?: number
	/** Flush as soon as the buffer reaches this many entries. Default 200. */
	maxBatch?: number
	/** Hard cap; beyond it the oldest entries are dropped (counted). Default 1000. */
	maxBuffer?: number
}

export interface BatchingForwarder {
	forward(source: string, level: LogLevel, ...data: unknown[]): void
	flush(): void
	dispose(): void
}

/**
 * Buffers forwarded log entries and ships them in batches, so a high-volume
 * producer (the offscreen PXE block-synchronizer's per-block console output)
 * can't flood the single service-worker event loop with one RPC per line — the
 * backpressure that starved dApp-tx execution-start (see
 * `implementations-plan/proverless-e2e-diagnosis/DIAGNOSIS.md`).
 *
 * Invariants (audit-driven):
 *   - **Warn/Error flush immediately** — and the buffer is flushed in FIFO order
 *     first, so an Error is prompt AND still ordered after the Info/Debug before it.
 *   - **Info/Debug** are buffered and flushed on a `flushMs` debounce or when the
 *     buffer hits `maxBatch` — best-effort timing, never dropped except under the
 *     hard `maxBuffer` cap (drop-oldest, with a Warn notice carrying the count).
 *   - **One batch → one `sink` call → one SW handler turn** (the sink is
 *     `LoggerServiceClient.logBatch`), collapsing N event-loop wakes into one.
 *   - `dispose()` flushes (best-effort teardown) and clears the timer.
 */
export function createBatchingForwarder(sink: (entries: BatchEntry[]) => void, options: BatchingForwarderOptions = {}): BatchingForwarder {
	const flushMs = options.flushMs ?? 50
	const maxBatch = options.maxBatch ?? 200
	const maxBuffer = options.maxBuffer ?? 1000

	let buffer: BatchEntry[] = []
	let dropped = 0
	let timer: ReturnType<typeof setTimeout> | undefined

	const flush = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer)
			timer = undefined
		}
		if (dropped > 0) {
			// Surface the loss rather than hide it (audit: a drop must be observable).
			buffer.push({
				source: "log-batcher",
				level: LogLevel.Warn,
				data: [`dropped ${dropped} buffered log entr(ies) at buffer cap ${maxBuffer}`],
			})
			dropped = 0
		}
		if (buffer.length === 0) return
		const batch = buffer
		buffer = []
		sink(batch)
	}

	const forward = (source: string, level: LogLevel, ...data: unknown[]): void => {
		buffer.push({ source, level, data })
		if (buffer.length > maxBuffer) {
			buffer.shift()
			dropped++
		}
		// Warn/Error: flush now (buffer already holds prior entries + this one → ordered).
		if (level >= LogLevel.Warn) {
			flush()
			return
		}
		// Info/Debug: flush on size, else debounce.
		if (buffer.length >= maxBatch) {
			flush()
			return
		}
		if (timer === undefined) timer = setTimeout(flush, flushMs)
	}

	return {
		forward,
		flush,
		dispose: () => {
			flush()
			if (timer !== undefined) {
				clearTimeout(timer)
				timer = undefined
			}
		},
	}
}
