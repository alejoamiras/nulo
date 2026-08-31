import type { ILogger } from "@nulo/wallet-core/logger"
import { getRandomHex } from "@nulo/wallet-core/utils"
import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"
import { BaseServiceClient, type RequestErrorMeta, type TerminalRecord } from "../core/base-client"
import { summarizeMessage } from "../core/envelope-summary"
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
 * Correlation, timeout, terminal cleanup, and typed-error construction live in
 * `BaseServiceClient`; this subclass owns the offscreen routing (uid +
 * from/to), readiness, telemetry, and its error-message wording.
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
			this.logWarn("Invalid message received", summarizeMessage(message))
			return
		}
		if (message.type === MessageType.Response) {
			this.handleResponse(message.content)
		} else {
			const { event, payload } = message.content
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

	/** One-call `onReady` bypass for {@link requestAlreadyReady}. Consumed
	 *  SYNCHRONOUSLY: `request()` invokes `ensureTransportReady()` in the same
	 *  call stack before its first await, so the flag can never remain set when
	 *  a concurrent ordinary request runs — those always take `onReady`. */
	private bypassReadyOnce = false

	/**
	 * PROTECTED, deliberately narrow: send a request WITHOUT running `onReady`
	 * first, for a caller that has ALREADY awaited readiness and must not allow
	 * a second readiness pass (which can recreate the offscreen document and
	 * reset its in-memory state) between an authority check and the wire. Full
	 * request machinery — correlation, readiness-inclusive deadline,
	 * serialization, telemetry, send-error settlement — is reused unchanged.
	 * Never expose publicly: a generic readiness bypass would let arbitrary
	 * calls race the transport.
	 */
	protected requestAlreadyReady<T extends keyof TRequests>(
		method: T,
		...params: Parameters<TRequests[T]>
	): Promise<Awaited<ReturnType<TRequests[T]>>> {
		this.bypassReadyOnce = true
		return super.request(method, ...params)
	}

	// ── Transport hooks ─────────────────────────────────────────────────

	// Deliberately NOT async: the consumed bypass must return `void` — not a
	// resolved Promise — so the correlator's `if (ready) await …` never
	// suspends and the request runs synchronously to the wire send with zero
	// microtask gap between the caller's authority check and `sendMessage`
	// (the gap is exactly where an offscreen recreation could land).
	protected ensureTransportReady(): void | Promise<void> {
		if (!this.connected) this.connect()
		if (this.bypassReadyOnce) {
			this.bypassReadyOnce = false
			return
		}
		return this.onReady()
	}

	protected async sendEnvelope(content: unknown): Promise<void> {
		await chrome.runtime.sendMessage({ type: MessageType.Request, content, from: this.uid, to: this.service })
	}

	// Typed error construction lives in `BaseServiceClient`; only the wording is
	// transport-specific. Rejections that reach a connected dApp via
	// prove/simulate are mapped to a stable response.error in `error-envelope.ts`.
	protected timeoutMessage(meta: RequestErrorMeta): string {
		return `Offscreen request timed out: ${meta.methodName}`
	}

	protected sendFailureMessage(meta: RequestErrorMeta): string {
		return `Offscreen send failed: ${meta.methodName}`
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
