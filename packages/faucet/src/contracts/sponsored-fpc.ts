import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { Fr } from "@aztec/aztec.js/fields"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"

type SponsoredFpcInstance = Awaited<ReturnType<typeof getContractInstanceFromInstantiationParams>>

let cached: SponsoredFpcInstance | null = null

/**
 * Computes the deterministic SponsoredFPC contract instance from the
 * protocol-pinned salt. The result is cached per-tab — the salt is constant
 * across all Aztec environments and the computation is hash-only (no I/O),
 * so a single warm-up is sufficient.
 *
 * Used as `feePayer: instance.address` in the faucet's drip exec payload.
 * Nulo's dispatcher materializes the embedded fee path on the wallet side;
 * the dApp never needs to `wallet.registerContract(sponsoredFpc, ...)`.
 */
export async function getSponsoredFpcInstance(): Promise<SponsoredFpcInstance> {
	if (cached) return cached
	cached = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, {
		salt: new Fr(SPONSORED_FPC_SALT),
	})
	return cached
}
