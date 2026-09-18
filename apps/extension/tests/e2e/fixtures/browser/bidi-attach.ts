import puppeteer, { type Browser } from "puppeteer"
import type { SessionCapabilities } from "./webdriver-classic"

/**
 * Attach Puppeteer to a BiDi session geckodriver already owns.
 *
 * `puppeteer.connect` opens by sending `session.new`, and Firefox answers a second one with
 * "Maximum number of active sessions" — the classic session holds the only slot. The transport
 * therefore answers `session.new` locally with the session geckodriver handed us and `session.end`
 * with an empty result (ending the session is the classic channel's job, and doing it here would
 * pull the floor out from under the still-open HTTP channel). Everything else is forwarded
 * untouched, so Puppeteer sees an ordinary BiDi peer.
 */
export async function attachPuppeteerOverBiDi(capabilities: SessionCapabilities, sessionId: string): Promise<Browser> {
	const transport = await openShimmedTransport(capabilities, sessionId)
	return puppeteer.connect({ transport, protocol: "webDriverBiDi" })
}

interface ShimTransport {
	send(message: string): void
	close(): void
	onmessage?: (message: string) => void
	onclose?: () => void
}

function openShimmedTransport(capabilities: SessionCapabilities, sessionId: string): Promise<ShimTransport> {
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
		ws.onmessage = (event: MessageEvent) => transport.onmessage?.(String(event.data))
		ws.onclose = () => transport.onclose?.()
		ws.onopen = () => resolve(transport)
		ws.onerror = () => reject(new Error(`BiDi socket ${capabilities.webSocketUrl} failed to open`))
	})
}
