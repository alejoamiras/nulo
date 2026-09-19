import puppeteer, { type Browser } from "puppeteer"
import type { SessionCapabilities } from "./webdriver-classic"

export interface BiDiAttachment {
	browser: Browser
	/** Top-level browsing contexts Puppeteer currently believes are open. */
	openContexts(): readonly string[]
	/** Tell Puppeteer a context is gone when Firefox did not. Idempotent. */
	reportClosed(contextId: string): void
}

/**
 * Attach Puppeteer to a BiDi session geckodriver already owns.
 *
 * `puppeteer.connect` opens by sending `session.new`, and Firefox answers a second one with
 * "Maximum number of active sessions" — the classic session holds the only slot. The transport
 * therefore answers `session.new` locally with the session geckodriver handed us and `session.end`
 * with an empty result (ending the session is the classic channel's job, and doing it here would
 * pull the floor out from under the still-open HTTP channel).
 *
 * It also lets the driver supply the one event Firefox omits: a window that closes ITSELF produces
 * no `browsingContext.contextDestroyed`, so Puppeteer would list it, and report its page open,
 * for the rest of the session. Everything else is forwarded untouched.
 */
export async function attachPuppeteerOverBiDi(capabilities: SessionCapabilities, sessionId: string): Promise<BiDiAttachment> {
	const open = new Set<string>()
	const closed = new Set<string>()
	const transport = await openShimmedTransport(capabilities, sessionId, (message) => trackContexts(message, open, closed))
	const browser = await puppeteer.connect({ transport, protocol: "webDriverBiDi" })
	return {
		browser,
		openContexts: () => [...open],
		reportClosed(contextId) {
			if (closed.has(contextId)) return
			closed.add(contextId)
			open.delete(contextId)
			transport.onmessage?.(
				JSON.stringify({
					type: "event",
					method: "browsingContext.contextDestroyed",
					params: {
						context: contextId,
						parent: null,
						url: "about:blank",
						children: [],
						userContext: "default",
						originalOpener: null,
					},
				}),
			)
		},
	}
}

interface ContextInfo {
	context: string
	parent?: string | null
}

interface IncomingMessage {
	method?: string
	params?: ContextInfo
	result?: { contexts?: ContextInfo[] }
}

/** Returns false for a message Puppeteer must not see: a real destroy arriving after ours. */
function trackContexts(raw: string, open: Set<string>, closed: Set<string>): boolean {
	// Cheap pre-filter: this runs on every frame, and almost none of them mention a context tree.
	if (!raw.includes("browsingContext.context") && !raw.includes('"contexts"')) return true
	const message = JSON.parse(raw) as IncomingMessage
	for (const info of message.result?.contexts ?? []) open.add(info.context)
	if (!message.params || message.params.parent) return true
	if (message.method === "browsingContext.contextCreated") open.add(message.params.context)
	if (message.method !== "browsingContext.contextDestroyed") return true
	open.delete(message.params.context)
	const alreadyReported = closed.has(message.params.context)
	closed.add(message.params.context)
	return !alreadyReported
}

interface ShimTransport {
	send(message: string): void
	close(): void
	onmessage?: (message: string) => void
	onclose?: () => void
}

function openShimmedTransport(
	capabilities: SessionCapabilities,
	sessionId: string,
	admit: (message: string) => boolean,
): Promise<ShimTransport> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(capabilities.webSocketUrl)
		const transport: ShimTransport = {
			send(message: string) {
				const { id, method } = JSON.parse(message) as { id: number; method: string }
				if (method !== "session.new" && method !== "session.end") {
					ws.send(message)
					return
				}
				const result = method === "session.new" ? { sessionId, capabilities } : {}
				// A reply cannot be delivered inside `send` — Puppeteer has not registered the
				// callback for this id yet.
				queueMicrotask(() => transport.onmessage?.(JSON.stringify({ type: "success", id, result })))
			},
			close: () => ws.close(),
		}
		ws.onmessage = (event: MessageEvent) => {
			const message = String(event.data)
			if (admit(message)) transport.onmessage?.(message)
		}
		ws.onclose = () => transport.onclose?.()
		const deadline = setTimeout(() => {
			ws.close()
			reject(new Error(`BiDi socket ${capabilities.webSocketUrl} did not open within 15s`))
		}, 15_000)
		ws.onopen = () => {
			clearTimeout(deadline)
			resolve(transport)
		}
		ws.onerror = () => {
			clearTimeout(deadline)
			reject(new Error(`BiDi socket ${capabilities.webSocketUrl} failed to open`))
		}
	})
}
