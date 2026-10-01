// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
import type { ILogger } from "@nulo/wallet-core/logger"
import type { EventsMap, MethodsMap } from "@nulo/wallet-core/base"
import { BaseService } from "../core/base-service"
import { isBackgroundSender } from "../core/sender-auth"
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
		if (typeof message === "object" && message !== null && message.to === this.name) {
			void this.admit(message, sender)
		}
		return false
	}

	/** Only the wallet's BACKGROUND context may drive the offscreen: a request from any other
	 *  same-extension page (a compromised popup) that carries a victim's `{from, requestId}` would
	 *  otherwise have the genuine offscreen settle the victim's pending call with a reflected
	 *  response. Foreign extensions and tab-bound senders are out by the same test. Async because
	 *  the manifest lookup behind the check is (a Chrome offscreen document must fetch it). */
	private async admit(message: RequestMessage<TRequests>, sender: chrome.runtime.MessageSender): Promise<void> {
		if (await isBackgroundSender(sender)) this.onMessage(message)
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
