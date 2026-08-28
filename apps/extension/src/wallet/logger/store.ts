import type { ConfigProp, IConfig } from "@/wallet/config"
import { EventHandler } from "@nulo/wallet-core/utils"
import { type ILoggerStore, type Log, LogLevel, CircularBufferIterable, print, trim } from "."

export class LoggerStore implements ILoggerStore {
	public readonly onLog = new EventHandler<Log>()

	private logLevel: LogLevel
	private logs: CircularBufferIterable<Log>
	private nextId = 1
	private flushTimer?: ReturnType<typeof setTimeout>
	/**
	 * FIFO chain of every session-storage operation this store performs.
	 *
	 * A single "in-flight write" slot is not enough: the timer is cleared the moment a flush
	 * STARTS, so a later log can schedule and fire a second flush while the first is still
	 * pending, and a purge awaiting only the latest promise can still be overtaken by the earlier
	 * write. Chaining every `set` and `remove` through one queue makes the ordering total.
	 */
	private storageOps: Promise<void> = Promise.resolve()
	private persistEnabled: boolean

	private readonly config: IConfig

	public constructor(config: IConfig) {
		this.config = config
		this.logLevel = config.get("debugMode") ? LogLevel.Debug : LogLevel.Info
		this.logs = new CircularBufferIterable(this.logLevel === LogLevel.Debug ? 10_000 : 1000)
		// The persisted config has NOT loaded at construction — this store is built at module
		// scope, while `config.load()` runs later inside `runtime.start()` (after migrations, an
		// ordering that must not change). So this is the schema default, not the user's choice;
		// `applyRetentionPolicy()` is what settles it once the real value is known.
		this.persistEnabled = config.get("developerMode") === true
		config.onUpdate.add(this.onConfigUpdate)
	}

	public get(count: number, fromId?: number): Log[] {
		return this.logs.get(count, fromId ?? 0)
	}

	/**
	 * Clearing must drop the persisted copy too. Emptying only the ring buffer left `nulo:logs`
	 * intact, so the next worker restart rehydrated everything the user had just cleared — the
	 * "Clear logs" button appeared to work and didn't.
	 */
	public clear(): Promise<void> {
		this.logs.clear()
		// Returned, not fired-and-forgotten: `clearLogs()` must not acknowledge success while the
		// persisted copy is still on disk — a worker restart in that window resurrects it.
		return this.purgePersisted()
	}

	public log(source: string, level: LogLevel, ...data: unknown[]): void {
		if (level < this.logLevel) {
			return
		}
		const log: Log = {
			id: this.nextId++,
			timestamp: Date.now(),
			source,
			level,
			context: "sw",
			data: trim(data) as unknown[],
		}
		this.logs.add(log)
		this.scheduleFlush()
		this.onLog.invoke(log)
		print(log)
	}

	/** Log with explicit context (used by LoggerService for offscreen/popup forwarding). */
	public logWithContext(context: string | undefined, source: string, level: LogLevel, ...data: unknown[]): void {
		if (level < this.logLevel) {
			return
		}
		const log: Log = {
			id: this.nextId++,
			timestamp: Date.now(),
			source,
			level,
			context: (context as Log["context"]) ?? "sw",
			data: trim(data) as unknown[],
		}
		this.logs.add(log)
		this.scheduleFlush()
		this.onLog.invoke(log)
		print(log)
	}

	/**
	 * Rehydrate logs from chrome.storage.session (call on startup before wiring services).
	 *
	 * Deliberately unconditional. It runs BEFORE the persisted config loads, so gating it on
	 * `persistEnabled` would read the schema default and wipe a developer's logs on every worker
	 * restart — the exact continuity the retention opt-in exists to preserve.
	 * `applyRetentionPolicy()` undoes this if the loaded config turns out to disable retention.
	 */
	public async rehydrate(): Promise<void> {
		try {
			const result = await chrome.storage.session.get("nulo:logs")
			const saved = result["nulo:logs"] as Log[] | undefined
			if (saved?.length) {
				for (const log of saved) {
					this.logs.add(log)
					this.nextId = Math.max(this.nextId, log.id + 1)
				}
			}
		} catch {
			// Session storage may not be available (e.g., in tests)
		}
	}

	/**
	 * Debounced flush of recent logs to chrome.storage.session for crash recovery.
	 *
	 * Retention is opt-in with developer mode. Without it a normal user's logs live only in this
	 * worker's memory and die with it, so no captured line survives to be read back or exported —
	 * which is the bulk of the exposure, since the capture surface is far wider than the redactor
	 * can cover. Developers accept retention in exchange for diagnosis across worker restarts.
	 */
	private scheduleFlush(): void {
		if (!this.persistEnabled) return
		if (this.flushTimer) return
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined
			// Queued, not fire-and-forget: cancelling the TIMER cannot stop a write that has already
			// begun, and an unqueued `set()` landing after a purge would recreate the very key the
			// purge just removed.
			void this.enqueueStorageOp(async () => {
				const items = this.logs.items().slice(-2000)
				await chrome.storage.session.set({ "nulo:logs": items })
			})
		}, 2000)
	}

	/**
	 * Append a session-storage operation to the serialized chain and return its completion.
	 *
	 * Each link swallows its own failure — session storage is unavailable in tests and can throw at
	 * runtime — so one bad operation never wedges the queue for the rest of the worker's life.
	 */
	private enqueueStorageOp(op: () => Promise<void>): Promise<void> {
		const next = this.storageOps.then(op, op).catch(() => {})
		this.storageOps = next
		return next
	}

	/**
	 * Settle retention once the persisted config has actually loaded. MUST be called after
	 * `config.load()` resolves.
	 *
	 * Two cases the config-update event alone cannot cover: `apply()` only emits when a value
	 * CHANGES, so a stored `developerMode: false` matching the default emits nothing; and the flag
	 * can be turned off while this worker is dead, so the disable-time purge never ran. Either way
	 * the rehydrated entries and the stored copy must go — retention-off means nothing outlives the
	 * worker that wrote it.
	 */
	public async applyRetentionPolicy(): Promise<void> {
		this.persistEnabled = this.config.get("developerMode") === true
		if (this.persistEnabled) return
		this.logs.clear()
		await this.purgePersisted()
	}

	/**
	 * Drop the persisted copy. Cancels a pending flush and queues the removal behind every write
	 * already in flight, so no `set()` can land on top of it and resurrect the key.
	 */
	private purgePersisted(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
			this.flushTimer = undefined
		}
		return this.enqueueStorageOp(async () => {
			await chrome.storage.session.remove("nulo:logs")
		})
	}

	private readonly onConfigUpdate = (prop: ConfigProp) => {
		if (prop.key === "debugMode") {
			this.logLevel = prop.value ? LogLevel.Debug : LogLevel.Info
			this.logs.resize(this.logLevel === LogLevel.Debug ? 10_000 : 1_000)
		}
		if (prop.key === "developerMode") {
			this.persistEnabled = prop.value === true
			// Turning retention off must PURGE, not merely stop writing: entries captured while it
			// was on otherwise survive in session storage and are re-imported by rehydrate() on the
			// next worker restart, so the setting would appear to do nothing.
			if (!this.persistEnabled) void this.purgePersisted()
		}
	}
}
