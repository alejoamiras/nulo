/**
 * `chrome.runtime` abstracted. Covers:
 *  - one-shot message passing (content-script ↔ SW, SW ↔ offscreen)
 *  - long-lived ports (popup ↔ SW)
 *  - extension URL resolution
 *  - install lifecycle events
 *  - `lastError` readout inside callback-style APIs
 */

import type { Unsubscribe } from "./types"

/** Minimal `chrome.runtime.Port`-equivalent used by ServiceClient/Service bases. */
export interface MessagePortLike {
	name: string
	postMessage(message: unknown): void
	disconnect(): void
	onMessage(listener: (message: unknown) => void): Unsubscribe
	onDisconnect(listener: () => void): Unsubscribe
}

/** Sender metadata attached to incoming `onMessage` events. Subset we actually use. */
export interface MessageSender {
	id?: string
	origin?: string
	url?: string
	tab?: { id?: number; url?: string }
}

export type MessageListener = (message: unknown, sender: MessageSender) => Promise<unknown> | unknown

export interface RuntimePort {
	/** Send a one-shot message; resolves with the receiver's reply. */
	sendMessage(message: unknown): Promise<unknown>

	/** Subscribe to incoming one-shot messages. Return a value/promise to reply. */
	onMessage(listener: MessageListener): Unsubscribe

	/** Open a long-lived port keyed by `name`. Caller owns the port lifecycle. */
	connect(options: { name: string }): MessagePortLike

	/** Subscribe to inbound long-lived port connections. */
	onConnect(listener: (port: MessagePortLike) => void): Unsubscribe

	/** Resolve an extension-internal path to a `chrome-extension://` URL. */
	getURL(path: string): string

	/** Fired once per install / update / chrome_update / shared_module_update. */
	onInstalled(listener: (details: { reason: string; previousVersion?: string }) => void): Unsubscribe

	/**
	 * Readout of the most recent callback-style error. Adapters must expose the
	 * same "read inside callback" semantics as `chrome.runtime.lastError`.
	 */
	readonly lastError: { message: string } | undefined

	/** Set the URL opened when the user uninstalls the extension. */
	setUninstallURL(url: string): Promise<void>

	/**
	 * Offscreen supervision. Returns the list of active contexts matching the
	 * filter; used by `ensureOffscreenRunning()` to detect zombies.
	 * Optional because not all adapters need it (e.g. FakeBrowserApi).
	 */
	getContexts?(filter: {
		contextTypes?: string[]
		documentUrls?: string[]
	}): Promise<Array<{ contextId: string; contextType: string; documentUrl?: string }>>
}
