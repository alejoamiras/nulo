/**
 * Shared request→operation materializer tests (Phase 2 follow-up, Layer 4).
 *
 * Pins:
 *  - One canonical mapping per request kind. Future divergence between
 *    silent-path and popup-path is caught by these tests, not by users.
 *  - The send-like feeSettings rule: pre-fill embedded ONLY when the dApp
 *    chose its own fee path. Otherwise undefined (draft).
 */

import { describe, expect, test, vi } from "vitest"
import type { Account } from "@/wallet/services/account/service"
import type { Network } from "@/wallet/services/network/service"
import { assertSilentExecutable, materializeRequest, type MaterializeDeps } from "./materialize"

const NETWORK: Network = {
	id: "net-1",
	profileId: "p1",
	chainId: 1337,
	name: "Test",
	primaryEndpointId: "ep1",
	endpoints: [],
} as unknown as Network

const ACCOUNT: Account = {
	address: "0xabc",
	name: "A",
	chainId: 1337,
} as unknown as Account

function makeDeps(): MaterializeDeps {
	return {
		resolveNetwork: vi.fn(async (_chain: string) => NETWORK),
		resolveNetworkAndAccount: vi.fn(async (_account: string) => [NETWORK, ACCOUNT] as [Network, Account]),
	}
}

describe("materializeRequest", () => {
	test("non-send chain-scoped kinds: enriches with networkId", async () => {
		const deps = makeDeps()
		const out = await materializeRequest(
			{ kind: "register_contract", chain: "eip155:1337", address: "0xdef", artifact: {} } as never,
			deps,
		)
		expect(out.networkId).toBe("net-1")
		expect((out as { feeSettings?: unknown }).feeSettings).toBeUndefined()
	})

	test("non-send account-scoped kinds: enriches with networkId + accountAddress", async () => {
		const deps = makeDeps()
		const out = await materializeRequest({ kind: "simulate_transaction", account: "eip155:1337:0xabc", actions: [] } as never, deps)
		expect(out.networkId).toBe("net-1")
		expect((out as { accountAddress?: string }).accountAddress).toBe("0xabc")
		expect((out as { feeSettings?: unknown }).feeSettings).toBeUndefined()
	})

	test("aztec_sendTx with executionMode=default_entrypoint: feeSettings = embedded", async () => {
		const deps = makeDeps()
		const out = await materializeRequest(
			{
				kind: "aztec_sendTx",
				account: "eip155:1337:0xabc",
				exec: { calls: [] },
				opts: {},
				executionMode: "default_entrypoint",
			} as never,
			deps,
		)
		expect((out as { feeSettings: unknown }).feeSettings).toEqual({ paymentMethod: { kind: "embedded" } })
	})

	test("aztec_sendTx with exec.feePayer set: feeSettings = embedded", async () => {
		const deps = makeDeps()
		const out = await materializeRequest(
			{
				kind: "aztec_sendTx",
				account: "eip155:1337:0xabc",
				exec: { calls: [], feePayer: "0xfee" },
				opts: {},
			} as never,
			deps,
		)
		expect((out as { feeSettings: unknown }).feeSettings).toEqual({ paymentMethod: { kind: "embedded" } })
	})

	test("aztec_sendTx whose payer is the account itself with no fee call: feeSettings = the wallet's own Fee Juice", async () => {
		const deps = makeDeps()
		const out = await materializeRequest(
			{
				kind: "aztec_sendTx",
				account: "eip155:1337:0xabc",
				exec: { calls: [{ name: "transfer" }], feePayer: "0xabc" },
				opts: { from: "0xabc" },
			} as never,
			deps,
		)
		expect((out as { feeSettings: unknown }).feeSettings).toEqual({ paymentMethod: { kind: "fj" } })
		// The same payer WITH the setup-ending claim carries its payment: embedded.
		const claim = await materializeRequest(
			{
				kind: "aztec_sendTx",
				account: "eip155:1337:0xabc",
				exec: { calls: [{ name: "claim_and_end_setup" }, { name: "transfer" }], feePayer: "0xabc" },
				opts: { from: "0xabc" },
			} as never,
			deps,
		)
		expect((claim as { feeSettings: unknown }).feeSettings).toEqual({ paymentMethod: { kind: "embedded" } })
	})

	test("aztec_sendTx with no self-fee path: feeSettings undefined (draft)", async () => {
		const deps = makeDeps()
		const out = await materializeRequest(
			{
				kind: "aztec_sendTx",
				account: "eip155:1337:0xabc",
				exec: { calls: [] },
				opts: {},
			} as never,
			deps,
		)
		expect((out as { feeSettings?: unknown }).feeSettings).toBeUndefined()
	})

	test("send_transaction with op.fee.embeddedFeePayment set: feeSettings = embedded", async () => {
		const deps = makeDeps()
		const out = await materializeRequest(
			{
				kind: "send_transaction",
				account: "eip155:1337:0xabc",
				actions: [],
				fee: { embeddedFeePayment: "fpc" },
			} as never,
			deps,
		)
		expect((out as { feeSettings: unknown }).feeSettings).toEqual({ paymentMethod: { kind: "embedded" } })
	})

	test("send_transaction without embedded fee: feeSettings undefined (draft)", async () => {
		const deps = makeDeps()
		const out = await materializeRequest(
			{
				kind: "send_transaction",
				account: "eip155:1337:0xabc",
				actions: [],
			} as never,
			deps,
		)
		expect((out as { feeSettings?: unknown }).feeSettings).toBeUndefined()
	})

	test("unknown kind throws clear error", async () => {
		const deps = makeDeps()
		await expect(materializeRequest({ kind: "nope" as never } as never, deps)).rejects.toThrow(/unknown operation kind: nope/)
	})

	test("delegates chain resolution exactly once per chain-scoped op", async () => {
		const deps = makeDeps()
		await materializeRequest({ kind: "register_contract", chain: "eip155:1337", address: "0xdef", artifact: {} } as never, deps)
		expect(deps.resolveNetwork).toHaveBeenCalledTimes(1)
		expect(deps.resolveNetworkAndAccount).not.toHaveBeenCalled()
	})

	test("delegates account resolution exactly once per account-scoped op", async () => {
		const deps = makeDeps()
		await materializeRequest({ kind: "aztec_sendTx", account: "eip155:1337:0xabc", exec: { calls: [] }, opts: {} } as never, deps)
		expect(deps.resolveNetworkAndAccount).toHaveBeenCalledTimes(1)
		expect(deps.resolveNetwork).not.toHaveBeenCalled()
	})
})

describe("assertSilentExecutable", () => {
	test("non-send kinds pass without throw", () => {
		expect(() => assertSilentExecutable({ kind: "register_contract", networkId: "net-1" } as never)).not.toThrow()
	})

	test("send-like with embedded feeSettings passes", () => {
		expect(() =>
			assertSilentExecutable({
				kind: "aztec_sendTx",
				networkId: "net-1",
				accountAddress: "0xabc",
				feeSettings: { paymentMethod: { kind: "embedded" } },
			} as never),
		).not.toThrow()
	})

	test("send-like without feeSettings throws drift-alarm message", () => {
		expect(() =>
			assertSilentExecutable({
				kind: "aztec_sendTx",
				networkId: "net-1",
				accountAddress: "0xabc",
			} as never),
		).toThrow(/silentInteraction.*aztec_sendTx.*no feeSettings.*gate broken/i)
	})

	test("send_transaction silent-path drift case also throws", () => {
		expect(() =>
			assertSilentExecutable({
				kind: "send_transaction",
				networkId: "net-1",
				accountAddress: "0xabc",
			} as never),
		).toThrow(/silentInteraction.*send_transaction.*no feeSettings/)
	})
})
