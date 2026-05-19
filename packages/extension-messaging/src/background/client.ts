import { type ILogger, LogLevel } from "@nulo/wallet-core/logger"
import { sleep } from "@nulo/wallet-core/utils"
import { EventHandler } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { jsonSanitize } from "@nulo/wallet-core/utils"
import type { EventsMap, EventsSpec, MethodsMap } from "@nulo/wallet-core/base"
import { RpcDisconnectedError, RpcTimeoutError, walletErrorFromPayload } from "../errors"
import { MessageType, type EventMessage, type RequestMessage, type ResponseMessage } from "../messages"
import { wrapParams } from "../utils"

/** Default upper bound on any RPC request. Individual calls can override.
 *
 *  30s was too tight: PXE-backed views (getGasBalances, simulateTx on
 *  a cold PXE, etc.) routinely run past that on local networks and a
 *  freshly-unlocked wallet. The timeout exists to catch a wedged SW, not
 *  to police slow-but-healthy calls — 60s gives real work room to finish
 *  while still surfacing a hang. */
export const DEFAULT_RPC_TIMEOUT_MS = 60_000

/** Stored per-request resolver set. The timeout handle is cleared on terminal state. */
type PendingRequest = {
	resolve: (result: unknown) => void
	reject: (error: unknown) => void
	timeoutHandle?: ReturnType<typeof setTimeout>
}

export abstract class ServiceClient<TRequests extends MethodsMap, TEvents extends EventsMap = Record<string, never>> {
	public onConnected: EventHandler<void> = new EventHandler()
	public onDisconnected: EventHandler<void> = new EventHandler()

	private readonly name: string
	private readonly service: string
	private readonly logger: ILogger
	private readonly defaultTimeoutMs: number

	private state: ClientState = ClientState.Disconnected
	private readonly requests: Map<number, PendingRequest> = new Map()
	private nextRequestId = 1
	private port?: chrome.runtime.Port

	protected constructor(service: string, logger: ILogger, name?: string, options?: { requestTimeoutMs?: number }) {
		this.name = name ?? `${service}-client`
		this.service = service
		this.logger = logger
		this.defaultTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
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
		if (this.requests.size) {
			this.requests.forEach((entry) => {
				if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle)
				entry.reject(new Error("Client disconnected"))
			})
			this.requests.clear()
		}
		this.state = ClientState.Disconnected
		this.logDebug("Disconnected")
		this.onDisconnected.invoke()
	}

	private readonly onDisconnect = () => {
		this.disconnect()
		this.connect()
	}

	private readonly onMessage = (message: ResponseMessage<TRequests> | EventMessage<TEvents>) => {
		if ((message?.type !== MessageType.Response && message.type !== MessageType.Event) || !message.content) {
			this.logWarn("Invalid message received", message)
			return
		}
		if (message.type === MessageType.Response) {
			const { requestId, result, error, errorPayload, resultIsJson } = message.content
			const entry = this.requests.get(requestId)
			if (!entry) {
				this.logWarn("Invalid response received", message.content)
				return
			}
			if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle)
			this.requests.delete(requestId)
			if (error !== undefined || errorPayload !== undefined) {
				// Structured payload takes precedence so `instanceof WalletError`
				// (and subclass) checks work on the client. Fall back to a plain
				// Error when the service threw something that wasn't a WalletError.
				const rejection = errorPayload ? walletErrorFromPayload(errorPayload) : new Error(error ?? "Unknown error")
				entry.reject(rejection)
				this.logDebug("Request rejected", message.content)
			} else {
				// AUDIT plan A6 fallback: when the service's structured-clone
				// path failed and it retried with `jsonStringify`, `result` is
				// a JSON string. Parse it here so callers get the same shape
				// they would have on the success path. Safe regardless of
				// content because both paths produce plain JSON-safe values
				// (the success path because `jsonSanitize` runs upstream).
				const parsed = resultIsJson && typeof result === "string" ? (JSON.parse(result) as typeof result) : result
				entry.resolve(parsed)
				this.logDebug("Request resolved", message.content)
			}
			this.logDebug("Pending requests", this.requests.size)
		} else {
			const { event, payload } = message.content
			this.logDebug("Event received", event, payload)
			;(this as EventsSpec<TEvents>)[event].invoke(payload)
		}
	}

	protected async request<T extends keyof TRequests>(
		method: T,
		...params: Parameters<TRequests[T]>
	): Promise<Awaited<ReturnType<TRequests[T]>>> {
		while (this.state !== ClientState.Connected) {
			if (this.state === ClientState.Disconnected) {
				this.connect()
				continue
			}
			await sleep(300)
		}
		// AUDIT A5 fix: capture the connected port to a local reference so a
		// concurrent `onDisconnect` (which sets `this.port = undefined` via
		// `disconnect()`) can't turn the upcoming `postMessage` into a null
		// deref. The `while`-loop exits with state=Connected, but state can
		// flip between the loop and the `postMessage` below; the captured
		// reference is what we send through, and the null-check covers the
		// rare microtask-ordered race where disconnect ran before the local
		// capture saw a non-undefined `this.port`.
		const connectedPort = this.port
		const requestId = this.getRequestId()
		const request: RequestMessage<TRequests> = {
			type: MessageType.Request,
			content: {
				requestId,
				method: method,
				params: jsonSanitize(wrapParams(params)) as Parameters<TRequests[T]>,
			},
		}

		const methodName = String(method)
		const timeoutMs = this.defaultTimeoutMs
		const start = Date.now()
		this.logDebug(`→ ${methodName}`)

		const warnTimer = setTimeout(() => {
			this.logWarn(`Request pending >10s: ${methodName} (id: ${requestId})`)
		}, 10_000)

		const promise = new Promise<Awaited<ReturnType<TRequests[T]>>>((resolve, reject) => {
			// Hard timeout — rejects the pending request with a typed error so
			// callers can distinguish "the service worker is wedged" from
			// "the service worker replied with an error". Clears itself on
			// terminal state (response / disconnect).
			const timeoutHandle = setTimeout(() => {
				const entry = this.requests.get(requestId)
				if (!entry) return
				this.requests.delete(requestId)
				entry.reject(new RpcTimeoutError(`RPC '${methodName}' timed out after ${timeoutMs}ms`, { requestId, methodName }))
				this.logWarn(`Request timed out: ${methodName} (id: ${requestId}, ${timeoutMs}ms)`)
			}, timeoutMs)

			this.requests.set(requestId, {
				resolve: resolve as (result: unknown) => void,
				reject,
				timeoutHandle,
			})
		})

		// Two failure modes the legacy `port!.postMessage(request)` couldn't
		// distinguish from a hang: (a) the local port reference is undefined
		// because disconnect raced us, (b) postMessage throws synchronously
		// because the port was already torn down. Both reject with a typed
		// `RpcDisconnectedError` so callers can retry without conflating
		// with service-side failures.
		const fail = (cause?: unknown) => {
			const entry = this.requests.get(requestId)
			if (!entry) return
			if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle)
			this.requests.delete(requestId)
			entry.reject(
				new RpcDisconnectedError(`RPC '${methodName}' aborted: port disconnected`, {
					requestId,
					methodName,
					cause: cause === undefined ? undefined : String(cause),
				}),
			)
		}

		if (!connectedPort) {
			fail("port reference cleared between connect and send")
		} else {
			try {
				connectedPort.postMessage(request)
			} catch (error) {
				fail(error)
			}
		}

		return promise.finally(() => {
			clearTimeout(warnTimer)
			this.logDebug(`← ${methodName} (${Date.now() - start}ms)`)
		})
	}

	private getRequestId() {
		return this.nextRequestId++
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
