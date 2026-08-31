/**
 * The diff is the half that decides what gets written, so it is pinned against
 * the ways the naive version is wrong: cross-chain pairing (the row schema
 * carries no chainId to catch it), hidden/imported accounts that legitimately
 * DO have rows, foreign-profile rows that must never be materialized, and the
 * never-projected rows that the missing-row half alone would strand.
 */

import { describe, expect, test } from "vitest"
import { type ReconcileAccount, type ReconcileRow, type ReconcileToken, reconcilePlan } from "./reconcile-pairs"

const MAINNET = 4248422646
const TESTNET = 1816023401

const token = (id: number, chainId = MAINNET): ReconcileToken => ({ id, chainId })
const account = (address: string, chainId = MAINNET, index = 0): ReconcileAccount => ({ address, chainId, index })
const row = (t: number, a: string, over: Partial<ReconcileRow> = {}): ReconcileRow => ({
	token: t,
	account: a,
	updatedAt: 1,
	...over,
})

const pairsOf = (p: ReturnType<typeof reconcilePlan>) => p.missing.map((m) => `${m.token.id}:${m.account.address}`)

describe("reconcilePlan — missing pairs", () => {
	test("an empty world plans nothing", () => {
		expect(reconcilePlan({ tokens: [], accounts: [], existing: [] })).toEqual({ missing: [], staleTokens: [] })
	})

	test("a token with no row on its chain yields exactly that pair", () => {
		const plan = reconcilePlan({ tokens: [token(1)], accounts: [account("0xa")], existing: [] })
		expect(pairsOf(plan)).toEqual(["1:0xa"])
	})

	test("an existing row suppresses its own pair and nothing else", () => {
		const plan = reconcilePlan({
			tokens: [token(1), token(2)],
			accounts: [account("0xa")],
			existing: [row(1, "0xa")],
		})
		expect(pairsOf(plan)).toEqual(["2:0xa"])
	})

	test("pairs NEVER cross chains — the row schema has no chainId to catch it downstream", () => {
		const plan = reconcilePlan({
			tokens: [token(1, MAINNET)],
			accounts: [account("0xtestnet", TESTNET), account("0xmainnet", MAINNET)],
			existing: [],
		})
		expect(pairsOf(plan)).toEqual(["1:0xmainnet"])
	})

	test("hidden and imported accounts are included — they legitimately hold rows", () => {
		// The caller passes getAccountsRaw output, which has no visibility filter
		// at all; excluding them here would under-create exactly the rows
		// `onTokenAdded`'s `all: true` exists to cover.
		const plan = reconcilePlan({
			tokens: [token(1)],
			accounts: [account("0xvisible", MAINNET, 0), account("0xhidden", MAINNET, 1)],
			existing: [],
		})
		expect(pairsOf(plan)).toEqual(["1:0xvisible", "1:0xhidden"])
	})

	test("a foreign row is never materialized — an unknown pair cannot suppress a creation", () => {
		const plan = reconcilePlan({
			tokens: [token(1)],
			accounts: [account("0xa")],
			existing: [row(99, "0xforeign"), row(1, "0xsomeoneelse")],
		})
		expect(pairsOf(plan)).toEqual(["1:0xa"])
		expect(plan.staleTokens).toEqual([])
	})

	test("duplicated inputs cannot produce the same pair twice", () => {
		const plan = reconcilePlan({
			tokens: [token(1), token(1)],
			accounts: [account("0xa"), account("0xa")],
			existing: [],
		})
		expect(pairsOf(plan)).toEqual(["1:0xa"])
	})
})

describe("reconcilePlan — never-projected rows", () => {
	test("a row at updatedAt 0 with no failure is stale — the worker died before enqueue", () => {
		const plan = reconcilePlan({
			tokens: [token(1)],
			accounts: [account("0xa")],
			existing: [row(1, "0xa", { updatedAt: 0 })],
		})
		expect(plan.missing).toEqual([])
		expect(plan.staleTokens).toHaveLength(1)
	})

	test("a row that already FAILED is left to the queue's own retry", () => {
		const plan = reconcilePlan({
			tokens: [token(1)],
			accounts: [account("0xa")],
			existing: [row(1, "0xa", { updatedAt: 0, syncFailure: { kind: "rpc" } })],
		})
		expect(plan.staleTokens).toEqual([])
	})

	test("a projected row is neither missing nor stale", () => {
		const plan = reconcilePlan({
			tokens: [token(1)],
			accounts: [account("0xa")],
			existing: [row(1, "0xa", { updatedAt: 1700000000000 })],
		})
		expect(plan).toEqual({ missing: [], staleTokens: [] })
	})

	test("a never-projected row for a FOREIGN pair is not re-enqueued", () => {
		const plan = reconcilePlan({
			tokens: [token(1)],
			accounts: [account("0xa")],
			existing: [row(42, "0xnotmine", { updatedAt: 0 })],
		})
		expect(plan.staleTokens).toEqual([])
	})
})

describe("reconcilePlan — ordering", () => {
	test("order is total and independent of input permutation", () => {
		const tokens = [token(2, TESTNET), token(1, MAINNET), token(3, MAINNET)]
		const accounts = [account("0xb", MAINNET, 1), account("0xa", MAINNET, 0), account("0xt", TESTNET, 0)]
		const forward = pairsOf(reconcilePlan({ tokens, accounts, existing: [] }))
		const reversed = pairsOf(reconcilePlan({ tokens: [...tokens].reverse(), accounts: [...accounts].reverse(), existing: [] }))
		expect(forward).toEqual(reversed)
		// chainId, then token id, then account index — TESTNET's id is the
		// smaller number, so its pairs sort first.
		expect(forward).toEqual(["2:0xt", "1:0xa", "1:0xb", "3:0xa", "3:0xb"])
	})

	test("same chain and token falls through to account index, then address", () => {
		const plan = reconcilePlan({
			tokens: [token(1)],
			accounts: [account("0xz", MAINNET, 0), account("0xa", MAINNET, 0), account("0xm", MAINNET, 1)],
			existing: [],
		})
		expect(pairsOf(plan)).toEqual(["1:0xa", "1:0xz", "1:0xm"])
	})
})

describe("reconcilePlan — cost shape", () => {
	test("a large world stays linear and correct", () => {
		const tokens = Array.from({ length: 50 }, (_, i) => token(i + 1))
		const accounts = Array.from({ length: 40 }, (_, i) => account(`0x${i}`, MAINNET, i))
		// Every pair exists except the last token's rows.
		const existing = tokens.slice(0, 49).flatMap((t) => accounts.map((a) => row(t.id, a.address)))

		const plan = reconcilePlan({ tokens, accounts, existing })

		expect(plan.missing).toHaveLength(40)
		expect(plan.missing.every((m) => m.token.id === 50)).toBe(true)
		expect(plan.staleTokens).toEqual([])
	})
})
