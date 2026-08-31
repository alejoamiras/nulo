import type { ILogger } from "@nulo/wallet-core/logger"
import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"
import { BaseService } from "../core/base-service"
import { isTrustedInternalSender } from "../core/sender-auth"
import { summarizeMessage } from "../core/envelope-summary"
import type { ResponseContentLike } from "../core/base-client"
import { MessageType } from "../messages"
import type { EventMessage, RequestMessage } from "./messages"

/** Send keepalive pings every 20s to prevent Chrome from killing the service
 *  worker during long operations (PXE proof gen, etc.). Any message traffic
 *  resets Chrome's SW idle timer; the payload is just a magic string. */
const KEEPALIVE_MESSAGE = "OFFSCREEN_KEEPALIVE"
const KEEPALIVE_INTERVAL_MS = 20_000

/**
 * SW ↔ offscreen-document server over `chrome.runtime.sendMessage`. The request
 * lifecycle lives in `BaseService`; this subclass owns the from/to routing and
 * the per-request keepalive. The send context (`TCtx`) is the requester's
 * address (the request's `from`).
 */
export abstract class Service<TRequests extends MethodsMap, TEvents extends EventsMap = Record<string, never>> extends BaseService<
	TRequests,
	TEvents,
	string
> {
	protected constructor(name: string, logger: ILogger) {
		super(name, logger)
		// After super() + this class's field initializers, so `this.onMessageListener`
		// (an arrow-function field) exists when we register it.
		this.subscribe()
	}

	protected subscribe(): void {
		chrome.runtime.onMessage.addListener(this.onMessageListener)
	}

	private readonly onMessageListener = (message: RequestMessage<TRequests>, sender: chrome.runtime.MessageSender): boolean => {
		// F-09: only same-extension SW / popup / offscreen senders may drive the
		// offscreen listener — reject foreign extensions and any tab-bound sender.
		if (!isTrustedInternalSender(sender)) return false
		if (typeof message === "object" && message !== null && message.to === this.name) {
			this.onMessage(message) // fire and forget
		}
		return false
	}

	private readonly onMessage = (message: RequestMessage<TRequests>) => {
		if (message?.type !== MessageType.Request || !message.from || !message.content) {
			this.logWarn("Invalid message received", summarizeMessage(message, this.isRegisteredName))
			return
		}
		void this.handleRequest(message.content, message.from)
	}

	// ── Transport seams ─────────────────────────────────────────────────

	protected wrapResponse(content: ResponseContentLike, to: string): unknown {
		return { type: MessageType.Response, content, from: this.name, to }
	}

	protected async rawSend(message: unknown): Promise<void> {
		await chrome.runtime.sendMessage(message)
	}

	protected sendEvent(content: { event: keyof TEvents; payload: TEvents[keyof TEvents] }): void {
		const message: EventMessage<TEvents> = { type: MessageType.Event, content, from: this.name } as EventMessage<TEvents>
		chrome.runtime.sendMessage(message).catch(() => {
			// Service worker is dead — event is lost.
		})
	}

	protected beforeInvoke(): () => void {
		// Keep the service worker alive during long operations. Chrome kills idle
		// SWs after ~30s — sending any message resets that timer.
		const keepalive = setInterval(() => {
			chrome.runtime.sendMessage(KEEPALIVE_MESSAGE).catch(() => {})
		}, KEEPALIVE_INTERVAL_MS)
		return () => clearInterval(keepalive)
	}
}
