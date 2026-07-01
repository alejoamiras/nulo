import type { MethodsMap } from "@nulo/wallet-core/base"

/**
 * Define mechanical request-passthrough methods on a service-client prototype.
 *
 * The extension service clients are almost all pure forwarders: each declared
 * method is `methodName(...args) { return this.request("methodName", ...args) }`.
 * That body is identical across ~110 methods in ~18 clients — pure boilerplate
 * whose only per-method content is the name. `definePassthroughs` installs those
 * bodies on the prototype from an EXPLICIT method-name list, so a client only
 * declares its name list (paired with a `interface X extends MethodsSpec<M> {}`
 * declaration-merge for the types) instead of hand-writing every forward.
 *
 * ## Why an explicit name list, not a Proxy or a type-derived list
 *
 * A `Proxy` would change stack traces, method identity, `function.length`, and
 * property enumeration, and hide runtime holes behind casts. A type-derived list
 * is impossible — `Methods` is erased at runtime. So the caller passes a literal
 * `as const` array; pair it with a compile-time exhaustiveness assertion
 * (`Exclude<keyof M, (typeof LIST)[number]> extends never`) so the list can never
 * silently drift from the `Methods` type. This helper only touches the CLIENT
 * side (a forwarder) — it has NO bearing on the service-side dispatch allowlist
 * (`rpcMethods`), which stays hand-written and is the actual trust boundary.
 *
 * Methods are installed non-enumerable + writable + configurable to mirror
 * ordinary `class` prototype methods (which are non-enumerable).
 */
export function definePassthroughs<M extends MethodsMap>(proto: object, methods: readonly (keyof M & string)[]): void {
	for (const name of methods) {
		Object.defineProperty(proto, name, {
			value: function (
				this: { request(method: string, ...args: unknown[]): Promise<unknown> },
				...args: unknown[]
			): Promise<unknown> {
				return this.request(name, ...args)
			},
			writable: true,
			enumerable: false,
			configurable: true,
		})
	}
}
