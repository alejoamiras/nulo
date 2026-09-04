/**
 * KEYSTONE (TS leg): the hub-derived Token instance must equal the hub's in-circuit `derive_token`
 * (contracts/bridge/aztec/token_bridge_hub/src/test/keystone.nr) for the fixed vector. The class id
 * is the installed aztec-standards@5.0.1 Token — the same pin as noir-artifact-classids.test.ts.
 */
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { describe, expect, it } from "vitest"
import { deriveHubTokenInstance, hubTokenSalt } from "./hub-token"

const HUB = AztecAddress.fromBigIntUnsafe(0x1234000000000000000000000000000000000000000000000000000000000abcn)
const ERC20 = "0x00000000000000000000000000000000000e2c20"
/** The installed aztec-standards@5.0.1 Token class — the same pin as noir-artifact-classids.test.ts. */
const TOKEN_CLASS_ID = "0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf"
const WORDS = {
	nameWord: "0x004e756c6f205465737420546f6b656e00000000000000000000000000000000",
	symbolWord: "0x004e545400000000000000000000000000000000000000000000000000000000",
	decimals: 18,
}

describe("hub token keystone", () => {
	it("salts with the ERC-20 address", () => {
		expect(hubTokenSalt(ERC20).toString()).toBe("0x00000000000000000000000000000000000000000000000000000000000e2c20")
	})

	it("matches the hub's in-circuit derivation for the fixed vector", async () => {
		const inst = await deriveHubTokenInstance(HUB, ERC20, WORDS, TOKEN_CLASS_ID)
		expect(inst.currentContractClassId.toString()).toBe(TOKEN_CLASS_ID)
		expect(inst.deployer.equals(HUB)).toBe(true)
		expect(inst.address.toString()).toBe("0x16d03942b8ae31464284482ee43727e40718773358bf324c5c287f52a63b573d")
	})

	it("refuses a hub whose Token class is not the installed one", async () => {
		await expect(deriveHubTokenInstance(HUB, ERC20, WORDS, `0x${"1".repeat(64)}`)).rejects.toThrow("hub Token class mismatch")
	})
})
