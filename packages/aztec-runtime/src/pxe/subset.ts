import type { IPXE } from "./ipxe"
import type { PXEProxy } from "./proxy"
import type { Methods } from "./spec"

/**
 * Canonical list of the PXE methods exposed **in-process** (per-network,
 * promisified, with the leading `network` param dropped) via {@link IPXE} and
 * its currying adapter {@link PXEProxy}. This is the single source the three
 * hand-maintained PXE declarations are pinned against:
 *   - the full RPC surface {@link Methods} (`spec.ts`),
 *   - the in-process interface `IPXE` (`ipxe.ts`),
 *   - the network-currying adapter `PXEProxy` (`proxy.ts`).
 *
 * It is deliberately a SUBSET of `Methods`: `getNoteSchemas`,
 * `getBlockTimestamp`, and `clearChainState` are SW-side only and are NOT
 * exposed per-network in-process.
 *
 * The `_Assert*` type aliases below FAIL TO COMPILE if any declaration drifts
 * from this list — turning a previously-unchecked synchronization surface into
 * a type error. Full mapped-type derivation of `IPXE`/`PXEProxy` from `Methods`
 * is a larger step (it must strip `network` + promisify, and `client.ts`'s
 * per-method zod response validation can't be generated), so this pins the KEY
 * boundary only.
 */
export const PXE_SUBSET_METHODS = [
	"getContractInstance",
	"getContractArtifact",
	"registerAccount",
	"registerSender",
	"getSenders",
	"removeSender",
	"getRegisteredAccounts",
	"registerContractClass",
	"registerContract",
	"updateContract",
	"getContracts",
	"getNotes",
	"proveTx",
	"profileTx",
	"simulateTx",
	"executeUtility",
	"getPrivateEvents",
	"getSyncedBlockHeader",
] as const

type PxeSubsetMethod = (typeof PXE_SUBSET_METHODS)[number]

/** `Expect<true>` is `true`; `Expect<false>` (or any non-`true`) is a compile error. */
type Expect<T extends true> = T
/** Exact type equality (distinguishes unions precisely, unlike bare `extends`). */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// (1) Every subset key is a real `Methods` key — catches a `Methods` rename the list missed.
type _SubsetKeysAreReal = Expect<PxeSubsetMethod extends keyof Methods ? true : never>
// (2) `IPXE`'s method set === the canonical subset — catches an `IPXE` add/remove that didn't
//     update this list (or a typo'd name here).
type _IPXEMatchesSubset = Expect<Equal<keyof IPXE, PxeSubsetMethod>>
// (3) `PXEProxy` stays an `IPXE` impl — its `implements IPXE` clause is the primary guard;
//     pinning it here keeps proxy.ts in the same checked synchronization set.
type _ProxyIsIPXE = Expect<InstanceType<typeof PXEProxy> extends IPXE ? true : never>
