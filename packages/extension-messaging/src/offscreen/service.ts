import { type ILogger, LogLevel } from "@nulo/wallet-core/logger"
import { sleep } from "@nulo/wallet-core/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { jsonSanitize, jsonStringify } from "@nulo/wallet-core/utils"
import type { EventsMap, MethodsMap, MethodsSpec, IService, EventsSpec, ServiceCollection } from "@nulo/wallet-core/base"
import { MessageType } from "../messages"
import { unwrapParams } from "../utils"
import type { EventMessage, RequestMessage, ResponseMessage } from "./messages"

/** Send keepalive pings every 20s to prevent Chrome from killing the
 *  service worker. The specific payload is just a magic string — any
 *  message traffic resets Chrome's SW idle timer. */
const KEEPALIVE_MESSAGE = "OFFSCREEN_KEEPALIVE"
const KEEPALIVE_INTERVAL_MS = 20_000

export abstract class Service<TRequests extends MethodsMap, TEvents extends EventsMap = {}> implements IService {
	public readonly name: string
	private readonly logger: ILogger
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
		chrome.runtime.onMessage.addListener(this.onMessageListener)
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

	private readonly onMessageListener = (message: RequestMessage<TRequests>): boolean => {
		if (message.to === this.name) {
			this.onMessage(message) // fire and forget
		}
		return false
	}

	private readonly onMessage = async (message: RequestMessage<TRequests>) => {
		if (message?.type !== MessageType.Request || !message.from || !message.content) {
			this.logWarn("Invalid message received", message)
			return
		}
		const { requestId, method, params: wrappedParams } = message.content
		if (!requestId || !(method in this.requests) || typeof wrappedParams !== "object") {
			this.logWarn("Invalid request received", message)
			return
		}
		const params = unwrapParams(wrappedParams)
		this.logDebug("Request received", requestId, method, params)

		// Keep the service worker alive during long operations (PXE proof gen, etc.).
		// Chrome kills idle SWs after 30s — sending any message resets that timer.
		const keepalive = setInterval(() => {
			chrome.runtime.sendMessage(KEEPALIVE_MESSAGE).catch(() => {})
		}, KEEPALIVE_INTERVAL_MS)

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
				from: this.name,
				to: message.from,
			}
		} catch (error) {
			const errorMessage = getErrorMessage(error)
			this.logDebug("Request failed", requestId, errorMessage)
			response = {
				type: MessageType.Response,
				content: {
					requestId,
					error: errorMessage,
				},
				from: this.name,
				to: message.from,
			}
		} finally {
			clearInterval(keepalive)
		}
		try {
			await chrome.runtime.sendMessage(response)
			this.logDebug("Response sent", response)
		} catch (error) {
			// Two distinct failure modes here:
			//   (a) SW dead → re-send won't help; client timeout fires.
			//   (b) DataCloneError → result has a shape structured-clone
			//       refused. Retry once with `jsonStringify` (BigInt /
			//       Buffer / Map / Set / Error aware) + `resultIsJson` flag
			//       so the client transparently `JSON.parse`s. AUDIT plan A6.
			//
			// The error message is the only signal we have to distinguish
			// the two without browser-specific instanceof checks; both
			// branches are safe to attempt because (a) just throws again.
			if (response.content.result !== undefined) {
				try {
					const stringifiedResult = jsonStringify(response.content.result)
					const fallback: ResponseMessage<TRequests> = {
						type: MessageType.Response,
						content: {
							...response.content,
							result: stringifiedResult as ResponseMessage<TRequests>["content"]["result"],
							resultIsJson: true,
						},
						from: this.name,
						to: message.from,
					}
					await chrome.runtime.sendMessage(fallback)
					this.logWarn(
						"sendMessage fell back to jsonStringify",
						`requestId=${response.content.requestId}`,
						`originalError=${getErrorMessage(error)}`,
					)
					return
				} catch {
					// Either jsonStringify itself failed or SW is dead.
					// Fall through to the legacy swallow.
				}
			}
			// Legacy: SW likely dead; client-side timeout will reject.
		}
	}

	protected emit<T extends keyof TEvents>(event: T, payload: TEvents[T]) {
		const message: EventMessage<TEvents> = {
			type: MessageType.Event,
			content: {
				event,
				payload: jsonSanitize(payload),
			},
			from: this.name,
		}
		chrome.runtime.sendMessage(message).catch(() => {
			// Service worker is dead — event is lost.
		})
		this.events[event].invoke(payload)
		this.logDebug("Event sent", message)
	}

	protected async ensureInitialized() {
		if (this.initialized) {
			return
		}
		let restMs = 30_000
		while (!this.initialized && restMs > 0) {
			await sleep(500)
			restMs -= 500
		}
		if (!this.initialized) {
			throw new Error("Service not initialized")
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
