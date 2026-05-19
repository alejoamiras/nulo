/**
 * Content-script message envelope validator.
 *
 * Defense-in-depth at the SW seam where `chrome.runtime.onMessage`
 * delivers content-script-originated messages to the upstream
 * `@aztec/wallet-sdk` `BackgroundConnectionHandler`. The upstream
 * handler does its own type-switching, but adding a zod boundary
 * here drops adversarial / malformed envelopes early with a
 * structured debug log.
 *
 * Filter contract:
 *   - Messages with `origin: "content-script"` must match the
 *     `ContentScriptMessageSchema` shape (well-formed envelope,
 *     `type` is one of the upstream `InternalMessageType` values
 *     that content scripts are expected to send).
 *   - Messages with any other origin (e.g. ServiceClient responses,
 *     offscreen pings) are passed through untouched — the listener's
 *     receiver does its own filter on `origin === "background"` etc.
 *
 * NOT a security boundary on its own (the upstream handler also
 * filters), just a noise-reduction + invariant check that catches
 * malformed dispatches before they reach the upstream code.
 *
 * Pure function — no chrome.*, no globals. Tested directly with
 * synthetic payloads.
 */

import { z } from "zod"

/**
 * Content-script-originated message shapes the SW expects to receive.
 *
 * Mirrors `@aztec/wallet-sdk/extension/handlers.InternalMessageType`'s
 * content-script-to-background subset (DISCOVERY_REQUEST,
 * KEY_EXCHANGE_REQUEST, SECURE_MESSAGE, DISCONNECT_REQUEST). If the
 * upstream enum gains a new content-script→background message type,
 * extend this set.
 *
 * Background-to-content-script types (DISCOVERY_APPROVED,
 * KEY_EXCHANGE_RESPONSE, etc.) are NOT in this set — they appear with
 * `origin: "background"` and are filtered out by the origin check
 * before reaching the type validator.
 */
const CONTENT_SCRIPT_MESSAGE_TYPES = ["discovery-request", "key-exchange-request", "secure-message", "disconnect-request"] as const

const ContentScriptMessageSchema = z.object({
	origin: z.literal("content-script"),
	type: z.enum(CONTENT_SCRIPT_MESSAGE_TYPES),
	sessionId: z.string().optional(),
	// `content` is intentionally `unknown` — its shape varies by `type`
	// and the upstream handler does its own per-type validation. We
	// just verify the envelope is well-formed.
	content: z.unknown().optional(),
})

export type ContentScriptMessageEnvelope = z.infer<typeof ContentScriptMessageSchema>

export type ValidationResult =
	| { kind: "passthrough" } // not a content-script message; let other listeners handle
	| { kind: "valid"; message: ContentScriptMessageEnvelope }
	| { kind: "invalid"; reason: string; details?: unknown }

/**
 * Inspect an arbitrary chrome.runtime message and return one of:
 *   - `passthrough`: the message is NOT a content-script-originated
 *     envelope (it might be a ServiceClient response, offscreen ping,
 *     etc.). The caller should still forward it to other listeners.
 *   - `valid`: the message is a well-formed content-script envelope.
 *   - `invalid`: the message claims to be from content-script but
 *     fails the shape check. The caller should drop it.
 */
export function validateContentScriptMessage(message: unknown): ValidationResult {
	if (typeof message !== "object" || message === null) {
		return { kind: "passthrough" }
	}
	const origin = (message as { origin?: unknown }).origin
	if (origin !== "content-script") {
		return { kind: "passthrough" }
	}
	const parsed = ContentScriptMessageSchema.safeParse(message)
	if (!parsed.success) {
		return {
			kind: "invalid",
			reason: "ContentScriptMessage envelope failed schema check",
			details: parsed.error.issues,
		}
	}
	return { kind: "valid", message: parsed.data }
}
