import { describe, expect, test } from "vitest"
import type { Account } from "@/wallet/services/account/client"
import type { Network } from "@/wallet/services/network/client"
import { resolveOperationScope, type ScopeOperation, scopeBannerCopy, scopeBannerState } from "./scope-mismatch"

const row = (id: string, name: string, chainId = 1) => ({ id, name, chainId }) as unknown as Network
const acct = (address: string, name: string, visible = true) => ({ address, name, visible }) as unknown as Account

const TESTNET = row("net-testnet", "Testnet", 31337)
const LOCAL = row("net-local", "Local Network", 31337)
const MAIN = acct("0xmain", "Main")
const SAVINGS = acct("0xsavings", "Savings")
const HIDDEN = acct("0xhidden", "Hidden", false)

const op = (kind: string, account: Account | undefined, network = TESTNET): ScopeOperation => ({ kind, account, network })
const send = (account: Account, network = TESTNET) => op("aztec_sendTx", account, network)
const read = (account: Account, network = TESTNET) => op("simulate_utility", account, network)

/** The wallet viewing Savings on Testnet. */
const ACTIVE = { networkId: TESTNET.id, accountAddress: SAVINGS.address }
const ACTIVE_ROWS = { account: SAVINGS, network: TESTNET }

const stateOf = (operations: ScopeOperation[], active = ACTIVE, declined = false) =>
	scopeBannerState(resolveOperationScope(operations, active), declined)

describe("resolveOperationScope", () => {
	test("undefined without operations or while the active scope is unresolved", () => {
		expect(resolveOperationScope([], ACTIVE)).toBeUndefined()
		expect(resolveOperationScope([send(MAIN)], { networkId: TESTNET.id })).toBeUndefined()
		expect(resolveOperationScope([send(MAIN)], { accountAddress: SAVINGS.address })).toBeUndefined()
	})

	test("the chain axis is row identity: two rows on one chain differ, the same row agrees", () => {
		expect(resolveOperationScope([send(SAVINGS, LOCAL)], ACTIVE)?.networkMismatch).toBe(true)
		expect(resolveOperationScope([send(SAVINGS, TESTNET)], ACTIVE)?.networkMismatch).toBe(false)
	})

	test("one signer is the follow account; two accounts that both send leave none", () => {
		expect(resolveOperationScope([send(MAIN)], ACTIVE)?.followAccount).toBe(MAIN)
		// The resolver cannot know that one of the two sends will fail; both count.
		expect(resolveOperationScope([send(MAIN), send(SAVINGS)], ACTIVE)?.followAccount).toBeUndefined()
	})

	test("among several signers, the single account that sends is followed; a padded read does not suppress it", () => {
		const view = resolveOperationScope([send(MAIN), read(SAVINGS), op("aztec_createAuthWit", SAVINGS)], ACTIVE)
		expect(view?.signers).toEqual([MAIN, SAVINGS])
		expect(view?.followAccount).toBe(MAIN)
		expect(view?.accountMismatch).toBe(true)
	})

	test("a hidden signer is never followed", () => {
		const view = resolveOperationScope([send(HIDDEN)], ACTIVE)
		expect(view?.followAccount).toBeUndefined()
		expect(view?.accountMismatch).toBe(false)
	})

	test("accountMismatch needs the row to match; on another row the account travels with the chain", () => {
		const view = resolveOperationScope([send(MAIN, LOCAL)], ACTIVE)
		expect(view?.networkMismatch).toBe(true)
		expect(view?.followAccount).toBe(MAIN)
		expect(view?.accountMismatch).toBe(false)
	})

	test("readOnly when no operation sends; operations without an account contribute no signer", () => {
		const view = resolveOperationScope([read(MAIN), op("register_contract", undefined)], ACTIVE)
		expect(view?.readOnly).toBe(true)
		expect(view?.signers).toEqual([MAIN])
		expect(resolveOperationScope([send(MAIN)], ACTIVE)?.readOnly).toBe(false)
	})
})

describe("scopeBannerState — the state table", () => {
	test("same row, signer is the active account → no banner", () => {
		expect(stateOf([send(SAVINGS)])).toBeUndefined()
		expect(stateOf([op("register_contract", undefined)])).toBeUndefined()
	})

	test("chain differs → chain, whether or not an account is followed; declining flips it", () => {
		expect(stateOf([send(MAIN, LOCAL)])).toBe("chain")
		expect(stateOf([send(MAIN, LOCAL), send(SAVINGS, LOCAL)])).toBe("chain")
		expect(stateOf([send(MAIN, LOCAL)], ACTIVE, true)).toBe("chain-declined")
	})

	test("same row, one signer that is not the active account → account; declining flips it", () => {
		expect(stateOf([send(MAIN)])).toBe("account")
		expect(stateOf([send(MAIN), read(SAVINGS)])).toBe("account")
		expect(stateOf([send(MAIN)], ACTIVE, true)).toBe("account-declined")
	})

	test("same row, several signers and no single sender → multi-signer, which declining cannot change", () => {
		expect(stateOf([send(MAIN), send(SAVINGS)])).toBe("multi-signer")
		expect(stateOf([read(MAIN), read(SAVINGS)])).toBe("multi-signer")
		expect(stateOf([send(MAIN), send(SAVINGS)], ACTIVE, true)).toBe("multi-signer")
	})

	test("a hidden lone signer on the same row shows nothing; on another row it names the chain only", () => {
		expect(stateOf([send(HIDDEN)])).toBeUndefined()
		const view = resolveOperationScope([send(HIDDEN, LOCAL)], ACTIVE)
		expect(scopeBannerState(view, false)).toBe("chain")
		expect(scopeBannerCopy("chain", view!, ACTIVE_ROWS).body).toBe(
			"Your wallet is on Testnet. It switches to Local Network after you confirm, so you can watch the transaction.",
		)
	})

	test("no view → no state", () => {
		expect(scopeBannerState(undefined, false)).toBeUndefined()
	})
})

describe("scopeBannerCopy — the owner-approved table, verbatim", () => {
	test("chain, with a follow account", () => {
		const view = resolveOperationScope([send(MAIN, LOCAL)], ACTIVE)!
		expect(scopeBannerCopy("chain", view, ACTIVE_ROWS)).toEqual({
			title: "Runs on Local Network",
			body: "Your wallet is on Savings · Testnet. It switches to Main · Local Network after you confirm, so you can watch the transaction.",
			action: "Stay on Testnet",
		})
		expect(scopeBannerCopy("chain-declined", view, ACTIVE_ROWS)).toEqual({
			title: "Runs on Local Network",
			body: "Your wallet stays on Savings · Testnet. This still executes — you just won't see it in your balances or activity.",
			action: "Switch after confirming",
		})
	})

	test("chain, chains only when several accounts send", () => {
		const view = resolveOperationScope([send(MAIN, LOCAL), send(SAVINGS, LOCAL)], ACTIVE)!
		expect(scopeBannerCopy("chain", view, ACTIVE_ROWS).body).toBe(
			"Your wallet is on Testnet. It switches to Local Network after you confirm, so you can watch the transaction.",
		)
		expect(scopeBannerCopy("chain-declined", view, ACTIVE_ROWS).body).toBe(
			"Your wallet stays on Testnet. This still executes — you just won't see it in your balances or activity.",
		)
	})

	test("account", () => {
		const view = resolveOperationScope([send(MAIN)], ACTIVE)!
		expect(scopeBannerCopy("account", view, ACTIVE_ROWS)).toEqual({
			title: "Signed by Main",
			body: "Your wallet is on Savings. It switches to Main after you confirm, so you can watch the transaction.",
			action: "Stay on Savings",
		})
		expect(scopeBannerCopy("account-declined", view, ACTIVE_ROWS)).toEqual({
			title: "Signed by Main",
			body: "Your wallet stays on Savings. This still executes — you just won't see it in your balances or activity.",
			action: "Switch after confirming",
		})
	})

	test("multi-signer names every signer and offers no action", () => {
		const view = resolveOperationScope([send(MAIN), send(SAVINGS)], ACTIVE)!
		expect(scopeBannerCopy("multi-signer", view, ACTIVE_ROWS)).toEqual({
			title: "Signed by 2 accounts",
			body: "Main, Savings. Each operation is signed by its own account; your wallet stays where it is.",
		})
	})

	test("a read-only payload drops the watch clause", () => {
		const view = resolveOperationScope([read(MAIN, LOCAL)], ACTIVE)!
		expect(scopeBannerCopy("chain", view, ACTIVE_ROWS).body).toBe(
			"Your wallet is on Savings · Testnet. It switches to Main · Local Network after you confirm.",
		)
		expect(scopeBannerCopy("account", resolveOperationScope([read(MAIN)], ACTIVE)!, ACTIVE_ROWS).body).toBe(
			"Your wallet is on Savings. It switches to Main after you confirm.",
		)
	})

	test("names are the rows' own: a renamed row reads by its new name", () => {
		const renamed = row(LOCAL.id, "Sandbox", LOCAL.chainId)
		const view = resolveOperationScope([send(MAIN, renamed)], ACTIVE)!
		expect(scopeBannerCopy("chain", view, ACTIVE_ROWS).title).toBe("Runs on Sandbox")
	})
})
