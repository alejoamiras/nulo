import { type ILogger, LogLevel } from "@nulo/wallet-core/logger"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { jsonSanitize, jsonStringify } from "@nulo/wallet-core/utils"
import type { EventsMap, MethodsMap, MethodsSpec, IService, EventsSpec, ServiceCollection } from "@nulo/wallet-core/base"
import { buildErrorResponseContent } from "../core/error-response"
import { awaitInitialized } from "../core/initialization"
import { ValidationError } from "../errors"
import { MessageType, type EventMessage, type RequestMessage, type ResponseMessage } from "../messages"
import { unwrapParams } from "../utils"

export abstract class Service<TRequests extends MethodsMap, TEvents extends EventsMap = {}> implements IService {
	public readonly name: string
	protected readonly logger: ILogger
	private readonly clients: chrome.runtime.Port[] = []
	private get events() {
		return this as unknown as EventsSpec<TEvents>
	}
	private get requests() {
		return this as unknown as MethodsSpec<TRequests>
	}
	private initialized = false

	protected constructor(name: string, logger: ILogger) {
		this.name = name
		this.logger = logger
		chrome.runtime.onConnect.addListener(this.onConnect)
		this.logDebug("Service created")
	}

	protected async init(_services: ServiceCollection): Promise<void> {
		// to be overridden in derived classes
	}

	public async start(services: ServiceCollection) {
		if (this.initialized) return
		await this.init(services)
		this.initialized = true
		this.logDebug("Service started")
	}

	private readonly onConnect = (client: chrome.runtime.Port) => {
		if (client.name !== this.name) {
			return
		}
		client.onDisconnect.addListener(this.onDisconnect)
		client.onMessage.addListener(this.onMessage)
		this.clients.push(client)
		this.logDebug(`Client connected. Total: ${this.clients.length}`)
	}

	private readonly onDisconnect = (client: chrome.runtime.Port) => {
		client.onDisconnect.removeListener(this.onDisconnect)
		client.onMessage.removeListener(this.onMessage)
		const index = this.clients.indexOf(client)
		if (index === -1) {
			this.logWarn("Unknown client disconnected")
			return
		}
		this.clients.splice(index, 1)
		this.logDebug(`Client disconnected. Total: ${this.clients.length}`)
	}

	private readonly onMessage = async (message: RequestMessage<TRequests>, client: chrome.runtime.Port) => {
		if (message?.type !== MessageType.Request || !message.content) {
			this.logWarn("Invalid message received", message)
			return
		}
		const { requestId, method, params: wrappedParams } = message.content
		if (!requestId || !(method in this.requests)) {
			this.logWarn("Invalid request received", message)
			return
		}
		if (typeof wrappedParams !== "object" || wrappedParams === null) {
			// Valid requestId + method but malformed params. Reply with a clean
			// error so the client rejects immediately instead of hanging until
			// its timeout (the prior `typeof null === "object"` let null through
			// and `unwrapParams(null)` threw — silent hang).
			this.logWarn("Invalid request params", message)
			this.send(
				{
					type: MessageType.Response,
					content: { requestId, ...buildErrorResponseContent(new ValidationError("Invalid request params")) },
				},
				client,
			)
			return
		}
		const params = unwrapParams(wrappedParams)
		this.logDebug("Request received", requestId, method, params)
		let response: ResponseMessage<TRequests>
		try {
			const result = await this.requests[method](...params)
			this.logDebug("Request processed", requestId, result)
			response = {
				type: MessageType.Response,
				content: {
					requestId,
					result: jsonSanitize(result),
				},
			}
		} catch (error) {
			this.logDebug("Request failed", requestId, getErrorMessage(error))
			response = {
				type: MessageType.Response,
				content: { requestId, ...buildErrorResponseContent(error) },
			}
		}
		this.send(response, client)
		this.logDebug("Response sent", response)
	}

	protected emit<T extends keyof TEvents>(event: T, payload: TEvents[T]) {
		const message: EventMessage<TEvents> = {
			type: MessageType.Event,
			content: {
				event,
				payload: jsonSanitize(payload),
			},
		}
		for (const client of this.clients) {
			this.send(message, client)
		}
		this.events[event].invoke(payload)
		this.logDebug("Event sent", message)
	}

	private send(message: unknown, client: chrome.runtime.Port) {
		try {
			client.postMessage(message)
		} catch (error) {
			// AUDIT plan A6 / Grego port-server.ts:46-88. Structured clone
			// rarely fails after `jsonSanitize` (responses + events are
			// already plain JSON-safe), but it CAN — circular refs in a
			// custom error's `details`, BigInts that escaped sanitization,
			// etc. Retry with `jsonStringify` (BigInt + Buffer + Map + Set
			// + Error aware) and let the client transparently `JSON.parse`
			// via the `resultIsJson` flag. If even that fails we fall back
			// to the legacy log-and-drop so the request times out cleanly
			// instead of hanging forever.
			const fallbackOk = this.trySendJsonFallback(message, client, error)
			if (!fallbackOk && this.clients.includes(client)) {
				this.logError("Failed to send message", getErrorMessage(error))
			}
		}
	}

	private trySendJsonFallback(message: unknown, client: chrome.runtime.Port, originalError: unknown): boolean {
		// Only response messages with a `result` field are eligible — events
		// and request envelopes carry no large user-domain data, and error
		// responses don't need the fallback (the error string already round-
		// trips fine through structured clone).
		if (typeof message !== "object" || message === null || (message as { type?: unknown }).type !== MessageType.Response) {
			return false
		}
		const response = message as ResponseMessage<TRequests>
		if (response.content.result === undefined) return false
		try {
			const stringifiedResult = jsonStringify(response.content.result)
			const fallback: ResponseMessage<TRequests> = {
				type: MessageType.Response,
				content: {
					...response.content,
					result: stringifiedResult as ResponseMessage<TRequests>["content"]["result"],
					resultIsJson: true,
				},
			}
			client.postMessage(fallback)
			this.logWarn(
				"postMessage fell back to jsonStringify",
				`requestId=${response.content.requestId}`,
				`originalError=${getErrorMessage(originalError)}`,
			)
			return true
		} catch (fallbackError) {
			// JSON.stringify itself failed (typically circular refs).
			// Send a structured error so the caller doesn't hang.
			try {
				const errResponse: ResponseMessage<TRequests> = {
					type: MessageType.Response,
					content: {
						...response.content,
						result: undefined as ResponseMessage<TRequests>["content"]["result"],
						error: `Response not serializable: ${getErrorMessage(fallbackError)}`,
					},
				}
				client.postMessage(errResponse)
				return true
			} catch {
				// Truly disconnected — caller's request timeout will fire.
				return false
			}
		}
	}

	protected async ensureInitialized() {
		await awaitInitialized(() => this.initialized)
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
		// can be overridden in derived classes if necessary
		return null
	}

	public async restore(..._args: unknown[]): Promise<unknown> {
		// can be overridden in derived classes if necessary
		return null
	}
}
