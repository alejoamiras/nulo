import { Fr } from "@aztec/foundation/curves/bn254"
import { type ContractArtifact, loadContractArtifact } from "@aztec/stdlib/abi"
import { AuthRegistryArtifact } from "@aztec/protocol-contracts/auth-registry"
import { ContractClassRegistryArtifact } from "@aztec/protocol-contracts/class-registry"
import { FeeJuiceArtifact } from "@aztec/protocol-contracts/fee-juice"
import { ContractInstanceRegistryArtifact } from "@aztec/protocol-contracts/instance-registry"
import { MultiCallEntrypointArtifact } from "@aztec/protocol-contracts/multi-call-entrypoint"
import { PublicChecksArtifact } from "@aztec/protocol-contracts/public-checks"
import { FPCContractArtifact } from "@aztec/noir-contracts.js/FPC"
import { NFTContractArtifact } from "@aztec/noir-contracts.js/NFT"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import {
	type ContractInstanceWithAddress,
	getContractClassFromArtifact,
	getContractInstanceFromInstantiationParams,
} from "@aztec/stdlib/contract"
// @ts-expect-error — raw JSON import via vite alias
import WonderlandTokenJson from "@wonderland-token-artifact"
// @ts-expect-error — raw JSON import via vite alias
import PrivateFPCJson from "@private-fpc-artifact"

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

/** Production loader: the frozen 12 compiled-in artifacts + the
 *  SponsoredFPC instance. Invariant: this list stays locally
 *  compiled-in — never fetched at runtime, never user-mutable. */
export const loadProductionKnownArtifacts: KnownArtifactsLoader = async () => {
	const WonderlandTokenArtifact = loadContractArtifact(WonderlandTokenJson)
	const PrivateFPCArtifact = loadContractArtifact(PrivateFPCJson)
	const artifacts = new Map<string, ContractArtifact>()
	const instances = new Map<string, ContractInstanceWithAddress>()

	const compiledIn = [
		// protocol
		AuthRegistryArtifact,
		ContractClassRegistryArtifact,
		FeeJuiceArtifact,
		ContractInstanceRegistryArtifact,
		MultiCallEntrypointArtifact,
		PublicChecksArtifact,
		// other
		FPCContractArtifact,
		NFTContractArtifact,
		SponsoredFPCContractArtifact,
		TokenContractArtifact,
		// wonderland standards
		WonderlandTokenArtifact,
		// PrivateFPC: also imported by FpcService for instance auto-discovery;
		// adding here exposes it via `known` resolution + smart-tighten.
		PrivateFPCArtifact,
	]
	for (const artifact of compiledIn) {
		const contractClass = await getContractClassFromArtifact(artifact)
		artifacts.set(contractClass.id.toString(), artifact)
	}
	const sponsoredFpcInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
		salt: new Fr(SPONSORED_FPC_SALT),
	})
	instances.set(sponsoredFpcInstance.address.toString(), sponsoredFpcInstance)

	return { artifacts, instances }
}
