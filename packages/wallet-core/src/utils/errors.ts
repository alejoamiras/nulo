/**
 * Hostile-input-safe message extractor. ALWAYS returns a real string — for an
 * `Error` its `.message`, for a string itself, the literal `"null"`/`"undefined"`
 * for nullish, else `String(raw)`. Canonical semantics, identical to the former
 * `jobs/error.extractMessage` (whose tests pin `null`→`"null"` etc.). Used by the
 * durable-job error envelope (`jobs/error.normalizeError`).
 */
export function errorMessageFromUnknown(raw: unknown): string {
	if (raw instanceof Error) return raw.message
	if (typeof raw === "string") return raw
	if (raw === null) return "null"
	if (raw === undefined) return "undefined"
	return String(raw)
}

export const getErrorData = (error: unknown) => (error as Error)?.stack ?? getErrorMessage(error)

/**
 * Lenient RPC-wire / popup variant — DELIBERATELY NOT routed through
 * {@link errorMessageFromUnknown}. Its raw semantics are OBSERVABLE at
 * non-coercing sinks: the dApp wire JSON (extension-messaging
 * `core/error-response.ts` `buildErrorResponseContent`) and `LoggerStore`
 * (`logger/store.ts`). A pathological non-string throw (`42`, `{ message: 0 }`,
 * `{ nope: 1 }`) must reach those sinks as the SAME raw value it did pre-Q07, so
 * the pre-existing type-lie (typed `string`, can return a non-string at runtime)
 * is preserved verbatim and tracked for Q-01 (boundary decode), where the wire
 * field gets a real parser. Do NOT "fix" it here — that changes wire/log bytes.
 */
export const getErrorMessage = (error: unknown) => (error as Error)?.message ?? (error as string) ?? "Unknown error"
