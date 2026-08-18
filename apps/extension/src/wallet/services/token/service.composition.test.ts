/**
 * Composition test (integration-test rollout): drives the REAL TokenService
 * graph in-process via `ServiceCollection.start()` against the shared dumb PXE
 * fake + FakeBrowserApi storage — NO Aztec sandbox / offscreen worker / proving
 * / browser. Proves the SHALLOW token-interface path: resolve the contract +
 * dedup-register + extract function candidates from a REAL artifact.
 *
 * SCOPE (narrow, on purpose): targets `parseTokenInterface` — the shallow
 * register + name-based candidate-extraction path. It does NOT touch
 * `fetchTokenMetadata`/`addToken`, which call `simulate(...)` (deep — e2e).
 * Candidate extraction is bb-FREE (it filters the artifact's functions by name/
 * params); the contract instance is a HARDCODED fake (deriving one needs the
 * Barretenberg WASM, which vitest/jsdom doesn't load). See
 * `apps/extension/tests/COMPOSITION-TESTS.md`.
 */
import { describe, expect, test, vi } from "vitest"
import type { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { TaskService } from "@/wallet/services/task/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { makeShallowPxeFake, type ShallowPxeFakeConfig } from "@/wallet/services/pxe/shallow-port.fake"
import { svc } from "@/wallet/services/composition-harness"
import { EventHandler } from "@nulo/wallet-core/utils"
import { fakeBrowser } from "@webext-core/fake-browser"
import { CHAIN_IDS } from "@/utils/chain-ids"
import { TokenService } from "./service"
import { PinMismatchError, TokenSeeder } from "./seeder"
import { DEFAULT_TOKEN_SEEDS } from "./default-tokens"
import type { Token, TokenInterface } from "./spec"

const NETWORK = { id: "net1", chainId: 1, primaryEndpointId: "ep1", endpoints: [{ id: "ep1", rpcUrl: "http://fake" }] }
const CONTRACT = AztecAddress.fromNumberUnsafe(0x1234).toString()
const CLASS_ID = "0xc1a55"

/** Hardcoded fake instance — deriving a real one needs the bb WASM (not loaded in vitest). */
function fakeTokenInstance(): ContractInstanceWithAddress {
	return {
		address: AztecAddress.fromStringUnsafe(CONTRACT),
		currentContractClassId: { toString: () => CLASS_ID } as unknown as Fr,
	} as unknown as ContractInstanceWithAddress
}

async function makeHarness(fakeConfig?: ShallowPxeFakeConfig) {
	const fake = makeShallowPxeFake(
		fakeConfig ?? {
			instances: new Map([[AztecAddress.fromStringUnsafe(CONTRACT).toString(), fakeTokenInstance()]]),
			artifacts: new Map([[CLASS_ID, TokenContractArtifact]]),
			registered: [],
		},
	)
	const api = new FakeBrowserApi()
	api.reset()
	const logger = new LoggerStore(new ConfigStore())
	const fakeTask = { complete: vi.fn(), fail: vi.fn(), startSubtask: vi.fn() }
	fakeTask.startSubtask.mockReturnValue(fakeTask)

	const collection = new ServiceCollection()
	collection.add(
		svc(ProfileService.name, {
			getActiveProfile: async () => ({ id: "p1" }),
			onProfileDeleted: { add: () => {} },
			onActiveProfileChanged: new EventHandler(),
		}),
	)
	collection.add(
		svc(NetworkService.name, {
			getNetwork: async () => NETWORK,
			registerChainPurgeSubscriber: () => {},
			onActiveNetworkChanged: new EventHandler(),
		}),
	)
	collection.add(svc(AccountService.name, {}))
	collection.add(svc(TaskService.name, { startNewTask: () => fakeTask }))
	collection.add(svc(OperationJournalService.name, {}))
	const tokenService = new TokenService(logger, api, () => fake.client)
	collection.add(tokenService)
	await collection.start()
	return { tokenService, fake, api }
}

describe("TokenService composition — in-process, no sandbox", () => {
	test("parseTokenInterface resolves + dedup-registers + extracts real candidates", async () => {
		const { tokenService, fake } = await makeHarness()

		const ti = await tokenService.parseTokenInterface(NETWORK.id, CONTRACT)

		expect(ti.contract).toBe(CONTRACT)
		// Real candidate extraction against the real Token artifact (bb-free, name-based).
		expect(ti.getNameFnCandidates.length).toBeGreaterThan(0)
		expect(ti.transferPublicFnCandidates.length).toBeGreaterThan(0)
		// getContracts() returned [] → the contract was registered exactly once.
		expect(fake.registerCalls).toHaveLength(1)
	})

	test("parseTokenInterface skips registration when already registered (dedup)", async () => {
		const { tokenService, fake } = await makeHarness({
			instances: new Map([[AztecAddress.fromStringUnsafe(CONTRACT).toString(), fakeTokenInstance()]]),
			artifacts: new Map([[CLASS_ID, TokenContractArtifact]]),
			registered: [AztecAddress.fromStringUnsafe(CONTRACT)],
		})

		await tokenService.parseTokenInterface(NETWORK.id, CONTRACT)
		expect(fake.registerCalls).toHaveLength(0) // getContracts() already lists it → no register
	})

	// Characterization pins (F-Q09): getTokenInterface had ZERO coverage — its
	// load-bearing identity is pinned here before any structural refactor.
	describe("getTokenInterface (characterization)", () => {
		const SENTINEL = { name: "sentinel_custom_fn", impl: 999 }
		const seedRow = (over: Partial<Token> = {}): Token => ({
			id: 7,
			profileId: "p1",
			chainId: 1,
			contract: CONTRACT,
			name: "Tok",
			symbol: "TOK",
			decimals: 18,
			getNameFn: SENTINEL,
			...over,
		})

		test("returns the STORED per-kind picks verbatim (never re-derives a default) + real candidates", async () => {
			const { tokenService, api } = await makeHarness()
			await api.storage.local.set({ "nulo:core:tokens@7": JSON.stringify(seedRow()) })

			const ti = await tokenService.getTokenInterface(NETWORK.id, 7)

			// The pick-source is the stored row's field — a fabricated impl no
			// artifact-derived default would ever produce must round-trip as-is.
			expect(ti.getNameFn).toEqual(SENTINEL)
			// An absent stored pick stays absent (no getDefaultTokenFn fallback).
			expect(ti.getSymbolFn).toBeUndefined()
			// Candidates still come from the real artifact.
			expect(ti.getNameFnCandidates.length).toBeGreaterThan(0)
			expect(ti.transferPublicFnCandidates.length).toBeGreaterThan(0)
			expect(ti.contract).toBe(CONTRACT)
			expect(ti.chainId).toBe(1)
		})

		test("rejects a token owned by ANOTHER profile (ownership gate)", async () => {
			const { tokenService, api } = await makeHarness()
			await api.storage.local.set({ "nulo:core:tokens@7": JSON.stringify(seedRow({ profileId: "p2" })) })

			await expect(tokenService.getTokenInterface(NETWORK.id, 7)).rejects.toThrow(/unknown token id/)
		})

		test("rejects an unknown token id", async () => {
			const { tokenService } = await makeHarness()
			await expect(tokenService.getTokenInterface(NETWORK.id, 999)).rejects.toThrow(/unknown token id/)
		})
	})
})

describe("TokenService.restore — shared numeric cursor (nextNumericId + restoreRows)", () => {
	const mkToken = (contract: string): Token =>
		({ id: 0, profileId: "p1", chainId: 1, contract, name: contract, symbol: contract, decimals: 18 }) as Token

	test("assigns a shared numeric cursor — ids are consecutive across the batch", async () => {
		const { tokenService } = await makeHarness()

		const restored = await tokenService.restore([mkToken("0xa"), mkToken("0xb"), mkToken("0xc")])

		expect(restored.every((r) => r.restoreError === undefined)).toBe(true)
		const ids = restored.map((r) => r.id)
		expect(ids[1]).toBe(ids[0] + 1)
		expect(ids[2]).toBe(ids[1] + 1)
		// The reassigned ids are what actually landed in the store.
		expect((await tokenService.getTokensRaw("p1")).map((t) => t.id).sort((a, b) => a - b)).toEqual(ids)
	})

	test("a failed write records a restoreError STRING; the cursor skips it (no id consumed)", async () => {
		const { tokenService, api } = await makeHarness()
		// Fail only the first persisted write (restore's writes are the only sets and
		// run in row order), so the surviving rows must still restore.
		vi.spyOn(api.storage.local, "set").mockRejectedValueOnce(new Error("disk full"))

		const [a, b, c] = await tokenService.restore([mkToken("0xa"), mkToken("0xb"), mkToken("0xc")])

		expect(a.restoreError).toBe("disk full")
		expect(typeof a.restoreError).toBe("string")
		expect(b.restoreError).toBeUndefined()
		expect(c.restoreError).toBeUndefined()
		// `a` failed → its id was not consumed → `b`/`c` are consecutive from the cursor start.
		expect(c.id).toBe(b.id + 1)
	})
})

describe("TokenService seeding — composition (simulate-free slice)", () => {
	// The deep half of the seed flow (previewTokenMetadata → simulate) is
	// covered at the seeder-deps seam in seeder.test.ts — D2 keeps it out of
	// composition. This slice drives the REAL graph for everything else:
	// register-free pin reads, the seed-only persist path + journal labeling,
	// tombstone-on-delete, and the unlock/network-change hook wiring.
	const CUSD = DEFAULT_TOKEN_SEEDS[0].contract

	async function seedHarness() {
		const fake = makeShallowPxeFake({
			instances: new Map([[AztecAddress.fromStringUnsafe(CONTRACT).toString(), fakeTokenInstance()]]),
			artifacts: new Map([[CLASS_ID, TokenContractArtifact]]),
			registered: [],
		})
		const api = new FakeBrowserApi()
		api.reset()
		const logger = new LoggerStore(new ConfigStore())
		const fakeTask = { complete: vi.fn(), fail: vi.fn(), startSubtask: vi.fn() }
		fakeTask.startSubtask.mockReturnValue(fakeTask)

		const onActiveProfileChanged = new EventHandler<{ id: string } | undefined>()
		const onActiveNetworkChanged = new EventHandler<unknown>()
		const journal = {
			createOperation: vi.fn(async (input: Record<string, unknown>) => ({ id: "op1", ...input })),
			transitionOperation: vi.fn(async () => {}),
			setOperationMeta: vi.fn(async () => {}),
			purgeForProfile: vi.fn(async () => {}),
		}

		const collection = new ServiceCollection()
		collection.add(
			svc(ProfileService.name, {
				getActiveProfile: async () => ({ id: "p1" }),
				onProfileDeleted: { add: () => {} },
				onActiveProfileChanged,
			}),
		)
		collection.add(
			svc(NetworkService.name, {
				getNetwork: async () => NETWORK,
				getActiveNetwork: async () => NETWORK,
				registerChainPurgeSubscriber: () => {},
				onActiveNetworkChanged,
			}),
		)
		collection.add(svc(AccountService.name, { getAccounts: async () => [{ address: "0xacc1" }] }))
		collection.add(svc(TaskService.name, { startNewTask: () => fakeTask }))
		collection.add(svc(OperationJournalService.name, journal))
		const tokenService = new TokenService(logger, api, () => fake.client)
		collection.add(tokenService)
		await collection.start()
		return { tokenService, fake, api, journal, onActiveProfileChanged, onActiveNetworkChanged }
	}

	const seedIface = (chainId: number, contract: string) => ({ chainId, contract, isComplete: true }) as unknown as TokenInterface

	test("pinned parse: matching class id registers once and returns the interface from THAT fetch", async () => {
		const { tokenService, fake } = await seedHarness()
		const ti = await tokenService.parseTokenInterface(NETWORK.id, CONTRACT, undefined, CLASS_ID)
		expect(ti.contract).toBe(CONTRACT)
		expect(fake.registerCalls).toHaveLength(1)
	})

	test("pinned parse: class-id mismatch throws PinMismatchError BEFORE any PXE registration", async () => {
		const { tokenService, fake } = await seedHarness()
		await expect(tokenService.parseTokenInterface(NETWORK.id, CONTRACT, undefined, "0xNOTTHECLASS")).rejects.toThrow(PinMismatchError)
		expect(fake.registerCalls).toHaveLength(0)
	})

	test("addSeededToken persists the given snapshot with origin=seed journaling; idempotent", async () => {
		const { tokenService, journal } = await seedHarness()
		const input = {
			profileId: "p1",
			networkId: NETWORK.id,
			accountAddress: "0xacc1",
			tokenInterface: seedIface(NETWORK.chainId, CONTRACT),
			name: "Compressed USD",
			symbol: "cUSD",
			decimals: 6,
		}
		const info = await tokenService.addSeededToken(input)
		expect(info.symbol).toBe("cUSD")
		expect(info.decimals).toBe(6)

		expect(journal.createOperation).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "token_import", origin: "seed", subtitle: "Default token", title: "cUSD" }),
		)
		expect(journal.transitionOperation).toHaveBeenLastCalledWith("op1", { stage: "succeeded" })

		const rows = await tokenService.getTokensRaw("p1", NETWORK.chainId)
		expect(rows).toHaveLength(1)
		expect(rows[0].name).toBe("Compressed USD")

		// Idempotency: a second call short-circuits before journaling.
		await tokenService.addSeededToken(input)
		expect(journal.createOperation).toHaveBeenCalledTimes(1)
		expect(await tokenService.getTokensRaw("p1", NETWORK.chainId)).toHaveLength(1)
	})

	test("(Q-01 ordering pin) a failed import journals 'failed' BEFORE the token lock releases", async () => {
		// The catch lives INSIDE the withLock closure: a queued token op must
		// never observe the operation mid-failure. If the catch ever moves
		// outside the lock, the queued op below runs before the journal write
		// and this ordering assertion reds.
		const { tokenService, journal } = await seedHarness()
		const events: string[] = []
		let releaseFailed!: () => void
		const failedGate = new Promise<void>((r) => {
			releaseFailed = r
		})
		let startQueued!: () => void
		const queuedStarted = new Promise<void>((r) => {
			startQueued = r
		})
		;(journal.transitionOperation as ReturnType<typeof vi.fn>).mockImplementation(async (...args: unknown[]) => {
			const stage = (args[1] as { stage: string }).stage
			if (stage === "simulating") {
				// We are UNDER the token lock now: let the test enqueue a second
				// locked op behind us, give it a beat to reach the lock queue,
				// then fail the import.
				startQueued()
				await new Promise((r) => setTimeout(r, 0))
				throw new Error("sim boom")
			}
			if (stage === "failed") {
				// The discriminator: the failed transition BLOCKS until the test
				// releases it. With the catch inside the closure, the token lock
				// is held through this await — the queued op below must stay
				// blocked while the gate is closed. A catch outside the lock
				// releases first and the mid-flight assertion reds.
				await failedGate
				events.push("journal:failed-complete")
			}
		})
		const failing = tokenService
			.addSeededToken({
				profileId: "p1",
				networkId: NETWORK.id,
				accountAddress: "0xacc1",
				tokenInterface: seedIface(NETWORK.chainId, CONTRACT),
				name: "Compressed USD",
				symbol: "cUSD",
				decimals: 6,
			})
			.catch(() => {})
		await queuedStarted
		const queued = tokenService.restore([]).then(() => events.push("queued-op:ran"))
		// Generous window for the queued op to (wrongly) slip in while the failed
		// transition is still pending — it must not.
		await new Promise((r) => setTimeout(r, 20))
		expect(events).toEqual([])
		releaseFailed()
		await Promise.all([failing, queued])
		expect(events).toEqual(["journal:failed-complete", "queued-op:ran"])
	})

	test("deleting a DEFAULT token writes the user tombstone marker", async () => {
		const { tokenService } = await seedHarness()
		const info = await tokenService.addSeededToken({
			profileId: "p1",
			networkId: NETWORK.id,
			accountAddress: "0xacc1",
			tokenInterface: seedIface(CHAIN_IDS.MAINNET, CUSD),
			name: "Compressed USD",
			symbol: "cUSD",
			decimals: 6,
		})
		await tokenService.deleteToken(info.id)

		const res = await fakeBrowser.storage.local.get("nulo:core:token-seeded@p1")
		const marker = JSON.parse(res["nulo:core:token-seeded@p1"] as string)
		expect(marker[`${CHAIN_IDS.MAINNET}:${CUSD.toLowerCase()}`].outcome).toBe("deleted")
	})

	test("deleting a NON-default token writes no marker", async () => {
		const { tokenService } = await seedHarness()
		const info = await tokenService.addSeededToken({
			profileId: "p1",
			networkId: NETWORK.id,
			accountAddress: "0xacc1",
			tokenInterface: seedIface(NETWORK.chainId, CONTRACT),
			name: "Other",
			symbol: "OTH",
			decimals: 18,
		})
		await tokenService.deleteToken(info.id)
		const res = await fakeBrowser.storage.local.get("nulo:core:token-seeded@p1")
		expect(res["nulo:core:token-seeded@p1"]).toBeUndefined()
	})

	test("unlock + active-network-change both trigger a seed pass through the REAL init wiring", async () => {
		const runSpy = vi.spyOn(TokenSeeder.prototype, "run").mockResolvedValue(undefined)
		try {
			const { onActiveProfileChanged, onActiveNetworkChanged } = await seedHarness()
			onActiveProfileChanged.invoke({ id: "p1" })
			expect(runSpy).toHaveBeenCalledTimes(1)
			// Lock (undefined) must NOT trigger a pass.
			onActiveProfileChanged.invoke(undefined)
			expect(runSpy).toHaveBeenCalledTimes(1)
			onActiveNetworkChanged.invoke(NETWORK)
			expect(runSpy).toHaveBeenCalledTimes(2)
		} finally {
			runSpy.mockRestore()
		}
	})

	test("purgeForProfile re-purges journals AFTER the seeder fence — a late seed's journal row cannot orphan", async () => {
		const { tokenService, journal } = await seedHarness()
		await tokenService.addSeededToken({
			profileId: "p1",
			networkId: NETWORK.id,
			accountAddress: "0xacc1",
			tokenInterface: seedIface(NETWORK.chainId, CONTRACT),
			name: "Compressed USD",
			symbol: "cUSD",
			decimals: 6,
		})
		// The coordinator purges journals BEFORE TokenService.purgeForProfile
		// runs; a seed committing in between creates a journal row nothing
		// later sweeps — unless this purge re-runs the journal purge itself.
		await tokenService.purgeForProfile("p1")
		expect(journal.purgeForProfile).toHaveBeenCalledWith("p1")
	})
})
