/**
 * Shape guards for untrusted values. Neither checks the prototype: `@nulo/legal`'s `isPlainObject`
 * does, for inputs where a class instance must be refused too.
 */

/** A non-null object that is not an array: what a JSON object decodes to. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)

/** Any non-null object, arrays and boxed primitives included. */
export const isObjectLike = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
