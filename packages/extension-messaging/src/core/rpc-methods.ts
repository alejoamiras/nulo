/**
 * Declare a service's explicit RPC method surface.
 *
 * The RPC dispatcher must NOT invoke arbitrary `this[method]` — that lets a
 * crafted message reach inherited/prototype methods (`toString`, `constructor`),
 * framework methods (`start`, `emit`), and a concrete service's own public
 * composition / private helper methods. Instead each service declares exactly
 * which method names are callable, and the base rejects anything else.
 *
 * The helper is curried so the method-name list is checked against the service's
 * `Methods` type at compile time:
 *
 * ```ts
 * protected readonly rpcMethods = defineRpcMethods<Methods>()("getTask", "getTasks")
 * ```
 *
 * - A name that isn't a key of `Methods` → type error (typo / non-RPC method).
 * - A `Methods` key that's omitted → type error (the variadic param type
 *   collapses to an error tuple naming the missing key). This is what makes the
 *   surface fail-CLOSED *and* impossible to under-register by accident: a new
 *   RPC method won't compile until it's listed.
 */
export function defineRpcMethods<TMethods>() {
	return <const TNames extends readonly (keyof TMethods & string)[]>(
		...names: [Exclude<keyof TMethods & string, TNames[number]>] extends [never]
			? TNames
			: readonly ["ERROR: every RPC method must be registered; missing →", Exclude<keyof TMethods & string, TNames[number]>]
	): ReadonlySet<string> => new Set(names as readonly string[])
}
