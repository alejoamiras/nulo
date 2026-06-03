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
	IncomingTransferRepository: vi.fn(function () {
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
	}),
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

function makeNoteStub(notesByContract: Record<string, unknown[]> = {}) {
	return {
		name: "note",
		dependencies: [],
		getNotesRaw: vi.fn().mockImplementation(async (_n: string, _a: string, contract: string) => {
			return notesByContract[contract] ?? []
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
	const service = new IncomingTransferService(logger, 1_000_000)
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
		const { service } = await bootService({ config })
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
		const { service } = await bootService()
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
