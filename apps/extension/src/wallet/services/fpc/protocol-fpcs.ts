// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
import { Fr } from "@aztec/foundation/curves/bn254"
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC"
import { type ContractArtifact, loadContractArtifact } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { type ContractInstanceWithAddress, getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
// @ts-expect-error — raw JSON import via vite alias, bypasses @aztec/aztec.js (which references document/window)
import PrivateFPCJson from "@private-fpc-artifact"

export const PrivateFPCContractArtifact = loadContractArtifact(PrivateFPCJson)

/** Instantiation params for each protocol FPC. The derive helpers below are the only way the
 * service computes these instances, so its canonical-address check and its PXE registration can
 * never derive different addresses. The PrivateFPC salt is a fixed project constant from 5.0.0
 * onward (rc-era used salt 0) and must yield the canonical deployment the bridge funds, which
 * `protocol-fpcs.test.ts` pins: Fee Juice deposited to any other PrivateFPC address is
 * unrecoverable. */
export const SPONSORED_FPC_PARAMS = () => ({ constructorArgs: [], salt: Fr.zero() })
export const PRIVATE_FPC_PARAMS = () => ({ constructorArgs: [], salt: new Fr(1n), deployer: AztecAddress.ZERO })

export type ProtocolFpc = { instance: ContractInstanceWithAddress; artifact: ContractArtifact }

export async function deriveSponsoredFpc(): Promise<ProtocolFpc> {
	const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, SPONSORED_FPC_PARAMS())
	return { instance, artifact: SponsoredFPCContractArtifact }
}

export async function derivePrivateFpc(): Promise<ProtocolFpc> {
	const instance = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, PRIVATE_FPC_PARAMS())
	return { instance, artifact: PrivateFPCContractArtifact }
}
