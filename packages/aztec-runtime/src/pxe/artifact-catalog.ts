import { memoizeAsyncBy } from "./async-memo"
import { type ContractArtifact, loadContractArtifact } from "@aztec-labs/stdlib/abi"
import { getContractClassFromArtifact } from "@aztec-labs/stdlib/contract"
import { AuthRegistryArtifact } from "@aztec-labs/standard-contracts/auth-registry"
import { ContractClassRegistryArtifact } from "@aztec-labs/protocol-contracts/class-registry"
import { FeeJuiceArtifact } from "@aztec-labs/protocol-contracts/fee-juice"
import { ContractInstanceRegistryArtifact } from "@aztec-labs/protocol-contracts/instance-registry"
import { MultiCallEntrypointArtifact } from "@aztec-labs/standard-contracts/multi-call-entrypoint"
import { PublicChecksArtifact } from "@aztec-labs/standard-contracts/public-checks"
import { FPCContractArtifact } from "@aztec-labs/noir-contracts.js/FPC"
import { NFTContractArtifact } from "@aztec-labs/noir-contracts.js/NFT"
import { SponsoredFPCContractArtifact } from "@aztec-labs/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@aztec-labs/noir-contracts.js/Token"
// @ts-expect-error — raw JSON import via vite alias
import WonderlandTokenJson from "@wonderland-token-artifact"
// @ts-expect-error — raw JSON import via vite alias
import PrivateFPCJson from "@private-fpc-artifact"

/**
 * Single source of truth for the compiled-in artifacts and their class ids: `known-artifacts.ts`
 * and `note-schemas.ts` both look class ids up by `CatalogKey` here, so the two can never diverge.
 *
 * Per-key cached (NOT an eager all-12 load): note-schemas depends only on its
 * four keys, so a transient failure hashing an unrelated protocol artifact
 * can't break note rendering — while a key requested by both callers is still
 * hashed only once. Invariant: the list stays locally compiled-in — never
 * fetched at runtime, never user-mutable.
 *
 * Lazy raw-artifact accessors: requesting one key doesn't force `loadContractArtifact`
 * parsing of the others. (The JSON module imports are eager via the vite alias;
 * the parse + class-id hash happen per-key on demand.) Entry order is the
 * known-artifact resolution order.
 */
const rawArtifact = {
	authRegistry: () => AuthRegistryArtifact,
	contractClassRegistry: () => ContractClassRegistryArtifact,
	feeJuice: () => FeeJuiceArtifact,
	contractInstanceRegistry: () => ContractInstanceRegistryArtifact,
	multiCallEntrypoint: () => MultiCallEntrypointArtifact,
	publicChecks: () => PublicChecksArtifact,
	fpc: () => FPCContractArtifact,
	nft: () => NFTContractArtifact,
	sponsoredFpc: () => SponsoredFPCContractArtifact,
	token: () => TokenContractArtifact,
	wonderlandToken: () => loadContractArtifact(WonderlandTokenJson),
	privateFpc: () => loadContractArtifact(PrivateFPCJson),
} satisfies Record<string, () => ContractArtifact>

export type CatalogKey = keyof typeof rawArtifact

export type CatalogEntry = {
	artifact: ContractArtifact
	/** `getContractClassFromArtifact(artifact).id.toString()` — computed once. */
	classId: string
}

/** The 12 compiled-in keys, in known-artifact resolution order. */
export const ALL_CATALOG_KEYS = Object.keys(rawArtifact) as readonly CatalogKey[]

// The store is held locally (not helper-internal) because the test reset
// below clears the WHOLE map — the helper's reset is deliberately per-key.
const cache = new Map<CatalogKey, Promise<CatalogEntry>>()
const catalogMemo = memoizeAsyncBy<CatalogKey, CatalogEntry>(async (key) => {
	const artifact = rawArtifact[key]()
	const contractClass = await getContractClassFromArtifact(artifact)
	return { artifact, classId: contractClass.id.toString() }
}, cache)

/** Load one artifact and compute its class id, once. Class ids are computed
 *  lazily (Poseidon hashing the artifact) and cached per key. Retry allowed
 *  after a transient failure. */
export function getCatalogEntry(key: CatalogKey): Promise<CatalogEntry> {
	return catalogMemo.get(key)
}

/** Reset the per-key cache. Test-only. */
export function _resetArtifactCatalogForTests(): void {
	cache.clear()
}
