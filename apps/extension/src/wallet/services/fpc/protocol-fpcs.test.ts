// @vitest-environment node
// Node, not jsdom: bb.js poseidon2 throws std::bad_cast under jsdom.
import { Fr } from "@aztec/foundation/curves/bn254"
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract"
import { describe, expect, test } from "vitest"
import { derivePrivateFpc, PRIVATE_FPC_PARAMS, PrivateFPCContractArtifact } from "./protocol-fpcs"

/** The PrivateFPC's canonical deployment (identical on testnet and mainnet): where bridged private
 *  Fee Juice is sent, so a wallet that derives any other address strands the user's deposit. A red
 *  run means the artifact, the salt or upstream's derivation moved — fix it against the deployed
 *  contract, never by re-pinning these literals alone. */
const CANONICAL_PRIVATE_FPC = {
	salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
	deployer: "0x0000000000000000000000000000000000000000000000000000000000000000",
	address: "0x1a6d21ce5fd80137df0e99632a4ca17e58a42dc8f6c08191a96ca8ae907a1bc0",
}

describe("protocol FPC derivation", () => {
	test("the wallet derives the PrivateFPC's canonical deployment address", async () => {
		const { instance } = await derivePrivateFpc()
		expect({
			salt: instance.salt.toString(),
			deployer: instance.deployer.toString(),
			address: instance.address.toString(),
		}).toEqual(CANONICAL_PRIVATE_FPC)
	})

	test("the salt reaches the hash: salt + 1 moves the address", async () => {
		const params = PRIVATE_FPC_PARAMS()
		const moved = await getContractInstanceFromInstantiationParams(PrivateFPCContractArtifact, {
			...params,
			salt: params.salt.add(new Fr(1n)),
		})
		expect(moved.address.toString()).not.toBe(CANONICAL_PRIVATE_FPC.address)
	})
})
