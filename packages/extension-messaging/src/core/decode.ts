/**
 * Success-path result decode shared by both transport clients.
 *
 * When the service's structured-clone send failed and it retried with
 * `jsonStringify` (setting `resultIsJson`), `result` is a JSON string. Parse
 * it back so callers get the same shape they would on the happy path. Safe
 * regardless of content: both the happy path (via `jsonSanitize` upstream) and
 * the fallback path produce plain JSON-safe values.
 *
 * Only touches the SUCCESS `result`. Error decode (errorPayload vs flat string)
 * is transport-specific and lives in the client correlator's per-transport
 * error-shaping hook, NOT here.
 */
export function decodeResult<T>(result: T, resultIsJson?: boolean): T {
	return resultIsJson && typeof result === "string" ? (JSON.parse(result) as T) : result
}
