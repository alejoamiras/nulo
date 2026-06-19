/**
 * Project an `Error`'s three standard fields (`name`, `message`, `stack`)
 * into a plain JSON object. They are non-enumerable, so a bare
 * `JSON.stringify(err)` drops them and emits `{}` — every path that sends an
 * Error over the wire must shape it explicitly first.
 *
 * This owns ONLY the genuinely-common subset shared by the two replacers that
 * coax Errors through `JSON.stringify`: `utils/serialization.ts` (the wire
 * format, vendored from `@aztec/foundation/json-rpc`) and `jobs/error.ts` (the
 * job-failure envelope). Each caller layers its own divergent extras on top —
 * `serialization` adds `WalletError`'s `code`/`details`; `jobs/error` adds the
 * `__error` discriminant — so those deliberate differences stay at the call
 * site, not here. `stack` is omitted when absent so the two callers' existing
 * wire output is byte-identical (a present `stack: undefined` key would
 * otherwise be dropped by stringify anyway, but omitting it keeps the object
 * shape honest).
 */
export function baseErrorJson(err: Error): { name: string; message: string; stack?: string } {
	return {
		name: err.name,
		message: err.message,
		...(err.stack !== undefined ? { stack: err.stack } : {}),
	}
}
