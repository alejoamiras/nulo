/**
 * Allowlisted descriptions of transport envelopes, for logging.
 *
 * An envelope carries the method's PARAMS and its RESULT — `unlockProfile(id, password)`,
 * `importMnemonic(name, words, password)`, whatever `exportMnemonic()` returns. The malformed
 * -request and unmatched-response paths log at Warn, which is above the level filter, so logging
 * an envelope whole puts plaintext key material into the log store on an ordinary timeout.
 *
 * These rebuild a fixed shape from known-safe fields rather than filtering out known-bad ones, so
 * a field added to an envelope later cannot silently become loggable.
 *
 * The subtlety: on these paths the envelope is MALFORMED and therefore attacker-shaped, so even
 * "just the method name" is untrusted — a hostile sender can put a password in it. A string is
 * echoed only when the caller vouches that it is a registered name; otherwise it is reduced to its
 * length. Everything else kept here is correlation metadata: ids, arities, presence booleans.
 */

/** Caller-supplied predicate confirming a string is a registered name, not attacker text. */
export type NameVouch = (value: string) => boolean

function describeString(value: unknown, vouch?: NameVouch): string {
	if (typeof value !== "string") return `[${typeof value}]`
	// Vouched names are the whole diagnostic value of these lines; unvouched ones are hostile input.
	return vouch?.(value) ? value : `[unregistered:${value.length}]`
}

/**
 * Arity of a params payload.
 *
 * The wire shape is `wrapParams`' `{ n, 0, 1, … }`, NOT an array — reading `.length` here would
 * report `[object]` for every real request. Arrays are still handled for pre-wrap callers.
 */
function describeArity(params: unknown): number | string {
	if (Array.isArray(params)) return params.length
	if (typeof params === "object" && params !== null) {
		const n = (params as { n?: unknown }).n
		if (typeof n === "number" && Number.isInteger(n) && n >= 0) return n
	}
	return `[${typeof params}]`
}

function summarizeContentUnsafe(content: unknown, vouch?: NameVouch): Record<string, unknown> {
	if (typeof content !== "object" || content === null) {
		return { contentShape: content === null ? "null" : typeof content }
	}
	const c = content as Record<string, unknown>
	const out: Record<string, unknown> = {}

	if (typeof c.requestId === "number") out.requestId = c.requestId
	else if ("requestId" in c) out.requestId = `[${typeof c.requestId}]`

	if ("method" in c) out.method = describeString(c.method, vouch)
	if ("event" in c) out.event = describeString(c.event, vouch)

	if ("params" in c) out.paramCount = describeArity(c.params)
	if ("payload" in c) out.hasPayload = true
	if ("result" in c) out.hasResult = c.result !== undefined
	if ("error" in c) out.hasError = c.error !== undefined
	if ("errorPayload" in c) out.hasErrorPayload = c.errorPayload !== undefined

	return out
}

function summarizeMessageUnsafe(message: unknown, vouch?: NameVouch): Record<string, unknown> {
	if (typeof message !== "object" || message === null) {
		return { messageShape: message === null ? "null" : typeof message }
	}
	const m = message as Record<string, unknown>
	const out: Record<string, unknown> = {}

	if (typeof m.type === "string") out.type = describeString(m.type, vouch)
	else if (typeof m.type === "number") out.type = m.type
	else if ("type" in m) out.type = `[${typeof m.type}]`

	if ("from" in m) out.from = describeString(m.from, vouch)
	if ("content" in m) out.content = summarizeContentUnsafe(m.content, vouch)

	return out
}

/**
 * Summarising must never throw.
 *
 * These run on the malformed-request path, where the very next statement sends the client a clean
 * error response. A hostile object with a throwing getter would otherwise take the whole handler
 * down and leave the caller waiting for a reply that never comes — turning a log-hygiene helper
 * into a denial of service.
 */
function guard(build: () => Record<string, unknown>): Record<string, unknown> {
	try {
		return build()
	} catch {
		return { summaryFailed: true }
	}
}

/** Describe a request/response `content` block: ids and vouched names, never `params`/`result`. */
export function summarizeContent(content: unknown, vouch?: NameVouch): Record<string, unknown> {
	return guard(() => summarizeContentUnsafe(content, vouch))
}

/** Describe a whole wire message, including its nested `content`. */
export function summarizeMessage(message: unknown, vouch?: NameVouch): Record<string, unknown> {
	return guard(() => summarizeMessageUnsafe(message, vouch))
}
