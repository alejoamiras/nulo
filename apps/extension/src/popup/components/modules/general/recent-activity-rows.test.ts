/**
 * Seam tests for the home-preview row math extracted from `RecentActivityView` (the component
 * suite still proves the wiring): scope filters, the token-object semantics (a PRESENT token with an
 * undefined id still scopes incoming rows), the slot math including the fallback-card rule, the
 * stable order for equal sort keys, and the budget slice.
 */
import { describe, expect, test } from "vitest"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import type { Tx } from "@/wallet/services/transaction/spec"
import { type RecentTokenScope, buildRecentActivityRows, remainingRowSlots } from "./recent-activity-rows"

const scope = { accountAddress: "0xme", chainId: 1, networkId: "net-1", profileId: "p1" }
const tx = (over: Record<string, unknown>): Tx =>
	({ hash: "0xh", account: "0xme", chainId: 1, profileId: "p1", updatedAt: 10, ...over }) as unknown as Tx
const inc = (over: Record<string, unknown>): IncomingTransferRecord =>
	({
		id: "i",
		tokenId: 1,
		accountAddress: "0xme",
		networkId: "net-1",
		profileId: "p1",
		discoveredAt: 5,
		...over,
	}) as unknown as IncomingTransferRecord
const op = (over: Record<string, unknown>): OperationRecord => ({ id: "j", terminalAt: 5, ...over }) as unknown as OperationRecord

describe("remainingRowSlots", () => {
	test.each([
		[0, 0, false, 5],
		[2, 0, false, 3],
		[0, 1, false, 4],
		[0, 0, true, 4],
		[3, 1, true, 0],
		[9, 0, false, 0],
	])("journal %i, orphan %i, fallback %s → %i", (journalCount, orphanCount, fallbackRendered, expected) => {
		expect(remainingRowSlots({ journalCount, orphanCount, fallbackRendered, budget: 5 })).toBe(expected)
	})
})

describe("buildRecentActivityRows — scope", () => {
	test("tx rows: foreign account, chain or profile are dropped; unstamped profile stays", () => {
		const rows = buildRecentActivityRows({
			journalOps: [],
			transactions: [
				tx({ hash: "keep" }),
				tx({ hash: "acct", account: "0xother" }),
				tx({ hash: "chain", chainId: 2 }),
				tx({ hash: "prof", profileId: "p2" }),
				tx({ hash: "unstamped", profileId: undefined }),
			],
			incomingTransfers: [],
			scope,
			token: undefined,
		})
		expect(rows.map((r) => r.key)).toEqual(["tx:keep", "tx:unstamped"])
	})

	test("incoming rows: foreign account, network or profile are dropped; unknown scope fields are tolerant", () => {
		const rows = buildRecentActivityRows({
			journalOps: [],
			transactions: [],
			incomingTransfers: [
				inc({ id: "keep" }),
				inc({ id: "acct", accountAddress: "0xother" }),
				inc({ id: "net", networkId: "net-2" }),
				inc({ id: "prof", profileId: "p2" }),
			],
			scope: { accountAddress: undefined, chainId: undefined, networkId: undefined, profileId: undefined },
			token: undefined,
		})
		expect(rows.map((r) => r.key).sort()).toEqual(["incoming:acct", "incoming:keep", "incoming:net", "incoming:prof"])
	})

	test("token scoping keys on the token OBJECT: absent → all; present → only its id, even an undefined one", () => {
		const transfers = [inc({ id: "t1", tokenId: 1 }), inc({ id: "t2", tokenId: 2 }), inc({ id: "none", tokenId: undefined })]
		const keys = (token: RecentTokenScope) =>
			buildRecentActivityRows({ journalOps: [], transactions: [], incomingTransfers: transfers, scope, token })
				.map((r) => r.key)
				.sort()
		expect(keys(undefined)).toEqual(["incoming:none", "incoming:t1", "incoming:t2"])
		expect(keys({ id: 1 })).toEqual(["incoming:t1"])
		expect(keys({})).toEqual(["incoming:none"])
	})
})

/** Wraps a record so every string-keyed property read is logged, in order. */
function recorded<T extends object>(target: T, log: string[]): T {
	return new Proxy(target, {
		get(t, key, receiver) {
			if (typeof key === "string") log.push(key)
			return Reflect.get(t, key, receiver)
		},
	})
}

describe("buildRecentActivityRows — scope pins", () => {
	const keysOf = (p: {
		transactions?: Tx[]
		incomingTransfers?: IncomingTransferRecord[]
		journalOps?: OperationRecord[]
		scope?: typeof scope
		token?: RecentTokenScope
	}) =>
		buildRecentActivityRows({ journalOps: [], transactions: [], incomingTransfers: [], scope, token: undefined, ...p }).map(
			(r) => r.key,
		)

	test("under a known scope, an incoming row stamped with another profile is dropped beside an identical kept one", () => {
		expect(keysOf({ incomingTransfers: [inc({ id: "mine", discoveredAt: 6 }), inc({ id: "theirs", profileId: "p2" })] })).toEqual([
			"incoming:mine",
		])
	})

	test("the incoming token check does not reach journal rows, which arrive filtered", () => {
		expect(
			keysOf({
				incomingTransfers: [inc({ id: "other-token", tokenId: 2 })],
				journalOps: [op({ id: "other-token-op", tokenId: 2 })],
				token: { id: 1 },
			}),
		).toEqual(["journal:other-token-op"])
	})

	test("chain id 0 is a known chain, not an unknown one", () => {
		expect(
			keysOf({ transactions: [tx({ hash: "zero", chainId: 0 }), tx({ hash: "one", chainId: 1 })], scope: { ...scope, chainId: 0 } }),
		).toEqual(["tx:zero"])
	})
})

describe("buildRecentActivityRows — read order", () => {
	test("under a token scope, another token's incoming row reads only its token; a kept one reads token, scope, sort key, id", () => {
		const reads = (over: Record<string, unknown>) => {
			const log: string[] = []
			buildRecentActivityRows({
				journalOps: [],
				transactions: [],
				incomingTransfers: [recorded(inc(over), log)],
				scope,
				token: { id: 1 },
			})
			return log
		}
		expect(reads({ tokenId: 2 })).toEqual(["tokenId"])
		expect(reads({ accountAddress: "0xother" })).toEqual(["tokenId", "accountAddress"])
		expect(reads({ networkId: "net-2" })).toEqual(["tokenId", "accountAddress", "networkId"])
		expect(reads({ profileId: "p2" })).toEqual(["tokenId", "accountAddress", "networkId", "profileId"])
		expect(reads({})).toEqual(["tokenId", "accountAddress", "networkId", "profileId", "blockTimestamp", "discoveredAt", "id"])
	})

	test("a tx stops at the first failed check, and a kept one reads its key after its scope", () => {
		const reads = (over: Record<string, unknown>) => {
			const log: string[] = []
			buildRecentActivityRows({
				journalOps: [],
				transactions: [recorded(tx(over), log)],
				incomingTransfers: [],
				scope,
				token: undefined,
			})
			return log
		}
		expect(reads({ account: "0xother" })).toEqual(["account"])
		expect(reads({ chainId: 2 })).toEqual(["account", "chainId"])
		expect(reads({})).toEqual(["account", "chainId", "profileId", "hash", "updatedAt"])
	})
})

describe("buildRecentActivityRows — order", () => {
	test("newest first across kinds; block timestamp (seconds) is scaled to ms; a null terminalAt sorts as 0", () => {
		const rows = buildRecentActivityRows({
			journalOps: [op({ id: "j", terminalAt: 7 }), op({ id: "jnull", terminalAt: null })],
			transactions: [tx({ hash: "h", updatedAt: 6_000 })],
			incomingTransfers: [inc({ id: "blk", blockTimestamp: 8, discoveredAt: 1 }), inc({ id: "disc", discoveredAt: 5_000 })],
			scope,
			token: undefined,
		})
		expect(rows.map((r) => r.key)).toEqual(["incoming:blk", "tx:h", "incoming:disc", "journal:j", "journal:jnull"])
	})

	test("equal sort keys keep insertion order: journal, then tx, then incoming", () => {
		const rows = buildRecentActivityRows({
			journalOps: [op({ id: "j", terminalAt: 5 })],
			transactions: [tx({ hash: "h", updatedAt: 5 })],
			incomingTransfers: [inc({ id: "i", discoveredAt: 5 })],
			scope,
			token: undefined,
		})
		expect(rows.map((r) => r.key)).toEqual(["journal:j", "tx:h", "incoming:i"])
	})
})
