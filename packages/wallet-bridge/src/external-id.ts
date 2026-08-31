import { METHOD_REGISTRY } from "./method-descriptors"

/**
 * Correlation tokens for ids that came from the PAGE.
 *
 * `requestId` is supplied by the dApp, and upstream reuses it VERBATIM as the `sessionId`. The
 * content-script validator accepts `sessionId: z.string().optional()` with no shape constraint and
 * deliberately leaves discovery `content` unvalidated, because per-type validation is upstream's
 * job. So a hostile page can put its full URL — or any text at all — where a correlation id
 * belongs, and any log line echoing one is an open channel.
 *
 * A SHAPE check is not enough, which is the trap this module exists to avoid: a valid v4 UUID still
 * carries ~122 attacker-chosen bits, and a secret can simply be spread across several requests. So
 * nothing the page supplied is ever echoed. Instead each distinct external id is mapped to a
 * locally-minted token, which gives the same thing the id was being logged for — "these lines are
 * the same session" — while carrying no page-chosen data at all.
 */

/**
 * Bound on tracked ids. A hostile page can mint unlimited distinct ids, so this map must not grow
 * without limit; on overflow the table resets and correlation simply restarts, which degrades
 * diagnosis rather than memory.
 */
const MAX_TRACKED_IDS = 512

const tokens = new Map<string, string>()
let nextToken = 1

export function describeExternalId(value: unknown): string {
	if (typeof value !== "string") return `[${typeof value}]`
	if (value.length === 0) return "[empty-id]"

	const existing = tokens.get(value)
	if (existing !== undefined) return existing

	if (tokens.size >= MAX_TRACKED_IDS) {
		// Clear the table but NEVER rewind the counter. Old log lines survive in the store's buffer,
		// so reusing `ext-1` would make two unrelated sessions read as the same one — and a hostile
		// page can force exactly that by minting enough ids to trigger the overflow.
		tokens.clear()
	}
	const token = `ext-${nextToken++}`
	tokens.set(value, token)
	return token
}

/** Test seam — the token table is process-global and would otherwise leak across cases. */
export function resetExternalIdTokensForTest(): void {
	tokens.clear()
	nextToken = 1
}

/**
 * A wire method name, safe to log.
 *
 * `message.type` comes from the DECRYPTED dApp payload and is not runtime-validated before it
 * reaches these log lines — and the unsupported-method branch is trivially reachable, so a hostile
 * dApp can put its URL or any text where a method name belongs. A name is echoed only when it is
 * one the dispatcher actually registers; anything else is, by definition, not a method.
 */
export function describeWireMethod(value: unknown, registry: Record<string, unknown> = METHOD_REGISTRY): string {
	if (typeof value !== "string") return `[${typeof value}]`
	return Object.hasOwn(registry, value) ? value : "[unsupported-method]"
}
