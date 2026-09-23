/**
 * Offscreen `ServiceClient` telemetry surface.
 *
 * Pure observability — NOT durable recovery. Every request that the
 * client tracks emits exactly one terminal-status event. Callers wire
 * a `TelemetrySink` at construction; the default is
 * `LoggingTelemetrySink` so production builds get DevTools observability
 * for the offscreen relay without any caller-side wiring. Tests pass
 * `MemoryTelemetrySink` or `NoopTelemetrySink` explicitly to override.
 *
 * ## Data sensitivity (user-flagged)
 *
 * Telemetry events are SAFE METADATA only. The runtime path goes through
 * `sanitizeTelemetry()` before any sink hand-off:
 *
 *   ALLOWED:
 *     - method   (string, e.g. "getGasBalances") — already exposed as
 *       a service method name; not sensitive.
 *     - requestId (number) — internal correlation id; not sensitive.
 *     - startedAtMs / endedAtMs (epoch-ms) — timing only.
 *     - status (RequestTerminalStatus enum) — bounded set.
 *     - detail (string, optional) — sanitized into a STATIC error
 *       category. Untrusted error.message strings, stack traces, and
 *       payload bytes are NEVER passed through.
 *
 *   DISALLOWED (stripped):
 *     - request params, response data, error.message, error.stack, IDs
 *       that could correlate to user identity, network addresses,
 *       balances, encrypted blobs, etc.
 *
 * Sinks MUST call `sanitizeTelemetry()` before logging. The
 * `LoggingTelemetrySink` does this; production sinks must follow.
 */

import { type ILogger, LogLevel } from "@nulo/wallet-core/logger"
// Q-06: owned by core/ (transport-agnostic); this transport imports it DOWN.
import type { RequestTerminalStatus } from "../core/terminal-status"

export type { RequestTerminalStatus }

export interface RequestTelemetry {
	/** Service-method name (e.g. "getGasBalances"). Public RPC name; not
	 *  sensitive. */
	method: string
	/** Per-client correlation id. Not user-correlatable. */
	requestId: number
	/** Epoch-ms when the client began tracking the request. */
	startedAtMs: number
	/** Epoch-ms when the terminal status was reached. */
	endedAtMs: number
	/** Terminal status. */
	status: RequestTerminalStatus
	/** Optional sanitized detail (a STATIC short string — never an
	 *  attacker-influenced error.message). */
	detail?: string
}

/**
 * Strip any untrusted fields from a telemetry record. Production
 * sinks MUST call this before persisting / logging / forwarding.
 *
 * The sanitizer is permissive on the SHAPE (just guards against
 * accidental extra fields) but strict on the `detail` field — only
 * a known short whitelist of static categories is allowed; anything
 * else is dropped.
 */
const ALLOWED_DETAILS = new Set<string>([
	// send_failed family
	"sendMessage_threw",
	// disconnected family
	"client_disconnect",
	// timeout family
	"timeout_fired",
	// success / rejected — typically no detail; remote errors are
	// already structured by the service layer.
])

export function sanitizeTelemetry(t: RequestTelemetry): RequestTelemetry {
	const out: RequestTelemetry = {
		method: typeof t.method === "string" ? t.method : "unknown",
		requestId: typeof t.requestId === "number" ? t.requestId : -1,
		startedAtMs: typeof t.startedAtMs === "number" ? t.startedAtMs : 0,
		endedAtMs: typeof t.endedAtMs === "number" ? t.endedAtMs : 0,
		status: t.status,
	}
	if (t.detail !== undefined && ALLOWED_DETAILS.has(t.detail)) {
		out.detail = t.detail
	}
	return out
}

/**
 * Emit a single terminal-status record per request lifecycle.
 *
 * The interface is sync — sinks must not block the client on I/O.
 * A future async sink (e.g. push to a metrics endpoint) wraps an
 * internal queue; the synchronous facade stays.
 */
export interface TelemetrySink {
	recordTerminal(record: RequestTelemetry): void
}

/** Discards all telemetry. Explicit opt-out for tests / consumers that
 *  don't want observability emitted at construction. NOT the default —
 *  `LoggingTelemetrySink` is. */
export class NoopTelemetrySink implements TelemetrySink {
	public recordTerminal(_record: RequestTelemetry): void {
		// no-op
	}
}

/**
 * Logs the sanitized record via the wallet's `ILogger`. Default sink
 * for offscreen `ServiceClient` instances.
 *
 * ## Level by status
 *
 *   - `success` / `rejected`               → `LogLevel.Debug`
 *     Normal request flow; chatty (dozens per session). Hidden behind
 *     the default `Info` log filter.
 *   - `timeout` / `disconnected` /
 *     `send_failed`                        → `LogLevel.Info`
 *     Anomalies the user notices in DevTools without flipping the
 *     logger to Debug. Concerning enough to surface; not so loud they
 *     need to be `Warn`.
 *
 * `sanitizeTelemetry()` runs unconditionally before the log call —
 * untrusted detail strings + extra fields stripped per the data policy.
 */
export class LoggingTelemetrySink implements TelemetrySink {
	public constructor(
		private readonly logger: ILogger,
		private readonly logSource: string = "offscreen-telemetry",
	) {}

	public recordTerminal(record: RequestTelemetry): void {
		const sanitized = sanitizeTelemetry(record)
		const level = isAnomalyStatus(sanitized.status) ? LogLevel.Info : LogLevel.Debug
		this.logger.log(this.logSource, level, sanitized)
	}
}

/** Pure helper — extend if a future `RequestTerminalStatus` value
 *  should also surface at Info. */
function isAnomalyStatus(status: RequestTerminalStatus): boolean {
	return status === "timeout" || status === "disconnected" || status === "send_failed"
}

/**
 * Test-only sink: captures records into an array. NOT exported from
 * the package's public index; tests import directly from
 * `@nulo/extension-messaging/offscreen/telemetry`.
 */
export class MemoryTelemetrySink implements TelemetrySink {
	public readonly records: RequestTelemetry[] = []
	public recordTerminal(record: RequestTelemetry): void {
		this.records.push(sanitizeTelemetry(record))
	}
}
