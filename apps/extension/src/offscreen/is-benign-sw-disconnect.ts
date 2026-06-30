/**
 * True iff `reason` is the canonical "Client disconnected" Error thrown
 * by `extension-messaging/src/background/client.ts:80` when the SW port
 * closes and pending RPCs are rejected en-masse.
 *
 * Used by the offscreen's `onunhandledrejection` handler to suppress
 * the noisy cascade on SW restart while still surfacing real errors.
 *
 * Background:
 *   The offscreen hosts `ProfileServiceClient` + `LoggerServiceClient`
 *   (see `offscreen/index.ts:41-42`). Both are background-port clients.
 *   When the SW dies, each pending RPC rejects with this message.
 *   Most callers are fire-and-forget (notably the console-sniffer
 *   calling `logger.log(...)`); they don't attach .catch handlers,
 *   so the rejections fire `onunhandledrejection` — 14× per boot
 *   under realistic load. The rejection IS expected; the noise is
 *   the only problem.
 *
 * Extracted as a tiny named predicate so the filter is unit-testable
 * (the actual `onunhandledrejection` event is hard to simulate cleanly
 * in vitest/jsdom).
 */
export function isBenignSwDisconnect(reason: unknown): boolean {
	return reason instanceof Error && reason.message === "Client disconnected"
}
