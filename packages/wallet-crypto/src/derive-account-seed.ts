/**
 * The ONE account-seed derivation for NULO-ACCOUNT-KDF v2 (consensus-critical):
 *
 *     accountSeed = poseidon2HashWithSeparator([master, l1ChainId, type, index], NULO_ACCOUNT_SEED_SEP)
 *
 * Every consumer — AccountService, the account-integrity coordinator — MUST call this function;
 * a second implementation of the formula is the bug class that previously bricked-at-unlock in
 * audit (a stale duplicate in the coordinator's default deriver). The e2e canary keeps its own
 * deliberately independent recompute as an external check.
 *
 * `l1ChainId` is the EXACT L1 chain id (1 / 11155111 / 31337 / probed), NEVER the XOR-composite
 * storage-scoping chainId — and never a silent default: a missing or non-canonical value must
 * fail account derivation, not collapse chain separation onto 0.
 */
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon"
import { Fr } from "@aztec/foundation/curves/bn254"
import { NULO_ACCOUNT_SEED_SEP } from "./nulo-separators"

export function assertCanonicalL1ChainId(l1ChainId: number): void {
	if (!Number.isSafeInteger(l1ChainId) || l1ChainId < 0 || l1ChainId > 0xffffffff) {
		throw new Error(`Non-canonical l1ChainId for key derivation: ${l1ChainId}`)
	}
}

export async function deriveAccountSeed(master: Fr, l1ChainId: number, type: number, index: number): Promise<Fr> {
	assertCanonicalL1ChainId(l1ChainId)
	if (!Number.isSafeInteger(type) || type < 0 || !Number.isSafeInteger(index) || index < 0) {
		throw new Error(`Non-canonical derivation inputs: type=${type} index=${index}`)
	}
	return poseidon2HashWithSeparator([master, new Fr(l1ChainId), new Fr(type), new Fr(index)], NULO_ACCOUNT_SEED_SEP)
}
