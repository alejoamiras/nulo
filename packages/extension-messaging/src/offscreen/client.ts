import type { ILogger } from "@nulo/wallet-core/logger"
import { getRandomHex } from "@nulo/wallet-core/utils"
import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"
import { BaseServiceClient, type RequestErrorMeta, type ResponseContentLike, type TerminalRecord } from "../core/base-client"
import { MessageType } from "../messages"
import type { EventMessage, ResponseMessage } from "./messages"
import { type RequestTelemetry, type TelemetrySink, LoggingTelemetrySink } from "./telemetry"

/**
 * Default offscreen request timeout (ms). Sane ceiling for most RPC calls.
 *
 * Long-running methods (`proveTx` in particular) override this via the
 * `getRequestTimeoutMs(method)` hook on the subclass — proving can take
 * many minutes on slow hardware, and `cancelJob` handles mid-flight
 * cancellation (lossy: SW transitions to `cancelled`; offscreen keeps running
 * but its result is dropped), so the timeout no longer acts as the cancel
 * mechanism.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 90_000

/**
 * SW ↔ offscreen-document client over one-shot `chrome.runtime.sendMessage`.
 * Correlation, timeout, and terminal cleanup live in `BaseServiceClient`; this
 * subclass owns the offscreen routing (uid + from/to), readiness, telemetry,
 * and the (currently string-shaped) error contract.
 */
export abstract class ServiceClient<
	TRequests extends MethodsMap,
	TEvents extends EventsMap = Record<string, never>,
> extends BaseServiceClient<TRequests, TEvents> {
	private readonly uid: string
	private readonly telemetry: TelemetrySink
	private connected = false

	protected constructor(service: string, logger: ILogger, name?: string, telemetry?: TelemetrySink) {
		super(service, logger, name, { defaultTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS })
		this.uid = getRandomHex(8)
		// Default to LoggingTelemetrySink so production offscreen clients emit
		// observable terminal-status events without each caller wiring a sink.
		// Tests pass MemoryTelemetrySink / NoopTelemetrySink explicitly.
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
		this.rejectAllPending(() => this.makeDisconnectError(), "disconnected", "client_disconnect")
		this.logDebug("Disconnected")
	}

	private readonly onMessageListener = (message: ResponseMessage<TRequests> | EventMessage<TEvents>): boolean => {
		if (!message) return false
		if (message.to === this.uid || (message.type === MessageType.Event && message.from === this.service && message.to === undefined)) {
			this.onMessage(message) // fire and forget
		}
		return false
	}

	private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
		if (
			!message ||
			(message.type !== MessageType.Response && message.type !== MessageType.Event) ||
			message.from !== this.service ||
			!message.content
		) {
			this.logWarn("Invalid message received", message)
			return
		}
		if (message.type === MessageType.Response) {
			this.handleResponse(message.content)
		} else {
			const { event, payload } = message.content
			this.logDebug("Event received", event, payload)
			this.handleEvent(event, payload)
		}
	}

	/**
	 * Overridable hook called before every request. Subclasses ensure the
	 * transport they depend on is live (e.g. `await ensureOffscreenRunning()`).
	 * Default is a no-op so test doubles don't need to stub it.
	 */
	protected async onReady(): Promise<void> {
		// no-op by default
	}

	// ── Transport hooks ─────────────────────────────────────────────────

	protected async ensureTransportReady(): Promise<void> {
		if (!this.connected) this.connect()
		await this.onReady()
	}

	protected async sendEnvelope(content: unknown): Promise<void> {
		await chrome.runtime.sendMessage({ type: MessageType.Request, content, from: this.uid, to: this.service })
	}

	// Error shaping is intentionally string-valued — the current offscreen
	// contract. The string→typed flip is a later, localized change to these
	// four hooks only.
	protected makeRemoteError(content: ResponseContentLike): unknown {
		return content.error
	}

	protected makeTimeoutError(meta: RequestErrorMeta): unknown {
		return `Offscreen request timed out: ${meta.methodName}`
	}

	protected makeSendFailureError(meta: RequestErrorMeta): unknown {
		return `Offscreen send failed: ${meta.methodName}`
	}

	protected makeDisconnectError(): unknown {
		return "Client disconnected"
	}

	protected onTerminal(record: TerminalRecord): void {
		try {
			this.telemetry.recordTerminal({
				method: record.method,
				requestId: record.requestId,
				startedAtMs: record.startedAtMs,
				endedAtMs: record.endedAtMs,
				status: record.status,
				detail: record.detail as RequestTelemetry["detail"],
			})
		} catch (err) {
			// Sink errors must NEVER affect the request lifecycle.
			this.logError("Telemetry sink threw; swallowing", err)
		}
	}
}
