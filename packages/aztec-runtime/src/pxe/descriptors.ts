/**
 * The single descriptor table for the PXE method surface. Every method on the
 * full RPC contract ({@link Methods}, `spec.ts`) has an entry with ALL flags
 * explicit — no permissive defaults — so adding a method forces a deliberate
 * decision about each exposure surface:
 *
 * - `rpc`      — served over the SW↔offscreen transport. The service-side
 *                dispatch allowlist (`service.ts`'s `defineRpcMethods`) stays
 *                HAND-WRITTEN — it is the trust boundary and is never derived
 *                from this table; the `_EveryMethodIsRpc` assert below only
 *                documents that today the whole `Methods` contract is RPC.
 * - `ipxe`     — exposed in-process per-network via {@link IPXE} and its
 *                currying adapter `PXEProxy` (which IS generated from this
 *                table — see `proxy.ts`). The SW-only methods
 *                (`getNoteSchemas`, `getBlockTimestamp`, `clearChainState`)
 *                are `ipxe: false` and MUST stay absent from that facade: a
 *                per-network handle must not reach chain-purge or the static
 *                schema map.
 * - `requiresNetwork` — the first parameter is a `NetworkInfo`. Everything
 *                `ipxe: true` must also be `requiresNetwork: true` (the proxy
 *                curries that parameter away) — enforced by
 *                `_IpxeImpliesNetwork` below.
 *
 * Method BODIES are deliberately not generated from this table: `service.ts`
 * encodes validation/rehydration/locks and `client.ts` carries per-method zod
 * response validation + the `proveTx` timeout override — all hand-written.
 *
 * The `_Assert*` aliases FAIL TO COMPILE if any declaration drifts — they
 * replace the previous hand-maintained `subset.ts` pin list, which this table
 * now derives.
 */

import type { NetworkInfo } from "./chain-runtime"
import type { IPXE } from "./ipxe"
import type { Methods } from "./spec"

export interface PxeMethodDescriptor {
	rpc: boolean
	ipxe: boolean
	requiresNetwork: boolean
}

export const PXE_METHOD_DESCRIPTORS = {
	getContractInstance: { rpc: true, ipxe: true, requiresNetwork: true },
	getContractArtifact: { rpc: true, ipxe: true, requiresNetwork: true },
	getNoteSchemas: { rpc: true, ipxe: false, requiresNetwork: false },
	registerAccount: { rpc: true, ipxe: true, requiresNetwork: true },
	registerSender: { rpc: true, ipxe: true, requiresNetwork: true },
	getSenders: { rpc: true, ipxe: true, requiresNetwork: true },
	removeSender: { rpc: true, ipxe: true, requiresNetwork: true },
	getRegisteredAccounts: { rpc: true, ipxe: true, requiresNetwork: true },
	registerContractClass: { rpc: true, ipxe: true, requiresNetwork: true },
	registerContract: { rpc: true, ipxe: true, requiresNetwork: true },
	getContracts: { rpc: true, ipxe: true, requiresNetwork: true },
	getNotes: { rpc: true, ipxe: true, requiresNetwork: true },
	proveTx: { rpc: true, ipxe: true, requiresNetwork: true },
	profileTx: { rpc: true, ipxe: true, requiresNetwork: true },
	simulateTx: { rpc: true, ipxe: true, requiresNetwork: true },
	executeUtility: { rpc: true, ipxe: true, requiresNetwork: true },
	getPrivateEvents: { rpc: true, ipxe: true, requiresNetwork: true },
	getSyncedBlockHeader: { rpc: true, ipxe: true, requiresNetwork: true },
	getBlockTimestamp: { rpc: true, ipxe: false, requiresNetwork: true },
	getPublicTokenTransferEvents: { rpc: true, ipxe: false, requiresNetwork: true },
	getPublicScanTips: { rpc: true, ipxe: false, requiresNetwork: true },
	getPublicTokenClassStatus: { rpc: true, ipxe: false, requiresNetwork: true },
	clearChainState: { rpc: true, ipxe: false, requiresNetwork: false },
	clearProfileState: { rpc: true, ipxe: false, requiresNetwork: false },
	provisionChainStoreKey: { rpc: true, ipxe: false, requiresNetwork: false },
} as const satisfies Record<keyof Methods, PxeMethodDescriptor>

type Descriptors = typeof PXE_METHOD_DESCRIPTORS

/** The `ipxe: true` keys — the per-network in-process subset. */
export type PxeIpxeMethod = { [K in keyof Descriptors]: Descriptors[K]["ipxe"] extends true ? K : never }[keyof Descriptors]

/**
 * Runtime mirror of {@link PxeIpxeMethod} — the list `proxy.ts` generates its
 * forwards from. Derived, so it cannot drift from the table.
 */
export const PXE_IPXE_METHODS = (Object.keys(PXE_METHOD_DESCRIPTORS) as (keyof Methods & string)[]).filter(
	(name) => PXE_METHOD_DESCRIPTORS[name].ipxe,
) as readonly (PxeIpxeMethod & string)[]

/** `Expect<true>` is `true`; `Expect<false>` (or any non-`true`) is a compile error. */
type Expect<T extends true> = T
/** Exact type equality (distinguishes unions precisely, unlike bare `extends`). */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// (1) The table covers Methods exactly (both directions — `satisfies` above
//     rejects extras/missing at the value level; this pins it at the type level).
type _TableMatchesMethods = Expect<Equal<keyof Descriptors, keyof Methods>>
// (2) `IPXE`'s method set === the table's `ipxe: true` keys — an IPXE add/remove
//     (or a flag flip here) that isn't mirrored is a compile error. This is the
//     SW-only-exclusion guard: flipping e.g. `clearChainState` to `ipxe: true`
//     fails here unless someone ALSO hand-adds it to the IPXE interface.
type _IPXEMatchesTable = Expect<Equal<keyof IPXE, PxeIpxeMethod>>
// (3) Everything in-process is network-curried: `ipxe: true` ⇒ `requiresNetwork: true`.
type _IpxeImpliesNetwork = Expect<Equal<{ [K in PxeIpxeMethod]: Descriptors[K]["requiresNetwork"] }[PxeIpxeMethod], true>>
// (4) Today the entire `Methods` contract is RPC-served; a `rpc: false` entry
//     would signal a method that exists in the type but must not be dispatched —
//     that split doesn't exist yet, so pin all-true until it deliberately does.
type _EveryMethodIsRpc = Expect<Equal<{ [K in keyof Descriptors]: Descriptors[K]["rpc"] }[keyof Descriptors], true>>
// (5) The `requiresNetwork` FLAG matches the real signature: every method flagged
//     `requiresNetwork: true` takes a first parameter that is EXACTLY `NetworkInfo`.
//     Exact `Equal`, not `extends NetworkInfo`: a first param drifted to a SUBTYPE
//     would satisfy `extends` yet break the proxy curry (contravariance), so the
//     one-directional check would miss it. With (3) this makes every `ipxe: true`
//     method provably network-first, foreclosing proxy.ts's curry-assert vacuity.
type NetworkFirstMethod = { [K in keyof Descriptors]: Descriptors[K]["requiresNetwork"] extends true ? K : never }[keyof Descriptors]
type _RequiresNetworkImpliesNetworkFirstParam = Expect<
	Equal<{ [K in NetworkFirstMethod]: Equal<Parameters<Methods[K]>[0], NetworkInfo> }[NetworkFirstMethod], true>
>
