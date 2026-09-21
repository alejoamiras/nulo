/**
 * The reply for a session this background does not know.
 *
 * Sessions live only in the background's memory, so a restart forgets every one while the page's
 * SDK still holds its channel: its heartbeat and its calls would be dropped in silence, and the
 * dApp waits out its own 300 s ceiling. `session-disconnected` is the one message a peer with no
 * shared key can still act on — the content script closes the port it holds for that id and the
 * page's SDK rejects every in-flight call at once. So a message that presupposes an established
 * session and names one the handler lacks is answered with it, to the tab the browser says it came
 * from, instead of being forwarded to a handler that would only drop it.
 */
import { type BackgroundMessage, MessageOrigin } from "@aztec/wallet-sdk/extension/handlers"
import type { ContentScriptMessageEnvelope } from "./content-script-validator"

/** `InternalMessageType.SESSION_DISCONNECTED`; the SDK's package entry does not export the enum. */
export const SESSION_DISCONNECTED = "session-disconnected"

/** The content-script types that exist only for an established session. */
const SESSION_BOUND_TYPES: ReadonlySet<ContentScriptMessageEnvelope["type"]> = new Set(["ping", "secure-message"])

export type StaleSessionVerdict = "forward" | { disconnectTab: number; sessionId: string }

/**
 * Decide whether a validated content-script envelope names a dead session. `tabId` is the
 * browser's `sender.tab.id`, never anything the envelope carries; `sessionKnown` answers for the
 * handler that exists right now, and is asked only for a session-bound type that names a session.
 */
export function staleSessionVerdict(
	envelope: ContentScriptMessageEnvelope,
	tabId: number | undefined,
	sessionKnown: (sessionId: string) => boolean,
): StaleSessionVerdict {
	if (!SESSION_BOUND_TYPES.has(envelope.type)) return "forward"
	const { sessionId } = envelope
	if (typeof sessionId !== "string" || typeof tabId !== "number") return "forward"
	return sessionKnown(sessionId) ? "forward" : { disconnectTab: tabId, sessionId }
}

/**
 * Whether `handler` holds `sessionId` — and "yes" while there is no handler at all: the boot window
 * is nobody's to disconnect, so it forwards as it always has.
 */
export function sessionKnownTo(handler: { getSession(sessionId: string): unknown } | undefined, sessionId: string): boolean {
	return handler === undefined || handler.getSession(sessionId) !== undefined
}

/** The wire shape the SDK's own `terminateSession` sends, so the content script treats both alike. */
export function sessionDisconnectedMessage(sessionId: string): BackgroundMessage {
	return { origin: MessageOrigin.BACKGROUND, type: SESSION_DISCONNECTED, sessionId }
}
