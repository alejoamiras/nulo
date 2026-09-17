import type { ILogger } from "@nulo/wallet-core/logger"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"
import { BaseServiceClient, type RequestErrorMeta } from "../core/base-client"
import { summarizeMessage } from "../core/envelope-summary"
import { RpcConnectError } from "../errors"
import { MessageType, type EventMessage, type ResponseMessage } from "../messages"

/** Default upper bound on any RPC request. Individual calls can override.
 *
 *  30s was too tight: PXE-backed views (getGasBalances, simulateTx on
 *  a cold PXE, etc.) routinely run past that on local networks and a
 *  freshly-unlocked wallet. The timeout exists to catch a wedged SW, not
 *  to police slow-but-healthy calls — 60s gives real work room to finish
 *  while still surfacing a hang. */
export const DEFAULT_RPC_TIMEOUT_MS = 60_000

/** Warn (don't fail) when a request has been pending unusually long. */
const WARN_AFTER_MS = 10_000

/**
 * Popup ↔ service-worker client over a long-lived `chrome.runtime.Port`.
 * Correlation, timeout, and terminal cleanup live in `BaseServiceClient`; this
 * subclass owns the Port lifecycle (connect / reconnect / disconnect) and the
 * typed-error shaping.
 */
export abstract class ServiceClient<
	TRequests extends MethodsMap,
	TEvents extends EventsMap = Record<string, never>,
> extends BaseServiceClient<TRequests, TEvents> {
	public onConnected: EventHandler<void> = new EventHandler()
	public onDisconnected: EventHandler<void> = new EventHandler()

	/** onConnected/onDisconnected are local lifecycle signals — never wire
	 *  events. Reserve them so a forged event message can't invoke them. */
	protected override readonly reservedEventNames: ReadonlySet<string> = new Set(["onConnected", "onDisconnected"])

	private state: ClientState = ClientState.Disconnected
	private port?: chrome.runtime.Port

	protected constructor(service: string, logger: ILogger, name?: string, options?: { requestTimeoutMs?: number }) {
		super(service, logger, name, { defaultTimeoutMs: options?.requestTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS, warnAfterMs: WARN_AFTER_MS })
	}

	/**
	 * Opens the port if it is closed. Never rejects for a failed open: most callers do not await
	 * this, so the failure is logged where it happens and reported by the request that needs the port.
	 */
	public async connect(): Promise<void> {
		try {
			this.openPort()
		} catch (error) {
			if (!(error instanceof RpcConnectError)) throw error
		}
	}

	/**
	 * Opens the port synchronously or throws `RpcConnectError`. A synchronous throw from
	 * `chrome.runtime.connect` is treated as permanent — the known ones are (the extension context is
	 * gone) — so nothing retries: an asleep worker never throws, it is woken, and a missing peer
	 * surfaces later as `onDisconnect`.
	 */
	private openPort(): void {
		if (this.state !== ClientState.Disconnected) return
		let port: chrome.runtime.Port
		try {
			port = chrome.runtime.connect(undefined, { name: this.service })
		} catch (cause) {
			const error = new RpcConnectError(this.service, cause)
			this.logError("Failed to connect", error)
			throw error
		}
		this.port = port
		port.onDisconnect.addListener(this.onDisconnect)
		port.onMessage.addListener(this.onMessage)
		this.state = ClientState.Connected
		this.logDebug("Connected")
		this.onConnected.invoke()
	}

	public disconnect() {
		this.state = ClientState.Disconnecting
		if (this.port) {
			this.port.onMessage.removeListener(this.onMessage)
			this.port.onDisconnect.removeListener(this.onDisconnect)
			this.port.disconnect()
			this.port = undefined
		}
		this.rejectAllPending(() => this.makeDisconnectError(), "disconnected", "client_disconnect")
		this.state = ClientState.Disconnected
		this.logDebug("Disconnected")
		this.onDisconnected.invoke()
	}

	private readonly onDisconnect = () => {
		this.disconnect()
		void this.connect()
	}

	private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
		if (!message || (message.type !== MessageType.Response && message.type !== MessageType.Event) || !message.content) {
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

	// ── Transport hooks ─────────────────────────────────────────────────

	/** Synchronous by design: returning void keeps the request running straight through to the Port
	 *  send with no intervening microtask. A failed open throws and rejects that request. */
	protected ensureTransportReady(): void {
		this.openPort()
	}

	protected sendEnvelope(content: unknown): void {
		// AUDIT A5: capture the connected port locally so a concurrent
		// onDisconnect (which sets `this.port = undefined` via `disconnect()`)
		// can't turn this `postMessage` into a null deref. A throw here (port
		// torn down) is caught by the core and surfaced as a send failure.
		const port = this.port
		if (!port) throw new Error("port reference cleared between connect and send")
		port.postMessage({ type: MessageType.Request, content })
	}

	protected timeoutMessage(meta: RequestErrorMeta): string {
		return `RPC '${meta.methodName}' timed out after ${meta.timeoutMs}ms`
	}

	protected sendFailureMessage(meta: RequestErrorMeta): string {
		return `RPC '${meta.methodName}' aborted: port disconnected`
	}

	// ── Convenience RPCs ────────────────────────────────────────────────

	public async backup(): Promise<unknown> {
		return this.request("backup" as keyof TRequests, ...([] as unknown as Parameters<TRequests[keyof TRequests]>))
	}

	public async restore(..._args: unknown[]): Promise<unknown> {
		return this.request("restore" as keyof TRequests, ...(_args as unknown as Parameters<TRequests[keyof TRequests]>))
	}
}

enum ClientState {
	Connected,
	Disconnecting,
	Disconnected,
}
