/**
 * Pre-extraction pins for restore() branches the PR-b decomposition moves and
 * the existing suite does not fix exactly: the protocol-contract silent skip,
 * the empty-item fast path (which must STAY synchronous under the length-
 * guarded loop extraction), and the deadline restoreError's exact string.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { IService } from "@/wallet/base"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { NETWORK_SERVICE_NAME, type Network, NodeStatus } from "@/wallet/services/network/spec"
import { AccountStateService } from "./service"

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

interface FakePxe {
	registerSender: ReturnType<typeof vi.fn>
	registerContract: ReturnType<typeof vi.fn>
}

const NET = {
	id: "net-a",
	profileId: "p1",
	chainId: 1,
	l1ChainId: 1,
	name: "Net net-a",
	endpoints: [{ id: "primary", rpcUrl: "http://localhost:9" }],
	primaryEndpointId: "primary",
} as Network

describe("restore() pins for the PR-b loop extraction", () => {
	let accountStateService: AccountStateService
	let pxe: FakePxe

	beforeEach(async () => {
		const services = new ServiceCollection()
		services.add(new FakeNetworkService())
		accountStateService = new AccountStateService(new LoggerStore(new ConfigStore()))
		services.add(accountStateService)
		await services.start()
		pxe = {
			registerSender: vi.fn(async (_info: unknown, addr: { toString(): string }) => addr),
			registerContract: vi.fn(async () => undefined),
		}
		;(accountStateService as unknown as { pxeService: FakePxe }).pxeService = pxe
	})

	test("protocol contracts (address ≤ 6) are silently skipped: no launch, no result entry", async () => {
		const protocolAddr = `0x${"00".repeat(31)}05`
		const realAddr = `0x${"07".repeat(32)}`
		const result = await accountStateService.restore(
			[
				{
					networkId: "net-a",
					senders: [],
					contracts: [
						{ address: protocolAddr, instance: { i: 1 }, artifact: { a: 1 } },
						{ address: realAddr, instance: { i: 2 }, artifact: { a: 2 } },
					],
				},
			] as never,
			[NET],
		)
		expect(pxe.registerContract).toHaveBeenCalledTimes(1)
		expect(result[0].contracts).toHaveLength(1)
		expect((result[0].contracts[0] as { address: string }).address).toBe(realAddr)
		expect(result[0].restoreError).toBeUndefined()
	})

	test("an empty item yields a clean entry with no launches and no restoreError", async () => {
		const result = await accountStateService.restore([{ networkId: "net-a", senders: [], contracts: [] }] as never, [NET])
		expect(result).toEqual([{ networkId: "net-a", senders: [], contracts: [] }])
		expect(pxe.registerSender).not.toHaveBeenCalled()
		expect(pxe.registerContract).not.toHaveBeenCalled()
	})

	test("deadline skips stamp the EXACT counted restoreError string", async () => {
		const sender = (i: number) => ({ address: `0x${String(i).padStart(2, "0").repeat(32)}` })
		// A 0-clamped deadline expires before the first launch: both senders skip.
		const result = await accountStateService.restore(
			[{ networkId: "net-a", senders: [sender(1), sender(2)], contracts: [] }] as never,
			[NET],
			-5,
		)
		expect(pxe.registerSender).not.toHaveBeenCalled()
		expect(result[0].restoreError).toBe("Skipped — ran out of time reaching the network (2 registration(s) not attempted)")
	})
})
