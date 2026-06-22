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

import type { IncomingTransferRecord, IncomingTrustRecord, IncomingTrustState } from "./spec"

// ── Repo mock (in-memory) ────────────────────────────────────────────────

const records = new Map<string, IncomingTransferRecord>()
const trust = new Map<string, IncomingTrustRecord>()

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
					records.set(r.siloedNullifier, r)
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
				},
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

function makeNetworkStub(networks: { id: string; chainId: number }[] = [{ id: "n1", chainId: 1 }]) {
	let purgeSub: ((profileId: string, chainId: number, networkId: string) => Promise<void>) | null = null
	return {
		name: "network",
		dependencies: [],
		networks,
		getNetworks: vi.fn().mockImplementation(async (chainId?: number) => {
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

function makeTransactionStub(txs: { hash: string; account: string; chainId: number }[] = []) {
	return {
		name: "transaction",
		dependencies: [],
		onTransactionAdded: eh<{ hash: string; account: string; chainId: number; calls: unknown[] }>(),
		// Real surface: `getTransactions(accountAddress)` returns all txs for
		// the address; the service filters by chainId locally. Pinning the
		// argspec here keeps the test honest with what scanContract calls.
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
	return {
		name: "config",
		dependencies: [],
		getValue: vi.fn().mockImplementation(async (key: string) => {
			if (key === "incomingTransfersVisible") return visibility
			return undefined
		}),
		setVisibility(v: boolean) {
			visibility = v
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
	}
	const { IncomingTransferService } = await import("./service")
	const logger = new LoggerStore(new ConfigStore())
	// Huge poll interval so scheduler doesn't fire during tests; we exercise
	// the scan path via the public surface or via direct method calls.
	const browserApi = new FakeBrowserApi()
	browserApi.reset()
	const service = new IncomingTransferService(logger, browserApi, 1_000_000)
	const collection = new ServiceCollection()
	for (const stub of Object.values(fixture)) collection.add(stub as never)
	collection.add(service)
	await collection.start()
	return { service, ...fixture }
}

beforeEach(() => {
	records.clear()
	trust.clear()
})

// ── Tests ───────────────────────────────────────────────────────────────

const validNullifier = (n: number) => `0x${n.toString(16).padStart(64, "0")}`
const tokenA = { id: 1, chainId: 1, contract: "0xtokenA", symbol: "TKA", decimals: 18 }
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
		noteIndexInTx: 0,
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
		records.set("k", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		const out = await service.getIncomingTransfers("p1", "n1", "0xa")
		expect(out).toEqual([])
	})

	test("getIncomingTransfers returns visible records when visibility=true", async () => {
		const { service } = await bootService()
		records.set("k", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		const out = await service.getIncomingTransfers("p1", "n1", "0xa")
		expect(out).toHaveLength(1)
	})

	test("getIncomingTransfers filters hidden records", async () => {
		const { service } = await bootService()
		records.set("v", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		records.set("h", {
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
			noteIndexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		const out = await service.getIncomingTransfers("p1", "n1", "0xa")
		expect(out).toHaveLength(1)
		expect(out[0].siloedNullifier).toBe("v")
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
		records.set(validNullifier(7), {
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
			noteIndexInTx: 0,
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
		records.set("ka", {
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
			noteIndexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		records.set("kb", {
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
			noteIndexInTx: 0,
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
		records.set("k", {
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
			noteIndexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		const added = vi.fn()
		service.onIncomingTransferAdded.add(added)
		await service.setTrustAllow("p1", "n1", tokenA.contract)
		expect(records.get("k")?.hidden).toBe(false)
		expect(added).toHaveBeenCalledTimes(1)
	})

	test("setTrustAllow with visibility=false flips records visible but does NOT emit (P4 carry)", async () => {
		const config = makeConfigStub(false)
		const { service } = await bootService({ config, token: makeTokenStub([tokenA]) })
		records.set("k", {
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
			noteIndexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		const added = vi.fn()
		service.onIncomingTransferAdded.add(added)
		await service.setTrustAllow("p1", "n1", tokenA.contract)
		// Records flipped (so a future toggle-on shows them) but no live event.
		expect(records.get("k")?.hidden).toBe(false)
		expect(added).not.toHaveBeenCalled()
	})

	test("setTrustReject sets state=blocked + does NOT flip hidden records visible", async () => {
		const { service } = await bootService({ token: makeTokenStub([tokenA]) })
		records.set("k", {
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
			noteIndexInTx: 0,
			hidden: true,
			discoveredAt: 0,
		})
		await service.setTrustReject("p1", "n1", tokenA.contract)
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("blocked")
		expect(records.get("k")?.hidden).toBe(true)
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

	test("dedupe source 1 (prior records): existing siloedNullifier → skip", async () => {
		const network = makeNetworkStub([{ id: "n1", chainId: 1 }])
		const token = makeTokenStub([tokenA])
		const n = note()
		const noteSvc = makeNoteStub({ [tokenA.contract]: [n] })
		const { service } = await bootService({ network, token, note: noteSvc })
		records.set(n.siloedNullifier, {
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
			noteIndexInTx: 0,
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
		const transaction = makeTransactionStub([{ hash: "0xtx1", account: "0xa", chainId: 1 }])
		const noteSvc = makeNoteStub({ [tokenA.contract]: [note({ txHash: "0xtx1" })] })
		const { service } = await bootService({ network, token, transaction, note: noteSvc })

		const pending = vi.fn()
		service.onIncomingTransferPending.add(pending)

		await scan(service)

		// Skipped → no trust transition either; nothing to prompt about.
		expect(pending).not.toHaveBeenCalled()
		expect(trust.size).toBe(0)
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

		const pre = {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		}
		records.set(pre.siloedNullifier, pre)

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		transaction.onTransactionAdded.invoke({ hash: "0xpending", account: "0xa", chainId: 1, calls: [] } as never)
		await flushPromises()

		expect(records.has(pre.siloedNullifier)).toBe(false)
		expect(deleted).toHaveBeenCalledTimes(1)
	})

	test("unrelated txHash: no delete, no emit", async () => {
		const transaction = makeTransactionStub()
		const { service } = await bootService({ transaction })

		const pre = {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		}
		records.set(pre.siloedNullifier, pre)

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		transaction.onTransactionAdded.invoke({ hash: "0xdifferent", account: "0xa", chainId: 1, calls: [] } as never)
		await flushPromises()

		expect(records.has(pre.siloedNullifier)).toBe(true)
		expect(deleted).not.toHaveBeenCalled()
	})

	test("(P5) per-hash reentrancy guard: two same-hash events → exactly one Delete emit", async () => {
		const transaction = makeTransactionStub()
		const { service } = await bootService({ transaction })

		const pre = {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		}
		records.set(pre.siloedNullifier, pre)

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		// Fire twice back-to-back — two listeners observing the same
		// listByTxHash result before either delete completes would have
		// emitted Deleted twice without the guard.
		transaction.onTransactionAdded.invoke({ hash: "0xreentrant", account: "0xa", chainId: 1, calls: [] } as never)
		transaction.onTransactionAdded.invoke({ hash: "0xreentrant", account: "0xa", chainId: 1, calls: [] } as never)
		await flushPromises()

		expect(records.has(pre.siloedNullifier)).toBe(false)
		expect(deleted).toHaveBeenCalledTimes(1)
	})

	test("(P5) account filter: same hash across accounts → only the originating account's record deleted", async () => {
		const transaction = makeTransactionStub()
		const { service } = await bootService({ transaction })

		// Two accounts with the same incoming txHash (legal under split-fee
		// / sponsored flows where account A's outgoing tx can deliver a
		// note to account B in the same hash).
		const recordA = {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		}
		const recordB = { ...recordA, siloedNullifier: validNullifier(11), accountAddress: "0xB", owner: "0xB" }
		records.set(recordA.siloedNullifier, recordA)
		records.set(recordB.siloedNullifier, recordB)

		const deleted = vi.fn()
		service.onIncomingTransferDeleted.add(deleted)

		transaction.onTransactionAdded.invoke({ hash: "0xshared", account: "0xA", chainId: 1, calls: [] } as never)
		await flushPromises()

		// Only account A's record gone; B's stays grounding.
		expect(records.has(recordA.siloedNullifier)).toBe(false)
		expect(records.has(recordB.siloedNullifier)).toBe(true)
		expect(deleted).toHaveBeenCalledTimes(1)
	})
})

describe("IncomingTransferService — cleanup wiring", () => {
	test("clearProfile wipes records + trust for that profileId", async () => {
		const { service } = await bootService()
		records.set("k1", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		records.set("k2", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		trust.set(trustKey("p1", "n1", "0xc"), { profileId: "p1", networkId: "n1", contract: "0xc", state: "trusted", updatedAt: 0 })
		trust.set(trustKey("p2", "n1", "0xc"), { profileId: "p2", networkId: "n1", contract: "0xc", state: "trusted", updatedAt: 0 })

		await service.clearProfile("p1")

		expect(records.has("k1")).toBe(false)
		expect(records.has("k2")).toBe(true)
		expect(trust.has(trustKey("p1", "n1", "0xc"))).toBe(false)
		expect(trust.has(trustKey("p2", "n1", "0xc"))).toBe(true)
	})

	test("clearChain wipes only records + trust matching (profileId, networkId)", async () => {
		const { service } = await bootService()
		records.set("k1", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		records.set("k2", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		trust.set(trustKey("p1", "n1", "0xc"), { profileId: "p1", networkId: "n1", contract: "0xc", state: "trusted", updatedAt: 0 })
		trust.set(trustKey("p1", "n2", "0xc"), { profileId: "p1", networkId: "n2", contract: "0xc", state: "trusted", updatedAt: 0 })

		await service.clearChain("p1", "n1")

		expect(records.has("k1")).toBe(false)
		expect(records.has("k2")).toBe(true)
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
		expect(persisted.siloedNullifier).toBe(validNullifier(1))
	})

	test("(token-delete wipe) onTokenDeleted purges records + resets trust to unknown", async () => {
		// Pre-seed records + trust=trusted for tokenA. Token delete should
		// wipe both. Closes the subagent-diagnosed remove+re-add bug.
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })

		records.set("k1", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
			blockTimestamp: 1_700_000_000,
		})
		records.set("k2", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
			blockTimestamp: 1_700_000_036,
		})
		// Unrelated contract's records must survive.
		records.set("kOther", {
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
			noteIndexInTx: 0,
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
		expect(records.has("k1")).toBe(false)
		expect(records.has("k2")).toBe(false)
		expect(records.has("kOther")).toBe(true)
		expect(deleted).toHaveBeenCalledTimes(2)
		// Trust row for tokenA flipped to unknown.
		expect(trust.get(trustKey("p1", "n1", tokenA.contract))?.state).toBe("unknown")
		expect(trustChanged).toHaveBeenCalled()
	})

	test("(token-delete wipe) trust row absent → no trustChanged emit but records still wiped", async () => {
		const accountStub = makeAccountStub([{ profileId: "p1", chainId: 1, address: "0xa" }])
		const tokenStub = makeTokenStub([tokenA])
		const { service } = await bootService({ network: network(), account: accountStub, token: tokenStub })

		records.set("k1", {
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
			noteIndexInTx: 0,
			hidden: false,
			discoveredAt: 0,
		})
		// NO trust row pre-seeded.

		const trustChanged = vi.fn()
		service.onIncomingTrustChanged.add(trustChanged)

		tokenStub.onTokenDeleted.invoke(tokenA as never)
		await flushPromises()

		expect(records.has("k1")).toBe(false)
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
		expect(reindexed.siloedNullifier).toBe(validNullifier(1))
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
		expect(second.siloedNullifier).toBe(validNullifier(1))
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
		records.set("k1", {
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
			noteIndexInTx: 0,
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
		records.set("k_orphan", {
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
			noteIndexInTx: 0,
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
			records.delete("k_orphan")
			return snap
		})

		const added = vi.fn()
		service.onIncomingTransferAdded.add(added)

		await service.setTrustAllow("p1", "n1", tokenA.contract)

		// No Added emit; record stays deleted.
		expect(added).not.toHaveBeenCalled()
		expect(records.has("k_orphan")).toBe(false)
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
		records.set("k1", {
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
			noteIndexInTx: 0,
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
		records.set(validNullifier(1), {
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
			noteIndexInTx: 0,
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
