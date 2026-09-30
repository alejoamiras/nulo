/**
 * The public Fee Juice balance read the sponsor probe makes. Not in the `@/wallet/utils` barrel:
 * `@aztec/protocol-contracts/fee-juice` loads the Fee Juice artifact at module init, and every page
 * that imports the barrel would load it.
 */
import { FEE_JUICE_ADDRESS } from "@aztec/constants"
import type { Fr } from "@aztec/foundation/curves/bn254"
import { computeFeePayerBalanceStorageSlot } from "@aztec/protocol-contracts/fee-juice"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { Network } from "@/wallet/services/network/spec"

/** One public-storage read at `network`'s endpoint, bounded by `timeoutMs`. */
export type PublicStorageReader = (network: Network, contract: AztecAddress, slot: Fr, timeoutMs: number) => Promise<Fr>

/** `owner`'s public Fee Juice balance, read at the slot the node's fee-payer check reads. */
export async function readPublicFeeJuiceBalance(
	read: PublicStorageReader,
	network: Network,
	owner: AztecAddress,
	timeoutMs: number,
): Promise<bigint> {
	const slot = await computeFeePayerBalanceStorageSlot(owner)
	const value = await read(network, AztecAddress.fromNumberUnsafe(FEE_JUICE_ADDRESS), slot, timeoutMs)
	return value.toBigInt()
}
