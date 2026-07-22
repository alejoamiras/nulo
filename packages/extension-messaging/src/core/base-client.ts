import { type ILogger, LogLevel } from "@nulo/wallet-core/logger"
import { jsonSanitize } from "@nulo/wallet-core/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"
import { decodeResult } from "./decode"
import { wrapParams } from "../utils"
import type { RequestTerminalStatus } from "../offscreen/telemetry"

/**
 * Shared request-correlator core for both transport clients (popup↔SW Port and
 * SW↔offscreen sendMessage). It owns the mechanics that were duplicated and
 * subtly drift-prone across the two forks:
 *
 *   - per-instance request-id allocation
 *   - the single pending map (resolver + timer + telemetry meta in ONE entry —
 *     no sidecar; the timer is cleared whenever the entry is settled)
 *   - the hard-timeout lifecycle
 *   - success-path result decode + response DISPATCH (`handleResponse`)
 *   - late/duplicate-response drop (settle is idempotent — a second terminal
 *     for the same id is a silent no-op)
 *
 * What it deliberately does NOT own — left as transport hooks — is everything
 * that genuinely differs between the two transports:
 *
 *   - liveness / readiness (`ensureTransportReady`) and the wire send
 *     (`sendEnvelope`); the message listener + routing stay in the subclass.
 *   - the error-VALUE construction (`makeRemoteError` / `makeTimeoutError` /
 *     `makeSendFailureError` / `makeDisconnectError`). The background transport
 *     rejects with typed `WalletError`s; the offscreen transport currently
 *     rejects with raw strings. Keeping error shaping in hooks is what lets the
 *     offscreen string→typed flip be a localized, later change rather than a
 *     behavior change smuggled into this core.
 *   - terminal observability (`onTerminal`); the offscreen subclass records
 *     telemetry, the background subclass does not.
 */

/** What the timeout/send/disconnect hooks receive to build their error value. */
export interface RequestErrorMeta {
	requestId: number
	methodName: string
	timeoutMs?: number
	cause?: unknown
}

/** Terminal-status record handed to `onTerminal` once per request lifecycle. */
export interface TerminalRecord {
	requestId: number
	method: string
	startedAtMs: number
	endedAtMs: number
	status: RequestTerminalStatus
	detail?: string
}

/** Per-request state. Timer + telemetry meta live in the entry (no sidecar) so
 *  a single `settle` clears everything atomically. */
interface PendingEntry {
	resolve: (result: unknown) => void
	reject: (error: unknown) => void
	method: string
	startedAtMs: number
	timeoutHandle?: ReturnType<typeof setTimeout>
	warnHandle?: ReturnType<typeof setTimeout>
}

/** Minimal shape of a response envelope's `content` the dispatch reads. */
export interface ResponseContentLike {
	requestId: number
	result?: unknown
	error?: string
	errorPayload?: unknown
	resultIsJson?: boolean
}

export abstract class BaseServiceClient<TRequests extends MethodsMap, TEvents extends EventsMap = Record<string, never>> {
	protected readonly service: string
	protected readonly logger: ILogger
	private readonly clientName: string
	private readonly defaultTimeoutMs: number
	private readonly warnAfterMs?: number

	private readonly pending: Map<number, PendingEntry> = new Map()
	private nextRequestId = 1

	protected constructor(
		service: string,
		logger: ILogger,
		name: string | undefined,
		options: { defaultTimeoutMs: number; warnAfterMs?: number },
	) {
		this.service = service
		this.logger = logger
		this.clientName = name ?? `${service}-client`
		this.defaultTimeoutMs = options.defaultTimeoutMs
		this.warnAfterMs = options.warnAfterMs
	}

	// ── Correlator core (owned) ─────────────────────────────────────────

	protected async request<T extends keyof TRequests>(
		method: T,
		...params: Parameters<TRequests[T]>
	): Promise<Awaited<ReturnType<TRequests[T]>>> {
		// Only suspend if the transport actually needs to wait. A transport
		// that is ready synchronously (the background Port when already
		// connected) returns void, so the request runs straight through to the
		// wire send without an intervening microtask — preserving the
		// synchronous-send timing the Port transport always had.
		const ready = this.ensureTransportReady()
		if (ready) await ready
		const requestId = this.nextRequestId++
		const methodName = String(method)
		const startedAtMs = Date.now()
		const content = {
			requestId,
			method,
			params: jsonSanitize(wrapParams(params)) as unknown as Parameters<TRequests[T]>,
		}
		const timeoutMs = this.getRequestTimeoutMs(method)
		this.logDebug(`→ ${methodName}`)

		const promise = new Promise<Awaited<ReturnType<TRequests[T]>>>((resolve, reject) => {
			const timeoutHandle = setTimeout(() => {
				this.settle(requestId, { reject: this.makeTimeoutError({ requestId, methodName, timeoutMs }) }, "timeout", "timeout_fired")
			}, timeoutMs)
			const warnHandle =
				this.warnAfterMs === undefined
					? undefined
					: setTimeout(() => {
							this.logWarn(`Request pending >${this.warnAfterMs}ms: ${methodName} (id: ${requestId})`)
						}, this.warnAfterMs)
			this.pending.set(requestId, {
				resolve: resolve as (result: unknown) => void,
				reject,
				method: methodName,
				startedAtMs,
				timeoutHandle,
				warnHandle,
			})
		})

		// Two failure modes the wire send can hit: a synchronous throw (Port
		// torn down) or a rejected promise (offscreen document gone). Either
		// way, settle with the transport's send-failure error so the caller
		// doesn't wait out the full timeout. settle is idempotent, so a
		// disconnect that raced the send simply wins. The sync Port send runs
		// `postMessage` before returning, so its throw is caught here too.
		try {
			const sent = this.sendEnvelope(content, methodName, requestId)
			if (sent) await sent
		} catch (cause) {
			this.settle(
				requestId,
				{ reject: this.makeSendFailureError({ requestId, methodName, cause }) },
				"send_failed",
				"sendMessage_threw",
			)
		}

		return promise
	}

	/**
	 * Dispatch a correlated response. Drops late/duplicate responses silently
	 * (the request was already terminal). Error decode is a per-transport hook;
	 * only the success-path result decode is shared.
	 */
	protected handleResponse(content: ResponseContentLike): void {
		const entry = this.pending.get(content.requestId)
		if (!entry) {
			this.logWarn("Invalid response received", content)
			return
		}
		if (content.error !== undefined || content.errorPayload !== undefined) {
			this.settle(content.requestId, { reject: this.makeRemoteError(content) }, "rejected")
			return
		}
		let decoded: unknown
		try {
			decoded = decodeResult(content.result, content.resultIsJson)
		} catch (cause) {
			// Malformed `resultIsJson` payload. Fail closed: settle (which clears
			// the pending entry) with an error, rather than letting the throw
			// escape this listener and leak the request until its timeout.
			const message = cause instanceof Error ? cause.message : String(cause)
			this.settle(content.requestId, { reject: new Error(`Malformed response payload: ${message}`) }, "rejected")
			return
		}
		this.settle(content.requestId, { resolve: decoded }, "success")
	}

	/** Framework-reserved property names that are EventHandlers but NEVER wire
	 *  events — invoked locally by lifecycle, never dispatched from a message.
	 *  The background transport reserves `onConnected`/`onDisconnected`. */
	protected readonly reservedEventNames: ReadonlySet<string> = new Set()

	/** Invoke the local handler for a received event. Hardened two ways: the
	 *  named property must be a real `EventHandler` (so `toString`/`constructor`/
	 *  etc. can't reach an unrelated property or crash the listener), AND it must
	 *  not be a framework-reserved lifecycle handler (so a forged message can't
	 *  drive reconnect/subscription logic via `onConnected`/`onDisconnected`).
	 *  Since every client's other EventHandlers are exactly its declared TEvents
	 *  events, this is the declared-event allowlist in practice. */
	protected handleEvent(event: keyof TEvents, payload: TEvents[keyof TEvents]): void {
		const handler = (this as unknown as Record<PropertyKey, unknown>)[event]
		if (this.reservedEventNames.has(String(event)) || !(handler instanceof EventHandler)) {
			this.logWarn("Unknown or reserved event received", event)
			return
		}
		handler.invoke(payload)
	}

	/** Reject every in-flight request — used by the subclass `disconnect`. */
	protected rejectAllPending(makeError: () => unknown, status: RequestTerminalStatus, detail?: string): void {
		for (const requestId of [...this.pending.keys()]) {
			this.settle(requestId, { reject: makeError() }, status, detail)
		}
	}

	protected get pendingCount(): number {
		return this.pending.size
	}

	/**
	 * The single terminal path. Clears the entry's timers, removes it, settles
	 * the promise, and emits exactly one terminal record. Idempotent: a second
	 * call for an already-settled id is a no-op, which is how late responses,
	 * post-timeout responses, and disconnect/send races stay safe.
	 */
	private settle(
		requestId: number,
		outcome: { resolve: unknown } | { reject: unknown },
		status: RequestTerminalStatus,
		detail?: string,
	): void {
		const entry = this.pending.get(requestId)
		if (!entry) return
		if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle)
		if (entry.warnHandle) clearTimeout(entry.warnHandle)
		this.pending.delete(requestId)
		const endedAtMs = Date.now()
		if ("resolve" in outcome) entry.resolve(outcome.resolve)
		else entry.reject(outcome.reject)
		this.onTerminal({ requestId, method: entry.method, startedAtMs: entry.startedAtMs, endedAtMs, status, detail })
		this.logDebug(`← ${entry.method} (${endedAtMs - entry.startedAtMs}ms)`, "pending:", this.pending.size)
	}

	// ── Transport hooks (subclass-owned) ────────────────────────────────

	/** Block until the transport can carry a request (connect / spawn offscreen).
	 *  Return void to signal "ready synchronously, no need to suspend". */
	protected abstract ensureTransportReady(): void | Promise<void>

	/** Wrap `content` in the transport envelope and put it on the wire. May
	 *  throw synchronously (sync Port send) or reject (async sendMessage) — the
	 *  core treats both as a send failure. */
	protected abstract sendEnvelope(content: unknown, methodName: string, requestId: number): void | Promise<void>

	/** Build the rejection value for a remote (service-side) error response. */
	protected abstract makeRemoteError(content: ResponseContentLike): unknown

	/** Build the rejection value for a hard timeout. */
	protected abstract makeTimeoutError(meta: RequestErrorMeta): unknown

	/** Build the rejection value when the wire send fails. */
	protected abstract makeSendFailureError(meta: RequestErrorMeta): unknown

	/** Build the rejection value for an explicit `disconnect()`. */
	protected abstract makeDisconnectError(): unknown

	/** Per-method timeout. Defaults to the constructor default; offscreen
	 *  overrides for long-running methods (e.g. proveTx). */
	protected getRequestTimeoutMs(_method: keyof TRequests): number {
		return this.defaultTimeoutMs
	}

	/** Terminal observability. Default no-op; the offscreen subclass records
	 *  telemetry. Always called exactly once per request. */
	protected onTerminal(_record: TerminalRecord): void {
		// no-op by default
	}

	// ── Logging ─────────────────────────────────────────────────────────

	protected logDebug(...data: unknown[]) {
		this.logger.log(this.clientName, LogLevel.Debug, ...data)
	}

	protected logInfo(...data: unknown[]) {
		this.logger.log(this.clientName, LogLevel.Info, ...data)
	}

	protected logWarn(...data: unknown[]) {
		this.logger.log(this.clientName, LogLevel.Warn, ...data)
	}

	protected logError(...data: unknown[]) {
		this.logger.log(this.clientName, LogLevel.Error, ...data)
	}
}
