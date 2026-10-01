// @vitest-environment node
// Real poseidon2 (bb.js WASM), which crashes under jsdom.
import { FEE_JUICE_ADDRESS } from "@aztec-labs/constants"
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { computeFeePayerBalanceStorageSlot } from "@aztec-labs/protocol-contracts/fee-juice"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { deriveStorageSlotInMap } from "@aztec-labs/stdlib/hash"
import { describe, expect, test, vi } from "vitest"
import type { Network } from "@/wallet/services/network/spec"
import { type PublicStorageReader, readPublicFeeJuiceBalance } from "./fee-juice-balance"

const NETWORK = { id: "net-1", chainId: 7 } as unknown as Network

describe("readPublicFeeJuiceBalance", () => {
	test.each([0x1234, 0xabcdef])("reads owner %i's balance slot on the Fee Juice contract", async (n) => {
		const owner = AztecAddress.fromNumberUnsafe(n)
		const read = vi.fn<PublicStorageReader>(async () => new Fr(987_654_321n))

		expect(await readPublicFeeJuiceBalance(read, NETWORK, owner, 5_000)).toBe(987_654_321n)

		expect(read).toHaveBeenCalledTimes(1)
		const [network, contract, slot, timeoutMs] = read.mock.calls[0] ?? []
		expect(network).toBe(NETWORK)
		expect(contract?.equals(AztecAddress.fromNumberUnsafe(FEE_JUICE_ADDRESS))).toBe(true)
		expect(slot?.equals(await computeFeePayerBalanceStorageSlot(owner))).toBe(true)
		// The node's own slot function is the Fee Juice `balances` map at slot 1; an upstream layout
		// change fails here before it reads a wrong balance.
		expect(slot?.equals(await deriveStorageSlotInMap(new Fr(1), owner))).toBe(true)
		expect(timeoutMs).toBe(5_000)
	})
})
