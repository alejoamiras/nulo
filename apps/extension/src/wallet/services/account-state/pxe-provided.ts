/**
 * Contracts every PXE registers by itself at boot: the protocol contracts and upstream's preloaded
 * standard contracts. A backup still carries them, but an import never needs to register them, so a
 * network whose slice holds only these is neither probed nor booted. Nothing here derives from slice
 * content: the set is compiled in from upstream's constants.
 */

import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { STANDARD_AUTH_REGISTRY_ADDRESS } from "@aztec-labs/standard-contracts/auth-registry/constants"
import {
	HISTORICAL_STANDARD_HANDSHAKE_REGISTRY_ADDRESSES,
	STANDARD_HANDSHAKE_REGISTRY_ADDRESS,
} from "@aztec-labs/standard-contracts/handshake-registry/constants"
import { STANDARD_MULTI_CALL_ENTRYPOINT_ADDRESS } from "@aztec-labs/standard-contracts/multi-call-entrypoint/constants"

/** Protocol contracts sit at fixed low addresses, not preimage-derived ones, so a backup's copy
 *  would fail registration's address check anyway (1 to 3 today, inside the historic bound). */
const MAX_PROTOCOL_ADDRESS = 6n

/** The addresses `getDefaultStandardPreloadedContracts()` registers, read from the address-only
 *  leaves because the function itself loads every artifact; `pxe-provided.test.ts` pins the two. */
export const PRELOADED_CONTRACT_ADDRESSES: ReadonlySet<bigint> = new Set(
	[
		STANDARD_MULTI_CALL_ENTRYPOINT_ADDRESS,
		STANDARD_AUTH_REGISTRY_ADDRESS,
		STANDARD_HANDSHAKE_REGISTRY_ADDRESS,
		...HISTORICAL_STANDARD_HANDSHAKE_REGISTRY_ADDRESSES,
	].map((address) => address.toBigInt()),
)

export function isPxeProvidedAddress(value: bigint): boolean {
	return (value >= 0n && value <= MAX_PROTOCOL_ADDRESS) || PRELOADED_CONTRACT_ADDRESSES.has(value)
}

/** False for an address the restore's own parse refuses: that entry is still work, and its
 *  registration reports the parse error. */
export function isPxeProvidedContract(address: string): boolean {
	try {
		return isPxeProvidedAddress(AztecAddress.fromStringUnsafe(address).toBigInt())
	} catch {
		return false
	}
}
