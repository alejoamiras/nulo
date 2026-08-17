/**
 * Behavioral coverage for IncomingTransferService.
 *
 * Pairs with the orderByBlockIndex pin in service.test.ts. This file
 * carries the broader-scope tests audit-flagged in earlier phases:
 *   - P3: PopupManager/RecentActivityView mount wiring is covered in
 *     PopupManager.test.ts (the .vue file mounts already exercise the
 *     ServiceClient.connect path).
 *   - P4: visibility gate matrix on scanContract.onIncomingTransferPending
 *         + replayPendingPrompts.
 *   - P5: account lifecycle (onAccountAdded → hydrateSchedulers;
 *         onAccountDeleted → tear down per-network scheduler).
 *   - P8 dedup + late-delete + trust transitions (this file's headline).
 *
 * Fixture strategy: mock IncomingTransferRepository with an in-memory
 * Map-backed shape; stub the 8 declared dependencies as plain objects
 * with the surface scanContract / replayPendingPrompts / lifecycle
 * handlers actually touch. The real ServiceCollection.start() flow is
 * used so init() runs end-to-end.
 */

import { EventHandler } from "@nulo/wallet-core/utils"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { flushPromises } from "@vue/test-utils"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { beforeEach, describe, expect, test, vi } from "vitest"

// Static (module-scope) import: pays Vite's cold transform of this service +
// its inlined @nulo/* graph during the file's import phase, NOT inside the first
// test's 5s budget. Under Vite 8 that cold transform can exceed 5s on CI's
// shared runner, which timed out the first `bootService()` when the import was
// dynamic. vi.mock("./repository") is hoisted above this, so the mock still applies.
import { IncomingTransferService } from "./service"
import { PublicScanCursorSchema, noteRecordId } from "./spec"
import type { IncomingNoteRecord, IncomingPublicEventRecord, IncomingTransferRecord, IncomingTrustRecord, IncomingTrustState } from "./spec"
import { TaskStatus } from "@/wallet/services/task/spec"
import type { PublicEventReader } from "./public-event-indexer"
import type {
	PublicScanTips,
	PublicTokenClassStatus,
	PublicTransferEvent,
	PublicTransferFetchArgs,
	PublicTransferPage,
} from "@nulo/aztec-runtime/pxe/public-events"

// ── Repo mock (in-memory) ────────────────────────────────────────────────

const records = new Map<string, IncomingTransferRecord>()
const trust = new Map<string, IncomingTrustRecord>()
const cursors = new Map<string, unknown>()
const outbox = new Map<string, unknown>()

function trustKey(profileId: string, networkId: string, contract: string): string {
	return `${profileId}|${networkId}|${contract}`
}

vi.mock("./repository", () => ({
	// A constructable class — Vitest 4 refuses to `new` a vi.fn whose impl is an
	// arrow, and Biome rewrites a `function` impl back to an arrow. The mock's
	// call-tracking isn't asserted, so a plain class returning the in-memory
	// fake is the robust form.
	IncomingTransferRepository: class {
		constructor() {
			// biome-ignore lint/correctness/noConstructorReturn: mock ctor returns the in-memory fake
			return {
				getRecord: async (k: string) => records.get(k),
				hasRecord: async (k: string) => records.has(k),
				upsertRecord: async (r: IncomingTransferRecord) => {
					records.set(r.id, r)
				},
				deleteRecord: async (k: string) => {
					records.delete(k)
				},
				listRecords: async () => [...records.values()],
				listForAccount: async (p: string, n: string, a: string) =>
					[...records.values()].filter((r) => r.profileId === p && r.networkId === n && r.accountAddress === a),
				listByTxHash: async (p: string, n: string, h: string) =>
					[...records.values()].filter((r) => r.profileId === p && r.networkId === n && r.txHash === h),
				listByContract: async (p: string, n: string, c: string) =>
					[...records.values()].filter((r) => r.profileId === p && r.networkId === n && r.contract === c),
				getTrust: async (p: string, n: string, c: string) => trust.get(trustKey(p, n, c)),
				setTrust: async (p: string, n: string, c: string, state: IncomingTrustState) => {
					const rec: IncomingTrustRecord = { profileId: p, networkId: n, contract: c, state, updatedAt: 0 }
					trust.set(trustKey(p, n, c), rec)
					return rec
				},
				listTrust: async () => [...trust.values()],
				clearProfile: async (p: string) => {
					for (const [k, v] of records) if (v.profileId === p) records.delete(k)
					for (const [k, v] of trust) if (v.profileId === p) trust.delete(k)
				},
				clearChain: async (p: string, n: string) => {
					for (const [k, v] of records) if (v.profileId === p && v.networkId === n) records.delete(k)
					for (const [k, v] of trust) if (v.profileId === p && v.networkId === n) trust.delete(k)
					for (const key of cursors.keys()) if (key.startsWith(`${p}|${n}|`)) cursors.delete(key)
					for (const key of outbox.keys()) if (key.startsWith(`${p}|${n}|`)) outbox.delete(key)
				},
				// Public-event cursors (D3/D6).
				getCursor: async (p: string, n: string, c: string) => cursors.get(`${p}|${n}|${c}`),
				setCursor: async (p: string, n: string, c: string, cur: unknown) => {
					cursors.set(`${p}|${n}|${c}`, cur)
				},
				deleteCursor: async (p: string, n: string, c: string) => {
					cursors.delete(`${p}|${n}|${c}`)
				},
				listCursors: async () => [...cursors.entries()],
				// Balance-refresh outbox (D4).
				getOutbox: async (p: string, n: string, a: string, t: number) => outbox.get(`${p}|${n}|${a}|${t}`),
				setOutbox: async (p: string, n: string, a: string, t: number, row: unknown) => {
					outbox.set(`${p}|${n}|${a}|${t}`, row)
				},
				deleteOutbox: async (p: string, n: string, a: string, t: number) => {
					outbox.delete(`${p}|${n}|${a}|${t}`)
				},
				listOutbox: async () => [...outbox.entries()],
			}
		}
	},
	trustKey,
}))

// ── Stub services ───────────────────────────────────────────────────────
//
// Each stub matches the IService shape (name + dependencies? + start) and
// exposes the surface IncomingTransferService.init touches.

function eh<T>(): EventHandler<T> {
	return new EventHandler<T>()
}

function makeProfileStub(activeProfile: { id: string } | null = { id: "p1" }) {
	return {
		name: "profile",
		dependencies: [],
		onActiveProfileChanged: eh<void>(),
		onProfileDeleted: eh<{ id: string }>(),
		getActiveProfile: vi.fn().mockResolvedValue(activeProfile),
		async start() {},
	}
}

function makeNetworkStub(
	networks: { id: string; chainId: number; endpoints?: { id: string; rpcUrl: string }[]; primaryEndpointId?: string }[] = [
		{ id: "n1", chainId: 1, endpoints: [{ id: "e1", rpcUrl: "http://n1" }], primaryEndpointId: "e1" },
	],
) {
	let purgeSub: ((profileId: string, chainId: number, networkId: string) => Promise<void>) | null = null
	// getReceiptFee reaches through getNodeForUrl(endpoint).getTxReceipt(txHash) (or getNode(chainId) as a
	// fallback); tests inject the receipt via setReceiptImpl. Unset → the node throws (unreachable), which
	// getReceiptFee swallows to null. The receipt's blockHash gates caching (reorg-safety).
	type FakeReceipt = { transactionFee?: bigint; blockHash?: { toString(): string } }
	let receiptImpl: ((txHashStr: string) => Promise<FakeReceipt>) | null = null
	const fakeNode = {
		getTxReceipt: async (txHash: { toString(): string }) => {
			if (!receiptImpl) throw new Error("no node receipt configured")
			return receiptImpl(txHash.toString())
		},
	}
	return {
		name: "network",
		dependencies: [],
		networks,
		// Real networks carry endpoints; getReceiptFee pins the fetch to the primary endpoint's URL.
		getNode: vi.fn().mockImplementation(async (_chainId: number) => fakeNode),
		getNodeForUrl: vi.fn().mockImplementation(async (_url: string) => fakeNode),
		setReceiptImpl(fn: ((txHashStr: string) => Promise<FakeReceipt>) | null) {
			receiptImpl = fn
		},
		getNetworks: vi.fn().mockImplementation(async (chainId?: number) => {
			if (chainId === undefined) return networks
			return networks.filter((n) => n.chainId === chainId)
		}),
		// Profile-scoped read (finding C) — the stub networks belong to the test
		// profile, so filter by chainId only (profileId is accepted + ignored).
		getNetworksRaw: vi.fn().mockImplementation(async (_profileId: string, chainId?: number) => {
			if (chainId === undefined) return networks
			return networks.filter((n) => n.chainId === chainId)
		}),
		getNetwork: vi.fn().mockImplementation(async (id: string) => networks.find((n) => n.id === id)),
		registerChainPurgeSubscriber(sub: typeof purgeSub) {
			purgeSub = sub
		},
		async firePurge(profileId: string, chainId: number, networkId: string) {
			await purgeSub?.(profileId, chainId, networkId)
		},
		async start() {},
	}
}

function makeAccountStub(accounts: { profileId: string; chainId: number; address: string }[] = []) {
	return {
		name: "account",
		dependencies: [],
		onAccountAdded: eh<{ profileId: string; chainId: number; address: string }>(),
		onAccountUpdated: eh<{ profileId: string; chainId: number; address: string }>(),
		onAccountDeleted: eh<{ profileId: string; chainId: number; address: string }>(),
		getAccounts: vi.fn().mockImplementation(async (_p: string, chainId: number) => {
			return accounts.filter((a) => a.chainId === chainId)
		}),
		async start() {},
	}
}

function makeTokenStub(tokens: { id: number; chainId: number; contract: string; symbol: string; decimals: number }[] = []) {
	return {
		name: "token",
		dependencies: [],
		onTokenAdded: eh<unknown>(),
		onTokenDeleted: eh<unknown>(),
		getTokensRaw: vi.fn().mockResolvedValue(tokens),
		async start() {},
	}
}

function makeTransactionStub(txs: { hash: string; account: string; chainId: number; profileId?: string; networkId?: string }[] = []) {
	return {
		name: "transaction",
		dependencies: [],
		onTransactionAdded: eh<{ hash: string; account: string; chainId: number; calls: unknown[] }>(),
		// Real surface: `getTransactions(accountAddress)` returns all txs for
		// the address ACROSS profiles and networks; the service must filter to
		// the scanned scope locally. Pinning the argspec here keeps the test
		// honest with what scanContract calls.
		getTransactions: vi.fn().mockImplementation(async (account: string) => {
			return txs.filter((t) => t.account === account)
		}),
		async start() {},
	}
}

function makeJournalStub(
	operations: { accountAddress?: string; networkId?: string; progress?: { stage?: string; txHash?: string } }[] = [],
) {
	return {
		name: "operation-journal",
		dependencies: [],
		getOperations: vi.fn().mockResolvedValue(operations),
		async start() {},
	}
}

function makeNoteStub(notesByContract: Record<string, unknown[]> = {}, blockTimestampsByNumber: Record<number, number | undefined> = {}) {
	return {
		name: "note",
		dependencies: [],
		getNotesRaw: vi.fn().mockImplementation(async (_n: string, _a: string, contract: string) => {
			return notesByContract[contract] ?? []
		}),
		getBlockTimestamp: vi.fn().mockImplementation(async (_n: string, blockNumber: number) => {
			return blockTimestampsByNumber[blockNumber]
		}),
		async start() {},
	}
}

function makeConfigStub(initialVisibility: boolean = true) {
	let visibility = initialVisibility
	let dustThreshold = 0
	return {
		name: "config",
		dependencies: [],
		getValue: vi.fn().mockImplementation(async (key: string) => {
			if (key === "incomingTransfersVisible") return visibility
			if (key === "incomingDustUsdThreshold") return dustThreshold
			return undefined
		}),
		setVisibility(v: boolean) {
			visibility = v
		},
		setDustThreshold(t: number) {
			dustThreshold = t
		},
		async start() {},
	}
}

/** TokenBalanceService stub with a configurable `requestBalanceRefresh` result (D4). `setResult` can
 *  return `{missing:true}` (the balance pair is positively gone → drain deletes the row); `setThrow`
 *  simulates a TRANSIENT storage/task failure (a real throw → drain KEEPS the row — codex R1 High #4). */
function makeTokenBalanceStub() {
	const state = { result: { busy: true } as { taskId: string } | { busy: true } | { missing: true }, throwOnRequest: false }
	const requestBalanceRefresh = vi.fn(async (_tokenId: number, _account: string) => {
		if (state.throwOnRequest) throw new Error("transient storage failure")
		return state.result
	})
	return {
		name: "token-balance",
		dependencies: [],
		requestBalanceRefresh,
		setResult(r: { taskId: string } | { busy: true } | { missing: true }) {
			state.result = r
		},
		setThrow(t: boolean) {
			state.throwOnRequest = t
		},
		async start() {},
	}
}

/** PriceService stub — `getQuotes` returns a settable `coingeckoId → {usd}` map (D8 dust filter). */
function makePriceStub() {
	const state = { quotes: {} as Record<string, { usd: number }> }
	return {
		name: "price",
		dependencies: [],
		getQuotes: vi.fn(async () => state.quotes),
		setQuotes(q: Record<string, { usd: number }>) {
			state.quotes = q
		},
		async start() {},
	}
}

/** TaskService stub — `getTaskSync` reads from a settable in-memory ledger (D4 causal ack). */
function makeTaskStub() {
	const tasks = new Map<string, { status: number; finishedAt?: number }>()
	return {
		name: "task",
		dependencies: [],
		getTaskSync: vi.fn((id: string) => {
			const t = tasks.get(id)
			if (!t) throw new Error("Invalid task id")
			return { id, status: t.status, finishedAt: t.finishedAt }
		}),
		setTask(id: string, status: number, finishedAt?: number) {
			tasks.set(id, { status, finishedAt })
		},
		async start() {},
	}
}

// ── Service bootstrap ───────────────────────────────────────────────────

async function bootService(
	stubs: {
		profile?: ReturnType<typeof makeProfileStub>
		network?: ReturnType<typeof makeNetworkStub>
		account?: ReturnType<typeof makeAccountStub>
		token?: ReturnType<typeof makeTokenStub>
		transaction?: ReturnType<typeof makeTransactionStub>
		journal?: ReturnType<typeof makeJournalStub>
		note?: ReturnType<typeof makeNoteStub>
		config?: ReturnType<typeof makeConfigStub>
		tokenBalance?: ReturnType<typeof makeTokenBalanceStub>
		task?: ReturnType<typeof makeTaskStub>
		price?: ReturnType<typeof makePriceStub>
		publicReader?: PublicEventReader
	} = {},
) {
	const fixture = {
		profile: stubs.profile ?? makeProfileStub(),
		network: stubs.network ?? makeNetworkStub(),
		account: stubs.account ?? makeAccountStub(),
		token: stubs.token ?? makeTokenStub(),
		transaction: stubs.transaction ?? makeTransactionStub(),
		journal: stubs.journal ?? makeJournalStub(),
		note: stubs.note ?? makeNoteStub(),
		config: stubs.config ?? makeConfigStub(),
		tokenBalance: stubs.tokenBalance ?? makeTokenBalanceStub(),
		task: stubs.task ?? makeTaskStub(),
		price: stubs.price ?? makePriceStub(),
	}
	const logger = new LoggerStore(new ConfigStore())
	// Huge poll interval so scheduler doesn't fire during tests; we exercise
	// the scan path via the public surface or via direct method calls.
	const browserApi = new FakeBrowserApi()
	browserApi.reset()
	const service = new IncomingTransferService(logger, browserApi, 1_000_000, stubs.publicReader)
	const collection = new ServiceCollection()
	for (const stub of Object.values(fixture)) collection.add(stub as never)
	collection.add(service)
	await collection.start()
	return { service, ...fixture }
}

beforeEach(() => {
	records.clear()
	trust.clear()
	cursors.clear()
	outbox.clear()
})

/** Build a valid note-kind record with the `id` ALWAYS derived from the final
 *  (profileId, networkId, siloedNullifier) — so a `{ ...other }` spread can't carry a stale id. */
function noteRecord(overrides: Partial<IncomingNoteRecord> = {}): IncomingNoteRecord {
	const merged = {
		kind: "note" as const,
		siloedNullifier: validNullifier(1),
		profileId: "p1",
		networkId: "n1",
		accountAddress: "0xa",
		contract: "0xc",
		tokenId: 1,
		owner: "0xa",
		amountRaw: "100",
		noteHash: "0xnh",
		txHash: "0xtx",
		l2BlockNumber: 1,
		txIndexInBlock: 0,
		indexInTx: 0,
		hidden: false,
		discoveredAt: 0,
		...overrides,
	}
	return { ...merged, id: noteRecordId(merged.profileId, merged.networkId, merged.siloedNullifier) }
}

/** Seed a note record keyed by its `id` (matches the repo's real keying). Returns the record. */
function seedNote(overrides: Partial<IncomingNoteRecord> = {}): IncomingNoteRecord {
	const r = noteRecord(overrides)
	records.set(r.id, r)
	return r
}

// ── Tests ───────────────────────────────────────────────────────────────

const validNullifier = (n: number) => `0x${n.toString(16).padStart(64, "0")}`
const tokenA = { id: 1, profileId: "p1", chainId: 1, contract: "0xtokenA", symbol: "TKA", decimals: 18 }
const tokenB = { id: 2, chainId: 1, contract: "0xtokenB", symbol: "TKB", decimals: 18 }

function note(
	overrides: Partial<{
		siloedNullifier: string
		noteHash: string
		l2BlockNumber: number
		txIndexInBlock: number
		noteIndexInTx: number
		contract: string
		storageSlot: string
		txHash: string
		rawContent: string[]
		content: Record<string, string>
	}> = {},
) {
	return {
		siloedNullifier: validNullifier(1),
		noteHash: "0xnh1",
		l2BlockNumber: 100,
		txIndexInBlock: 0,
		indexInTx: 0,
		contract: tokenA.contract,
		storageSlot: "0xslot",
		txHash: "0xtx1",
		rawContent: [],
		content: { value: "1000" },
		...overrides,
	}
}

async function scan(service: unknown, contract: string = tokenA.contract) {
	await (service as { scanContract: (p: string, n: string, a: string, c: string) => Promise<void> }).scanContract(
		"p1",
		"n1",
		"0xa",
		contract,
	)
}

describe("IncomingTransferService — public surface gating (P4 visibility)", () => {
	test("getIncomingTransfers returns [] when incomingTransfersVisible=false", async () => {
		const config = makeConfigStub(false)
		const { service } = await bootService({ config })
		seedNote({
			siloedNullifier: "k",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		const out = await service.getIncomingTransfers("p1", "n1", "0xa")
		expect(out).toEqual([])
	})

	test("getIncomingTransfers returns visible records when visibility=true", async () => {
		const { service } = await bootService()
		seedNote({
			siloedNullifier: "k",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		const out = await service.getIncomingTransfers("p1", "n1", "0xa")
		expect(out).toHaveLength(1)
	})

	test("getIncomingTransfers fails CLOSED on a config error (returns [], record stays persisted)", async () => {
		const config = makeConfigStub()
		const { service } = await bootService({ config })
		records.set("k", {
			kind: "note",
			id: "note:p1|n1|k",
			siloedNullifier: "k",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		// Config port hiccup for the visibility key → the READ path must not expose records.
		config.getValue.mockImplementation(async (key: string) => {
			if (key === "incomingTransfersVisible") throw new Error("config down")
			return undefined
		})
		const out = await service.getIncomingTransfers("p1", "n1", "0xa")
		expect(out).toEqual([])
		// Still persisted — reappears once visibility can be read again.
		expect(records.size).toBe(1)
	})

	test("getIncomingTransfers filters hidden records", async () => {
		const { service } = await bootService()
		seedNote({
			siloedNullifier: "v",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx1",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		seedNote({
			siloedNullifier: "h",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx2",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		const out = await service.getIncomingTransfers("p1", "n1", "0xa")
		expect(out).toHaveLength(1)
		expect((out[0] as IncomingNoteRecord).siloedNullifier).toBe("v")
	})

	test("replayPendingPrompts is a no-op when visibility=false (P4 regression pin)", async () => {
		const config = makeConfigStub(false)
		const { service } = await bootService({ config })
		const seen = vi.fn()
		service.onIncomingTransferPending.add(seen)
		// Pre-seed a pending trust record so the method has something to emit.
		trust.set(trustKey("p1", "n1", "0xtokenA"), {
			profileId: "p1",
			networkId: "n1",
			contract: "0xtokenA",
			state: "pending",
			updatedAt: 0,
		})
		seedNote({
			siloedNullifier: validNullifier(7),
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xtokenA",
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		await service.replayPendingPrompts("p1", "n1", "0xa")
		expect(seen).not.toHaveBeenCalled()
	})

	test("replayPendingPrompts emits for each pending contract when visibility=true", async () => {
		const token = makeTokenStub([tokenA, tokenB])
		const { service } = await bootService({ token })
		const seen = vi.fn()
		service.onIncomingTransferPending.add(seen)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "pending",
			updatedAt: 0,
		})
		trust.set(trustKey("p1", "n1", tokenB.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenB.contract,
			state: "pending",
			updatedAt: 0,
		})
		seedNote({
			siloedNullifier: "ka",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx1",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		seedNote({
			siloedNullifier: "kb",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenB.contract,
			tokenId: 2,
			owner: "0xa",
			amountRaw: "200",
			noteHash: "0xnh",
			txHash: "0xtx2",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		await service.replayPendingPrompts("p1", "n1", "0xa")
		expect(seen).toHaveBeenCalledTimes(2)
	})
})

describe("IncomingTransferService — trust transitions", () => {
	test("setTrustAllow flips hidden records visible + emits onIncomingTransferAdded", async () => {
		const token = makeTokenStub([tokenA])
		const { service } = await bootService({ token })
		seedNote({
			siloedNullifier: "k",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		const added = vi.fn()
		service.onIncomingTransferAdded.add(added)
		await service.setTrustAllow("p1", "n1", tokenA.contract)
		expect(records.get("note:p1|n1|k")?.hidden).toBe(false)
		expect(added).toHaveBeenCalledTimes(1)
	})

	test("setTrustAllow with visibility=false flips records visible but does NOT emit (P4 carry)", async () => {
		const config = makeConfigStub(false)
		const { service } = await bootService({ config, token: makeTokenStub([tokenA]) })
		seedNote({
			siloedNullifier: "k",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		const added = vi.fn()
		service.onIncomingTransferAdded.add(added)
		await service.setTrustAllow("p1", "n1", tokenA.contract)
		// Records flipped (so a future toggle-on shows them) but no live event.
		expect(records.get("note:p1|n1|k")?.hidden).toBe(false)
		expect(added).not.toHaveBeenCalled()
	})

	test("setTrustReject sets state=blocked + does NOT flip hidden records visible", async () => {
		const { service } = await bootService({ token: makeTokenStub([tokenA]) })
		seedNote({
			siloedNullifier: "k",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		await service.setTrustReject("p1", "n1", tokenA.contract)
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("blocked")
		expect(records.get("note:p1|n1|k")?.hidden).toBe(true)
	})
})

describe("IncomingTransferService — account lifecycle (P5 carry)", () => {
	test("onAccountDeleted clears scheduler entries for that account across networks", async () => {
		const network = makeNetworkStub([
			{ id: "n1", chainId: 1 },
			{ id: "n2", chainId: 1 },
		])
		const account = makeAccountStub([
			{ profileId: "p1", chainId: 1, address: "0xa" },
			{ profileId: "p1", chainId: 1, address: "0xb" },
		])
		const token = makeTokenStub([tokenA])
		const { service } = await bootService({ network, account, token })

		// Hydrate populates schedulers for both accounts on both networks.
		const schedulers = (service as never as { schedulers: Map<string, unknown> }).schedulers
		expect(schedulers.has("n1|0xa")).toBe(true)
		expect(schedulers.has("n2|0xa")).toBe(true)
		expect(schedulers.has("n1|0xb")).toBe(true)

		// Fire delete for 0xa.
		account.onAccountDeleted.invoke({ profileId: "p1", chainId: 1, address: "0xa" })
		await flushPromises()

		// Both 0xa entries gone; 0xb stays.
		expect(schedulers.has("n1|0xa")).toBe(false)
		expect(schedulers.has("n2|0xa")).toBe(false)
		expect(schedulers.has("n1|0xb")).toBe(true)
	})

	test("onAccountDeleted with networkService throw: no crash, no state change", async () => {
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const account = makeAccountStub()
		const { service } = await bootService({ network, account })
		// Failure mode applies only to the post-init delete handler — hydrate
		// has already finished.
		network.getNetworks.mockRejectedValueOnce(new Error("transport"))
		const schedulersBefore = new Map((service as never as { schedulers: Map<string, unknown> }).schedulers)

		account.onAccountDeleted.invoke({ profileId: "p1", chainId: 1, address: "0xa" })
		await flushPromises()

		const schedulersAfter = (service as never as { schedulers: Map<string, unknown> }).schedulers
		expect(schedulersAfter.size).toBe(schedulersBefore.size)
	})

	test("(P12 backfill) onAccountAdded → hydrateSchedulers populates a scheduler entry for the new account", async () => {
		// Symmetric to onAccountDeleted. Codex Low #2 from the prior arc:
		// without this pin, a future refactor that drops the
		// `accountService.onAccountAdded.add(...)` subscription would silently
		// regress the "new account starts scanning immediately" behavior.
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		// Start with no accounts; we'll inject one via the event below.
		const account = makeAccountStub([])
		const { service } = await bootService({ network, account, token })

		const schedulers = (service as never as { schedulers: Map<string, unknown> }).schedulers
		expect(schedulers.has("n1|0xnewAccount")).toBe(false)

		// Mutate the account stub's backing list BEFORE firing the event —
		// hydrateSchedulers reads via getAccounts which the stub filters
		// against the list.
		account.getAccounts.mockImplementation(async (_p: string, chainId: number) => {
			if (chainId !== 1) return []
			return [{ profileId: "p1", chainId: 1, address: "0xnewAccount" }]
		})
		account.onAccountAdded.invoke({ profileId: "p1", chainId: 1, address: "0xnewAccount" })
		await flushPromises()

		expect(schedulers.has("n1|0xnewAccount")).toBe(true)
	})
})

describe("IncomingTransferService — scanContract dedup + emit semantics", () => {
	test("first note from unknown contract → pending state + Pending emit (visibility=true)", async () => {
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note()] })
		const { service } = await bootService({ network, token, note: noteSvc })

		const pending = vi.fn()
		const added = vi.fn()
		service.onIncomingTransferPending.add(pending)
		service.onIncomingTransferAdded.add(added)

		await scan(service)

		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("pending")
		expect(pending).toHaveBeenCalledTimes(1)
		// Pending state → record is hidden → no Added emit.
		expect(added).not.toHaveBeenCalled()
		// Record is persisted (hidden) for the future toggle-on / Allow path.
		const persisted = [...records.values()]
		expect(persisted).toHaveLength(1)
		expect(persisted[0].hidden).toBe(true)
	})

	test("(P4 carry) scanContract pending emit gated on visibility=false — record persisted, no emit", async () => {
		const config = makeConfigStub(false)
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note()] })
		const { service } = await bootService({ config, network, token, note: noteSvc })

		const pending = vi.fn()
		service.onIncomingTransferPending.add(pending)

		await scan(service)

		// Trust transition still happens (so toggle-on can replay) — only the
		// emit is silenced.
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("pending")
		expect(pending).not.toHaveBeenCalled()
		expect([...records.values()]).toHaveLength(1)
	})

	test("trusted contract: scanContract emits Added per note + persists visible", async () => {
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note()] })
		const { service } = await bootService({ network, token, note: noteSvc })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		const added = vi.fn()
		service.onIncomingTransferAdded.add(added)

		await scan(service)

		expect(added).toHaveBeenCalledTimes(1)
		expect([...records.values()][0].hidden).toBe(false)
	})

	test("visibility fails CLOSED: a config error suppresses the Added emit but persists the record hidden", async () => {
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note()] })
		const config = makeConfigStub()
		const { service } = await bootService({ network, token, note: noteSvc, config })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		// Config port hiccup ONLY for the visibility key (boot stays clean).
		config.getValue.mockImplementation(async (key: string) => {
			if (key === "incomingTransfersVisible") throw new Error("config port down")
			return undefined
		})
		const added = vi.fn()
		service.onIncomingTransferAdded.add(added)

		await scan(service)

		// Privacy control fails closed: no emit when visibility can't be confirmed…
		expect(added).not.toHaveBeenCalled()
		// …but the record is persisted (hidden), so it reappears once visibility resolves.
		expect(records.size).toBe(1)
	})

	test("dedupe source 1 (prior records): existing siloedNullifier → skip", async () => {
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		const n = note()
		const noteSvc = makeNoteStub({ [tokenA.contract]: [n] })
		const { service } = await bootService({ network, token, note: noteSvc })
		seedNote({
			siloedNullifier: n.siloedNullifier,
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: 1,
			owner: "0xa",
			amountRaw: "1000",
			noteHash: "x",
			txHash: n.txHash,
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})

		const pending = vi.fn()
		const added = vi.fn()
		service.onIncomingTransferPending.add(pending)
		service.onIncomingTransferAdded.add(added)

		await scan(service)

		expect(pending).not.toHaveBeenCalled()
		expect(added).not.toHaveBeenCalled()
	})

	test("dedupe source 2 (outgoing tx hash): note with matching outgoing hash → skip", async () => {
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		const transaction = makeTransactionStub([{ hash: "0xtx1", account: "0xa", chainId: 1, profileId: "p1", networkId: "n1" }])
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ txHash: "0xtx1" })] })
		const { service } = await bootService({ network, token, transaction, note: noteSvc })

		const pending = vi.fn()
		service.onIncomingTransferPending.add(pending)

		await scan(service)

		// Skipped → no trust transition either; nothing to prompt about.
		expect(pending).not.toHaveBeenCalled()
		expect(trust.size).toBe(0)
	})

	test("a FOREIGN profile's outgoing tx does not suppress this scope's note", async () => {
		// p2 shares address 0xa (same seed) and sent 0xtx1 on the same chain.
		// From p1's silo that send is someone else's activity — the note must
		// surface as incoming, exactly like another device's outgoing does.
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		const transaction = makeTransactionStub([{ hash: "0xtx1", account: "0xa", chainId: 1, profileId: "p2", networkId: "n9" }])
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ txHash: "0xtx1" })] })
		const { service } = await bootService({ network, token, transaction, note: noteSvc })

		const pending = vi.fn()
		service.onIncomingTransferPending.add(pending)

		await scan(service)

		expect(pending).toHaveBeenCalledTimes(1)
	})

	test("dedupe source 3 (in-flight journal txHash): note with matching journal txHash → skip", async () => {
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		const journal = makeJournalStub([{ accountAddress: "0xa", networkId: "n1", progress: { stage: "submitting", txHash: "0xtx1" } }])
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ txHash: "0xtx1" })] })
		const { service } = await bootService({ network, token, journal, note: noteSvc })

		const pending = vi.fn()
		service.onIncomingTransferPending.add(pending)

		await scan(service)

		expect(pending).not.toHaveBeenCalled()
		expect(trust.size).toBe(0)
	})

	test("token-removed (no matching tokens for contract) → scanContract no-ops", async () => {
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([]) // No tokens registered.
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note()] })
		const { service } = await bootService({ network, token, note: noteSvc })

		const pending = vi.fn()
		service.onIncomingTransferPending.add(pending)

		await scan(service)

		expect(pending).not.toHaveBeenCalled()
		expect([...records.values()]).toHaveLength(0)
	})
})

describe("IncomingTransferService — late-delete on onTransactionAdded", () => {
	test("pre-existing record whose txHash matches the new outgoing tx → deleted + Deleted emit", async () => {
		const transaction = makeTransactionStub()
		const { service } = await bootService({ transaction })

		const pre = noteRecord({
			siloedNullifier: validNullifier(7),
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xpending",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		records.set(pre.id, pre)

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		transaction.onTransactionAdded.invoke({ hash: "0xpending", account: "0xa", chainId: 1, calls: [] } as never)
		await flushPromises()

		expect(records.has(pre.id)).toBe(false)
		expect(deleted).toHaveBeenCalledTimes(1)
	})

	test("unrelated txHash: no delete, no emit", async () => {
		const transaction = makeTransactionStub()
		const { service } = await bootService({ transaction })

		const pre = noteRecord({
			siloedNullifier: validNullifier(8),
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xstayedA",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		records.set(pre.id, pre)

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		transaction.onTransactionAdded.invoke({ hash: "0xdifferent", account: "0xa", chainId: 1, calls: [] } as never)
		await flushPromises()

		expect(records.has(pre.id)).toBe(true)
		expect(deleted).not.toHaveBeenCalled()
	})

	test("(P5) per-hash reentrancy guard: two same-hash events → exactly one Delete emit", async () => {
		const transaction = makeTransactionStub()
		const { service } = await bootService({ transaction })

		const pre = noteRecord({
			siloedNullifier: validNullifier(9),
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xreentrant",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		records.set(pre.id, pre)

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		// Fire twice back-to-back — two listeners observing the same
		// listByTxHash result before either delete completes would have
		// emitted Deleted twice without the guard.
		transaction.onTransactionAdded.invoke({ hash: "0xreentrant", account: "0xa", chainId: 1, calls: [] } as never)
		transaction.onTransactionAdded.invoke({ hash: "0xreentrant", account: "0xa", chainId: 1, calls: [] } as never)
		await flushPromises()

		expect(records.has(pre.id)).toBe(false)
		expect(deleted).toHaveBeenCalledTimes(1)
	})

	test("(P5) account filter: same hash across accounts → only the originating account's record deleted", async () => {
		const transaction = makeTransactionStub()
		const { service } = await bootService({ transaction })

		// Two accounts with the same incoming txHash (legal under split-fee
		// / sponsored flows where account A's outgoing tx can deliver a
		// note to account B in the same hash).
		const recordA = noteRecord({
			siloedNullifier: validNullifier(10),
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xA",
			contract: tokenA.contract,
			tokenId: 1,
			owner: "0xA",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xshared",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		const recordB = noteRecord({ ...recordA, siloedNullifier: validNullifier(11), accountAddress: "0xB", owner: "0xB" })
		records.set(recordA.id, recordA)
		records.set(recordB.id, recordB)

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		transaction.onTransactionAdded.invoke({ hash: "0xshared", account: "0xA", chainId: 1, calls: [] } as never)
		await flushPromises()

		// Only account A's record gone; B's stays grounding.
		expect(records.has(recordA.id)).toBe(false)
		expect(records.has(recordB.id)).toBe(true)
		expect(deleted).toHaveBeenCalledTimes(1)
	})
})

describe("IncomingTransferService — cleanup wiring", () => {
	test("clearProfile wipes records + trust for that profileId", async () => {
		const { service } = await bootService()
		seedNote({
			siloedNullifier: "k1",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		seedNote({
			siloedNullifier: "k2",
			profileId: "p2",
			networkId: "n1",
			accountAddress: "0xb",
			contract: "0xc",
			tokenId: 1,
			owner: "0xb",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		trust.set(trustKey("p1", "n1", "0xc"), { profileId: "p1", networkId: "n1", contract: "0xc", state: "trusted", updatedAt: 0 })
		trust.set(trustKey("p2", "n1", "0xc"), { profileId: "p2", networkId: "n1", contract: "0xc", state: "trusted", updatedAt: 0 })

		await service.clearProfile("p1")

		expect(records.has("note:p1|n1|k1")).toBe(false)
		expect(records.has("note:p2|n1|k2")).toBe(true)
		expect(trust.has(trustKey("p1", "n1", "0xc"))).toBe(false)
		expect(trust.has(trustKey("p2", "n1", "0xc"))).toBe(true)
	})

	test("clearChain wipes only records + trust matching (profileId, networkId)", async () => {
		const { service } = await bootService()
		seedNote({
			siloedNullifier: "k1",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		seedNote({
			siloedNullifier: "k2",
			profileId: "p1",
			networkId: "n2",
			accountAddress: "0xa",
			contract: "0xc",
			tokenId: 1,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		trust.set(trustKey("p1", "n1", "0xc"), { profileId: "p1", networkId: "n1", contract: "0xc", state: "trusted", updatedAt: 0 })
		trust.set(trustKey("p1", "n2", "0xc"), { profileId: "p1", networkId: "n2", contract: "0xc", state: "trusted", updatedAt: 0 })

		await service.clearChain("p1", "n1")

		expect(records.has("note:p1|n1|k1")).toBe(false)
		expect(records.has("note:p1|n2|k2")).toBe(true)
		expect(trust.has(trustKey("p1", "n1", "0xc"))).toBe(false)
		expect(trust.has(trustKey("p1", "n2", "0xc"))).toBe(true)
	})
})

describe("IncomingTransferService — Path 2 block-timestamp + token-delete wipe", () => {
	const network = () => makeNetworkStub([{ id: "n1", chainId: 1 }])
	const token = () => makeTokenStub([tokenA])

	test("(Path 2) scanContract populates blockTimestamp on insert", async () => {
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ l2BlockNumber: 42 })] }, { 42: 1_700_000_000 })
		const { service } = await bootService({ network: network(), token: token(), note: noteSvc })
		// Trust = trusted so the record persists visible immediately.
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		await scan(service)

		const persisted = [...records.values()][0]
		expect(persisted.blockTimestamp).toBe(1_700_000_000)
		expect(persisted.l2BlockNumber).toBe(42)
	})

	test("(Path 2) blockTimestamp lookup is memoized per scan (1 PXE call per unique block)", async () => {
		// 3 notes, 2 unique blocks → 2 PXE calls.
		const notes = [
			note({ siloedNullifier: validNullifier(10), txHash: "0xt1", l2BlockNumber: 10, noteIndexInTx: 0 }),
			note({ siloedNullifier: validNullifier(11), txHash: "0xt2", l2BlockNumber: 10, noteIndexInTx: 1 }),
			note({ siloedNullifier: validNullifier(12), txHash: "0xt3", l2BlockNumber: 11, noteIndexInTx: 0 }),
		]
		const noteSvc = makeNoteStub({ [tokenA.contract]: notes }, { 10: 1_700_000_000, 11: 1_700_000_036 })
		const { service } = await bootService({ network: network(), token: token(), note: noteSvc })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		await scan(service)

		// Exactly 2 lookups (block 10 fetched once, reused; block 11 once).
		expect(noteSvc.getBlockTimestamp).toHaveBeenCalledTimes(2)
		const persisted = [...records.values()]
		expect(persisted.find((r) => r.l2BlockNumber === 10)?.blockTimestamp).toBe(1_700_000_000)
		expect(persisted.find((r) => r.l2BlockNumber === 11)?.blockTimestamp).toBe(1_700_000_036)
	})

	test("(Path 2) PXE failure → record still persists, blockTimestamp left undefined", async () => {
		// Mocked PXE returns undefined for the block — record persists with
		// blockTimestamp=undefined; sort path falls back to discoveredAt.
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ l2BlockNumber: 99 })] }, { 99: undefined })
		const { service } = await bootService({ network: network(), token: token(), note: noteSvc })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		await scan(service)

		const persisted = [...records.values()][0]
		expect(persisted.blockTimestamp).toBeUndefined()
		expect((persisted as IncomingNoteRecord).siloedNullifier).toBe(validNullifier(1))
	})

	test("(token-delete wipe) onTokenDeleted purges records + resets trust to unknown", async () => {
		// Pre-seed records + trust=trusted for tokenA. Token delete should
		// wipe both. Closes the subagent-diagnosed remove+re-add bug.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })

		seedNote({
			siloedNullifier: "k1",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: tokenA.id,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx1",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
			blockTimestamp: 1_700_000_000,
		})
		seedNote({
			siloedNullifier: "k2",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: tokenA.id,
			owner: "0xa",
			amountRaw: "200",
			noteHash: "0xnh2",
			txHash: "0xtx2",
			l2BlockNumber: 2,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
			blockTimestamp: 1_700_000_036,
		})
		// Unrelated contract's records must survive.
		seedNote({
			siloedNullifier: "kOther",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenB.contract,
			tokenId: tokenB.id,
			owner: "0xa",
			amountRaw: "50",
			noteHash: "0xnh3",
			txHash: "0xtx3",
			l2BlockNumber: 3,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		const deleted = vi.fn()
		const trustChanged = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)
		service.onIncomingTrustChanged.add(trustChanged)

		// Fire the token-delete event.
		tokenStub.onTokenDeleted.invoke(tokenA as never)
		await flushPromises()

		// tokenA's records wiped; tokenB's record untouched.
		expect(records.has("note:p1|n1|k1")).toBe(false)
		expect(records.has("note:p1|n1|k2")).toBe(false)
		expect(records.has("note:p1|n1|kOther")).toBe(true)
		expect(deleted).toHaveBeenCalledTimes(2)
		// Trust row for tokenA flipped to unknown.
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("unknown")
		expect(trustChanged).toHaveBeenCalled()
	})

	test("(token-delete wipe) trust row absent → no trustChanged emit but records still wiped", async () => {
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })

		seedNote({
			siloedNullifier: "k1",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: tokenA.id,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx1",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		// NO trust row pre-seeded.

		const trustChanged = vi.fn()
		service.onIncomingTrustChanged.add(trustChanged)

		tokenStub.onTokenDeleted.invoke(tokenA as never)
		await flushPromises()

		expect(records.has("note:p1|n1|k1")).toBe(false)
		// No trust row to reset → no emit.
		expect(trustChanged).not.toHaveBeenCalled()
	})

	test("(remove + re-add) records re-index from PXE with original blockTimestamp preserved", async () => {
		// Pre-seed PXE state: note for tokenA at block 42, timestamp 1.7B.
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ l2BlockNumber: 42 })] }, { 42: 1_700_000_000 })
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({
			network: network(),
			account: accountStub,
			token: tokenStub,
			note: noteSvc,
		})
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		// First scan: record persists with blockTimestamp=1.7B.
		await scan(service)
		const firstPersist = [...records.values()][0]
		expect(firstPersist.blockTimestamp).toBe(1_700_000_000)

		// Delete the token → records + trust wiped.
		tokenStub.onTokenDeleted.invoke(tokenA as never)
		await flushPromises()
		expect(records.size).toBe(0)

		// Simulate re-add: setTrust back to trusted (mimics the popup-add
		// auto-trust path), then re-scan.
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		await scan(service)

		// Re-indexed record has the ORIGINAL chain timestamp, not Date.now().
		const reindexed = [...records.values()][0]
		expect(reindexed.blockTimestamp).toBe(1_700_000_000)
		expect(reindexed.l2BlockNumber).toBe(42)
		// siloedNullifier is identical to the original (cryptographically
		// stable across delete + re-discover).
		expect((reindexed as IncomingNoteRecord).siloedNullifier).toBe(validNullifier(1))
	})
})

describe("IncomingTransferService — codex post-impl Path-2 audit fixes", () => {
	const network = () => makeNetworkStub([{ id: "n1", chainId: 1 }])

	test("(High #1) scan started BEFORE delete bails via the !token guard on token-snapshot lookup", async () => {
		// Sanity: when the delete fires before the scan begins, the
		// existing `if (!token) return` guard catches it. The generation
		// counter is for the harder mid-flight case (next test).
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA, tokenB])
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ l2BlockNumber: 7 })] }, { 7: 1_700_000_007 })
		const { service } = await bootService({
			network: network(),
			account: accountStub,
			token: tokenStub,
			note: noteSvc,
		})
		tokenStub.getTokensRaw = vi.fn().mockResolvedValue([tokenB])
		tokenStub.onTokenDeleted.invoke(tokenA as never)
		await flushPromises()

		const upsertSpy = vi.spyOn((service as never as { repo: { upsertRecord: () => Promise<void> } }).repo, "upsertRecord")
		await scan(service)

		expect(upsertSpy).not.toHaveBeenCalled()
	})

	test("(legacy pin, post-lock) scan whose epoch snapshot predates a delete bails before mutating", async () => {
		// Hold getNotesRaw in flight: capture the resolver, return a pending
		// promise. The scan calls genKey-snapshot BEFORE this await, so
		// startGen=0 (no bumps yet). While the scan is parked, fire
		// onTokenDeleted (bumps to 1). Resolve getNotesRaw → scan continues,
		// per-note loop's isStale() check observes 1 !== 0 → bail.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA, tokenB])
		let resolveNotes: ((value: unknown[]) => void) | null = null
		const noteSvc = makeNoteStub({}, { 7: 1_700_000_007 })
		noteSvc.getNotesRaw = vi.fn().mockImplementation(() => {
			return new Promise<unknown[]>((resolve) => {
				resolveNotes = resolve
			})
		})
		const { service } = await bootService({
			network: network(),
			account: accountStub,
			token: tokenStub,
			note: noteSvc,
		})
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		const upsertSpy = vi.spyOn((service as never as { repo: { upsertRecord: () => Promise<void> } }).repo, "upsertRecord")

		// Start the scan but don't await — it's parked on getNotesRaw.
		const scanPromise = scan(service)
		await flushPromises()
		expect(resolveNotes).not.toBeNull()

		// Fire delete while scan is parked. This bumps the generation.
		tokenStub.getTokensRaw = vi.fn().mockResolvedValue([tokenB])
		tokenStub.onTokenDeleted.invoke(tokenA as never)
		await flushPromises()

		// Release getNotesRaw with one matching note. Scan resumes; the
		// per-note loop should immediately bail on the staleness check.
		if (resolveNotes !== null) (resolveNotes as (value: unknown[]) => void)([note({ l2BlockNumber: 7 })])
		await scanPromise

		expect(upsertSpy).not.toHaveBeenCalled()
	})

	// REMOVED: "(High #1 in-flight) backfill upsert ALSO bails when delete lands during PXE backfill await"
	// Pinned the old scanGenerations isStale() re-check during the backfill PXE await.
	// Under the global serviceLock, the race is structurally impossible:
	// onTokenDeleted's invoke is async but its handler acquires the lock —
	// while scan holds it across the parked PXE call, the delete handler is
	// queued. After scan completes its CS (including the backfill upsert),
	// the lock releases and the delete handler runs. End-state-correct.
	// Lock-based equivalent: LR12 in the lock-races describe block below.

	test("(Audit-3 Medium) setTrustAllow returns false when token is no longer registered", async () => {
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })

		const result = await service.setTrustAllow("p1", "n1", tokenA.contract)
		expect(result).toBe(false)
	})

	test("(Audit-3 Medium) setTrustAllow returns true on a successful flip", async () => {
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "pending",
			updatedAt: 0,
		})

		const result = await service.setTrustAllow("p1", "n1", tokenA.contract)
		expect(result).toBe(true)
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("trusted")
	})

	test("(Audit-3 High) pending transition bails when delete lands during the unknown→pending window", async () => {
		// First-receive race: trust is `unknown` (no prior row), scan
		// discovers a new note for a contract, then mid-await between the
		// top-of-loop isStale check and the `setTrust("pending")` call,
		// the user removes the token. Without the new pre-flight + post-
		// await isStale checks, the scan would create a pending trust row
		// AND open a first-receive prompt for a deleted contract.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA, tokenB])
		let resolveBlockTs: ((value: number | undefined) => void) | null = null
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ l2BlockNumber: 88 })] })
		// Block the SECOND PXE call (used by the per-note loop after the
		// pending transition), but resolve the first quickly. To make this
		// surface, we use getBlockTimestamp itself as the await window —
		// it's called BEFORE upsertRecord and AFTER the pending transition.
		// Actually the simplest reproduction: block getNotesRaw, fire
		// delete BEFORE notes resolve, then check no setTrust(pending) fires.
		let resolveNotes: ((value: unknown[]) => void) | null = null
		noteSvc.getNotesRaw = vi.fn().mockImplementation(() => {
			return new Promise<unknown[]>((resolve) => {
				resolveNotes = resolve
			})
		})
		noteSvc.getBlockTimestamp = vi.fn().mockImplementation(() => {
			return new Promise<number | undefined>((resolve) => {
				resolveBlockTs = resolve
			})
		})
		const { service } = await bootService({
			network: network(),
			account: accountStub,
			token: tokenStub,
			note: noteSvc,
		})
		// NO trust row — exercises the "no prior trust row" failure mode.

		const trustChanged = vi.fn()
		const transferPending = vi.fn()
		service.onIncomingTrustChanged.add(trustChanged)
		service.onIncomingTransferPending.add(transferPending)

		const scanPromise = scan(service)
		await flushPromises()
		expect(resolveNotes).not.toBeNull()

		// Delete fires while scan is parked on getNotesRaw. Generation bumps.
		tokenStub.getTokensRaw = vi.fn().mockResolvedValue([tokenB])
		tokenStub.onTokenDeleted.invoke(tokenA as never)
		await flushPromises()

		// Resolve notes → scan resumes. Per-note loop's top-of-iteration
		// isStale() catches the race FIRST (before the pending transition).
		if (resolveNotes !== null) (resolveNotes as (value: unknown[]) => void)([note({ l2BlockNumber: 88 })])
		// resolveBlockTs may never get called if isStale bails first; that's
		// the desired outcome. We resolve it defensively to drain the test.
		if (resolveBlockTs !== null) (resolveBlockTs as (value: number | undefined) => void)(1_700_000_088)
		await scanPromise

		// Critical: NO `pending` trust row created, NO Pending event emitted.
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))).toBeUndefined()
		expect(transferPending).not.toHaveBeenCalled()
		// onIncomingTrustChanged should not fire from the scan path. (It
		// would normally fire from onTokenDeleted's trust-reset, but that
		// only fires when a trust row exists — and there is none here.)
		expect(trustChanged).not.toHaveBeenCalled()
	})

	test("(Audit-3 Medium) setTrustReject returns false/true symmetrically", async () => {
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const stale = await bootService({ network: network(), account: accountStub, token: makeTokenStub([]) })
		expect(await stale.service.setTrustReject("p1", "n1", tokenA.contract)).toBe(false)

		records.clear()
		trust.clear()

		const live = await bootService({ network: network(), account: accountStub, token: makeTokenStub([tokenA]) })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "pending",
			updatedAt: 0,
		})
		expect(await live.service.setTrustReject("p1", "n1", tokenA.contract)).toBe(true)
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("blocked")
	})

	test("(High #2) setTrustAllow on deleted token is a no-op", async () => {
		// Boot with NO tokens (simulates a token whose delete already ran but
		// the popup's allow closure was still queued/open).
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })
		// Pre-seed trust=unknown (the post-delete state).
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "unknown",
			updatedAt: 0,
		})
		const trustChanged = vi.fn()
		service.onIncomingTrustChanged.add(trustChanged)

		await service.setTrustAllow("p1", "n1", tokenA.contract)

		// Stale-popup guard: tokenService.getTokensRaw returns [] → no flip.
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("unknown")
		expect(trustChanged).not.toHaveBeenCalled()
	})

	test("(High #2) setTrustReject on deleted token is a no-op", async () => {
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "unknown",
			updatedAt: 0,
		})
		const trustChanged = vi.fn()
		service.onIncomingTrustChanged.add(trustChanged)

		await service.setTrustReject("p1", "n1", tokenA.contract)

		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("unknown")
		expect(trustChanged).not.toHaveBeenCalled()
	})

	test("(High #2) setTrustAllow on a still-registered token works normally", async () => {
		// Sanity: the guard MUST NOT block legitimate Allow flows.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "pending",
			updatedAt: 0,
		})

		await service.setTrustAllow("p1", "n1", tokenA.contract)

		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("trusted")
	})

	test("(Medium #1) second scan backfills blockTimestamp after a first-scan PXE miss", async () => {
		// First-scan PXE returns undefined for block 50 → record persists
		// with blockTimestamp=undefined. On second scan, PXE is now healthy
		// for that block. The existing-record branch should detect the
		// missing field, re-call PXE, and patch via upsertRecord.
		const blockMap: Record<number, number | undefined> = { 50: undefined }
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ l2BlockNumber: 50 })] }, blockMap)
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), token: tokenStub, note: noteSvc })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		await scan(service)
		const first = [...records.values()][0]
		expect(first.blockTimestamp).toBeUndefined()

		// PXE recovers: block 50 timestamp is now resolvable.
		blockMap[50] = 1_700_000_050

		await scan(service)
		const second = [...records.values()][0]
		expect(second.blockTimestamp).toBe(1_700_000_050)
		// Other fields untouched — backfill preserves the original record.
		expect((second as IncomingNoteRecord).siloedNullifier).toBe(validNullifier(1))
		expect(second.l2BlockNumber).toBe(50)
	})

	test("(Medium #1) backfill is skipped when blockTimestamp is already populated", async () => {
		// If the existing record already has blockTimestamp, the per-scan
		// branch must NOT re-call PXE (wasted RPC).
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ l2BlockNumber: 60 })] }, { 60: 1_700_000_060 })
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), token: tokenStub, note: noteSvc })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		await scan(service)
		// Pre-condition: first scan persisted with timestamp.
		expect([...records.values()][0].blockTimestamp).toBe(1_700_000_060)
		const callsBeforeSecondScan = (noteSvc.getBlockTimestamp as ReturnType<typeof vi.fn>).mock.calls.length

		await scan(service)
		const callsAfterSecondScan = (noteSvc.getBlockTimestamp as ReturnType<typeof vi.fn>).mock.calls.length
		expect(callsAfterSecondScan).toBe(callsBeforeSecondScan)
	})

	test("(Audit-4 High) replayPendingPrompts skips a row whose token was deleted after the snapshot", async () => {
		// Codex audit-4 finding: replayPendingPrompts snapshots
		// `tokens = getTokensRaw(...)` before the per-row loop. If the
		// token gets deleted between that snapshot and a later iteration,
		// the snapshot still names it AND the per-row find succeeds — so
		// without a live re-check, the emit would resurrect an orphan
		// prompt. Verify the new live-token + live-trust re-checks suppress
		// the emit.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		// Stale snapshot: first getTokensRaw call (the outer snapshot)
		// returns the token; second call (the per-row live re-check)
		// returns empty. Simulates a delete landing between.
		const tokenStub = makeTokenStub([tokenA])
		let getTokensCalls = 0
		tokenStub.getTokensRaw = vi.fn().mockImplementation(async () => {
			getTokensCalls++
			return getTokensCalls === 1 ? [tokenA] : []
		})
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "pending",
			updatedAt: 0,
		})
		seedNote({
			siloedNullifier: "k1",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: tokenA.id,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})

		const seen = vi.fn()
		service.onIncomingTransferPending.add(seen)

		await service.replayPendingPrompts("p1", "n1", "0xa")

		// Live re-check fires: second getTokensRaw call returns [], the
		// `liveTokens.some(...)` check is false, the emit is suppressed.
		expect(seen).not.toHaveBeenCalled()
	})

	// Audit-5 compensating-revert tests REMOVED. The behavior they pinned
	// (revert trust to "unknown" after detecting a stale token mid-flow) no
	// longer exists — the global service Lock (implementations-plan/
	// incoming-trust-state-machine-refactor/) prevents the race those
	// reverts recovered from. Race-ordering pins for the new lock-based
	// behavior live in the lock-races describe block below.

	test("(Audit-5 High) setTrustAllow skips per-record upsert when record was deleted mid-loop", async () => {
		// Race: setTrustAllow snapshotted records via listByContract, but
		// onTokenDeleted ran its delete-per-record path before our upsert
		// could resurrect them. The per-iteration getRecord re-check must
		// skip those rows so the activity feed stays empty.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "pending",
			updatedAt: 0,
		})
		// Pre-seed a hidden record (the snapshot will see it; we drop it
		// from the underlying Map BEFORE setTrustAllow's per-record loop
		// runs, simulating a mid-flight delete).
		seedNote({
			siloedNullifier: "k_orphan",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: tokenA.id,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})

		// Intercept listByContract to return the snapshot, then delete the
		// underlying record. The per-record getRecord re-check should
		// observe `undefined` and skip the upsert.
		const realRepo = (service as never as { repo: { listByContract: (...args: unknown[]) => unknown } }).repo
		const originalList = realRepo.listByContract.bind(realRepo) as (...args: unknown[]) => Promise<unknown[]>
		realRepo.listByContract = vi.fn().mockImplementation(async (...args: unknown[]) => {
			const snap = await originalList(...args)
			records.delete("note:p1|n1|k_orphan")
			return snap
		})

		const added = vi.fn()
		service.onIncomingTransferAdded.add(added)

		await service.setTrustAllow("p1", "n1", tokenA.contract)

		// No Added emit; record stays deleted.
		expect(added).not.toHaveBeenCalled()
		expect(records.has("note:p1|n1|k_orphan")).toBe(false)
	})

	test("(Audit-4 High) replayPendingPrompts skips a row whose trust was reset to unknown after the snapshot", async () => {
		// Parallel case: token registration is still live, but the trust
		// row got reset to `unknown` between the listTrust snapshot and the
		// per-row emit. The live trust re-check must catch this.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })
		// Snapshot state: trust is `pending`.
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "pending",
			updatedAt: 0,
		})
		seedNote({
			siloedNullifier: "k1",
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: tokenA.id,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh",
			txHash: "0xtx",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})

		// Intercept repo.getTrust: snapshot listTrust returns the pending
		// row, but the per-row live getTrust returns `unknown` (simulating
		// a reset that landed after the snapshot).
		const realRepo = (service as never as { repo: { getTrust: (...args: unknown[]) => unknown } }).repo
		realRepo.getTrust = vi.fn().mockResolvedValue({
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "unknown",
			updatedAt: 0,
		})

		const seen = vi.fn()
		service.onIncomingTransferPending.add(seen)

		await service.replayPendingPrompts("p1", "n1", "0xa")

		expect(seen).not.toHaveBeenCalled()
	})
})

describe("IncomingTransferService — lock-races (Phase 7 pins for the global serviceLock refactor)", () => {
	const network = () => makeNetworkStub([{ id: "n1", chainId: 1 }])

	test("(LR9 reentrancy) setTrustAllow public wrapper does NOT deadlock against its own locked helper", async () => {
		// Regression pin: the public setTrustAllow acquires the serviceLock
		// once and the body uses _setTrustStateLocked (no re-acquire). If a
		// future refactor accidentally chained the public method through
		// another lock-acquiring method, the Lock primitive's non-reentrant
		// semantics would deadlock until the 5-min force-release timer fires.
		// A successful resolution under the vitest default timeout proves
		// the wrappers are split correctly.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "pending",
			updatedAt: 0,
		})

		const ok = await service.setTrustAllow("p1", "n1", tokenA.contract)
		expect(ok).toBe(true)
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("trusted")
	})

	test("(LR12 lifecycle epoch) clearChain during in-flight scan: no records persisted post-clear", async () => {
		// Pre-seed: token + trusted trust row so scanContract would persist
		// the records it discovers. Park getNotesRaw so we can fire
		// clearChain between getNotesRaw + the per-note critical section.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		let resolveNotes: ((value: unknown[]) => void) | null = null
		const noteSvc = makeNoteStub({}, { 7: 1_700_000_007 })
		noteSvc.getNotesRaw = vi.fn().mockImplementation(() => {
			return new Promise<unknown[]>((resolve) => {
				resolveNotes = resolve
			})
		})
		const { service } = await bootService({
			network: network(),
			account: accountStub,
			token: tokenStub,
			note: noteSvc,
		})
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		const upsertSpy = vi.spyOn((service as never as { repo: { upsertRecord: () => Promise<void> } }).repo, "upsertRecord")

		// Start scan; it captures `epochAtStart = this.serviceEpoch` BEFORE
		// any await (including getNotesRaw), then parks on getNotesRaw. A
		// clearChain firing during the park acquires the lock, bumps the
		// epoch via hydrateSchedulers, and releases. When scan resumes and
		// reaches its per-note CS, `this.serviceEpoch !== epochAtStart` →
		// bail before persisting.
		const scanPromise = scan(service)
		await flushPromises()
		expect(resolveNotes).not.toBeNull()

		// Fire clearChain while scan is parked. clearChain acquires the
		// lock (no contention — scan doesn't hold the lock yet), wipes
		// trust + records, bumps serviceEpoch.
		await service.clearChain("p1", "n1")
		await flushPromises()

		// Release notes. Scan resumes; epochAtStart was captured before
		// clearChain bumped, so scan's per-note CS check observes the
		// mismatch and bails before any upsertRecord call.
		if (resolveNotes !== null) (resolveNotes as (value: unknown[]) => void)([note({ l2BlockNumber: 7 })])
		await scanPromise

		// Storage is empty + no upserts happened.
		expect(records.size).toBe(0)
		expect(upsertSpy).not.toHaveBeenCalled()
	})

	test("(LR13 profile switch invalidates in-flight scan) → no records persisted post-switch", async () => {
		// Codex post-impl audit High #1: an A→B profile switch must bump
		// serviceEpoch so a scan for profile A parked on getNotesRaw can't
		// resume and emit Added events for A under B's identity. The fix
		// moves bumpServiceEpoch() into hydrateSchedulers() so every caller
		// (including onActiveProfileChanged) invalidates in-flight scans.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const profileStub = makeProfileStub({ id: "p1" })
		let resolveNotes: ((value: unknown[]) => void) | null = null
		const noteSvc = makeNoteStub({}, { 7: 1_700_000_007 })
		noteSvc.getNotesRaw = vi.fn().mockImplementation(() => {
			return new Promise<unknown[]>((resolve) => {
				resolveNotes = resolve
			})
		})
		const { service } = await bootService({
			profile: profileStub,
			network: network(),
			account: accountStub,
			token: tokenStub,
			note: noteSvc,
		})
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		const upsertSpy = vi.spyOn((service as never as { repo: { upsertRecord: () => Promise<void> } }).repo, "upsertRecord")

		// Start scan; parks on getNotesRaw.
		const scanPromise = scan(service)
		await flushPromises()
		expect(resolveNotes).not.toBeNull()

		// Profile switch fires → onActiveProfileChanged → hydrateSchedulers
		// → bumpServiceEpoch. The in-flight scan's epochAtStart is now stale.
		profileStub.onActiveProfileChanged.invoke()
		await flushPromises()

		// Release notes. Scan's per-note CS observes epoch mismatch and bails.
		if (resolveNotes !== null) (resolveNotes as (value: unknown[]) => void)([note({ l2BlockNumber: 7 })])
		await scanPromise

		expect(upsertSpy).not.toHaveBeenCalled()
	})

	test("(B-20 PIN) a profile switch during onTokenAdded fences out its stale scheduler install", async () => {
		// onTokenAdded resolves the active profile, network, trust, and accounts across
		// several awaits before installing per-account note schedulers + watching the new
		// contract. A profile switch mid-flight bumps serviceEpoch (via hydrateSchedulers);
		// the resumed add must NOT graft its contract onto the now-current scheduler set.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const profileStub = makeProfileStub({ id: "p1" })
		const { service } = await bootService({ profile: profileStub, network: network(), account: accountStub, token: tokenStub })
		await flushPromises()

		const key = "n1|0xa"
		const watched = (service as never as { watchedContracts: Map<string, Set<string>> }).watchedContracts
		expect([...(watched.get(key) ?? [])]).toEqual([tokenA.contract]) // bootstrap hydrate

		// Defer the add's trust read so it parks (holding the service lock, which the
		// lock-free hydrate path does not contend) right before the scheduler install.
		const repo = (service as never as { repo: { getTrust: (...a: unknown[]) => Promise<unknown> } }).repo
		let resolveTrust!: (v: unknown) => void
		const getTrustSpy = vi.spyOn(repo, "getTrust").mockImplementation(() => new Promise((r) => (resolveTrust = r as never)))

		const addPromise = tokenStub.onTokenAdded.invoke({
			id: tokenB.id,
			chainId: tokenB.chainId,
			contract: tokenB.contract,
			symbol: tokenB.symbol,
			decimals: tokenB.decimals,
			name: "Token B",
		} as never)
		await flushPromises()
		expect(getTrustSpy).toHaveBeenCalled() // parked on the trust read

		// Profile switch fires → hydrateSchedulers bumps the epoch (invalidating the
		// in-flight add) and re-installs from current tokens only (tokenA).
		await profileStub.onActiveProfileChanged.invoke()
		await flushPromises()

		resolveTrust(undefined) // release the trust read; the add resumes
		await addPromise
		await flushPromises()

		// The stale add must not have watched tokenB's contract on the live scheduler.
		expect([...(watched.get(key) ?? [])]).not.toContain(tokenB.contract)
		expect([...(watched.get(key) ?? [])]).toEqual([tokenA.contract])
	})

	test("(LR4 concurrent onTransactionAdded same hash) → exactly one Delete emit", async () => {
		// Two onTransactionAdded events for the same tx hash. The serviceLock
		// serializes them: the first runs to completion (deletes record,
		// emits Deleted), the second finds the record gone, no-ops.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const txStub = makeTransactionStub()
		const { service } = await bootService({
			network: network(),
			account: accountStub,
			token: tokenStub,
			transaction: txStub,
		})
		seedNote({
			siloedNullifier: validNullifier(1),
			profileId: "p1",
			networkId: "n1",
			accountAddress: "0xa",
			contract: tokenA.contract,
			tokenId: tokenA.id,
			owner: "0xa",
			amountRaw: "100",
			noteHash: "0xnh1",
			txHash: "0xtx-shared",
			l2BlockNumber: 1,
			txIndexInBlock: 0,
			indexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		const deletedSpy = vi.fn()
		service.onIncomingTransferDeleted.add(deletedSpy)

		const tx = { hash: "0xtx-shared", chainId: 1, account: "0xa" }
		// Fire twice in the same microtask; both queue on the lock.
		const a = txStub.onTransactionAdded.invoke(tx as never)
		const b = txStub.onTransactionAdded.invoke(tx as never)
		await Promise.all([a, b])
		await flushPromises()

		expect(deletedSpy).toHaveBeenCalledTimes(1)
		expect(records.size).toBe(0)
	})

	test("(LR14 onTokenAdded auto-trusts before any scan can read unknown) → no Pending emit", async () => {
		// Manual QA pin: a user-explicit add via TokenService.addToken
		// (popup form OR dApp register_token) must NOT produce a redundant
		// trust popup moments later. The handler's first step — locked
		// trust→trusted — runs BEFORE the for-loop kicks per-account
		// schedulers, so the first per-note CS in any scan reads "trusted"
		// and persists records visible (not hidden+pending). Without this
		// pre-trust step, the user sees both the add-token approval AND
		// the subsequent first-receive popup for the same contract.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		// Start with no tokens so bootstrap hydrateSchedulers is a no-op —
		// the test simulates a fresh first-add, not a re-hydration. Mutable
		// array so we can register tokenA after the spy is wired.
		const tokenList: (typeof tokenA)[] = []
		const tokenStub = makeTokenStub(tokenList)
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ l2BlockNumber: 7 })] }, { 7: 1_700_000_007 })
		const { service } = await bootService({
			network: network(),
			account: accountStub,
			token: tokenStub,
			note: noteSvc,
		})

		// Drain anything bootstrap queued before wiring spies.
		await flushPromises()

		const trustChangedSpy = vi.fn()
		const pendingSpy = vi.fn()
		service.onIncomingTrustChanged.add(trustChangedSpy)
		service.onIncomingTransferPending.add(pendingSpy)

		// Mirror TokenService.addToken: storage carries the new token
		// before onTokenAdded fires.
		tokenList.push(tokenA)

		await tokenStub.onTokenAdded.invoke({
			id: tokenA.id,
			chainId: tokenA.chainId,
			contract: tokenA.contract,
			symbol: tokenA.symbol,
			decimals: tokenA.decimals,
			name: "Token A",
		} as never)
		await flushPromises()

		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("trusted")
		expect(trustChangedSpy).toHaveBeenCalledTimes(1)
		expect(trustChangedSpy).toHaveBeenCalledWith(expect.objectContaining({ state: "trusted" }))
		// The immediate poll kicked by startScheduler runs scanContract for
		// the new contract. With auto-trust already set, the scan persists
		// records visible — Pending must never fire for this contract.
		expect(pendingSpy).not.toHaveBeenCalled()
	})

	test("(LR14 idempotent) onTokenAdded for already-trusted contract → no duplicate trustChanged emit", async () => {
		// If the user re-adds a contract that's already trusted (e.g., a
		// previously-imported token re-imported through a dApp's
		// register_token), the handler must not re-emit trustChanged. The
		// short-circuit reads getTrust first; only writes when state ≠
		// "trusted".
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({
			network: network(),
			account: accountStub,
			token: tokenStub,
		})
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		const trustChangedSpy = vi.fn()
		service.onIncomingTrustChanged.add(trustChangedSpy)

		await tokenStub.onTokenAdded.invoke({
			id: tokenA.id,
			chainId: tokenA.chainId,
			contract: tokenA.contract,
			symbol: tokenA.symbol,
			decimals: tokenA.decimals,
			name: "Token A",
		} as never)
		await flushPromises()

		expect(trustChangedSpy).not.toHaveBeenCalled()
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("trusted")
	})
})

// ── Public-event scan arm (Phase 2: D3 / D4 write-side / D6) ────────────────

function pubEvent(overrides: Partial<PublicTransferEvent> = {}): PublicTransferEvent {
	return {
		from: "0xfrom",
		to: "0xa",
		amountRaw: "100",
		txHash: "0xptx",
		l2BlockNumber: 5,
		blockHash: "0xbh5",
		blockTimestamp: 1_700_000_000,
		txIndexWithinBlock: 0,
		logIndexWithinTx: 0,
		...overrides,
	}
}

/** A page whose `scannedThrough` is the last event's position (or null when empty). */
function pubPage(events: PublicTransferEvent[], hasMore = false): PublicTransferPage {
	const last = events[events.length - 1]
	return {
		events,
		scannedThrough: last
			? { blockNumber: last.l2BlockNumber, txIndexWithinBlock: last.txIndexWithinBlock, logIndexWithinTx: last.logIndexWithinTx }
			: null,
		hasMore,
		dropped: false,
	}
}

/** A validator-DROPPED page (non-monotonic / beyond pinned bound): empty, `dropped:true`. */
function pubDroppedPage(): PublicTransferPage {
	return { events: [], scannedThrough: null, hasMore: false, dropped: true }
}

type ReaderResponse = PublicTransferPage | Error | ((args: PublicTransferFetchArgs) => PublicTransferPage)

/** A queue-driven fake public-event reader. `responses` is consumed FIFO; an exhausted queue
 *  returns an empty page. A response may be an Error (thrown — reorg simulation). */
function makePublicReader(init?: { tips?: Partial<PublicScanTips>; classStatus?: PublicTokenClassStatus }) {
	const state = {
		tips: {
			checkpointedBlockNumber: 100,
			checkpointedBlockHash: "0xcheckpoint",
			finalizedBlockNumber: 50,
			...init?.tips,
		} as PublicScanTips,
		classStatus: (init?.classStatus ?? "standard") as PublicTokenClassStatus,
		responses: [] as ReaderResponse[],
		fetchArgs: [] as PublicTransferFetchArgs[],
		tipsCalls: 0,
		classCalls: 0,
		reset() {
			state.responses.length = 0
			state.fetchArgs.length = 0
			state.tipsCalls = 0
			state.classCalls = 0
		},
	}
	const reader: PublicEventReader = {
		fetchTransferPage: async (_n, _c, args) => {
			state.fetchArgs.push(args)
			const next = state.responses.shift()
			if (next === undefined) return { events: [], scannedThrough: null, hasMore: false, dropped: false }
			if (next instanceof Error) throw next
			if (typeof next === "function") return next(args)
			return next
		},
		getScanTips: async () => {
			state.tipsCalls++
			return state.tips
		},
		getTokenClassStatus: async () => {
			state.classCalls++
			return state.classStatus
		},
	}
	return { reader, state }
}

async function scanPublic(service: unknown, contract: string = tokenA.contract, networkId = "n1", profileId = "p1"): Promise<void> {
	await (service as { scanPublicContract: (p: string, n: string, c: string) => Promise<void> }).scanPublicContract(
		profileId,
		networkId,
		contract,
	)
}

/** Account stub owning `0xa` on chainId 1 — the recipient the pre-lock filter matches. */
function publicAccountStub() {
	return makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
}

/**
 * Boot the service and DRAIN the scheduler's initial public kick (which runs on an empty reader
 * queue as a no-op), then wipe the cursor/outbox rows + reset the reader counters it touched — so a
 * test drives `scanPublicContract` from a clean, controlled state.
 */
async function bootPublic(
	reader: PublicEventReader,
	state: ReturnType<typeof makePublicReader>["state"],
	stubs: Parameters<typeof bootService>[0] = {},
) {
	const booted = await bootService({ account: publicAccountStub(), token: makeTokenStub([tokenA]), ...stubs, publicReader: reader })
	await flushPromises()
	cursors.clear()
	outbox.clear()
	// The initial kick warmed the finalized-tip class-gate cache; clear it so caching tests start cold.
	;(booted.service as unknown as { classGateCache: Map<string, unknown> }).classGateCache.clear()
	state.reset()
	return booted
}

const cursorFor = (c: string = tokenA.contract) =>
	cursors.get(`p1|n1|${c}`) as
		| {
				cursor: unknown
				lastSyncedBlockHash: string | null
				lastScanFinalized: number | null
				reconciling?: unknown
				pendingPage?: unknown
		  }
		| undefined
const outboxFor = (account = "0xa", tokenId = tokenA.id) =>
	outbox.get(`p1|n1|${account}|${tokenId}`) as { dirtyAt: number; pendingTaskId?: string } | undefined

describe("IncomingTransferService — public-event scan arm (D3)", () => {
	test("public first-receive: creates a hidden record, trust unknown→pending, emits Pending, writes outbox", async () => {
		const { reader, state } = makePublicReader()
		const pending = vi.fn()
		const { service } = await bootPublic(reader, state)
		service.onIncomingTransferPending.add(pending)
		state.responses.push(pubPage([pubEvent({ txHash: "0xp1", amountRaw: "777" })]))

		await scanPublic(service)

		const rec = records.get("pub:p1|n1|0xp1|0")
		expect(rec?.kind).toBe("public-event")
		expect(rec?.hidden).toBe(true)
		expect(rec?.amountRaw).toBe("777")
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("pending")
		expect(pending).toHaveBeenCalledTimes(1)
		expect(outboxFor()).toBeDefined()
	})

	test("auto-trusted token: public receipt inserts VISIBLE + emits Added", async () => {
		const { reader, state } = makePublicReader()
		const added = vi.fn()
		const { service } = await bootPublic(reader, state)
		service.onIncomingTransferAdded.add(added)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		state.responses.push(pubPage([pubEvent({ txHash: "0xp2" })]))

		await scanPublic(service)

		expect(records.get("pub:p1|n1|0xp2|0")?.hidden).toBe(false)
		expect(added).toHaveBeenCalledTimes(1)
	})

	test("dedupe vs own outgoing public tx: matching txHash → no record, no outbox", async () => {
		const { reader, state } = makePublicReader()
		const txStub = makeTransactionStub([{ hash: "0xmine", account: "0xa", chainId: 1, profileId: "p1", networkId: "n1" }])
		const { service } = await bootPublic(reader, state, { transaction: txStub })
		state.responses.push(pubPage([pubEvent({ txHash: "0xmine" })]))

		await scanPublic(service)

		expect(records.get("pub:p1|n1|0xmine|0")).toBeUndefined()
		expect(outboxFor()).toBeUndefined()
	})

	test("a FOREIGN profile's outgoing tx does not suppress this scope's public event", async () => {
		// p2 shares address 0xa (same seed) and sent 0xtheirs on the same chain.
		// From p1's silo that send is someone else's activity — the event must
		// surface as incoming, exactly like another device's outgoing does.
		const { reader, state } = makePublicReader()
		const txStub = makeTransactionStub([{ hash: "0xtheirs", account: "0xa", chainId: 1, profileId: "p2", networkId: "n9" }])
		const { service } = await bootPublic(reader, state, { transaction: txStub })
		state.responses.push(pubPage([pubEvent({ txHash: "0xtheirs" })]))

		await scanPublic(service)

		expect(records.get("pub:p1|n1|0xtheirs|0")).toBeDefined()
	})

	test("MAGIC (from-private) and zero (mint) senders stored raw; both create records", async () => {
		const MAGIC = "0x0000000000000000000000000000000000000000000000000000000000001111"
		const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000"
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		state.responses.push(
			pubPage([pubEvent({ txHash: "0xfromPriv", from: MAGIC }), pubEvent({ txHash: "0xmint", from: ZERO, txIndexWithinBlock: 1 })]),
		)

		await scanPublic(service)

		const priv = records.get("pub:p1|n1|0xfromPriv|0")
		const mint = records.get("pub:p1|n1|0xmint|0")
		expect(priv?.kind === "public-event" && priv.from).toBe(MAGIC)
		expect(mint?.kind === "public-event" && mint.from).toBe(ZERO)
	})

	test("non-recipient events advance the cursor but create NO record (pre-lock filter)", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		state.responses.push(pubPage([pubEvent({ txHash: "0xother", to: "0xNOTME" })]))

		await scanPublic(service)

		expect([...records.keys()].filter((k) => k.startsWith("pub:"))).toHaveLength(0)
		expect(cursorFor()?.cursor).toEqual({ blockNumber: 5, txIndexWithinBlock: 0, logIndexWithinTx: 0 })
	})

	test("non-standard class → NO scan (fail closed): no fetch, no records", async () => {
		const { reader, state } = makePublicReader({ classStatus: "non-standard" })
		const { service } = await bootPublic(reader, state)
		state.responses.push(pubPage([pubEvent({ txHash: "0xnope" })]))

		await scanPublic(service)

		expect(records.get("pub:p1|n1|0xnope|0")).toBeUndefined()
		expect(state.fetchArgs).toHaveLength(0)
	})

	test("unresolved class → fail closed AND not cached (re-probes next tick)", async () => {
		const { reader, state } = makePublicReader({ classStatus: "unresolved" })
		const { service } = await bootPublic(reader, state)

		await scanPublic(service)
		await scanPublic(service)

		expect(state.classCalls).toBe(2)
	})

	test("class gate cached by BOTH tips: re-resolves on a finalized OR a checkpointed advance (codex R3 #7)", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)

		await scanPublic(service)
		await scanPublic(service)
		expect(state.classCalls).toBe(1) // same tips across both ticks → cached

		state.tips = { ...state.tips, finalizedBlockNumber: 60 }
		await scanPublic(service)
		expect(state.classCalls).toBe(2) // finalized advanced → re-resolve

		// A checkpoint HASH change ALSO re-resolves — including a SAME-HEIGHT reorg (a number-keyed
		// cache would miss it) — else a mid-cache malicious upgrade at checkpointed would be served a
		// stale "standard" (codex R4 #7).
		state.tips = { ...state.tips, checkpointedBlockHash: "0xcheckpoint-reorged" }
		await scanPublic(service)
		expect(state.classCalls).toBe(3)
	})

	test("partial-page cursor advance: next tick resumes afterCursor", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		state.responses.push(pubPage([pubEvent({ txHash: "0xa1", l2BlockNumber: 7, logIndexWithinTx: 3 })], false))

		await scanPublic(service)
		expect(cursorFor()?.cursor).toEqual({ blockNumber: 7, txIndexWithinBlock: 0, logIndexWithinTx: 3 })
		expect(records.get("pub:p1|n1|0xa1|3")).toBeDefined()

		await scanPublic(service) // empty page
		expect(state.fetchArgs[state.fetchArgs.length - 1].afterCursor).toEqual({
			blockNumber: 7,
			txIndexWithinBlock: 0,
			logIndexWithinTx: 3,
		})
	})

	test("page-budget: all 5 budgeted pages fetched; cursor at the last page; every page pins the checkpoint hash", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		for (let i = 0; i < 5; i++) state.responses.push(pubPage([pubEvent({ txHash: `0xb${i}`, l2BlockNumber: 10 + i })], true))

		await scanPublic(service)

		// Fresh cursor (no boundary probe) → exactly 5 page fetches, each pinned to the checkpoint FORK
		// HASH so a mid-scan reorg throws on the offending page (codex R2 #1).
		expect(state.fetchArgs).toHaveLength(5)
		expect(state.fetchArgs.every((a) => a.referenceBlock === "0xcheckpoint")).toBe(true)
		expect(state.fetchArgs[0].toBlock).toBe(100) // pinned to tips.checkpointedBlockNumber
		expect(cursorFor()?.cursor).toEqual({ blockNumber: 14, txIndexWithinBlock: 0, logIndexWithinTx: 0 })
	})

	test("same-tx note + public event yield TWO records under disjoint PKs", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		seedNote({ siloedNullifier: "sn-shared", txHash: "0xshared", contract: tokenA.contract, tokenId: tokenA.id, accountAddress: "0xa" })
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		state.responses.push(pubPage([pubEvent({ txHash: "0xshared" })]))

		await scanPublic(service)

		expect(records.get("note:p1|n1|sn-shared")).toBeDefined()
		expect(records.get("pub:p1|n1|0xshared|0")).toBeDefined()
	})

	test("chain-purge mid-scan (epoch bump via clearChain) → the page's record is NOT persisted", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		state.responses.push(pubPage([pubEvent({ txHash: "0xrace" })]))

		const scanP = scanPublic(service)
		await service.clearChain("p1", "n1") // bumps serviceEpoch mid-flight
		await scanP

		expect(records.get("pub:p1|n1|0xrace|0")).toBeUndefined()
	})
})

// ── Public-event reorg reconciliation (Phase 2: D6) ────────────────────────

function seedPublic(overrides: Partial<IncomingPublicEventRecord> = {}): IncomingPublicEventRecord {
	const merged = {
		kind: "public-event" as const,
		from: "0xfrom",
		blockHash: "0xbh",
		profileId: "p1",
		networkId: "n1",
		accountAddress: "0xa",
		contract: tokenA.contract,
		tokenId: tokenA.id,
		amountRaw: "100",
		txHash: "0xptx",
		l2BlockNumber: 5,
		txIndexInBlock: 0,
		indexInTx: 0,
		hidden: false,
		discoveredAt: 0,
		...overrides,
	}
	const rec: IncomingPublicEventRecord = {
		...merged,
		id: `pub:${merged.profileId}|${merged.networkId}|${merged.txHash}|${merged.indexInTx}`,
	}
	records.set(rec.id, rec)
	return rec
}

function seedCursor(overrides: Record<string, unknown> = {}, contract = tokenA.contract): void {
	cursors.set(`p1|n1|${contract}`, { cursor: null, lastSyncedBlockHash: null, lastScanFinalized: null, startBlock: 0, ...overrides })
}

describe("IncomingTransferService — public-event reorg reconciliation (D6)", () => {
	test("referenceBlock throw → reconcile: orphan (blockHash ≠ canonical) deleted, balance refresh enqueued BEFORE delete, rewind to lastScanFinalized", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		const orphan = seedPublic({ txHash: "0xorphan", l2BlockNumber: 8, blockHash: "0xoldfork" })
		seedCursor({
			cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xoldfork",
			lastScanFinalized: 5,
		})
		state.responses.push(new Error("referenceBlock reorged out")) // forward scan detects the reorg
		state.responses.push(pubPage([])) // reconcile window has NO canonical event at block 8

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		await scanPublic(service)

		expect(records.get(orphan.id)).toBeUndefined()
		expect(deleted).toHaveBeenCalledTimes(1)
		expect(outboxFor()).toBeDefined()
		expect(state.fetchArgs[1].fromBlock).toBe(6) // lastScanFinalized(5)+1, NOT current finalized(50)
		expect(state.fetchArgs[1].referenceBlock).toBe("0xcheckpoint")
		expect(cursorFor()?.reconciling).toBeUndefined()
	})

	test("still-canonical record (blockHash matches) is KEPT across reconciliation", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		const rec = seedPublic({ txHash: "0xkeep", l2BlockNumber: 8, blockHash: "0xcanon8" })
		seedCursor({
			cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xanchor",
			lastScanFinalized: 5,
		})
		state.responses.push(new Error("reorg"))
		state.responses.push(pubPage([pubEvent({ txHash: "0xkeep", l2BlockNumber: 8, blockHash: "0xcanon8" })]))

		await scanPublic(service)

		expect(records.get(rec.id)).toBeDefined()
	})

	test("deletion driven ONLY by blockHash canonicality — a different-recipient orphan-height still deletes our record", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		const orphan = seedPublic({ txHash: "0xorph2", l2BlockNumber: 8, blockHash: "0xoldfork" })
		seedCursor({
			cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xoldfork",
			lastScanFinalized: 5,
		})
		state.responses.push(new Error("reorg"))
		state.responses.push(pubPage([pubEvent({ txHash: "0xelse", to: "0xNOTME", l2BlockNumber: 8, blockHash: "0xnewfork" })]))

		await scanPublic(service)

		expect(records.get(orphan.id)).toBeUndefined() // deleted on hash mismatch (0xoldfork ≠ 0xnewfork)
	})

	test("mid-reconcile reorg (upperBoundHash gone) → discard + restart (no cross-fork seen mixing)", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		seedCursor({
			cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xoldfork",
			lastScanFinalized: 5,
		})
		state.responses.push(new Error("reorg")) // forward scan detects reorg
		state.responses.push(new Error("upperBoundHash reorged mid-reconcile")) // reconcile throws → restart
		state.responses.push(pubPage([])) // restarted reconcile completes

		await scanPublic(service)

		expect(state.fetchArgs.length).toBeGreaterThanOrEqual(3)
		expect(cursorFor()?.reconciling).toBeUndefined()
	})

	test("(codex R5 A1) a budget-incomplete forward scan CAPS the finalized watermark at the scanned block (no reconcile-gap)", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		state.tips = { checkpointedBlockNumber: 100, checkpointedBlockHash: "0xcheckpoint", finalizedBlockNumber: 90 }
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		seedCursor({ cursor: null, lastSyncedBlockHash: null, lastScanFinalized: 0, startBlock: 0 })
		// 5 FULL pages (budget exhausted → hasMore) whose last log sits at block 10, far below finality
		// (90): the scan is BEHIND. Non-recipient events so they only advance the cursor.
		for (let i = 0; i < 5; i++) {
			state.responses.push(pubPage([pubEvent({ txHash: `0x${i}`, to: "0xNOTME", l2BlockNumber: 6 + i, logIndexWithinTx: i })], true))
		}

		await scanPublic(service)

		// The watermark must NOT jump to finalized(90) — that would let a later reconcile skip the
		// unscanned logs in (9, 90]. It is capped at the last FULLY-scanned block: block 10 is only
		// PARTIALLY scanned (the budget stopped mid-block), so the floor is block 10 − 1 = 9 (codex R6 A1).
		expect(cursorFor()?.cursor).toEqual({ blockNumber: 10, txIndexWithinBlock: 0, logIndexWithinTx: 4 })
		expect(cursorFor()?.lastScanFinalized).toBe(9)
	})

	test("(codex R6) checkpoint ROLLBACK: records above the new (rolled-back) tip are deleted + cursor rewinds", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		// Records committed when the checkpoint was 100 — now stranded above a rolled-back tip of 90.
		const above1 = seedPublic({ txHash: "0xrb1", l2BlockNumber: 95, blockHash: "0xh95" })
		const above2 = seedPublic({ txHash: "0xrb2", l2BlockNumber: 100, blockHash: "0xh100" })
		const belowFloor = seedPublic({ txHash: "0xfin", l2BlockNumber: 50, blockHash: "0xh50" }) // finalized — kept
		seedCursor({
			cursor: { blockNumber: 100, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xoldcheckpoint",
			lastScanFinalized: 60,
		})
		// The node has rolled the checkpoint back to 90 (proven tip). The boundary ancestry probe fails
		// (old anchor not in the new archive) → reconcile over [61..90], which is empty.
		state.tips = { checkpointedBlockNumber: 90, checkpointedBlockHash: "0xnewcheckpoint", finalizedBlockNumber: 60 }
		state.responses.push(new Error("old checkpoint not an ancestor")) // boundary ancestry throws
		state.responses.push(pubPage([])) // reconcile window [61..90] empty

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		await scanPublic(service)

		// Stranded rows above the new tip (90) are deleted; the finalized row (≤ floor) is kept.
		expect(records.get(above1.id)).toBeUndefined()
		expect(records.get(above2.id)).toBeUndefined()
		expect(records.get(belowFloor.id)).toBeDefined()
		// The cursor (was 100, above the new tip) is rewound to null so a re-advancing checkpoint re-indexes.
		expect(cursorFor()?.cursor).toBeNull()
		expect(cursorFor()?.reconciling).toBeUndefined()
	})

	test("pendingPage crash window: a set pendingPage whose fork is gone triggers reconciliation", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		const orphan = seedPublic({ txHash: "0xpp", l2BlockNumber: 8, blockHash: "0xoldfork" })
		seedCursor({
			cursor: { blockNumber: 7, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xanchor",
			lastScanFinalized: 5,
			pendingPage: {
				fromCursor: { blockNumber: 7, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
				toScannedThrough: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
				upperHash: "0xoldfork",
			},
		})
		state.responses.push(new Error("pendingPage upperHash not an ancestor")) // ancestry probe throws → reconcile
		state.responses.push(pubPage([])) // reconcile window empty → orphan deleted

		await scanPublic(service)

		// The pendingPage recovery is an ATOMIC ancestry probe rooted at the CURRENT checkpoint hash
		// (not a standalone canonicity fetch of the stale upperHash) — codex R5 A2.
		expect(state.fetchArgs[0].referenceBlock).toBe("0xcheckpoint")
		expect(state.fetchArgs[0].verifyAncestorHash).toBe("0xoldfork")
		expect(records.get(orphan.id)).toBeUndefined()
		expect(cursorFor()?.pendingPage).toBeUndefined()
	})

	test("clean pendingPage is cleared; forward scan proceeds", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		seedCursor({
			cursor: { blockNumber: 7, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xanchor",
			lastScanFinalized: 5,
			pendingPage: {
				fromCursor: null,
				toScannedThrough: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
				upperHash: "0xgoodfork",
			},
		})
		state.responses.push(pubPage([])) // probe succeeds
		state.responses.push(pubPage([])) // forward scan: nothing new

		await scanPublic(service)

		expect(cursorFor()?.pendingPage).toBeUndefined()
	})

	test("(codex R1/R2 Critical #1) intra-scan reorg: a page read off the wrong fork throws on the pinned checkpoint hash → reconcile, mixed-fork batch NEVER committed", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		seedCursor({
			cursor: { blockNumber: 4, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xboundary",
			lastScanFinalized: 3,
		})
		// (0) boundary probe: the low anchor is still canonical. (1) page 1 fetched OK against the
		// pinned checkpoint hash. (2) page 2 THROWS — the checkpoint fork was rewritten mid-scan, so the
		// second page can't validate against H_checkpoint. (3) restarted reconcile window is empty.
		state.responses.push(pubPage([])) // boundary probe OK
		state.responses.push(pubPage([pubEvent({ txHash: "0xp1e", l2BlockNumber: 6 })], true))
		state.responses.push(new Error("checkpoint hash reorged mid-scan")) // page 2 pinned-anchor throw
		state.responses.push(pubPage([])) // reconcile window

		await scanPublic(service)

		// page 1's event was NEVER committed (the scan threw before the commit loop)…
		expect(records.get("pub:p1|n1|0xp1e|0")).toBeUndefined()
		// …every forward page pinned the checkpoint hash…
		expect(state.fetchArgs[1].referenceBlock).toBe("0xcheckpoint")
		// …and reconciliation ran to completion (marker cleared).
		expect(cursorFor()?.reconciling).toBeUndefined()
	})

	test("(codex R4 #1/#7) no checkpoint hash → class gate is UNRESOLVED → nothing scanned (fail-closed defer)", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockHash: null } })
		const { service } = await bootPublic(reader, state)
		state.tips.checkpointedBlockHash = null // bootPublic's initial kick may have reset; re-assert
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		seedCursor({ cursor: null, lastSyncedBlockHash: null, lastScanFinalized: 3 })
		state.responses.push(pubPage([pubEvent({ txHash: "0xc1", l2BlockNumber: 6 })], true))

		await scanPublic(service)

		// Without the pinned checkpoint hash the class gate can't verify the checkpointed anchor → it
		// returns `unresolved` (fail closed) and the whole tick short-circuits: no class fetch, no page
		// fetch, no records. A blind scan is never attempted (codex R4 #1/#7).
		expect(state.classCalls).toBe(0)
		expect(state.fetchArgs).toHaveLength(0)
		expect(records.get("pub:p1|n1|0xc1|0")).toBeUndefined()
	})

	test("(codex R2/R3 #1) forward scan runs an ATOMIC boundary-ancestry probe first; a non-ancestor → reconcile", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		const orphan = seedPublic({ txHash: "0xbnd", l2BlockNumber: 8, blockHash: "0xoldfork" })
		seedCursor({
			cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xoldfork",
			lastScanFinalized: 5,
		})
		state.responses.push(new Error("boundary is not an ancestor of the checkpoint")) // the ancestry probe throws
		state.responses.push(pubPage([])) // reconcile window empty → orphan deleted

		await scanPublic(service)

		// The boundary probe is anchored to the CHECKPOINT hash and proves the boundary is its ancestor
		// (one atomic membership query — not two independent "canonical now" probes; codex R3 #1).
		expect(state.fetchArgs[0].referenceBlock).toBe("0xcheckpoint")
		expect(state.fetchArgs[0].verifyAncestorHash).toBe("0xoldfork")
		expect(records.get(orphan.id)).toBeUndefined()
	})

	test("(codex R1 Critical #2) a DROPPED reconcile page does NOT finish reconciliation (no deletion) — retries next tick", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		const rec = seedPublic({ txHash: "0xkeepme", l2BlockNumber: 7, blockHash: "0xcanon7" })
		// A reconciliation already staged over [6..8].
		seedCursor({
			cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xanchor",
			lastScanFinalized: 5,
			reconciling: { lowerBound: 6, upperBound: 8, upperBoundHash: "0xcheckpoint", progress: null, seen: [] },
		})
		// The reconcile scan returns a validator-DROPPED page (hostile/glitched node), NOT a genuine EOF.
		state.responses.push(pubDroppedPage())

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		await scanPublic(service)

		// A dropped page is NOT "window complete": the record must survive and the marker must remain.
		expect(records.get(rec.id)).toBeDefined()
		expect(deleted).not.toHaveBeenCalled()
		expect(cursorFor()?.reconciling).toBeDefined()
	})
})

describe("IncomingTransferService — public-arm lifecycle (D3)", () => {
	test("onAccountAdded resets public cursors to null (rescan the new account's history)", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		seedCursor({
			cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xh",
			lastScanFinalized: 5,
		})

		await (service as unknown as { onAccountAdded: (a: unknown) => Promise<void> }).onAccountAdded({ chainId: 1, address: "0xnew" })

		expect(cursorFor()?.cursor).toBeNull()
		expect(cursorFor()?.lastSyncedBlockHash).toBeNull()
	})

	test("(codex R1 High #4) onAccountAdded bumps the epoch DURING the reset — a pre-reset persist is rejected", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		seedCursor({
			cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastSyncedBlockHash: "0xh",
			lastScanFinalized: 5,
		})
		const svc = service as unknown as {
			serviceEpoch: number
			onAccountAdded: (a: unknown) => Promise<void>
			persistCursorLocked: (p: string, n: string, c: string, cur: unknown, e: number) => Promise<boolean>
		}
		const epochBefore = svc.serviceEpoch

		await svc.onAccountAdded({ chainId: 1, address: "0xnew" })

		// The reset ran under a bumped epoch, so a persist carrying the PRE-reset epoch (an in-flight
		// scan) is now rejected — closing the window where it could overwrite the cursor reset.
		expect(svc.serviceEpoch).toBeGreaterThan(epochBefore)
		const persisted = await svc.persistCursorLocked(
			"p1",
			"n1",
			tokenA.contract,
			{
				cursor: { blockNumber: 99, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
				lastSyncedBlockHash: "0xstale",
				lastScanFinalized: 5,
				startBlock: 0,
			},
			epochBefore,
		)
		expect(persisted).toBe(false)
		expect(cursorFor()?.cursor).toBeNull() // still the reset value, not the stale 99
	})

	test("onTokenDeleted deletes the cursor row (re-add re-indexes from startBlock)", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		seedCursor({ cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 } })
		seedPublic({ txHash: "0xtok", l2BlockNumber: 8 })

		await (service as unknown as { onTokenDeleted: (t: unknown) => Promise<void> }).onTokenDeleted({
			id: tokenA.id,
			profileId: "p1",
			chainId: 1,
			contract: tokenA.contract,
		})

		expect(cursorFor()).toBeUndefined()
	})

	test("clearChain wipes the public cursor + outbox rows too", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		seedCursor({ cursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 } })
		outbox.set("p1|n1|0xa|1", { dirtyAt: 1 })

		await service.clearChain("p1", "n1")

		expect(cursorFor()).toBeUndefined()
		expect(outboxFor()).toBeUndefined()
	})
})

// ── Balance-refresh outbox drain (Phase 3: D4 causal task-anchored ack) ─────

async function drain(service: unknown): Promise<void> {
	await (service as { drainBalanceOutbox: () => Promise<void> }).drainBalanceOutbox()
}

describe("IncomingTransferService — balance-refresh outbox (D4 write-side)", () => {
	test("outbox written regardless of trust state (a BLOCKED receipt still marks the balance dirty)", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "blocked",
			updatedAt: 0,
		})
		state.responses.push(pubPage([pubEvent({ txHash: "0xblocked" })]))

		await scanPublic(service)

		expect(records.get("pub:p1|n1|0xblocked|0")?.hidden).toBe(true)
		expect(outboxFor()).toBeDefined()
	})

	test("coalescing: N receipts for one (account, token) → ONE outbox row", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})
		state.responses.push(pubPage([pubEvent({ txHash: "0xr1" }), pubEvent({ txHash: "0xr2", txIndexWithinBlock: 1 })]))

		await scanPublic(service)

		expect([...outbox.keys()].filter((k) => k.startsWith("p1|n1|0xa|"))).toHaveLength(1)
	})

	test("private-arm parity: a discovered NOTE marks the balance dirty too", async () => {
		const noteStub = makeNoteStub({ [tokenA.contract]: [note({ content: { value: "1000" } })] })
		const { service } = await bootService({
			account: publicAccountStub(),
			token: makeTokenStub([tokenA]),
			note: noteStub,
		})
		trust.set(trustKey("p1", "n1", tokenA.contract), {
			profileId: "p1",
			networkId: "n1",
			contract: tokenA.contract,
			state: "trusted",
			updatedAt: 0,
		})

		await scan(service, tokenA.contract)

		expect(outbox.get("p1|n1|0xa|1")).toBeDefined()
	})
})

describe("IncomingTransferService — balance-refresh drain (D4 causal ack)", () => {
	test("row deleted ONLY on its pendingTaskId's terminal-SUCCESS, NOT on the enqueue return", async () => {
		const { reader, state } = makePublicReader()
		const tokenBalance = makeTokenBalanceStub()
		const task = makeTaskStub()
		const { service } = await bootPublic(reader, state, { tokenBalance, task })
		outbox.set("p1|n1|0xa|1", { dirtyAt: 100 })
		tokenBalance.setResult({ taskId: "T1" })

		await drain(service) // requests refresh, anchors T1 — row REMAINS
		expect(outboxFor()?.pendingTaskId).toBe("T1")

		task.setTask("T1", TaskStatus.Processing) // not terminal
		await drain(service)
		expect(outboxFor()).toBeDefined() // still there

		task.setTask("T1", TaskStatus.Completed, Date.now()) // terminal-success
		await drain(service)
		expect(outboxFor()).toBeUndefined() // NOW deleted
	})

	test("in-flight-coalescing interleave: T1 succeeds while B is busy → B's row survives until a FRESH T2 succeeds", async () => {
		const { reader, state } = makePublicReader()
		const tokenBalance = makeTokenBalanceStub()
		const task = makeTaskStub()
		const { service } = await bootPublic(reader, state, { tokenBalance, task })

		// Receipt A: drain anchors a fresh T1.
		outbox.set("p1|n1|0xa|1", { dirtyAt: 100 })
		tokenBalance.setResult({ taskId: "T1" })
		await drain(service)
		expect(outboxFor()?.pendingTaskId).toBe("T1")

		// Receipt B arrives (clears the anchor, newer dirtyAt); the drain finds T1 still pending → busy.
		outbox.set("p1|n1|0xa|1", { dirtyAt: 200 })
		tokenBalance.setResult({ busy: true })
		await drain(service)
		expect(outboxFor()).toEqual({ dirtyAt: 200 }) // unanchored

		// T1 completes on pre-B chain state — but B's row has NO anchor, so it is NOT deleted.
		task.setTask("T1", TaskStatus.Completed, Date.now())
		await drain(service)
		expect(outboxFor()).toBeDefined()

		// A later drain (T1 drained) mints a FRESH T2 (created after dirtyAt=200) and anchors it.
		tokenBalance.setResult({ taskId: "T2" })
		await drain(service)
		expect(outboxFor()?.pendingTaskId).toBe("T2")

		// T2 succeeds → its projection saw receipt B → row deletes.
		task.setTask("T2", TaskStatus.Completed, Date.now())
		await drain(service)
		expect(outboxFor()).toBeUndefined()
	})

	test("a new receipt CLEARS the prior anchor + OVERWRITES dirtyAt", async () => {
		const { reader, state } = makePublicReader()
		const tokenBalance = makeTokenBalanceStub()
		const { service } = await bootPublic(reader, state, { tokenBalance })
		outbox.set("p1|n1|0xa|1", { dirtyAt: 100 })
		tokenBalance.setResult({ taskId: "T1" })
		await drain(service)
		expect(outboxFor()?.pendingTaskId).toBe("T1")

		// markBalanceDirty (via a fresh receipt) overwrites the whole row.
		await (service as unknown as { markBalanceDirty: (p: string, n: string, a: string, t: number) => Promise<void> }).markBalanceDirty(
			"p1",
			"n1",
			"0xa",
			1,
		)
		expect(outboxFor()?.pendingTaskId).toBeUndefined()
		expect(outboxFor()?.dirtyAt).toBeGreaterThan(100)
	})

	test("task terminal-FAILURE → clear anchor + re-request next drain", async () => {
		const { reader, state } = makePublicReader()
		const tokenBalance = makeTokenBalanceStub()
		const task = makeTaskStub()
		const { service } = await bootPublic(reader, state, { tokenBalance, task })
		outbox.set("p1|n1|0xa|1", { dirtyAt: 100 })
		tokenBalance.setResult({ taskId: "T1" })
		await drain(service)

		task.setTask("T1", TaskStatus.Failed, Date.now())
		await drain(service)
		expect(outboxFor()?.pendingTaskId).toBeUndefined() // anchor cleared

		tokenBalance.setResult({ taskId: "T2" })
		await drain(service)
		expect(outboxFor()?.pendingTaskId).toBe("T2") // re-requested
	})

	test("task MISSING (expired / never existed) → clear anchor + re-request", async () => {
		const { reader, state } = makePublicReader()
		const tokenBalance = makeTokenBalanceStub()
		const task = makeTaskStub()
		const { service } = await bootPublic(reader, state, { tokenBalance, task })
		outbox.set("p1|n1|0xa|1", { dirtyAt: 100, pendingTaskId: "GONE" }) // anchor to a task the ledger doesn't have
		tokenBalance.setResult({ taskId: "T2" })

		await drain(service) // GONE is missing → clear anchor
		expect(outboxFor()?.pendingTaskId).toBeUndefined()
		await drain(service) // re-request
		expect(outboxFor()?.pendingTaskId).toBe("T2")
	})

	test("active-profile-scoped: a BACKGROUND profile's outbox row is NOT drained", async () => {
		const { reader, state } = makePublicReader()
		const tokenBalance = makeTokenBalanceStub()
		const { service } = await bootPublic(reader, state, { tokenBalance })
		outbox.set("p2|n1|0xa|1", { dirtyAt: 100 }) // p2 is NOT the active profile (p1)

		await drain(service)

		expect(tokenBalance.requestBalanceRefresh).not.toHaveBeenCalled()
		expect(outbox.get("p2|n1|0xa|1")).toBeDefined() // untouched
	})

	test("stale-row tolerance: a POSITIVELY-missing balance ({missing:true}) → row deleted, never throws", async () => {
		const { reader, state } = makePublicReader()
		const tokenBalance = makeTokenBalanceStub()
		const { service } = await bootPublic(reader, state, { tokenBalance })
		outbox.set("p1|n1|0xa|1", { dirtyAt: 100 })
		tokenBalance.setResult({ missing: true })

		await drain(service)

		expect(outboxFor()).toBeUndefined()
	})

	test("(codex R1 High #4) a TRANSIENT refresh throw KEEPS the row (never discards the durable marker)", async () => {
		const { reader, state } = makePublicReader()
		const tokenBalance = makeTokenBalanceStub()
		const { service } = await bootPublic(reader, state, { tokenBalance })
		outbox.set("p1|n1|0xa|1", { dirtyAt: 100 })
		tokenBalance.setThrow(true) // a transient storage/task failure, NOT a missing pair

		await drain(service) // must not throw

		expect(outboxFor()).toBeDefined() // row preserved for the next drain
		expect(outboxFor()?.pendingTaskId).toBeUndefined() // and left unanchored
	})

	test("drain-on-init after simulated SW death: the row survives + a refresh is re-requested", async () => {
		// Seed a persisted outbox row BEFORE boot (as if the SW died with a pending refresh).
		outbox.set("p1|n1|0xa|1", { dirtyAt: 100 })
		const tokenBalance = makeTokenBalanceStub()
		tokenBalance.setResult({ taskId: "T1" })
		await bootService({ account: publicAccountStub(), token: makeTokenStub([tokenA]), tokenBalance })
		await flushPromises()

		expect(tokenBalance.requestBalanceRefresh).toHaveBeenCalledWith(1, "0xa")
		expect(outboxFor()?.pendingTaskId).toBe("T1")
	})
})

// ── D8 USD-value dust filter in getIncomingTransfers ───────────────────────

// The one (chainId, contract) the price map recognizes: CHAIN_IDS.MAINNET + the cUSD proxy → USDC.
const MAINNET_CHAIN = 4248422646
const MAPPED_CONTRACT = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
const mappedToken = { id: 9, profileId: "p1", chainId: MAINNET_CHAIN, contract: MAPPED_CONTRACT, symbol: "cUSD", decimals: 6 }

async function bootDust(overrides: { threshold?: number; quotes?: Record<string, { usd: number }>; visibility?: boolean } = {}) {
	const config = makeConfigStub(overrides.visibility ?? true)
	const price = makePriceStub()
	const booted = await bootService({
		network: makeNetworkStub([{ id: "nMain", chainId: MAINNET_CHAIN }]),
		account: makeAccountStub([{ profileId: "p1", chainId: MAINNET_CHAIN, address: "0xa" }]),
		token: makeTokenStub([mappedToken]),
		config,
		price,
	})
	await flushPromises()
	if (overrides.quotes) price.setQuotes(overrides.quotes)
	if (overrides.threshold !== undefined) config.setDustThreshold(overrides.threshold)
	return booted.service
}

const dustSeed = (siloedNullifier: string, amountRaw: string) =>
	seedNote({
		siloedNullifier,
		networkId: "nMain",
		accountAddress: "0xa",
		contract: MAPPED_CONTRACT,
		tokenId: 9,
		amountRaw,
		hidden: false,
	})

describe("IncomingTransferService — D8 dust filter (getIncomingTransfers)", () => {
	test("hides sub-threshold receipts; keeps at/above (RAISING hides MORE, LOWERING re-reveals)", async () => {
		const service = await bootDust({ threshold: 0.01, quotes: { "usd-coin": { usd: 1 } } })
		dustSeed("big", "20000") // 0.02 cUSD @ $1 = $0.02
		dustSeed("dust", "5000") // 0.005 cUSD @ $1 = $0.005 < $0.01

		let out = await service.getIncomingTransfers("p1", "nMain", "0xa")
		expect(out.map((r) => r.id)).toEqual(["note:p1|nMain|big"])

		// RAISE the threshold above the big one → it hides too.
		;(service as unknown as { configService: { setDustThreshold: (t: number) => void } }).configService.setDustThreshold(0.05)
		out = await service.getIncomingTransfers("p1", "nMain", "0xa")
		expect(out).toHaveLength(0)

		// LOWER back → both re-revealed.
		;(service as unknown as { configService: { setDustThreshold: (t: number) => void } }).configService.setDustThreshold(0.001)
		out = await service.getIncomingTransfers("p1", "nMain", "0xa")
		expect(out.map((r) => r.id).sort()).toEqual(["note:p1|nMain|big", "note:p1|nMain|dust"])
	})

	test("fails OPEN when the token has NO CoinGecko mapping (shown regardless of threshold)", async () => {
		const config = makeConfigStub()
		const price = makePriceStub()
		const unmappedToken = { id: 3, profileId: "p1", chainId: 1, contract: "0xunmapped", symbol: "UNK", decimals: 18 }
		const { service } = await bootService({ account: publicAccountStub(), token: makeTokenStub([unmappedToken]), config, price })
		await flushPromises()
		config.setDustThreshold(1000) // huge threshold
		price.setQuotes({ "usd-coin": { usd: 1 } })
		seedNote({
			siloedNullifier: "unk",
			networkId: "n1",
			accountAddress: "0xa",
			contract: "0xunmapped",
			tokenId: 3,
			amountRaw: "1",
			hidden: false,
		})

		const out = await service.getIncomingTransfers("p1", "n1", "0xa")
		expect(out.map((r) => r.id)).toEqual(["note:p1|n1|unk"]) // no mapping → fail open
	})

	test("fails OPEN when the quote is stale/absent (getQuotes returns FRESH only)", async () => {
		const service = await bootDust({ threshold: 1000, quotes: {} }) // mapped token, but NO quote present
		dustSeed("noquote", "1")

		const out = await service.getIncomingTransfers("p1", "nMain", "0xa")
		expect(out.map((r) => r.id)).toEqual(["note:p1|nMain|noquote"])
	})

	test("NEVER bypasses the visible/hidden gates: incomingTransfersVisible=false → [] even with priced records", async () => {
		const service = await bootDust({ threshold: 0.01, quotes: { "usd-coin": { usd: 1 } }, visibility: false })
		dustSeed("big", "20000")

		expect(await service.getIncomingTransfers("p1", "nMain", "0xa")).toEqual([])
	})

	test("NEVER bypasses hidden: a hidden (pending) record stays hidden regardless of dust value", async () => {
		const service = await bootDust({ threshold: 0.01, quotes: { "usd-coin": { usd: 1 } } })
		seedNote({
			siloedNullifier: "hid",
			networkId: "nMain",
			accountAddress: "0xa",
			contract: MAPPED_CONTRACT,
			tokenId: 9,
			amountRaw: "20000",
			hidden: true,
		})

		expect(await service.getIncomingTransfers("p1", "nMain", "0xa")).toHaveLength(0)
	})

	test("getIncomingTransferById is UNFILTERED — returns a dust record the feed hides", async () => {
		const service = await bootDust({ threshold: 100, quotes: { "usd-coin": { usd: 1 } } })
		const rec = dustSeed("tiny", "1") // way below $100

		expect(await service.getIncomingTransfers("p1", "nMain", "0xa")).toHaveLength(0) // dust-hidden in the feed
		const byId = await service.getIncomingTransferById(rec.id)
		expect(byId?.id).toBe(rec.id) // but reachable by id for the detail page
	})

	test("(code-review) getIncomingTransferById is SCOPED to the active profile — a foreign-profile id → undefined", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state) // active profile = "p1"
		// The record exists in the shared store but belongs to ANOTHER profile. The `id` is a URL route
		// param, so a stale/crafted foreign id must not surface another profile's receipt.
		const foreign = seedPublic({ profileId: "pOTHER", txHash: "0xforeign", l2BlockNumber: 5 })
		expect(await service.getIncomingTransferById(foreign.id)).toBeUndefined()
		const own = seedPublic({ txHash: "0xown", l2BlockNumber: 5 }) // profileId defaults to "p1"
		expect((await service.getIncomingTransferById(own.id))?.id).toBe(own.id)
	})

	const hash = (s: string) => ({ toString: () => s })
	// TxHash.fromString field-validates (BN254), so test tx hashes MUST be in-range — validNullifier
	// zero-pads to a tiny value that always parses. A high-nibble hash (0x55…) would throw in fromString
	// and mask the behaviour under test.
	const txh = (n: number) => validNullifier(n)

	test("getReceiptFee returns the sender-paid fee juice for a public receipt + caches it (one node call)", async () => {
		const network = makeNetworkStub()
		const { service } = await bootService({ network })
		const rec = seedPublic({ txHash: txh(0x1001), blockHash: "0xbh" })
		let calls = 0
		network.setReceiptImpl(async () => {
			calls++
			return { transactionFee: 12345n, blockHash: hash("0xbh") }
		})

		expect(await service.getReceiptFee(rec.id)).toEqual({ feeJuice: "12345" })
		// A mined tx's fee is immutable (block matches) → the second call is served from the cache, no node hit.
		expect(await service.getReceiptFee(rec.id)).toEqual({ feeJuice: "12345" })
		expect(calls).toBe(1)
	})

	test("getReceiptFee → null (uncached) when the receipt has no fee, and null (soft) when the node throws", async () => {
		const network = makeNetworkStub()
		const { service } = await bootService({ network })

		const noFee = seedPublic({ txHash: txh(0x1002), blockHash: "0xbh" })
		network.setReceiptImpl(async () => ({ transactionFee: undefined, blockHash: hash("0xbh") }))
		expect(await service.getReceiptFee(noFee.id)).toBeNull()
		// Not cached: a later retry that DOES find a fee must not be shadowed by the null.
		network.setReceiptImpl(async () => ({ transactionFee: 7n, blockHash: hash("0xbh") }))
		expect(await service.getReceiptFee(noFee.id)).toEqual({ feeJuice: "7" })

		const throws = seedPublic({ txHash: txh(0x1003), blockHash: "0xbh" })
		let called = false
		network.setReceiptImpl(async () => {
			called = true
			throw new Error("node down")
		})
		expect(await service.getReceiptFee(throws.id)).toBeNull()
		expect(called).toBe(true) // the null came from the NODE throwing, not a fromString parse error
	})

	test("getReceiptFee is reorg-safe — a receipt/record blockHash MISMATCH returns null (never a wrong-block fee)", async () => {
		const network = makeNetworkStub()
		const { service } = await bootService({ network })
		const rec = seedPublic({ txHash: txh(0x1005), blockHash: "0xblockA" })
		let calls = 0
		// The node reports the tx in a DIFFERENT block than the record currently names (reconciler lagging).
		network.setReceiptImpl(async () => {
			calls++
			return { transactionFee: 100n, blockHash: hash("0xblockB") }
		})
		// Mismatch → null: the page shows the record's block, so a fee from another block must not appear.
		expect(await service.getReceiptFee(rec.id)).toBeNull()
		expect(await service.getReceiptFee(rec.id)).toBeNull()
		expect(calls).toBe(2) // never cached → refetched every time

		// The reconciler catches up: the record's blockHash becomes the node's block → now it matches → fee + cache.
		seedPublic({ txHash: txh(0x1005), blockHash: "0xblockB" }) // same id (indexInTx 0), new blockHash
		expect(await service.getReceiptFee(rec.id)).toEqual({ feeJuice: "100" })
		const after = calls
		expect(await service.getReceiptFee(rec.id)).toEqual({ feeJuice: "100" })
		expect(calls).toBe(after) // cached now that receipt.blockHash === record.blockHash
	})

	test("getReceiptFee skips the cache write when a purge bumped the epoch mid-fetch (no stale repopulation)", async () => {
		const network = makeNetworkStub()
		const { service } = await bootService({ network })
		seedPublic({ txHash: txh(0x1006), blockHash: "0xbh" })
		const id = `pub:p1|n1|${txh(0x1006)}|0`
		let calls = 0
		network.setReceiptImpl(async () => {
			calls++
			// A concurrent purge lands while we're off-lock fetching: clearChain bumps the epoch (+ wipes the chain).
			await service.clearChain("p1", "n1")
			return { transactionFee: 50n, blockHash: hash("0xbh") }
		})
		expect(await service.getReceiptFee(id)).toEqual({ feeJuice: "50" }) // fee still shown for THIS open

		// Re-seed (the purge wiped it) + swap in a non-clearing impl. Had the first fetch poisoned the cache,
		// this would be served from it (calls stays 1); the epoch guard forces a real refetch instead.
		seedPublic({ txHash: txh(0x1006), blockHash: "0xbh" })
		network.setReceiptImpl(async () => {
			calls++
			return { transactionFee: 50n, blockHash: hash("0xbh") }
		})
		expect(await service.getReceiptFee(id)).toEqual({ feeJuice: "50" })
		expect(calls).toBe(2)
	})

	test("getReceiptFee is GATED to public receipts — a note id (or bogus/foreign id) → null with NO node call", async () => {
		const network = makeNetworkStub()
		const { service } = await bootService({ network })
		let calls = 0
		network.setReceiptImpl(async () => {
			calls++
			return { transactionFee: 999n }
		})

		// A private (note) receipt must never hand its tx hash to the node — the server-side kind gate
		// short-circuits BEFORE any getNode/getTxReceipt.
		const noteRec = seedNote({ txHash: txh(0x1004) })
		expect(await service.getReceiptFee(noteRec.id)).toBeNull()
		// A bogus / foreign id also yields null (getIncomingTransferById returns undefined) — no node call.
		expect(await service.getReceiptFee("pub:pX|nX|0xdead|0")).toBeNull()
		expect(calls).toBe(0)
	})
})

describe("IncomingTransferService — public-scan sync state (§3 Catching up)", () => {
	type SyncEvent = { networkId: string; contract: string; state: string; blocksBehind: number }
	type SyncSnapshot = { state: string; blocksBehind: number }
	const capture = (service: unknown): SyncEvent[] => {
		const events: SyncEvent[] = []
		;(service as { onIncomingSyncStateChanged: { add: (h: (e: SyncEvent) => void) => void } }).onIncomingSyncStateChanged.add((e) =>
			events.push(e),
		)
		return events
	}
	const getSnap = (service: unknown, contract = tokenA.contract, networkId = "n1") =>
		(service as { getSyncState: (n: string, c: string) => Promise<SyncSnapshot> }).getSyncState(networkId, contract)
	// State-only view — most cases assert the FSM; lag-specific cases use getSnap.
	const getSync = async (service: unknown, contract = tokenA.contract, networkId = "n1") =>
		(await getSnap(service, contract, networkId)).state
	// bootPublic's initial scheduler kick already emits + seeds the dedup baseline. Clear it so each test
	// drives from a known-empty state (parity with how bootPublic clears cursors/outbox).
	const resetSync = (service: unknown) => (service as { syncState: Map<string, string> }).syncState.clear()

	// A budget-INCOMPLETE scan: maxPages(5) full pages with advancing cursors → the indexer aggregates
	// hasMore=true → the pass did NOT reach the tip → backfilling.
	const budgetIncomplete = () =>
		[10, 20, 30, 40, 50].map((blockNumber) => ({
			events: [],
			scannedThrough: { blockNumber, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			hasMore: true,
			dropped: false,
		}))
	// A validator-dropped page: nothing confirmed this tick → still backfilling.
	const droppedPage = { events: [], scannedThrough: null, hasMore: false, dropped: true }

	test("(CRITICAL) a quiet token whose last event is far back but which SCANS THROUGH to the tip → caught-up", async () => {
		// The regression guard for the cursor-vs-tip bug: cursor sits at block 10 (its last event), the tip
		// is 100, and the reader returns an empty EOF (nothing new up to the tip). Coverage — not the
		// last-event cursor — must decide, so this is CAUGHT-UP, not a permanently stuck indicator.
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)
		seedCursor({ cursor: { blockNumber: 10, txIndexWithinBlock: 0, logIndexWithinTx: 0 } }) // lastSyncedBlockHash null → no probe
		await scanPublic(service)
		expect(await getSync(service)).toBe("caught-up")
		expect(events).toEqual([{ networkId: "n1", contract: tokenA.contract, state: "caught-up", blocksBehind: 0 }])
	})

	test("a budget-incomplete pass (hasMore) → backfilling", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)
		state.responses.push(...budgetIncomplete())
		await scanPublic(service)
		expect(await getSync(service)).toBe("backfilling")
		expect(events.map((e) => e.state)).toEqual(["backfilling"])
	})

	test("a dropped/suspect page → backfilling (nothing confirmed this tick)", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		state.responses.push(droppedPage)
		await scanPublic(service)
		expect(await getSync(service)).toBe("backfilling")
	})

	test("a non-advancing (hostile) page → backfilling, NOT a false caught-up (§3 R2 #1)", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		seedCursor({ cursor: { blockNumber: 50, txIndexWithinBlock: 0, logIndexWithinTx: 0 } }) // lastSyncedBlockHash null → no probe
		// A page whose scannedThrough does NOT advance past the cursor: the indexer stops + marks it dropped,
		// so it must read as still-working, never as "covered to the tip".
		state.responses.push({
			events: [],
			scannedThrough: { blockNumber: 50, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			hasMore: true,
			dropped: false,
		})
		await scanPublic(service)
		expect(await getSync(service)).toBe("backfilling")
	})

	test("emits on TRANSITION only — backfilling → caught-up, then no re-emit of caught-up", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)

		state.responses.push(droppedPage) // pass 1: dropped → backfilling (cursor stays null)
		await scanPublic(service)
		await scanPublic(service) // pass 2: empty EOF → caught-up
		await scanPublic(service) // pass 3: empty EOF → still caught-up → no re-emit

		expect(events.map((e) => e.state)).toEqual(["backfilling", "caught-up"])
	})

	test("a non-standard token is not scanned → caught-up (no indicator), never stranded", async () => {
		const { reader, state } = makePublicReader({ classStatus: "non-standard" })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)
		await scanPublic(service)
		expect(await getSync(service)).toBe("caught-up")
		// Nothing is scanned, so there is nothing to be behind on — lag is a hard 0.
		expect(events).toEqual([{ networkId: "n1", contract: tokenA.contract, state: "caught-up", blocksBehind: 0 }])
	})

	test("getSyncState fails toward { caught-up, 0 } for an unknown / never-scanned key", async () => {
		const { reader, state } = makePublicReader()
		const { service } = await bootPublic(reader, state)
		expect(await getSnap(service, "0xneverscanned")).toEqual({ state: "caught-up", blocksBehind: 0 })
	})

	test("(AUDIT R1) quiet token that reached the tip, then a transient failure → SMALL lag, no false backlog", async () => {
		// The blocking-finding regression: coverage (not the ancient event cursor) is the lag datum. A
		// quiet token whose cursor sits at block 10 scans through to tip 100, then one dropped pass at
		// tip 105 must report 5 blocks behind — never 95.
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)
		seedCursor({ cursor: { blockNumber: 10, txIndexWithinBlock: 0, logIndexWithinTx: 0 } })
		await scanPublic(service) // empty EOF → caught-up; lastCoveredBlock persists as 100
		state.tips.checkpointedBlockNumber = 105
		state.responses.push(droppedPage)
		await scanPublic(service)
		expect(events.at(-1)).toEqual({ networkId: "n1", contract: tokenA.contract, state: "backfilling", blocksBehind: 5 })
		expect(await getSnap(service)).toEqual({ state: "backfilling", blocksBehind: 5 })
	})

	test("(AUDIT R2) restart: persisted lastCoveredBlock beyond finalized survives — no phantom checkpointed−finalized backlog", async () => {
		// lastScanFinalized is capped at the finalized tip (50 here); a restart seeding coverage from it
		// would fake a 55-block backlog. The uncapped lastCoveredBlock (100) is the seed instead.
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 105, finalizedBlockNumber: 50 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)
		seedCursor({
			cursor: { blockNumber: 100, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastCoveredBlock: 100,
			lastScanFinalized: 50,
		})
		state.responses.push(droppedPage)
		await scanPublic(service)
		expect(events.at(-1)).toEqual({ networkId: "n1", contract: tokenA.contract, state: "backfilling", blocksBehind: 5 })
	})

	test("(AUDIT R2) mid-reconciliation: lag derives from the repair window's safe progress, not stale coverage", async () => {
		// An open reconciliation window [60..90] means blocks ≥60 are suspect — coverage drops to 59 even
		// though lastCoveredBlock was 100 before the reorg was detected.
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)
		seedCursor({
			cursor: { blockNumber: 90, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			lastCoveredBlock: 100,
			reconciling: { lowerBound: 60, upperBound: 90, upperBoundHash: "0xfork", progress: null, seen: [] },
		})
		// The reconciliation step itself may fail on the bare stub reader — the emit under test fires first.
		await scanPublic(service).catch(() => {})
		expect(events[0]).toEqual({ networkId: "n1", contract: tokenA.contract, state: "backfilling", blocksBehind: 41 })
	})

	test("cold start: a budget-incomplete first pass reports coverage = scannedThrough − 1 (large lag)", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)
		state.responses.push(...budgetIncomplete()) // pages advance to block 50, hasMore
		await scanPublic(service)
		expect(events.at(-1)).toEqual({ networkId: "n1", contract: tokenA.contract, state: "backfilling", blocksBehind: 51 })
	})

	test("threshold crossing DOWN mid-episode re-emits (the dot can clear); same-bucket drift stays silent", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)
		// A budget-exhausting pass: 5 strictly-advancing full pages (the indexer aggregates
		// hasMore=true only when the page budget runs out). Positions vary by (block, txIndex).
		const partialPass = (positions: Array<[number, number]>) =>
			positions.map(([blockNumber, txIndexWithinBlock]) => ({
				events: [],
				scannedThrough: { blockNumber, txIndexWithinBlock, logIndexWithinTx: 0 },
				hasMore: true,
				dropped: false,
			}))
		// After a committed pass the cursor carries an anchor hash, so each later pass runs a boundary
		// ancestry probe that consumes ONE reader response before the scan pages.
		const probeAck = () => ({ events: [], scannedThrough: null, hasMore: false, dropped: false })
		state.responses.push(...budgetIncomplete()) // → covered 49, lag 51 (≥15) → emit (first)
		await scanPublic(service)
		state.responses.push(
			probeAck(),
			...partialPass([
				[91, 0],
				[92, 0],
				[93, 0],
				[94, 0],
				[95, 0],
			]),
		) // → covered 94, lag 6 (<15) → crossing DOWN → emit
		await scanPublic(service)
		state.responses.push(
			probeAck(),
			...partialPass([
				[96, 0],
				[96, 1],
				[96, 2],
				[96, 3],
				[97, 0],
			]),
		) // → covered 96, lag 4 — same bucket → NO emit
		await scanPublic(service)
		expect(events.map((e) => [e.state, e.blocksBehind])).toEqual([
			["backfilling", 51],
			["backfilling", 6],
		])
		// The always-fresh-snapshot invariant (audit round 1): no emit, but the stored snapshot — and
		// with it every reseed (mount / port reconnect) — still advanced to the newest lag.
		expect(await getSnap(service)).toEqual({ state: "backfilling", blocksBehind: 4 })
	})

	test("PublicScanCursorSchema round-trips lastCoveredBlock + reconciling (the persisted watermark survives parse)", () => {
		// The repository parses every cursor read through this schema (repository.ts) — a schema that
		// dropped `lastCoveredBlock` would silently strip the restart watermark while the in-memory
		// seeding in the tests above stayed green (post-impl audit, Low #1).
		const cursor = {
			cursor: { blockNumber: 90, txIndexWithinBlock: 1, logIndexWithinTx: 2 },
			lastSyncedBlockHash: "0xanchor",
			lastScanFinalized: 50,
			lastCoveredBlock: 100,
			startBlock: 0,
			reconciling: { lowerBound: 60, upperBound: 90, upperBoundHash: "0xfork", progress: null, seen: [] },
		}
		expect(PublicScanCursorSchema.parse(cursor)).toEqual(cursor)
	})

	test("threshold crossing UP mid-episode re-emits (the dot can appear late)", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		const { service } = await bootPublic(reader, state)
		resetSync(service)
		const events = capture(service)
		state.responses.push(
			...[91, 92, 93, 94, 95].map((blockNumber) => ({
				events: [],
				scannedThrough: { blockNumber, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
				hasMore: true,
				dropped: false,
			})),
		) // budget-exhausted at block 95 → covered 94, lag 6 (<15) → first emit (state transition)
		await scanPublic(service)
		state.tips.checkpointedBlockNumber = 200 // the tip runs away while we're stuck
		// The committed pass persisted an anchor → this pass probes first (consumes one response).
		state.responses.push({ events: [], scannedThrough: null, hasMore: false, dropped: false }, droppedPage)
		await scanPublic(service) // coverage stays 94 → lag 106 (≥15) → crossing UP → emit
		expect(events.map((e) => [e.state, e.blocksBehind])).toEqual([
			["backfilling", 6],
			["backfilling", 106],
		])
	})
})

describe("IncomingTransferService — public-scan cursor resume (SW-restart, case 4 unit proof)", () => {
	test("a fresh service instance resumes its scan from the PERSISTED cursor, not block 0", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		// Simulate a PRIOR instance that scanned up to block 50 (cursor persisted; no anchor → no boundary
		// probe, so the first reader call IS the forward scan).
		const persisted = { blockNumber: 50, txIndexWithinBlock: 3, logIndexWithinTx: 1 }
		seedCursor({ cursor: persisted, lastSyncedBlockHash: null })

		// Boot a FRESH service over the SAME persisted storage (bootService does NOT clear cursors — only
		// bootPublic does). This is the SW restart: a new instance re-hydrating from chrome.storage.local.
		const { service } = await bootService({ account: publicAccountStub(), token: makeTokenStub([tokenA]), publicReader: reader })
		await flushPromises() // let the scheduler's immediate kick run its forward scan
		void service

		// The resumed scan's FIRST fetch must page from the persisted cursor — NOT null / startBlock 0. A
		// buggy restart that dropped the cursor would fetch with afterCursor undefined + fromBlock 0, then
		// re-index everything from scratch. This is the "cursor-aware resume, no re-processing" property the
		// SW-restart e2e cannot prove on its own (a from-0 rescan + PK-dedup would look identical there).
		expect(state.fetchArgs.length).toBeGreaterThan(0)
		expect(state.fetchArgs[0].afterCursor).toEqual(persisted)
		expect(state.fetchArgs[0].fromBlock).toBeUndefined()
	})

	test("with a persisted anchor (the production post-scan state), the forward scan still pages from the cursor", async () => {
		const { reader, state } = makePublicReader({ tips: { checkpointedBlockNumber: 100 } })
		// Production fidelity: a real prior instance that scanned to block 50 ALSO recorded the anchor hash. On
		// resume that anchor triggers a boundary ancestry probe (a distinct reader call) BEFORE the forward
		// scan — so this exercises the probe-present branch the no-anchor case above skips.
		const persisted = { blockNumber: 50, txIndexWithinBlock: 3, logIndexWithinTx: 1 }
		seedCursor({ cursor: persisted, lastSyncedBlockHash: "0xanchor" })

		const { service } = await bootService({ account: publicAccountStub(), token: makeTokenStub([tokenA]), publicReader: reader })
		await flushPromises()
		void service

		// SOME reader call must resume from the exact persisted cursor with no block-0 fallback. A dropped
		// cursor would instead page from block 0 (fromBlock set, afterCursor undefined) — no such call exists.
		const resumed = state.fetchArgs.find(
			(a) =>
				a.afterCursor?.blockNumber === persisted.blockNumber &&
				a.afterCursor?.txIndexWithinBlock === persisted.txIndexWithinBlock &&
				a.afterCursor?.logIndexWithinTx === persisted.logIndexWithinTx,
		)
		expect(resumed).toBeDefined()
		expect(resumed?.fromBlock).toBeUndefined()
	})
})
