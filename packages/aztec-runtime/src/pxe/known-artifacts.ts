import { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact } from "@aztec/stdlib/abi"
import { type ContractInstanceWithAddress, getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { ALL_CATALOG_KEYS, getCatalogEntry } from "./artifact-catalog"

/** Standard SponsoredFPC deployment uses salt = 0. */
const SPONSORED_FPC_SALT = BigInt(0)

export type KnownArtifacts = {
	artifacts: Map<string, ContractArtifact>
	instances: Map<string, ContractInstanceWithAddress>
}

/** Loader signature. ArtifactRegistry invokes this lazily at first
 *  `ensureKnown()` call. Production returns the real compiled-in set;
 *  unit tests inject an empty or fixture loader to stay free of the
 *  heavy `@aztec/noir-contracts.js` / vite-alias imports. */
export type KnownArtifactsLoader = () => Promise<KnownArtifacts>

/** Production loader: the frozen 12 compiled-in artifacts + the SponsoredFPC
 *  instance, resolved through the shared {@link artifact-catalog} (class ids
 *  computed once, shared with note-schema resolution). Invariant: this set
 *  stays locally compiled-in — never fetched at runtime, never user-mutable. */
export const loadProductionKnownArtifacts: KnownArtifactsLoader = async () => {
	const artifacts = new Map<string, ContractArtifact>()
	// Sequential so the map's insertion order matches the catalog key order.
	for (const key of ALL_CATALOG_KEYS) {
		const { artifact, classId } = await getCatalogEntry(key)
		artifacts.set(classId, artifact)
	}

	const instances = new Map<string, ContractInstanceWithAddress>()
	const { artifact: sponsoredFpcArtifact } = await getCatalogEntry("sponsoredFpc")
	const sponsoredFpcInstance = await getContractInstanceFromInstantiationParams(sponsoredFpcArtifact, {
		salt: new Fr(SPONSORED_FPC_SALT),
	})
	instances.set(sponsoredFpcInstance.address.toString(), sponsoredFpcInstance)

	return { artifacts, instances }
}
