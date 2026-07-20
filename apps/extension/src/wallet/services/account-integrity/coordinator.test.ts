/**
 * Unit pins for `AccountIntegrityCoordinator` — the ORCHESTRATION contract (withhold on
 * mismatch, persist a durable blocking record, heal on green, close the session on a runtime
 * report). The derivation itself is injected (jsdom cannot run bb.js poseidon); the REAL frozen
 * derivation is covered by the aztec-runtime KAT/freeze suites and the network canary.
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import { AccountAddressInconsistencyError } from "@nulo/extension-messaging/errors"
import { EventHandler } from "@nulo/wallet-core/utils"
import { asMasterSecretBytes } from "@nulo/wallet-crypto"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { describe, expect, test } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { AccountService, AccountType, type Account } from "@/wallet/services/account/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { svc } from "../composition-harness"
import { AccountIntegrityBlockedRepository, AccountIntegrityVerifiedStampRepository } from "./blocked-repository"
import { AccountIntegrityCoordinator, type DeriveAddress } from "./coordinator"

const MASTER = asMasterSecretBytes(new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>)

function row(overrides: Partial<Account> = {}): Account {
	return {
		profileId: "p1",
		chainId: 0,
		address: "0xaaaa",
		index: 0,
		type: AccountType.Nulo_v1,
		name: "A",
		visible: true,
		...overrides,
	}
}

async function build(opts: {
	rows: Account[]
	derive: DeriveAddress
	/** Simulates a silently-rehydrated session present at coordinator start. */
	activeProfileId?: string
	api?: FakeBrowserApi
}) {
	const api = opts.api ?? new FakeBrowserApi()
	if (!opts.api) api.reset()
	const locks: string[] = []
	const services = new ServiceCollection()
	services.add(
		svc(ProfileService.name, {
			setIntegrityDelegate: () => {},
			lockProfileIfActive: async (id: string) => {
				locks.push(id)
			},
			getActiveProfile: async () => (opts.activeProfileId ? { id: opts.activeProfileId, name: "P", type: "password" } : undefined),
			getProfileSecret: async () => Fr.fromBuffer(Buffer.from(MASTER)),
		}),
	)
	const added = new EventHandler<Account>()
	const deleted = new EventHandler<Account>()
	services.add(
		svc(AccountService.name, {
			setIntegrityDelegate: () => {},
			getAccountsRaw: async () => opts.rows,
			onAccountAdded: added,
			onAccountDeleted: deleted,
		}),
	)
	const coordinator = new AccountIntegrityCoordinator(new LoggerStore(new ConfigStore()), api, opts.derive)
	services.add(coordinator)
	await services.start()
	await coordinator.bootVerification
	const repo = new AccountIntegrityBlockedRepository(api.storage.local)
	const stamps = new AccountIntegrityVerifiedStampRepository(api.storage.local)
	return { coordinator, repo, stamps, locks, api, accountEvents: { added, deleted } }
}

describe("AccountIntegrityCoordinator", () => {
	test("green verify passes, and heals a stale blocking record", async () => {
		const { coordinator, repo } = await build({ rows: [row()], derive: async () => "0xaaaa" })
		await repo.set({
			profileId: "p1",
			chainId: 0,
			accountIndex: 0,
			storedAddress: "0xaaaa",
			derivedAddress: "0xstale",
			regimeId: "nulo-v5",
			walletVersion: "0.0.0",
			detectedAt: 1,
		})
		await coordinator.verifyBeforeSessionOpen("p1", MASTER)
		expect(await repo.isBlocked("p1")).toBe(false)
	})

	test("tampered stored address → throws typed error + persists the blocking record", async () => {
		const { coordinator, repo } = await build({
			rows: [row({ address: "0xTAMPERED", chainId: 3, index: 2 })],
			derive: async () => "0xreal",
		})
		await expect(coordinator.verifyBeforeSessionOpen("p1", MASTER)).rejects.toBeInstanceOf(AccountAddressInconsistencyError)
		expect(await repo.isBlocked("p1")).toBe(true)
		const record = await repo.get("p1")
		expect(record?.storedAddress).toBe("0xTAMPERED")
		expect(record?.derivedAddress).toBe("0xreal")
		expect(record?.chainId).toBe(3)
		expect(record?.accountIndex).toBe(2)
		expect(record?.regimeId).toBe("nulo-v5")
	})

	test("checks every stored account across chains; first mismatch wins", async () => {
		const derived = new Map([
			["0:0", "0xaaaa"],
			["7:0", "0xdrifted"],
		])
		const seen: string[] = []
		const { coordinator, repo } = await build({
			rows: [row(), row({ chainId: 7, address: "0xbbbb" })],
			derive: async (_master, account) => {
				seen.push(`${account.chainId}:${account.index}`)
				return derived.get(`${account.chainId}:${account.index}`) ?? "0xnone"
			},
		})
		await expect(coordinator.verifyBeforeSessionOpen("p1", MASTER)).rejects.toBeInstanceOf(AccountAddressInconsistencyError)
		expect(seen).toEqual(["0:0", "7:0"])
		expect((await repo.get("p1"))?.chainId).toBe(7)
	})

	test("non-Nulo_v1 rows are skipped (no derivation exists for them)", async () => {
		const seen: number[] = []
		const { coordinator } = await build({
			rows: [row(), row({ type: 99 as AccountType, address: "0xother", index: 1 })],
			derive: async (_master, account) => {
				seen.push(account.index)
				return "0xaaaa"
			},
		})
		await coordinator.verifyBeforeSessionOpen("p1", MASTER)
		expect(seen).toEqual([0])
	})

	test("boot verify: a rehydrated session with a MISMATCHED account is blocked + locked at start", async () => {
		const { repo, locks } = await build({
			rows: [row({ address: "0xDRIFTED" })],
			derive: async () => "0xreal",
			activeProfileId: "p1",
		})
		expect(await repo.isBlocked("p1")).toBe(true)
		expect(locks).toEqual(["p1"])
	})

	test("boot verify: a green pass stamps the build so the NEXT boot skips re-deriving", async () => {
		let derives = 0
		const derive: DeriveAddress = async () => {
			derives++
			return "0xaaaa"
		}
		const { api } = await build({ rows: [row()], derive, activeProfileId: "p1" })
		expect(derives).toBe(1)
		// Same persisted storage, fresh coordinator = the next SW boot on the SAME build.
		await build({ rows: [row()], derive, activeProfileId: "p1", api })
		expect(derives).toBe(1)
	})

	test("boot verify: no active session is a no-op", async () => {
		let derives = 0
		await build({
			rows: [row()],
			derive: async () => {
				derives++
				return "0xaaaa"
			},
		})
		expect(derives).toBe(0)
	})

	test("closeSessionForMismatch closes ONLY the mismatching profile (never a different active one)", async () => {
		// ProfileService.lockProfileIfActive is stubbed to record the id it was asked to lock; the
		// coordinator must pass the mismatching profile id, not "the active one".
		const askedToLock: string[] = []
		const api = new FakeBrowserApi()
		api.reset()
		const services = new ServiceCollection()
		services.add(
			svc(ProfileService.name, {
				setIntegrityDelegate: () => {},
				lockProfileIfActive: async (id: string) => {
					askedToLock.push(id)
				},
				getActiveProfile: async () => undefined,
			}),
		)
		services.add(
			svc(AccountService.name, {
				setIntegrityDelegate: () => {},
				getAccountsRaw: async () => [],
				onAccountAdded: new EventHandler<Account>(),
				onAccountDeleted: new EventHandler<Account>(),
			}),
		)
		const coordinator = new AccountIntegrityCoordinator(new LoggerStore(new ConfigStore()), api, async () => "0x")
		services.add(coordinator)
		await services.start()
		await coordinator.bootVerification

		await coordinator.closeSessionForMismatch("p9")
		expect(askedToLock).toEqual(["p9"])
	})

	test("stamp is CLEARED when the profile's account set changes (no skip-verify of a new row)", async () => {
		const { stamps, accountEvents } = await build({ rows: [row()], derive: async () => "0xaaaa", activeProfileId: "p1" })
		// A green boot stamped the build.
		expect((await stamps.get("p1"))?.walletVersion).toBeDefined()
		accountEvents.added.invoke(row({ profileId: "p1", address: "0xnew", index: 1 }))
		await new Promise((r) => setTimeout(r, 0))
		expect(await stamps.get("p1")).toBeUndefined()
	})
})
