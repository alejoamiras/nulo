/**
 * Correlation ids that came from the PAGE, described safely for logging.
 *
 * `requestId` is supplied by the dApp, and upstream reuses it VERBATIM as the `sessionId`. The
 * content-script validator accepts `sessionId: z.string().optional()` with no shape constraint and
 * deliberately leaves discovery `content` unvalidated, because per-type validation is upstream's
 * job. So a hostile page can put its full URL — or any text at all — where a correlation id
 * belongs, and any log line echoing one is an open channel.
 *
 * Substituting these ids for dApp origins in log lines therefore does NOT close the leak on its
 * own; it only closes it for ids that actually look like what the protocol generates. Everything
 * else collapses to a length, which still distinguishes "absent" from "present but malformed"
 * without writing the value down.
 */

/** The shape the wallet-sdk protocol generates for request/session ids. */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function describeExternalId(value: unknown): string {
	if (typeof value !== "string") return `[${typeof value}]`
	return UUID_LIKE.test(value) ? value : `[malformed-id:${value.length}]`
}
