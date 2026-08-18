/**
 * Unit pins for `TokenService.addToken`'s journal/lock machinery (F-Q09
 * characterization — this path had no unit coverage; the composition layer
 * excludes it because the real `fetchTokenMetadata` calls `simulate(...)`).
 * The private fetch is stubbed via the repo's established test-only reach-in,
 * which is legitimate HERE (a unit file) but would violate the composition
 * layer's boundary rules — see COMPOSITION-TESTS.md.
 */

import { EventHandler } from "@nulo/wallet-core/utils"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { describe, expect, test, vi } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { AccountService } from "@/wallet/services/account/service"
import { svc } from "@/wallet/services/composition-harness"
import { NetworkService } from "@/wallet/services/network/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { TaskService } from "@/wallet/services/task/service"
import { TokenService } from "./service"
import type { TokenInterface } from "./spec"

const NETWORK = { id: "net1", chainId: 1, primaryEndpointId: "ep1", endpoints: [{ id: "ep1", rpcUrl: "http://fake" }] }

const ti = (contract: string): TokenInterface =>
	({
		chainId: 1,
		contract,
		getNameFn: { name: "get_name", impl: 1 },
		getSymbolFn: { name: "get_symbol", impl: 1 },
		getDecimalsFn: { name: "get_decimals", impl: 1 },
		isComplete: true,
	}) as unknown as TokenInterface

async function makeHarness() {
	const api = new FakeBrowserApi()
	api.reset()
	const logger = new LoggerStore(new ConfigStore())
	const journal = {
		createOperation: vi.fn(async () => ({ id: "op-1" })),
		transitionOperation: vi.fn(async () => {}),
		setOperationMeta: vi.fn(async () => {}),
	}
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
	collection.add(svc(TaskService.name, {}))
	collection.add(svc(OperationJournalService.name, journal))
	const tokenService = new TokenService(logger, api)
	collection.add(tokenService)
	await collection.start()

	const fetchStub = vi.fn(async (): Promise<[string, string, number]> => ["Fetched Name", "FTCH", 9])
	// biome-ignore lint/suspicious/noExplicitAny: test-only reach-in to stub the private simulate-backed fetch
	;(tokenService as any).fetchTokenMetadata = fetchStub
	return { tokenService, journal, fetchStub }
}

describe("TokenService.addToken — journal/lock machinery (characterization)", () => {
	test("journals the import (dapp origin + subtitle), backfills the title with the fetched symbol, succeeds", async () => {
		const { tokenService, journal } = await makeHarness()
		const emitted: unknown[] = []
		tokenService.onTokenAdded.add((t) => {
			emitted.push(t)
			return Promise.resolve()
		})

		const info = await tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xc0ffee"), {
			origin: "dapp",
			dappOrigin: "https://app.example",
		})

		expect(info.symbol).toBe("FTCH")
		expect(journal.createOperation).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "token_import",
				origin: "dapp",
				title: undefined,
				subtitle: "Requested by https://app.example",
			}),
		)
		expect(journal.setOperationMeta).toHaveBeenCalledWith("op-1", { title: "FTCH" })
		expect(journal.transitionOperation).toHaveBeenLastCalledWith("op-1", { stage: "succeeded" })
		expect(emitted).toHaveLength(1)
	})

	test("idempotency short-circuit: a repeat add returns the existing row and creates NO journal op", async () => {
		const { tokenService, journal, fetchStub } = await makeHarness()
		await tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xc0ffee"), { origin: "popup" })
		journal.createOperation.mockClear()
		fetchStub.mockClear()

		const again = await tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xc0ffee"), { origin: "popup" })

		expect(again.symbol).toBe("FTCH")
		expect(journal.createOperation).not.toHaveBeenCalled()
		expect(fetchStub).not.toHaveBeenCalled()
	})

	test("a failed fetch journals 'failed' and rethrows", async () => {
		const { tokenService, journal, fetchStub } = await makeHarness()
		fetchStub.mockRejectedValueOnce(new Error("metadata boom"))

		await expect(tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xbad"), { origin: "popup" })).rejects.toThrow("metadata boom")

		expect(journal.transitionOperation).toHaveBeenLastCalledWith("op-1", { stage: "failed" }, expect.anything())
	})

	test("the metadata fetch runs INSIDE the token lock — a queued token op waits for a blocked fetch", async () => {
		const { tokenService, fetchStub } = await makeHarness()
		let releaseFetch!: (v: [string, string, number]) => void
		fetchStub.mockReturnValueOnce(new Promise((r) => (releaseFetch = r)))

		const adding = tokenService.addToken("p1", NETWORK.id, "0xacc", ti("0xslow"), { origin: "popup" })
		// Give addToken time to enter the lock and block on the fetch.
		await new Promise((r) => setTimeout(r, 20))

		let restored = false
		const restoring = tokenService.restore([]).then((r) => {
			restored = true
			return r
		})
		await new Promise((r) => setTimeout(r, 20))
		expect(restored).toBe(false) // queued behind the lock the fetch holds

		releaseFetch(["Slow", "SLW", 6])
		await adding
		await restoring
		expect(restored).toBe(true)
	})

	test("seeded persistence never backfills a title (no setOperationMeta)", async () => {
		const { tokenService, journal } = await makeHarness()

		await tokenService.addSeededToken({
			profileId: "p1",
			networkId: NETWORK.id,
			accountAddress: "0xacc",
			tokenInterface: ti("0x5eed"),
			name: "Seeded",
			symbol: "SEED",
			decimals: 18,
		})

		expect(journal.createOperation).toHaveBeenCalledWith(
			expect.objectContaining({ origin: "seed", title: "SEED", subtitle: "Default token" }),
		)
		expect(journal.setOperationMeta).not.toHaveBeenCalled()
	})
})
