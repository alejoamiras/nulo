import { type ILogger, LogLevel } from "@nulo/wallet-core/logger"
import { getRandomHex } from "@nulo/wallet-core/utils"
import { jsonSanitize } from "@nulo/wallet-core/utils"
import { MessageType } from "../messages"
import type { EventsMap, EventsSpec, MethodsMap } from "@nulo/wallet-core/base"
import type { EventMessage, RequestMessage, ResponseMessage } from "./messages"
import { type RequestTelemetry, type TelemetrySink, LoggingTelemetrySink } from "./telemetry"
import { wrapParams } from "../utils"

/**
 * Default offscreen request timeout (ms). Sane ceiling for most RPC calls.
 *
 * Long-running methods (`proveTx` in particular) override this via the
 * `getRequestTimeoutMs(method)` hook on the subclass — proving can take
 * many minutes on slow hardware, and Phase 2's `cancelJob` handles
 * mid-flight cancellation (lossy: SW transitions to `cancelled`; offscreen
 * keeps running but its result is dropped), so the timeout no longer acts
 * as the cancel mechanism.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 90_000

/** Per-request metadata for telemetry. Sidecar map, in-memory only.
 *  Pure observability — no rehydration / recovery across SW restart. */
interface PendingMeta {
	method: string
	startedAtMs: number
}

export abstract class ServiceClient<TRequests extends MethodsMap, TEvents extends EventsMap = Record<string, never>> {
	private readonly uid: string
	private readonly name: string
	private readonly service: string
	private readonly logger: ILogger
	private readonly telemetry: TelemetrySink

	private readonly requests: Map<number, [(result: unknown) => void, (error: string) => void]> = new Map()
	private readonly requestTimers: Map<number, ReturnType<typeof setTimeout>> = new Map()
	private readonly pendingMeta: Map<number, PendingMeta> = new Map()
	private nextRequestId = 1
	private connected = false

	protected constructor(service: string, logger: ILogger, name?: string, telemetry?: TelemetrySink) {
		this.uid = getRandomHex(8)
		this.name = name ?? `${service}-client`
		this.service = service
		this.logger = logger
		// Default to LoggingTelemetrySink so production offscreen clients
		// emit observable terminal-status events without each caller
		// wiring a sink. Tests pass MemoryTelemetrySink or NoopTelemetrySink
		// explicitly to override.
		this.telemetry = telemetry ?? new LoggingTelemetrySink(logger)
	}

	public connect() {
		if (this.connected) return
		chrome.runtime.onMessage.addListener(this.onMessageListener)
		this.connected = true
		this.logDebug("Connected")
	}

	public disconnect() {
		if (!this.connected) return
		this.connected = false
		chrome.runtime.onMessage.removeListener(this.onMessageListener)
		this.requestTimers.forEach((timer) => {
			clearTimeout(timer)
		})
		this.requestTimers.clear()
		if (this.requests.size) {
			const now = Date.now()
			this.requests.forEach(([_, reject], requestId) => {
				reject("Client disconnected")
				this.recordTerminal(requestId, now, "disconnected", "client_disconnect")
			})
			this.requests.clear()
		}
		this.pendingMeta.clear()
		this.logDebug("Disconnected")
	}

	private readonly onMessageListener = (message: ResponseMessage<TRequests> | EventMessage<TEvents>): boolean => {
		if (message.to === this.uid || (message.type === MessageType.Event && message.from === this.service && message.to === undefined)) {
			this.onMessage(message) // fire and forget
		}
		return false
	}

	private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
		if (
			(message?.type !== MessageType.Response && message.type !== MessageType.Event) ||
			message.from !== this.service ||
			!message.content
		) {
			this.logWarn("Invalid message received", message)
			return
		}
		if (message.type === MessageType.Response) {
			const { requestId, result, error, resultIsJson } = message.content
			const requestPromise = this.requests.get(requestId)
			if (!requestPromise) {
				// Late or duplicate response — the request was already
				// terminal (timeout / disconnect / earlier response).
				// Drop silently; do NOT emit telemetry (would double-count).
				this.logWarn("Invalid response received", message.content)
				return
			}
			const [resolve, reject] = requestPromise
			const endedAtMs = Date.now()
			if (error !== undefined) {
				reject(error)
				this.recordTerminal(requestId, endedAtMs, "rejected")
				this.logDebug("Request rejected", message.content)
			} else {
				// AUDIT plan A6 fallback: when the offscreen service's
				// structured-clone path failed and it retried with
				// `jsonStringify`, `result` is a JSON string. Parse it back
				// here so callers get the same shape they would on the
				// success path. Both paths produce plain JSON-safe values
				// (the success path via `jsonSanitize` upstream).
				const parsed = resultIsJson && typeof result === "string" ? (JSON.parse(result) as typeof result) : result
				resolve(parsed)
				this.recordTerminal(requestId, endedAtMs, "success")
				this.logDebug("Request resolved", message.content)
			}
			this.requests.delete(requestId)
			const timer = this.requestTimers.get(requestId)
			if (timer) {
				clearTimeout(timer)
				this.requestTimers.delete(requestId)
			}
			this.logDebug("Pending requests", this.requests.size)
		} else {
			const { event, payload } = message.content
			this.logDebug("Event received", event, payload)
			;(this as EventsSpec<TEvents>)[event].invoke(payload)
		}
	}

	/**
	 * Invokes the subclass `onReady()` hook before each request. The
	 * base class is transport-agnostic: concrete subclasses are
	 * responsible for bootstrapping the offscreen document (or
	 * whatever transport they use) inside their `onReady()`. Keeping
	 * this hook at the base ensures no subclass forgets to prepare
	 * the transport — they can't make a request without going through
	 * here.
	 */
	private async ensureReady(): Promise<void> {
		await this.onReady()
	}

	/**
	 * Overridable hook called before every request is sent. Subclasses
	 * should use this to ensure the transport they depend on is live
	 * (e.g. Chrome extensions: `await ensureOffscreenRunning()`). The
	 * default is a no-op so test doubles don't need to stub it.
	 */
	protected async onReady(): Promise<void> {
		// no-op by default
	}

	/**
	 * Overridable per-method timeout (ms). Subclasses with long-running
	 * methods (notably PXE's `proveTx`, where BB.wasm is uninterruptible
	 * and can run for many minutes on slow hardware) return a larger
	 * value for that method and fall through to `DEFAULT_REQUEST_TIMEOUT_MS`
	 * for everything else.
	 *
	 * Returned per-call (not cached) so subclasses can adjust based on
	 * runtime config if they ever need to.
	 */
	protected getRequestTimeoutMs(_method: keyof TRequests): number {
		return DEFAULT_REQUEST_TIMEOUT_MS
	}

	protected async request<T extends keyof TRequests>(
		method: T,
		...params: Parameters<TRequests[T]>
	): Promise<Awaited<ReturnType<TRequests[T]>>> {
		if (!this.connected) {
			this.connect()
		}
		await this.ensureReady()
		const requestId = this.getRequestId()
		const methodName = String(method)
		const startedAtMs = Date.now()
		const request: RequestMessage<TRequests> = {
			type: MessageType.Request,
			content: {
				requestId,
				method: method,
				params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
			},
			from: this.uid,
			to: this.service,
		}
		const timeoutMs = this.getRequestTimeoutMs(method)
		const promise = new Promise<Awaited<ReturnType<TRequests[T]>>>((resolve, reject) => {
			this.requests.set(requestId, [resolve as (result: unknown) => void, reject])
			this.pendingMeta.set(requestId, { method: methodName, startedAtMs })
			const timer = setTimeout(() => {
				if (this.requests.delete(requestId)) {
					this.requestTimers.delete(requestId)
					this.logError(`Request timed out after ${timeoutMs}ms: ${methodName}`)
					this.recordTerminal(requestId, Date.now(), "timeout", "timeout_fired")
					reject(`Offscreen request timed out: ${methodName}`)
				}
			}, timeoutMs)
			this.requestTimers.set(requestId, timer)
		})
		try {
			await chrome.runtime.sendMessage(request)
		} catch (err) {
			// send_failed: chrome.runtime.sendMessage rejected (typical
			// cause: offscreen document gone or transitioning). State was
			// set BEFORE the await, so clean up synchronously here.
			// Without this branch the request would hang for the full 90s
			// timeout.
			//
			// We reject the inner `promise` (which the caller awaits)
			// with a stable "Offscreen send failed: ${methodName}"
			// shape, keeping the error surface caller-visible distinct
			// from the 90s timeout. The original `err` is logged but
			// NOT re-thrown, because the inner promise is already
			// rejected with the message we want — re-throwing would
			// create an unhandled rejection on the inner promise.
			const requestPromise = this.requests.get(requestId)
			if (requestPromise) {
				const [, reject] = requestPromise
				this.requests.delete(requestId)
				const timer = this.requestTimers.get(requestId)
				if (timer) {
					clearTimeout(timer)
					this.requestTimers.delete(requestId)
				}
				this.recordTerminal(requestId, Date.now(), "send_failed", "sendMessage_threw")
				reject(`Offscreen send failed: ${methodName}`)
			}
			this.logError(`sendMessage threw for ${methodName}; cleaned up synchronously`, err)
			return promise
		}
		this.logDebug("Request sent", request)
		this.logDebug("Pending requests", this.requests.size)
		return promise
	}

	private getRequestId() {
		return this.nextRequestId++
	}

	/**
	 * Emit a single terminal-status telemetry record per request
	 * lifecycle. Pulls the per-request metadata from `pendingMeta` (set
	 * at request-time) and hands the record to the configured sink. The
	 * record is then removed from `pendingMeta` so a stale duplicate
	 * delivery (e.g. late response after timeout) cannot emit twice.
	 */
	private recordTerminal(
		requestId: number,
		endedAtMs: number,
		status: RequestTelemetry["status"],
		detail?: RequestTelemetry["detail"],
	): void {
		const meta = this.pendingMeta.get(requestId)
		if (!meta) return
		this.pendingMeta.delete(requestId)
		try {
			this.telemetry.recordTerminal({
				method: meta.method,
				requestId,
				startedAtMs: meta.startedAtMs,
				endedAtMs,
				status,
				detail,
			})
		} catch (err) {
			// Sink errors must NEVER affect the request lifecycle.
			this.logger.log(this.name, LogLevel.Error, "Telemetry sink threw; swallowing", err)
		}
	}

	protected logDebug(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Debug, ...data)
	}

	protected logInfo(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Info, ...data)
	}

	protected logWarn(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Warn, ...data)
	}

	protected logError(...data: unknown[]) {
		this.logger.log(this.name, LogLevel.Error, ...data)
	}
}
