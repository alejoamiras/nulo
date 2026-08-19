import { isSubframeSender, validateContentScriptMessage } from "./content-script-validator"

/**
 * Cold-wake message relay: the SINGLE `chrome.runtime.onMessage` listener for
 * content-script wallet-sdk traffic.
 *
 * MV3: when a content-script `chrome.runtime.sendMessage` WAKES a dead service
 * worker, the event is dispatched the moment the SW's top level has executed —
 * only listeners registered synchronously at module scope receive it. The SDK
 * handler's listener attaches at the tail of `runtime.start()` (after
 * migrations, config/BB init, `services.start()`), so the waking message used
 * to be dropped. `registerContentMessageRelay()` is called synchronously from
 * the SW entry module; `attachContentListener()` is called by the transport's
 * `addContentListener` once the SDK handler exists — buffered messages flush
 * FIFO through the SAME validated path live messages take.
 *
 * Single-listener ownership is load-bearing: a second listener alongside the
 * SDK-attached one would double-deliver, and a duplicate discovery's
 * coalesce→reject path DELETES the entry its twin legitimately queued, while a
 * duplicate secure-message would double-journal a sendTx. The transport must
 * therefore attach here instead of registering its own chrome listener.
 *
 * Drain is keyed on ATTACH, never on `runtime.start()`'s promise — the
 * `started` flag is set before any await and never reset on failure, so that
 * promise can resolve before (or without) the handler ever attaching. If boot
 * never reaches attachment the bounded buffer dies with the unusable worker.
 *
 * Pre-attach admission is deliberately STRICTER than the live path: only a
 * validated, top-frame `discovery-request` may occupy a buffer slot.
 * Discovery is the one message type that is both stateless at the handler and
 * worth replaying (every other type is gated on in-memory session state that
 * did not survive the SW death anyway), and content scripts run in ALL frames
 * on ALL origins — without admission control, rejected iframe/malformed/flood
 * traffic could fill the buffer during the boot window and starve a different
 * tab's legitimate cold-wake discovery. Caps mirror the F-04 posture
 * (reject-new, never evict). Flushed messages re-run the live path's
 * validation at attach — harmlessly, the checks are pure.
 */

/** Mirrors background.ts's build-time iframe-dApps escape hatch (F-001). */
const NULO_ALLOW_IFRAME_DAPPS: boolean = import.meta.env?.VITE_NULO_ALLOW_IFRAME_DAPPS === "1"

export const CONTENT_RELAY_GLOBAL_CAP = 32
export const CONTENT_RELAY_PER_ORIGIN_CAP = 4
/** Aligned with DISCOVERY_STALE_MS: the SDK stamps `discovery.timestamp` at
 *  FLUSH time, so relay residence would otherwise silently extend the B-16
 *  freshness window past the dApp's own 60s local timeout. */
export const CONTENT_RELAY_MAX_AGE_MS = 55_000

type ContentListener = (message: unknown, sender: chrome.runtime.MessageSender) => void

interface BufferedMessage {
	message: unknown
	sender: chrome.runtime.MessageSender
	origin: string
	receivedAt: number
}

let attached: ContentListener | undefined
let buffered: BufferedMessage[] = []
let registered = false

const senderOrigin = (sender: chrome.runtime.MessageSender): string => sender.origin ?? sender.url ?? "unknown"

/**
 * Register the relay's chrome listener. MUST be called synchronously at the SW
 * entry module's top level, before any await — and is deliberately logger-free
 * so a failure elsewhere in entry-module construction cannot precede it.
 */
export function registerContentMessageRelay(): void {
	if (registered) return
	registered = true
	// biome-ignore lint/suspicious/noExplicitAny: Chrome message listener provides untyped messages
	chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender) => {
		// Cheap discriminator: only content-script envelopes belong to this
		// relay (mirrors the SDK's own `origin` field). Everything else —
		// toolbar-popup messages, ServiceClient traffic — is untouched.
		if (message?.origin !== "content-script") return undefined

		if (attached) {
			attached(message, sender)
			return undefined
		}

		// Pre-attach admission (stricter than live — see module doc).
		if (NULO_ALLOW_IFRAME_DAPPS !== true && isSubframeSender(sender)) return undefined
		if (validateContentScriptMessage(message).kind === "invalid") return undefined
		if (message?.type !== "discovery-request") return undefined
		if (buffered.length >= CONTENT_RELAY_GLOBAL_CAP) {
			console.warn("[content-message-relay] pre-boot buffer full — dropping discovery (reject-new)")
			return undefined
		}
		const origin = senderOrigin(sender)
		if (buffered.filter((b) => b.origin === origin).length >= CONTENT_RELAY_PER_ORIGIN_CAP) {
			console.warn(`[content-message-relay] pre-boot per-origin cap hit for ${origin} — dropping discovery (reject-new)`)
			return undefined
		}
		buffered.push({ message, sender, origin, receivedAt: Date.now() })
		return undefined
	})
}

/**
 * Attach the real listener (the transport's validated wrapper) and flush the
 * buffer FIFO through it, exactly once per message. Re-attach is idempotent
 * replacement (the newest listener wins). The buffer is snapshotted and
 * cleared BEFORE the callbacks run, so a synchronous throw cannot replay
 * already-delivered entries.
 */
export function attachContentListener(listener: ContentListener): void {
	attached = listener
	const flush = buffered
	buffered = []
	const now = Date.now()
	for (const entry of flush) {
		if (now - entry.receivedAt > CONTENT_RELAY_MAX_AGE_MS) {
			console.warn("[content-message-relay] dropping stale pre-boot discovery (older than the freshness window)")
			continue
		}
		listener(entry.message, entry.sender)
	}
}
