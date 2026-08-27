/**
 * Allowlisted descriptions of transport envelopes, for logging.
 *
 * An envelope carries the method's PARAMS and its RESULT — `unlockProfile(id, password)`,
 * `importMnemonic(name, words, password)`, whatever `exportMnemonic()` returns. The malformed
 * -request and unmatched-response paths log at Warn, which is above the level filter, so logging
 * an envelope whole puts plaintext key material into the log store on an ordinary timeout.
 *
 * These rebuild a fixed shape from known-safe fields rather than filtering out known-bad ones, so
 * a field added to an envelope later cannot silently become loggable. Everything kept here is
 * correlation metadata: ids, names, arities, presence booleans — never a value.
 */

/** Envelope strings are attacker-influenced; keep them correlatable but bounded. */
const MAX_LABEL_CHARS = 80

function label(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined
	return value.length > MAX_LABEL_CHARS ? `${value.slice(0, MAX_LABEL_CHARS - 1)}…` : value
}

/** Describe a request/response `content` block: ids and names, never `params`/`result`. */
export function summarizeContent(content: unknown): Record<string, unknown> {
	if (typeof content !== "object" || content === null) {
		return { contentShape: content === null ? "null" : typeof content }
	}
	const c = content as Record<string, unknown>
	const out: Record<string, unknown> = {}

	if (typeof c.requestId === "number") out.requestId = c.requestId
	else if ("requestId" in c) out.requestId = `[${typeof c.requestId}]`

	const method = label(c.method)
	if (method !== undefined) out.method = method
	else if ("method" in c) out.method = `[${typeof c.method}]`

	const event = label(c.event)
	if (event !== undefined) out.event = event

	// Arity is the diagnostically useful part of `params`; the values are the leak.
	if ("params" in c) out.paramCount = Array.isArray(c.params) ? c.params.length : `[${typeof c.params}]`
	if ("payload" in c) out.hasPayload = true
	if ("result" in c) out.hasResult = c.result !== undefined
	if ("error" in c) out.hasError = c.error !== undefined
	if ("errorPayload" in c) out.hasErrorPayload = c.errorPayload !== undefined

	return out
}

/** Describe a whole wire message, including its nested `content`. */
export function summarizeMessage(message: unknown): Record<string, unknown> {
	if (typeof message !== "object" || message === null) {
		return { messageShape: message === null ? "null" : typeof message }
	}
	const m = message as Record<string, unknown>
	const out: Record<string, unknown> = {}

	if (typeof m.type === "string" || typeof m.type === "number") out.type = m.type
	else if ("type" in m) out.type = `[${typeof m.type}]`

	const from = label(m.from)
	if (from !== undefined) out.from = from

	if ("content" in m) out.content = summarizeContent(m.content)

	return out
}
