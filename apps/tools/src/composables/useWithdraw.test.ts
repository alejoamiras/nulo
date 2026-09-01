import { AztecAddress } from "@aztec/aztec.js/addresses"
import { TxStatus } from "@aztec/aztec.js/tx"
import { describe, expect, it } from "vitest"
import { buildWithdrawSendOpts } from "./useWithdraw"

// DP3: the app must NEVER set a fee on a withdrawal — the connected wallet pays its own default
// (fee-juice balance / per-network default). Deposits may sponsor; withdrawals must not, on any
// network. All three withdraw sends (public authwit, public exit, private exit) route through this
// one builder, so a single assertion here guards every path against a reintroduced Sponsored FPC.
describe("buildWithdrawSendOpts — withdrawals never carry an app-set fee (DP3)", () => {
	const from = AztecAddress.fromNumberUnsafe(0x1234)

	it("returns send options with NO fee / paymentMethod", () => {
		const opts = buildWithdrawSendOpts(from)
		expect("fee" in opts).toBe(false)
		expect((opts as Record<string, unknown>).paymentMethod).toBeUndefined()
	})

	it("still carries the account + the PROPOSED wait", () => {
		const opts = buildWithdrawSendOpts(from)
		expect(opts.from).toBe(from)
		expect(opts.wait).toEqual({ waitForStatus: TxStatus.PROPOSED })
	})
})
