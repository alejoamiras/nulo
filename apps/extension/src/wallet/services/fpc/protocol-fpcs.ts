// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
import { Fr } from "@aztec/foundation/curves/bn254"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { type ContractArtifact, loadContractArtifact } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { type ContractInstanceWithAddress, getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
// @ts-expect-error — raw JSON import via vite alias, bypasses @aztec/aztec.js (which references document/window)
import PrivateFPCJson from "@private-fpc-artifact"

const PrivateFPCContractArtifact = loadContractArtifact(PrivateFPCJson)

const SPONSORED_FPC_PARAMS = () => ({ constructorArgs: [], salt: Fr.zero() })
/** Must derive the canonical PrivateFPC `protocol-fpcs.test.ts` pins; Fee Juice deposited to any
 *  other address is unrecoverable. */
const PRIVATE_FPC_PARAMS = () => ({ constructorArgs: [], salt: new Fr(1n), deployer: AztecAddress.ZERO })

export type ProtocolFpc = { instance: ContractInstanceWithAddress; artifact: ContractArtifact }

export async function deriveSponsoredFpc(): Promise<ProtocolFpc> {
	const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, SPONSORED_FPC_PARAMS())
	return { instance, artifact: SponsoredFPCContractArtifact }
}

export async function derivePrivateFpc(): Promise<ProtocolFpc> {
	const instance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, PRIVATE_FPC_PARAMS())
	return { instance, artifact: PrivateFPCContractArtifact }
}
