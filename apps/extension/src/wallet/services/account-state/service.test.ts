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

describe("AccountStateService.restore (nested restoreError normalization)", () => {
	let accountStateService: AccountStateService
	let services: ServiceCollectionType

	beforeEach(async () => {
		services = new ServiceCollection()
		services.add(new FakeNetworkService())
		accountStateService = new AccountStateService(new LoggerStore(new ConfigStore()))
		services.add(accountStateService)
		await services.start()
	})

	test("normalizes nested sender + contract restore errors to message strings", async () => {
		// A backup item whose networkId is absent from `networks` makes both
		// inner loops throw "Network not found"; the per-child catch stores the
		// normalized message STRING (via toRestoreError) — not a raw Error
		// object. (Contract entries need instance+artifact to pass the
		// normalizer's shape boundary.)
		const backup = [
			{
				networkId: "missing",
				senders: [{ address: "0x1" }],
				contracts: [{ address: "0x2", instance: { i: 1 }, artifact: { a: 1 } }],
			},
		] as unknown as Parameters<typeof accountStateService.restore>[0]

		const restored = await accountStateService.restore(backup, [])
		const item = restored.find((r) => r.networkId === "missing")
		expect(item?.senders[0]?.restoreError).toBe("Network not found")
		expect(item?.contracts[0]?.restoreError).toBe("Network not found")
		expect(typeof item?.senders[0]?.restoreError).toBe("string")
	})

	test("a shape-malformed item (senders: null) becomes a bounded violation record, NOT an uncaught throw", async () => {
		// This runs AFTER finalizeRestore where rollback is suppressed — a checksum-valid but
		// malformed slice must not throw uncaught mid-iteration and strand a partial restore
		// (codex audit MED). The normalizer collapses it into top-level violation records
		// (previously a per-item restoreError that the error collector silently DROPPED —
		// the vanishing-malformed-item bug).
		const backup = [
			{ networkId: "n1", senders: null, contracts: [] },
			{ networkId: "n2", senders: [], contracts: undefined },
		] as unknown as Parameters<typeof accountStateService.restore>[0]

		const restored = await accountStateService.restore(backup, [])
		const violations = restored.filter(
			(r) => typeof r.restoreError === "string" && /malformed account-state item/.test(String(r.restoreError)),
		)
		expect(violations.map((v) => v.networkId).sort()).toEqual(["n1", "n2"])
		// The coerced items still come back (empty children, no error).
		expect(
			restored
				.filter((r) => !r.restoreError)
				.map((r) => r.networkId)
				.sort(),
		).toEqual(["n1", "n2"])
	})
})

describe("AccountStateService.restore (bounded)", () => {
	let networkService: FakeNetworkService
	let accountStateService: AccountStateService
	let logger: LoggerStore

	interface FakePxe {
		registerSender: ReturnType<typeof vi.fn>
		registerContract: ReturnType<typeof vi.fn>
	}
	let pxe: FakePxe

	// A network with a resolvable primary endpoint — `networkInfoFrom` needs it
	// before any register call can even be built.
	// Must pass the restore boundary's NetworkSchema filter (an invalid row
	// behaves as an absent network), so every schema-required field is real.
	const NET = {
		id: "net-a",
		profileId: "p1",
		chainId: 1,
		l1ChainId: 1,
		name: "Net net-a",
		endpoints: [{ id: "primary", rpcUrl: "http://localhost:9" }],
		primaryEndpointId: "primary",
	} as Network
	const sender = (i: number) => ({ address: `0x${String(i).padStart(2, "0").repeat(32)}` })
	const item = (senders: Array<{ address: string }>) => ({ networkId: "net-a", senders, contracts: [] })

	beforeEach(async () => {
		networkService = new FakeNetworkService()
		logger = new LoggerStore(new ConfigStore())
		const services = new ServiceCollection()
		services.add(networkService)
		accountStateService = new AccountStateService(logger)
		services.add(accountStateService)
		await services.start()
		pxe = {
			registerSender: vi.fn(async (_info: unknown, addr: { toString(): string }) => addr),
			registerContract: vi.fn(async () => undefined),
		}
		;(accountStateService as unknown as { pxeService: FakePxe }).pxeService = pxe
	})

	test("registers every sender/contract when nothing fails and no deadline is set", async () => {
		const result = await accountStateService.restore([item([sender(1), sender(2)])], [NET])
		expect(pxe.registerSender).toHaveBeenCalledTimes(2)
		expect(result).toHaveLength(1)
		expect(result[0].restoreError).toBeUndefined()
		expect(result[0].senders.every((s) => !s.restoreError)).toBe(true)
	})

	test("PER-LAUNCH deadline: a slow-but-successful first registration crossing the deadline stops the SECOND from ever launching", async () => {
		pxe.registerSender.mockImplementationOnce(async (_info: unknown, addr: { toString(): string }) => {
			await new Promise((r) => setTimeout(r, 30))
			return addr
		})
		const result = await accountStateService.restore([item([sender(1), sender(2), sender(3)])], [NET], 10)
		expect(pxe.registerSender).toHaveBeenCalledTimes(1)
		expect(result[0].senders).toHaveLength(1)
		expect(result[0].restoreError).toContain("ran out of time")
		expect(result[0].restoreError).toContain("2 registration(s) not attempted")
	})

	test("deadline clamp floor: a hostile negative deadline skips everything without launching", async () => {
		const result = await accountStateService.restore([item([sender(1)])], [NET], -5)
		expect(pxe.registerSender).not.toHaveBeenCalled()
		expect(result[0].restoreError).toContain("ran out of time")
	})

	test("connectivity fail-fast: a transport-shaped failure skips the network's REMAINING registrations without launching them", async () => {
		pxe.registerSender.mockRejectedValueOnce(new Error("Request to http://x timed out after 5000ms"))
		const result = await accountStateService.restore(
			[
				{
					networkId: "net-a",
					senders: [sender(1), sender(2)],
					contracts: [{ address: `0x${"07".repeat(32)}`, instance: { i: 1 }, artifact: { a: 1 } }],
				},
			] as never,
			[NET],
		)
		expect(pxe.registerSender).toHaveBeenCalledTimes(1)
		expect(pxe.registerContract).not.toHaveBeenCalled()
		expect(result[0].senders[0].restoreError).toContain("timed out")
		expect(result[0].senders[1].restoreError).toBe("Skipped — couldn't reach the network")
		expect(result[0].contracts[0].restoreError).toBe("Skipped — couldn't reach the network")
	})

	test("a payload-shaped failure does NOT fail-fast the rest", async () => {
		pxe.registerSender.mockRejectedValueOnce(new Error("Invalid artifact: missing function abi"))
		const result = await accountStateService.restore([item([sender(1), sender(2)])], [NET])
		expect(pxe.registerSender).toHaveBeenCalledTimes(2)
		expect(result[0].senders[0].restoreError).toContain("Invalid artifact")
		expect(result[0].senders[1].restoreError).toBeUndefined()
	})

	test("malformed slice content becomes bounded violation records, never a throw", async () => {
		const result = await accountStateService.restore([null, { networkId: "net-a", senders: null, contracts: [] }] as never, [NET])
		expect(result.some((r) => String(r.restoreError).includes("malformed"))).toBe(true)
		expect(pxe.registerSender).not.toHaveBeenCalled()
	})

	test("unknown network: per-child 'Network not found' errors, no dial, no fail-fast misclassification", async () => {
		const result = await accountStateService.restore(
			[{ networkId: "ghost", senders: [sender(1), sender(2)], contracts: [] }] as never,
			[NET],
		)
		expect(pxe.registerSender).not.toHaveBeenCalled()
		expect(result.at(-1)?.senders).toHaveLength(2)
		expect(result.at(-1)?.senders.every((s) => String(s.restoreError).includes("Network not found"))).toBe(true)
	})
})
