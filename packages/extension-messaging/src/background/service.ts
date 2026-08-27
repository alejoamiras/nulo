import type { ILogger } from "@nulo/wallet-core/logger"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"
import { BaseService } from "../core/base-service"
import { isTrustedInternalSender } from "../core/sender-auth"
import { summarizeMessage } from "../core/envelope-summary"
import type { ResponseContentLike } from "../core/base-client"
import { MessageType, type EventMessage, type RequestMessage } from "../messages"

/**
 * Popup ↔ service-worker server over `chrome.runtime.Port`. The request
 * lifecycle (validation, RPC-surface guard, invoke, error projection, 3-tier
 * send, init) lives in `BaseService`; this subclass owns the Port fan-out.
 */
export abstract class Service<TRequests extends MethodsMap, TEvents extends EventsMap = Record<string, never>> extends BaseService<
	TRequests,
	TEvents,
	chrome.runtime.Port
> {
	private readonly clients: chrome.runtime.Port[] = []

	/** backup/restore are base-level convenience RPCs the Port ServiceClient
	 *  exposes; every Port service may answer them (default null, often
	 *  overridden — full-backup import drives `restore` across many services). */
	protected override readonly frameworkRpcMethods: ReadonlySet<string> = new Set(["backup", "restore"])

	protected constructor(name: string, logger: ILogger) {
		super(name, logger)
		// After super() + this class's field initializers, so `this.onConnect`
		// (an arrow-function field) exists when we register it.
		this.subscribe()
	}

	protected subscribe(): void {
		chrome.runtime.onConnect.addListener(this.onConnect)
	}

	private readonly onConnect = (client: chrome.runtime.Port) => {
		if (client.name !== this.name) {
			return
		}
		// F-09: reject Ports opened by anything other than a same-extension
		// SW / popup / offscreen context (foreign extension id, or a tab-bound
		// content-script sender).
		if (!isTrustedInternalSender(client.sender)) {
			this.logWarn(`Rejected Port from untrusted sender (id=${client.sender?.id ?? "?"})`)
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

	private readonly onMessage = (message: RequestMessage<TRequests>, client: chrome.runtime.Port) => {
		if (message?.type !== MessageType.Request || !message.content) {
			this.logWarn("Invalid message received", summarizeMessage(message, this.isRegisteredName))
			return
		}
		void this.handleRequest(message.content, client)
	}

	// ── Transport seams ─────────────────────────────────────────────────

	protected wrapResponse(content: ResponseContentLike): unknown {
		return { type: MessageType.Response, content }
	}

	protected rawSend(message: unknown, client: chrome.runtime.Port): void {
		client.postMessage(message)
	}

	protected sendEvent(content: { event: keyof TEvents; payload: TEvents[keyof TEvents] }): void {
		const message: EventMessage<TEvents> = { type: MessageType.Event, content } as EventMessage<TEvents>
		for (const client of this.clients) {
			try {
				client.postMessage(message)
			} catch (error) {
				if (this.clients.includes(client)) this.logError("Failed to send event", getErrorMessage(error))
			}
		}
	}

	protected onSendDropped(error: unknown, client: chrome.runtime.Port): void {
		if (this.clients.includes(client)) this.logError("Failed to send message", getErrorMessage(error))
	}

	// Overridable convenience defaults (subclasses may override).
	public async backup(): Promise<unknown> {
		return null
	}

	public async restore(..._args: unknown[]): Promise<unknown> {
		return null
	}
}
