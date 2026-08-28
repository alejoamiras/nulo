/**
 * Unit tests for `TokenSeeder`: the trust boundary (pre-registration class-id
 * pin, metadata pins/bounds), marker bookkeeping (attempt cap + per-version
 * retry, deletion tombstones vs chain-purge resets, write ordering), skip
 * semantics, and single-flight.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import { fakeBrowser } from "@webext-core/fake-browser"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { DEFAULT_TOKEN_SEEDS, type DefaultTokenSeed } from "./default-tokens"
import { PinMismatchError, SEED_ATTEMPT_CAP, TokenSeeder, type SeedPreview, type TokenSeederDeps } from "./seeder"
import type { TokenInterface } from "./spec"

const CHAIN_ID = 999
const CONTRACT = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
const CLASS_ID = "0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf"
const MARKER_KEY = "nulo:core:token-seeded@p1"

const SEED: DefaultTokenSeed = { chainId: CHAIN_ID, contract: CONTRACT, expectedClassId: CLASS_ID, expectedSymbol: "cUSD" }

const IFACE = { chainId: CHAIN_ID, contract: CONTRACT, isComplete: true } as unknown as TokenInterface

function goodPreview(): SeedPreview {
	return { name: "Compressed USD", symbol: "cUSD", decimals: 6, interface: IFACE }
}

function makeSeeder(overrides?: Partial<TokenSeederDeps> & { version?: string }) {
	const api = new FakeBrowserApi()
	const logger = new LoggerStore(new ConfigStore())
	const deps: TokenSeederDeps = {
		getSeeds: vi.fn(async () => [SEED]),
		getActiveProfile: vi.fn(async () => ({ id: "p1" })),
		getActiveNetwork: vi.fn(async () => ({ id: "net1", chainId: CHAIN_ID })),
		getAccounts: vi.fn(async () => [{ address: "0xacc1" }]),
		preview: vi.fn(async () => goodPreview()),
		isTokenPresent: vi.fn(async () => false),
		persist: vi.fn(async () => {}),
		...overrides,
	}
	const seeder = new TokenSeeder(deps, api.storage.local, logger, () => overrides?.version ?? "1.0.0")
	return { seeder, deps, api }
}

async function readMarker(): Promise<Record<string, { attempts: number; cappedAtVersion?: string; outcome?: string }>> {
	const res = await fakeBrowser.storage.local.get(MARKER_KEY)
	return res[MARKER_KEY] ? JSON.parse(res[MARKER_KEY] as string) : {}
}

const KEY = `${CHAIN_ID}:${CONTRACT}`

beforeEach(async () => {
	await fakeBrowser.reset()
})

describe("TokenSeeder — happy path + skips", () => {
	test("fresh profile seeds: single-pass pinned preview, persists the exact snapshot, marks seeded", async () => {
		const { seeder, deps } = makeSeeder()
		await seeder.run()

		expect(deps.preview).toHaveBeenCalledTimes(1)
		// The TOFU pin travels INTO the single parse pass.
		expect(deps.preview).toHaveBeenCalledWith("net1", "0xacc1", CONTRACT, CLASS_ID)
		expect(deps.persist).toHaveBeenCalledWith({
			profileId: "p1",
			networkId: "net1",
			accountAddress: "0xacc1",
			tokenInterface: IFACE,
			name: "Compressed USD",
			symbol: "cUSD",
			decimals: 6,
		})
		const marker = await readMarker()
		expect(marker[KEY].outcome).toBe("seeded")
		expect((marker[KEY] as { observedDecimals?: number }).observedDecimals).toBe(6)
	})

	test("already-present token: marked seeded without preview or persist", async () => {
		const { seeder, deps } = makeSeeder({ isTokenPresent: vi.fn(async () => true) })
		await seeder.run()
		expect(deps.preview).not.toHaveBeenCalled()
		expect(deps.persist).not.toHaveBeenCalled()
		expect((await readMarker())[KEY].outcome).toBe("seeded")
	})

	test("seeded outcome short-circuits subsequent runs entirely", async () => {
		const { seeder, deps } = makeSeeder()
		await seeder.run()
		await seeder.run()
		expect(deps.persist).toHaveBeenCalledTimes(1)
		expect(deps.preview).toHaveBeenCalledTimes(1)
	})

	test("no active profile / no network / foreign chain: silent no-op", async () => {
		const a = makeSeeder({ getActiveProfile: vi.fn(async () => undefined) })
		await a.seeder.run()
		expect(a.deps.preview).not.toHaveBeenCalled()

		const b = makeSeeder({ getActiveNetwork: vi.fn(async () => null) })
		await b.seeder.run()
		expect(b.deps.preview).not.toHaveBeenCalled()

		const c = makeSeeder({ getActiveNetwork: vi.fn(async () => ({ id: "net1", chainId: 0 })) })
		await c.seeder.run()
		expect(c.deps.preview).not.toHaveBeenCalled()
		expect(await readMarker()).toEqual({})
	})

	test("zero accounts: skips WITHOUT consuming an attempt; seeds once an account exists", async () => {
		const accounts: { address: string }[] = []
		const { seeder, deps } = makeSeeder({ getAccounts: vi.fn(async () => accounts) })
		await seeder.run()
		expect(deps.persist).not.toHaveBeenCalled()
		expect((await readMarker())[KEY]).toBeUndefined()

		// The second run stands in for the account-added trigger: on a fresh
		// profile the profile- and network-change triggers both fire while this
		// list is still empty, so that trigger is the only thing that reaches
		// this branch. The pass must find a full attempt budget waiting.
		accounts.push({ address: "0xacc1" })
		await seeder.run()
		expect(deps.persist).toHaveBeenCalledTimes(1)
		expect((await readMarker())[KEY]).toMatchObject({ attempts: 1, outcome: "seeded" })
	})

	test("single-flight: concurrent runs coalesce into one pass", async () => {
		let release: (() => void) | undefined
		const { seeder, deps } = makeSeeder({
			preview: vi.fn(
				() =>
					new Promise<SeedPreview>((resolve) => {
						release = () => resolve(goodPreview())
					}),
			),
		})
		const first = seeder.run()
		const second = seeder.run()
		await vi.waitFor(() => expect(release).toBeDefined())
		release?.()
		await Promise.all([first, second])
		expect(deps.preview).toHaveBeenCalledTimes(1)
		expect(deps.persist).toHaveBeenCalledTimes(1)
	})
})

describe("TokenSeeder — trust boundary (hard skips)", () => {
	test("pin mismatch (thrown by the single parse pass): hard skip, attempt counted, NO retry same version", async () => {
		const preview = vi.fn(async (): Promise<SeedPreview> => {
			throw new PinMismatchError(`class id 0xEVIL ≠ pinned ${CLASS_ID}`)
		})
		const { seeder, deps } = makeSeeder({ preview })
		await seeder.run()
		expect(deps.persist).not.toHaveBeenCalled()
		expect((await readMarker())[KEY].attempts).toBe(1)
	})

	test("symbol mismatch: hard skip after preview, nothing persisted", async () => {
		const { seeder, deps } = makeSeeder({ preview: vi.fn(async () => ({ ...goodPreview(), symbol: "USDC" })) })
		await seeder.run()
		expect(deps.persist).not.toHaveBeenCalled()
	})

	test("metadata bounds: out-of-range decimals and empty name are rejected", async () => {
		for (const bad of [
			{ ...goodPreview(), decimals: 19 },
			{ ...goodPreview(), decimals: -1 },
			{ ...goodPreview(), name: "" },
		]) {
			const { seeder, deps } = makeSeeder({ preview: vi.fn(async () => bad) })
			await seeder.run()
			expect(deps.persist).not.toHaveBeenCalled()
		}
	})

	test("PRODUCTION PIN: the shipped mainnet cUSDC seed accepts its live-captured metadata and rejects the old wrong pin", async () => {
		// Guards the real seed list, not a synthetic fixture: the entry at
		// 0x018d47… must accept exactly what Alpha serves (captured 2026-08-11
		// via seed-preflight-metadata.ts) — the original "cUSD" pin silently
		// hard-skipped this token on every unlock in production.
		const cusdc = DEFAULT_TOKEN_SEEDS.find((s) => s.contract.startsWith("0x018d47f656"))
		if (!cusdc) throw new Error("mainnet cUSDC seed missing from DEFAULT_TOKEN_SEEDS")
		const liveMetadata: SeedPreview = { name: "Clean USDC", symbol: "cUSDC", decimals: 6, interface: IFACE }

		const accepted = makeSeeder({
			getSeeds: async () => [cusdc],
			getActiveNetwork: vi.fn(async () => ({ id: "net1", chainId: cusdc.chainId })),
			preview: vi.fn(async () => liveMetadata),
		})
		await accepted.seeder.run()
		expect(accepted.deps.persist).toHaveBeenCalledTimes(1)

		const oldPin = makeSeeder({
			getSeeds: async () => [{ ...cusdc, expectedSymbol: "cUSD" }],
			getActiveNetwork: vi.fn(async () => ({ id: "net1", chainId: cusdc.chainId })),
			preview: vi.fn(async () => liveMetadata),
		})
		await oldPin.seeder.run()
		expect(oldPin.deps.persist).not.toHaveBeenCalled()
	})
})

describe("TokenSeeder — attempt cap + retry semantics", () => {
	test("transient failures count attempts and retry until the cap, then stop (same version)", async () => {
		const preview = vi.fn(async (): Promise<SeedPreview> => {
			throw new Error("rpc down")
		})
		const { seeder, deps } = makeSeeder({ preview })
		for (let i = 0; i < SEED_ATTEMPT_CAP + 2; i++) {
			await seeder.run()
		}
		expect(preview).toHaveBeenCalledTimes(SEED_ATTEMPT_CAP)
		const marker = await readMarker()
		expect(marker[KEY].attempts).toBe(SEED_ATTEMPT_CAP)
		expect(marker[KEY].cappedAtVersion).toBe("1.0.0")
		expect(deps.persist).not.toHaveBeenCalled()
	})

	test("attempt is recorded BEFORE the risky work (persist throw still counts)", async () => {
		const { seeder } = makeSeeder({
			persist: vi.fn(async () => {
				throw new Error("write failed")
			}),
		})
		await seeder.run()
		expect((await readMarker())[KEY].attempts).toBe(1)
		expect((await readMarker())[KEY].outcome).toBeUndefined()
	})

	test("a capped entry gets one fresh round on a new extension version", async () => {
		// Cap out on 1.0.0 with a failing preview.
		const api = new FakeBrowserApi()
		const logger = new LoggerStore(new ConfigStore())
		let version = "1.0.0"
		let previewOk = false
		const deps: TokenSeederDeps = {
			getSeeds: async () => [SEED],
			getActiveProfile: async () => ({ id: "p1" }),
			getActiveNetwork: async () => ({ id: "net1", chainId: CHAIN_ID }),
			getAccounts: async () => [{ address: "0xacc1" }],
			preview: async () => {
				if (!previewOk) throw new Error("rpc down")
				return goodPreview()
			},
			isTokenPresent: async () => false,
			persist: vi.fn(async () => {}),
		}
		const seeder = new TokenSeeder(deps, api.storage.local, logger, () => version)
		for (let i = 0; i < SEED_ATTEMPT_CAP; i++) await seeder.run()
		expect((await readMarker())[KEY].cappedAtVersion).toBe("1.0.0")

		version = "1.1.0"
		previewOk = true
		await seeder.run()
		expect(deps.persist).toHaveBeenCalledTimes(1)
		expect((await readMarker())[KEY].outcome).toBe("seeded")
	})
})

describe("TokenSeeder — tombstones vs purges", () => {
	test("user-deleted tombstone: never re-seeds", async () => {
		const { seeder, deps } = makeSeeder()
		await seeder.markDeletedByUser("p1", CHAIN_ID, CONTRACT)
		await seeder.run()
		expect(deps.preview).not.toHaveBeenCalled()
		expect(deps.persist).not.toHaveBeenCalled()
	})

	test("chain purge resets attempts but tombstones SURVIVE (delete + re-add ≠ resurrect)", async () => {
		const { seeder, deps } = makeSeeder()
		// Seed, then user deletes, then chain purged (network remove/re-add).
		await seeder.run()
		await seeder.markDeletedByUser("p1", CHAIN_ID, CONTRACT)
		await seeder.onChainPurged("p1", CHAIN_ID)

		await seeder.run()
		expect(deps.persist).toHaveBeenCalledTimes(1) // only the first run
		expect((await readMarker())[KEY].outcome).toBe("deleted")
	})

	test("chain purge clears non-tombstone bookkeeping so a fresh chain re-seeds", async () => {
		const { seeder, deps } = makeSeeder()
		await seeder.run()
		expect((await readMarker())[KEY].outcome).toBe("seeded")

		await seeder.onChainPurged("p1", CHAIN_ID)
		expect((await readMarker())[KEY]).toBeUndefined()

		await seeder.run()
		expect(deps.persist).toHaveBeenCalledTimes(2)
	})

	test("purgeForProfile drops the whole marker blob", async () => {
		const { seeder } = makeSeeder()
		await seeder.run()
		await seeder.purgeForProfile("p1")
		expect(await readMarker()).toEqual({})
	})
})

describe("TokenSeeder — marker write safety (codex post-impl M7)", () => {
	test("a deletion landing MID-seed-pass is never clobbered — and the token is NOT re-persisted", async () => {
		let seederRef: TokenSeeder = null as never
		const preview = vi.fn(async (): Promise<SeedPreview> => {
			// The user deletes the default WHILE the seed pass is simulating.
			await seederRef.markDeletedByUser("p1", CHAIN_ID, CONTRACT)
			return goodPreview()
		})
		const { seeder, deps } = makeSeeder({ preview })
		seederRef = seeder
		await seeder.run()

		// The tombstone written mid-pass survives the pass's own outcome write,
		// AND the pre-persist re-check stops the token row from resurrecting.
		expect((await readMarker())[KEY].outcome).toBe("deleted")
		expect(deps.persist).not.toHaveBeenCalled()
	})

	test("INTERLEAVED read-modify-writes serialize: both mutations reading the pre-delete blob cannot drop the tombstone", async () => {
		const { seeder, api } = makeSeeder()
		await seeder.run()
		expect((await readMarker())[KEY].outcome).toBe("seeded")

		// Slow every storage read so that WITHOUT the marker lock both
		// concurrent mutations read the same pre-delete blob — the purge
		// would then see "seeded", drop the key, and write LAST.
		const raw = api.storage.local as unknown as { get: (...a: unknown[]) => Promise<unknown> }
		const origGet = raw.get.bind(raw)
		raw.get = async (...a: unknown[]) => {
			await new Promise((r) => setTimeout(r, 5))
			return origGet(...a)
		}

		await Promise.all([seeder.markDeletedByUser("p1", CHAIN_ID, CONTRACT), seeder.onChainPurged("p1", CHAIN_ID)])
		expect((await readMarker())[KEY].outcome).toBe("deleted")
	})
})

describe("TokenSeeder — lifecycle + marker-shape hardening (codex post-ship audit)", () => {
	test("profile deleted MID-pass: nothing persists and the purged marker blob is NOT recreated", async () => {
		let seederRef: TokenSeeder = null as never
		let activeProfile: { id: string } | undefined = { id: "p1" }
		const preview = vi.fn(async (): Promise<SeedPreview> => {
			// The profile is deleted (coordinator purge) while the preview runs.
			activeProfile = undefined
			await seederRef.purgeForProfile("p1")
			return goodPreview()
		})
		const { seeder, deps } = makeSeeder({ preview, getActiveProfile: vi.fn(async () => activeProfile) })
		seederRef = seeder
		await seeder.run()

		expect(deps.persist).not.toHaveBeenCalled()
		expect(await readMarker()).toEqual({})
	})

	test("profile SWITCH mid-pass aborts writes for the stale profile, then the coalesced trigger re-runs for the new one", async () => {
		let seederRef: TokenSeeder = null as never
		let activeProfile = { id: "p1" }
		let passCount = 0
		const preview = vi.fn(async (): Promise<SeedPreview> => {
			passCount += 1
			if (passCount === 1) {
				// Mid-pass switch + coalesced trigger for the new profile.
				activeProfile = { id: "p2" }
				void seederRef.run()
			}
			return goodPreview()
		})
		const { seeder, deps } = makeSeeder({ preview, getActiveProfile: vi.fn(async () => activeProfile) })
		seederRef = seeder
		await seeder.run()
		// Drain the queued follow-up pass.
		await vi.waitFor(async () => {
			expect(deps.persist).toHaveBeenCalledTimes(1)
		})

		// The stale p1 pass persisted nothing; the follow-up seeded p2.
		expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({ profileId: "p2" }))
	})

	test("chain purge mid-pass bumps the epoch and aborts the stale pass's writes", async () => {
		let seederRef: TokenSeeder = null as never
		const preview = vi.fn(async (): Promise<SeedPreview> => {
			await seederRef.onChainPurged("p1", CHAIN_ID)
			return goodPreview()
		})
		const { seeder, deps } = makeSeeder({ preview })
		seederRef = seeder
		await seeder.run()
		expect(deps.persist).not.toHaveBeenCalled()
	})

	test("corrupt marker blob ([]): tombstone write still lands durably (no silent JSON.stringify drop)", async () => {
		const { seeder } = makeSeeder()
		await fakeBrowser.storage.local.set({ [MARKER_KEY]: JSON.stringify([]) })
		await seeder.markDeletedByUser("p1", CHAIN_ID, CONTRACT)
		expect((await readMarker())[KEY].outcome).toBe("deleted")
	})

	test("corrupt marker primitives/entries never throw — they reset instead of blocking deletion", async () => {
		const { seeder } = makeSeeder()
		for (const bad of ["5", JSON.stringify({ [KEY]: "not-an-object" }), JSON.stringify({ [KEY]: { attempts: "NaN" } })]) {
			await fakeBrowser.storage.local.set({ [MARKER_KEY]: bad })
			await expect(seeder.markDeletedByUser("p1", CHAIN_ID, CONTRACT)).resolves.toBeUndefined()
			expect((await readMarker())[KEY].outcome).toBe("deleted")
		}
	})
})

describe("TokenSeeder — commit fencing (codex re-verdict round)", () => {
	test("purge landing DURING the guard's own awaited profile read still aborts (post-await epoch re-check)", async () => {
		let seederRef: TokenSeeder = null as never
		let profileCalls = 0
		const getActiveProfile = vi.fn(async () => {
			profileCalls += 1
			// The codex-reproduced interleaving: the purge fires while the
			// lifecycle guard is awaiting this very read — a guard that only
			// sampled the epoch BEFORE the await would return true.
			if (profileCalls === 3) void seederRef.purgeForProfile("p1")
			return { id: "p1" }
		})
		const { seeder, deps } = makeSeeder({ getActiveProfile })
		seederRef = seeder
		await seeder.run()

		expect(deps.persist).not.toHaveBeenCalled()
		expect(await readMarker()).toEqual({})
	})

	test("a deletion queued DURING the atomic commit lands AFTER it — the tombstone wins, never a stale seeded overwrite", async () => {
		let seederRef: TokenSeeder = null as never
		const persist = vi.fn(async () => {
			// User deletion racing the commit: it queues on the marker lock
			// behind this very critical section.
			void seederRef.markDeletedByUser("p1", CHAIN_ID, CONTRACT)
		})
		const { seeder, deps } = makeSeeder({ persist })
		seederRef = seeder
		await seeder.run()
		await vi.waitFor(async () => {
			expect((await readMarker())[KEY].outcome).toBe("deleted")
		})
		expect(deps.persist).toHaveBeenCalledTimes(1)
	})
})
