import type { ILogger } from "@nulo/wallet-core/logger"
import { sleep } from "@nulo/wallet-core/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"
import { BaseServiceClient, type RequestErrorMeta, type ResponseContentLike } from "../core/base-client"
import { RpcDisconnectedError, RpcTimeoutError, walletErrorFromPayload } from "../errors"
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

	public async connect() {
		if (this.state !== ClientState.Disconnected) {
			return
		}
		this.state = ClientState.Connecting
		while (this.state === ClientState.Connecting) {
			try {
				this.port = chrome.runtime.connect(undefined, { name: this.service })
				this.port.onDisconnect.addListener(this.onDisconnect)
				this.port.onMessage.addListener(this.onMessage)
				this.state = ClientState.Connected
				this.logDebug("Connected")
				this.onConnected.invoke()
				return
			} catch (error) {
				this.logError("Failed to connect", getErrorMessage(error))
				await sleep(1000)
			}
		}
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
		this.connect()
	}

	private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
		if (!message || (message.type !== MessageType.Response && message.type !== MessageType.Event) || !message.content) {
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

	// ── Transport hooks ─────────────────────────────────────────────────

	protected ensureTransportReady(): void | Promise<void> {
		// `connect()` runs synchronously in the common case — `chrome.runtime.connect`
		// returns a Port immediately; the only `await` inside `connect()` is the
		// retry-after-failure path. So kick it off and, if it brought us to
		// Connected without suspending, return void so the request runs straight
		// through to the synchronous Port send with no intervening microtask
		// (preserving the Port transport's long-standing synchronous-send timing).
		if (this.state === ClientState.Disconnected) void this.connect()
		if (this.state === ClientState.Connected) return
		return this.waitForConnection()
	}

	private async waitForConnection(): Promise<void> {
		while (this.state !== ClientState.Connected) {
			if (this.state === ClientState.Disconnected) {
				void this.connect()
				continue
			}
			await sleep(300)
		}
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

	protected makeRemoteError(content: ResponseContentLike): unknown {
		// Structured payload takes precedence so `instanceof WalletError` (and
		// subclass) checks work on the client. Fall back to a plain Error when
		// the service threw something that wasn't a WalletError.
		return content.errorPayload
			? walletErrorFromPayload(content.errorPayload as Parameters<typeof walletErrorFromPayload>[0])
			: new Error(content.error ?? "Unknown error")
	}

	protected makeTimeoutError(meta: RequestErrorMeta): unknown {
		return new RpcTimeoutError(`RPC '${meta.methodName}' timed out after ${meta.timeoutMs}ms`, {
			requestId: meta.requestId,
			methodName: meta.methodName,
		})
	}

	protected makeSendFailureError(meta: RequestErrorMeta): unknown {
		return new RpcDisconnectedError(`RPC '${meta.methodName}' aborted: port disconnected`, {
			requestId: meta.requestId,
			methodName: meta.methodName,
			cause: meta.cause === undefined ? undefined : String(meta.cause),
		})
	}

	protected makeDisconnectError(): unknown {
		return new Error("Client disconnected")
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
	Connecting,
	Connected,
	Disconnecting,
	Disconnected,
}
