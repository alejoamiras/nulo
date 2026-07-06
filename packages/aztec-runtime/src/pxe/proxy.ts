import type { NetworkInfo } from "./chain-runtime"
import type { PxeServiceClientBase } from "./client"
import { PXE_IPXE_METHODS } from "./descriptors"
import type { IPXE } from "./ipxe"

/**
 * Adapter that exposes an `IPXE` interface over a `PxeServiceClientBase`
 * bound to a specific network. The underlying client is multi-network;
 * the proxy pins it to one so the consumer code reads like it's talking
 * to a single PXE.
 *
 * Every proxy method is the same mechanical curry —
 * `name(...args) { return this.pxeService.name(this.network, ...args) }` —
 * so the bodies are installed from the descriptor table's `ipxe: true` list
 * (`PXE_IPXE_METHODS`) instead of being hand-written 18×, mirroring the
 * `definePassthroughs` client-factory pattern. The TYPES come from the
 * `interface PXEProxy extends IPXE` declaration-merge; descriptors.ts's
 * `_IPXEMatchesTable` assert pins the list to `keyof IPXE` in both
 * directions, so a method can be neither missing nor extra here.
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: methods are installed on the prototype below from PXE_IPXE_METHODS; the descriptors.ts Equal-assert proves the list covers keyof IPXE exactly.
export interface PXEProxy extends IPXE {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: see above — runtime bodies come from the installer loop.
export class PXEProxy {
	public constructor(
		private readonly pxeService: PxeServiceClientBase,
		private readonly network: NetworkInfo,
	) {}
}

for (const name of PXE_IPXE_METHODS) {
	// `this` is typed structurally (the class's fields are TS-private, which is
	// compile-time-only); at runtime `this` IS the PXEProxy instance.
	const curried = function (
		this: { pxeService: Record<string, (network: NetworkInfo, ...rest: unknown[]) => unknown>; network: NetworkInfo },
		...args: unknown[]
	): unknown {
		return this.pxeService[name](this.network, ...args)
	}
	// Restore `.name` so stack traces match hand-written methods.
	Object.defineProperty(curried, "name", { value: name, configurable: true })
	Object.defineProperty(PXEProxy.prototype, name, { value: curried, writable: true, enumerable: false, configurable: true })
}

// ── Compile-time bridge: the generated curry must SATISFY IPXE ──────────
// The `extends IPXE` merge above only ASSERTS the methods exist; it does NOT
// check that the runtime curry `name(...args) => pxeService.name(network, ...args)`
// actually produces IPXE's signatures. `subset.ts`'s old `PXEProxy implements IPXE`
// gave that per-method check for free; the generated proxy lost it. Reconstruct it
// at the type level: drop the leading NetworkInfo from each client method and
// require the result to be ASSIGNABLE to IPXE (assignability, not identity — a
// client method may carry extra optional args the facade omits, exactly as
// `implements` allowed). A param/return-type drift on any single method — not just
// a missing/extra name (which `_IPXEMatchesTable` still owns) — now fails HERE at
// compile time instead of surfacing as a runtime shape mismatch.
type Expect<T extends true> = T
// The fallback is `unknown`, NOT `never`: if a client method's first param ever
// drifts off `NetworkInfo` (e.g. to a subtype), the conditional fails to match and
// this branch is taken — `never` is assignable to any IPXE method and would make
// the assert pass VACUOUSLY, whereas `unknown` is not, so the drift fails HERE.
type CurriedClientMethod<K extends keyof IPXE> = PxeServiceClientBase[K] extends (network: NetworkInfo, ...rest: infer P) => infer R
	? (...rest: P) => R
	: unknown
type CurriedProxy = { [K in keyof IPXE]: CurriedClientMethod<K> }
type _ProxyCurrySatisfiesIPXE = Expect<CurriedProxy extends IPXE ? true : false>
