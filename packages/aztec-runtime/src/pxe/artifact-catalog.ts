import { type ContractArtifact, loadContractArtifact } from "@aztec/stdlib/abi"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import { AuthRegistryArtifact } from "@aztec/standard-contracts/auth-registry"
import { ContractClassRegistryArtifact } from "@aztec/protocol-contracts/class-registry"
import { FeeJuiceArtifact } from "@aztec/protocol-contracts/fee-juice"
import { ContractInstanceRegistryArtifact } from "@aztec/protocol-contracts/instance-registry"
import { MultiCallEntrypointArtifact } from "@aztec/standard-contracts/multi-call-entrypoint"
import { PublicChecksArtifact } from "@aztec/standard-contracts/public-checks"
import { FPCContractArtifact } from "@aztec/noir-contracts.js/FPC"
import { NFTContractArtifact } from "@aztec/noir-contracts.js/NFT"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
// @ts-expect-error — raw JSON import via vite alias
import WonderlandTokenJson from "@wonderland-token-artifact"
// @ts-expect-error — raw JSON import via vite alias
import PrivateFPCJson from "@private-fpc-artifact"

/**
 * Single source of truth for the compiled-in artifacts and their class ids.
 *
 * Before this, `known-artifacts.ts` and `note-schemas.ts` each imported the
 * artifacts and called `getContractClassFromArtifact` independently — so the
 * note-schema map could be keyed off a DIFFERENT class-id computation than the
 * known-artifact resolver (a silent "notes won't decode" hazard if an artifact
 * alias or the Aztec class-id derivation ever shifts). Both now look class ids
 * up by `CatalogKey` here, so the two can never diverge.
 *
 * Per-key cached (NOT an eager all-12 load): note-schemas depends only on its
 * four keys, so a transient failure hashing an unrelated protocol artifact
 * can't break note rendering — while a key requested by both callers is still
 * hashed only once. Invariant: the list stays locally compiled-in — never
 * fetched at runtime, never user-mutable.
 */
export type CatalogKey =
	| "authRegistry"
	| "contractClassRegistry"
	| "feeJuice"
	| "contractInstanceRegistry"
	| "multiCallEntrypoint"
	| "publicChecks"
	| "fpc"
	| "nft"
	| "sponsoredFpc"
	| "token"
	| "wonderlandToken"
	| "privateFpc"

export type CatalogEntry = {
	artifact: ContractArtifact
	/** `getContractClassFromArtifact(artifact).id.toString()` — computed once. */
	classId: string
}

/** Lazy raw-artifact accessors: requesting one key doesn't force `loadContractArtifact`
 *  parsing of the others. (The JSON module imports are eager via the vite alias;
 *  the parse + class-id hash happen per-key on demand.) */
const rawArtifact: Record<CatalogKey, () => ContractArtifact> = {
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
}

/** The 12 compiled-in keys, in known-artifact resolution order. */
export const ALL_CATALOG_KEYS: readonly CatalogKey[] = [
	"authRegistry",
	"contractClassRegistry",
	"feeJuice",
	"contractInstanceRegistry",
	"multiCallEntrypoint",
	"publicChecks",
	"fpc",
	"nft",
	"sponsoredFpc",
	"token",
	"wonderlandToken",
	"privateFpc",
]

const cache = new Map<CatalogKey, Promise<CatalogEntry>>()

/** Load one artifact and compute its class id, once. Class ids are computed
 *  lazily (Poseidon hashing the artifact) and cached per key. Retry allowed
 *  after a transient failure. */
export function getCatalogEntry(key: CatalogKey): Promise<CatalogEntry> {
	const existing = cache.get(key)
	if (existing) return existing
	const entry = (async () => {
		const artifact = rawArtifact[key]()
		const contractClass = await getContractClassFromArtifact(artifact)
		return { artifact, classId: contractClass.id.toString() }
	})()
	cache.set(key, entry)
	entry.catch(() => {
		if (cache.get(key) === entry) cache.delete(key)
	})
	return entry
}

/** Reset the per-key cache. Test-only. */
export function _resetArtifactCatalogForTests(): void {
	cache.clear()
}
