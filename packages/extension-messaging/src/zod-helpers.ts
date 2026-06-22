/**
 * Thin Zod wrappers for the RPC boundary.
 *
 * Services pair a `paramsSchema` + `resultSchema` per method (in their
 * `spec.ts`) and call these helpers at the wire boundary:
 *
 *   - client-side, before sending:   `validateParams(...)`
 *   - client-side, after receiving:  `validateResult(...)`
 *   - service-side, on entry:        `validateParams(...)`
 *
 * On failure both helpers throw `ValidationError` (a `WalletError` subclass)
 * so the structured-error round-trip preserves subclass identity across
 * the JSON boundary.
 *
 * This module is intentionally small. Schemas live next to the types they
 * describe, not here. Rolling out to more services is one file change
 * per service with no plumbing in the base classes.
 */

import type { ZodType } from "zod"
import { ValidationError } from "./errors"

/** Shorten a Zod issue path for error messages. Empty paths become "<root>". */
function formatPath(path: readonly PropertyKey[]): string {
	return path.length === 0 ? "<root>" : path.join(".")
}

/** Compact human-readable summary across all issues in a failed parse. */
function summariseIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
	return issues.map((i) => `${formatPath(i.path)}: ${i.message}`).join("; ")
}

/**
 * Validate the tuple of positional params a caller sent for `method`.
 * Returns the parsed tuple (lets downstream code work with the narrowed
 * type). Throws `ValidationError` on any issue.
 */
export function validateParams<T>(schema: ZodType<T>, params: unknown, method: string): T {
	const result = schema.safeParse(params)
	if (!result.success) {
		throw new ValidationError(`Invalid params for ${method}: ${summariseIssues(result.error.issues)}`, {
			method,
			issues: result.error.issues,
		})
	}
	return result.data
}

/**
 * Validate the value a method is about to return (or has just received).
 * Used client-side to catch service bugs / wire corruption before the
 * value reaches UI code.
 */
export function validateResult<T>(schema: ZodType<T>, value: unknown, method: string): T {
	const result = schema.safeParse(value)
	if (!result.success) {
		throw new ValidationError(`Invalid result from ${method}: ${summariseIssues(result.error.issues)}`, {
			method,
			issues: result.error.issues,
		})
	}
	return result.data
}
