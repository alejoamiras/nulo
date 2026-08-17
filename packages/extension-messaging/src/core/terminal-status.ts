/**
 * The terminal status of a request's lifecycle, owned by the transport-agnostic
 * `core/` layer. Q-06: this used to live in `offscreen/telemetry.ts`, forcing
 * `core/base-client.ts` (which settles every pending request with one of these)
 * to import UP into a specific transport's leaf module — a layering inversion.
 * It lives here so `core/` owns it and transports (offscreen telemetry) import
 * it DOWN. A third transport wanting terminal telemetry no longer has to fork or
 * grow an offscreen-owned type.
 */
export type RequestTerminalStatus =
	| "success"
	| "rejected"
	| "timeout"
	| "disconnected"
	/**
	 * Synchronous failure of `chrome.runtime.sendMessage(...)` —
	 * typically because the offscreen document is gone or transitioning.
	 * The request never reached the offscreen handler; the client cleaned
	 * up state synchronously and rejected the caller's promise.
	 */
	| "send_failed"
