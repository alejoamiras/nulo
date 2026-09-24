// @vitest-environment node
// Node, not jsdom: bb.js poseidon2 throws std::bad_cast under jsdom.
import { describe, expect, test } from "vitest"
import { derivePrivateFpc } from "./protocol-fpcs"

/** The PrivateFPC's canonical deployment, identical on testnet and mainnet. A red run means the
 *  artifact, the salt or upstream's derivation moved: fix it against the deployed contract, never
 *  by re-pinning these literals alone. */
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
})
