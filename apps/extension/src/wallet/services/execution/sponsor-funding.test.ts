// @vitest-environment node
// Real poseidon2 (bb.js WASM) in the slot derivation, which crashes under jsdom.
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { computeFeePayerBalanceStorageSlot } from "@aztec-labs/protocol-contracts/fee-juice"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { Gas, GasFees, GasSettings } from "@aztec-labs/stdlib/gas"
import { describe, expect, test, vi } from "vitest"
import { trim } from "@/wallet/logger/utils"
import type { PublicStorageReader } from "@/wallet/utils/fee-juice-balance"
import type { FeeEstimate } from "./fee/fee-strategy"
import { SPONSOR_PROBE_TIMEOUT_MS, probeSponsorFunding } from "./sponsor-funding"

const SPONSOR = AztecAddress.fromNumberUnsafe(0x5f)
const NETWORK = { id: "net-1", chainId: 7 }
// 2 × 100 DA + 3 × 200 L2: the node's limit leaves the teardown limits out.
const FEE_LIMIT = 800n

function built(named = true): FeeEstimate {
	const gasSettings = new GasSettings(new Gas(100, 200), new Gas(10, 20), new GasFees(2n, 3n), new GasFees(0n, 0n))
	return {
		network: NETWORK,
		txRequest: { txContext: { gasSettings } },
		...(named ? { sponsor: { fpcId: "fpc-1", address: SPONSOR } } : {}),
	} as unknown as FeeEstimate
}

function reader(result: bigint | Error) {
	return vi.fn<PublicStorageReader>(async () => {
		if (result instanceof Error) throw result
		return new Fr(result)
	})
}

describe("probeSponsorFunding", () => {
	test.each([
		{ balance: FEE_LIMIT - 1n, funded: false, outcome: "short" },
		{ balance: FEE_LIMIT, funded: true, outcome: "funded" },
		{ balance: 0n, funded: false, outcome: "short" },
	])("a balance of $balance against the fee limit is funded: $funded", async ({ balance, funded, outcome }) => {
		const read = reader(balance)
		const log = vi.fn()

		expect(await probeSponsorFunding(built(), read, log)).toEqual({ fpcId: "fpc-1", address: SPONSOR.toString(), funded })

		expect(read).toHaveBeenCalledTimes(1)
		const [network, , slot, timeoutMs] = read.mock.calls[0] ?? []
		expect(network).toBe(NETWORK)
		expect(slot?.equals(await computeFeePayerBalanceStorageSlot(SPONSOR))).toBe(true)
		expect(timeoutMs).toBe(SPONSOR_PROBE_TIMEOUT_MS)
		expect(SPONSOR_PROBE_TIMEOUT_MS).toBe(5_000)
		expect(log.mock.calls).toEqual([["sponsor probe", { outcome }]])
	})

	test("no sponsor named: no read, no verdict", async () => {
		const read = reader(0n)
		const log = vi.fn()

		expect(await probeSponsorFunding(built(false), read, log)).toBeUndefined()
		expect(read).not.toHaveBeenCalled()
		expect(log).not.toHaveBeenCalled()
	})

	test("a failed read is no verdict, and nothing it said reaches the log", async () => {
		const leaks = ["https://rpc.example/key-in-path", "123456789", SPONSOR.toString()]
		const read = reader(new Error(`Error 500 from server ${leaks[0]}: balance ${leaks[1]} of ${leaks[2]}`))
		const log = vi.fn()

		expect(await probeSponsorFunding(built(), read, log)).toBeUndefined()

		expect(log.mock.calls).toEqual([["sponsor probe", { outcome: "failed" }]])
		const logged = JSON.stringify(log.mock.calls.map((args) => args.map((arg) => trim(arg))))
		for (const leak of leaks) expect(logged).not.toContain(leak)
	})
})
