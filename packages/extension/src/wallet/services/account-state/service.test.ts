/**
 * Tests for AccountStateService.getSendersAcrossActiveNetworks().
 *
 * Validates the OR-across-active-networks behavior used by the
 * contacts export to mark which contacts are senders. The test stubs
 * the per-network getSenders + the NetworkService dependency so the
 * PXE roundtrip stays out of scope; we only assert the OR + active-
 * status gating logic.
 */

import { beforeEach, describe, expect, test, vi } from "vitest"
import type { IService, ServiceCollection as ServiceCollectionType } from "@/wallet/base"
import { ServiceCollection } from "@/wallet/base"
import { LoggerStore } from "@/wallet/logger"
import { ConfigStore } from "@/wallet/config"
import { NETWORK_SERVICE_NAME, type Network, NodeStatus } from "@/wallet/services/network/spec"
import { AccountStateService } from "./service"

/** Minimal NetworkService fake — satisfies the methods
 *  AccountStateService.getSendersAcrossActiveNetworks needs. */
class FakeNetworkService implements IService {
	public static readonly name = NETWORK_SERVICE_NAME
	public readonly name = NETWORK_SERVICE_NAME

	public networks: Network[] = []
	public statuses: Map<string, NodeStatus> = new Map()

	public async start(): Promise<void> {}

	public async getNetworks(): Promise<Network[]> {
		return [...this.networks]
	}

	public async getNodeStatus(networkId: string): Promise<NodeStatus> {
		return this.statuses.get(networkId) ?? NodeStatus.Inactive
	}
}

function makeNetwork(id: string, chainId: number): Network {
	return {
		id,
		chainId,
		name: `Net ${id}`,
		endpoints: [],
		primaryEndpointId: "primary",
	} as unknown as Network
}

describe("AccountStateService.getSendersAcrossActiveNetworks", () => {
	let networkService: FakeNetworkService
	let accountStateService: AccountStateService
	let services: ServiceCollectionType
	let logger: LoggerStore

	beforeEach(async () => {
		networkService = new FakeNetworkService()
		logger = new LoggerStore(new ConfigStore())

		services = new ServiceCollection()
		services.add(networkService)
		accountStateService = new AccountStateService(logger)
		services.add(accountStateService)
		await services.start()
	})

	test("returns empty list when no networks are configured", async () => {
		networkService.networks = []
		const result = await accountStateService.getSendersAcrossActiveNetworks()
		expect(result).toEqual([])
	})

	test("returns empty list when no networks are Active", async () => {
		networkService.networks = [makeNetwork("net-a", 1), makeNetwork("net-b", 2)]
		networkService.statuses.set("net-a", NodeStatus.Inactive)
		networkService.statuses.set("net-b", NodeStatus.Inactive)
		// Stub getSenders so even if called we'd see it (we shouldn't).
		const getSendersSpy = vi.spyOn(accountStateService, "getSenders").mockResolvedValue([])

		const result = await accountStateService.getSendersAcrossActiveNetworks()
		expect(result).toEqual([])
		expect(getSendersSpy).not.toHaveBeenCalled()
	})

	test("returns union of senders from Active networks", async () => {
		networkService.networks = [makeNetwork("net-a", 1), makeNetwork("net-b", 2)]
		networkService.statuses.set("net-a", NodeStatus.Active)
		networkService.statuses.set("net-b", NodeStatus.Active)
		vi.spyOn(accountStateService, "getSenders").mockImplementation(async (id: string) => {
			if (id === "net-a") return ["0xalice", "0xbob"]
			if (id === "net-b") return ["0xbob", "0xcarol"]
			return []
		})

		const result = await accountStateService.getSendersAcrossActiveNetworks()
		expect(new Set(result)).toEqual(new Set(["0xalice", "0xbob", "0xcarol"]))
	})

	test("skips Inactive networks but includes Active ones", async () => {
		networkService.networks = [makeNetwork("net-a", 1), makeNetwork("net-b", 2), makeNetwork("net-c", 3)]
		networkService.statuses.set("net-a", NodeStatus.Active)
		networkService.statuses.set("net-b", NodeStatus.Inactive)
		networkService.statuses.set("net-c", NodeStatus.Active)
		const getSendersSpy = vi.spyOn(accountStateService, "getSenders").mockImplementation(async (id: string) => {
			if (id === "net-a") return ["0xalice"]
			if (id === "net-b") return ["0xbob"]
			if (id === "net-c") return ["0xcarol"]
			return []
		})

		const result = await accountStateService.getSendersAcrossActiveNetworks()
		expect(new Set(result)).toEqual(new Set(["0xalice", "0xcarol"]))
		expect(getSendersSpy).not.toHaveBeenCalledWith("net-b")
	})

	test("getSenders failure on one network does not abort the export", async () => {
		networkService.networks = [makeNetwork("net-a", 1), makeNetwork("net-b", 2)]
		networkService.statuses.set("net-a", NodeStatus.Active)
		networkService.statuses.set("net-b", NodeStatus.Active)
		vi.spyOn(accountStateService, "getSenders").mockImplementation(async (id: string) => {
			if (id === "net-a") return ["0xalice"]
			if (id === "net-b") throw new Error("PXE flake")
			return []
		})

		const result = await accountStateService.getSendersAcrossActiveNetworks()
		// net-b is silently skipped; the user gets a partial truth.
		expect(new Set(result)).toEqual(new Set(["0xalice"]))
	})

	test("dedupes networks that share the same chainId", async () => {
		// Two `NetworkRow`s pointing at the same chainId (different
		// endpoints — the network model allows multiple endpoints per
		// chain). Only one of them should be queried.
		networkService.networks = [makeNetwork("net-a-1", 1), makeNetwork("net-a-2", 1), makeNetwork("net-b", 2)]
		networkService.statuses.set("net-a-1", NodeStatus.Active)
		networkService.statuses.set("net-a-2", NodeStatus.Active)
		networkService.statuses.set("net-b", NodeStatus.Active)
		const getSendersSpy = vi.spyOn(accountStateService, "getSenders").mockImplementation(async () => ["0xalice"])

		await accountStateService.getSendersAcrossActiveNetworks()
		// chainId 1 is queried once, chainId 2 once = 2 calls total.
		expect(getSendersSpy).toHaveBeenCalledTimes(2)
	})
})
