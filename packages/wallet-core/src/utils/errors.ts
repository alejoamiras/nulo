/**
 * Hostile-input-safe message extractor. ALWAYS returns a real string — for an
 * `Error` its `.message`, for a string itself, the literal `"null"`/`"undefined"`
 * for nullish, else `String(raw)`. Canonical semantics, identical to the former
 * `jobs/error.extractMessage` (whose tests pin `null`→`"null"` etc.).
 */
export function errorMessageFromUnknown(raw: unknown): string {
	if (raw instanceof Error) return raw.message
	if (typeof raw === "string") return raw
	if (raw === null) return "null"
	if (raw === undefined) return "undefined"
	return String(raw)
}

/**
 * Lenient variant used at the RPC wire projection + popup display: nullish maps
 * to `"Unknown error"`, and a non-Error object's own `.message` is duck-typed out
 * (JSON-RPC / PXE plain-object throws like `{ code, message }`). Observably
 * identical to the pre-Q07 impl at every sink — but now genuinely typed `string`
 * (the old `(error as string)` cast could leak a non-string at runtime). The tail
 * delegates to {@link errorMessageFromUnknown}. Distinct from it by design: do NOT
 * collapse the two (see `utils/errors.test.ts` regression pins).
 */
export const getErrorMessage = (error: unknown): string => {
	if (error === null || error === undefined) return "Unknown error"
	if (typeof error === "object" && !(error instanceof Error)) {
		const m = (error as { message?: unknown }).message
		if (m !== null && m !== undefined) return typeof m === "string" ? m : String(m)
	}
	return errorMessageFromUnknown(error)
}

export const getErrorData = (error: unknown) => (error as Error)?.stack ?? getErrorMessage(error)
