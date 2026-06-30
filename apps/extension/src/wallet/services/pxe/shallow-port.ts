import type { ILogger } from "@/wallet/logger"
import { type IPXE, type NetworkInfo, PxeServiceClient } from "@/wallet/services/pxe/client"

/**
 * The contract-registry slice of `IPXE` the shallow composition fake implements:
 * `getContractInstance` / `getContractArtifact` / `getContracts` /
 * `registerContract`. DERIVED from `IPXE` via `Pick`, so a shape change on any
 * of those four breaks the composition fake's `typecheck` (the compile-time
 * drift guard — see `shallow-port.fake.ts`).
 */
export type ShallowPxe = Pick<IPXE, "getContractInstance" | "getContractArtifact" | "getContracts" | "registerContract">

/**
 * The seam TokenService injects (its `pxeClientFactory` ctor param). It calls
 * exactly ONE client-level method — `getPXE(network)` — so the port is just
 * that. FpcService does NOT inject this seam: it constructs `PxeServiceClient`
 * directly because its only interesting paths are bb-bound and live in Network
 * e2e (the composition-test counter-example — see
 * `apps/extension/tests/COMPOSITION-TESTS.md`), so there's nothing to swap.
 * The return stays the full `IPXE` (not the narrowed `ShallowPxe`) because
 * Token's deep metadata path (`fetchTokenMetadata` → `simulateTx`) reads the
 * SAME client; narrowing the return would break production typecheck.
 * `PxeServiceClient` satisfies this castlessly (`getPXE` is identical);
 * composition fakes implement only `ShallowPxe` and widen to `IPXE` with ONE
 * cast in the fake factory. The "no proving/simulation in a composition fake"
 * rule is therefore enforced by the fake's surface (it physically lacks
 * `simulateTx`/`proveTx`) + the doc (D2), not by this return type.
 */
export interface ShallowPxeClient {
	getPXE(network: NetworkInfo): IPXE
}

export type ShallowPxeClientFactory = (logger: ILogger) => ShallowPxeClient

/** Production default: the real RPC-backed client, structurally a `ShallowPxeClient`. */
export const DEFAULT_SHALLOW_PXE_CLIENT_FACTORY: ShallowPxeClientFactory = (logger) => new PxeServiceClient(logger)
