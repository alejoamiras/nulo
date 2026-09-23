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
