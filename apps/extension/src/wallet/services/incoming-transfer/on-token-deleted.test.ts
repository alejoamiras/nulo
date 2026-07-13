/**
 * Finding C pin: `IncomingTransferService.onTokenDeleted` must scope to the
 * DELETED token's profile (`token.profileId`), NOT the active profile. Deleting
 * an INACTIVE profile's token used to wipe the ACTIVE profile's incoming-transfer
 * records + trust for a shared (chain, contract).
 *
 * Property-injected (bypasses the 8-dependency `init`) — the handler only needs
 * `networkService`, `accountService`, `repo`, and the constructor-set service lock.
 */

import { describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { LoggerStore } from "@/wallet/logger"
import { ConfigStore } from "@/wallet/config"
import { IncomingTransferService } from "./service"

describe("IncomingTransferService.onTokenDeleted — scopes to the deleted token's profile (C)", () => {
	test("uses token.profileId, NOT the active profile, for network/record/trust scoping", async () => {
		const svc = new IncomingTransferService(new LoggerStore(new ConfigStore()), new FakeBrowserApi())

		const getNetworksRaw = vi.fn(async (pid: string, cid: number) => [{ id: `net-${pid}`, chainId: cid }])
		const listByContract = vi.fn(async () => [])
		const getTrust = vi.fn(async () => undefined)
		const getAccounts = vi.fn(async () => [])

		Object.assign(svc as unknown as Record<string, unknown>, {
			// Active profile is P1 — the pre-fix code resolved via this and wiped P1.
			profileService: { getActiveProfile: async () => ({ id: "P1" }) },
			networkService: { getNetworksRaw },
			accountService: { getAccounts },
			repo: { listByContract, getTrust },
		})

		// Delete INACTIVE profile P2's token (P1 is active).
		await (svc as unknown as { onTokenDeleted: (t: unknown) => Promise<void> }).onTokenDeleted({
			id: 1,
			profileId: "P2",
			chainId: 1,
			contract: "0xX",
		})

		// Every scoping call targets the DELETED profile P2, never the active P1.
		expect(getNetworksRaw).toHaveBeenCalledWith("P2", 1)
		expect(getAccounts).toHaveBeenCalledWith("P2", 1)
		expect(listByContract).toHaveBeenCalledWith("P2", "net-P2", "0xX")
		expect(getTrust).toHaveBeenCalledWith("P2", "net-P2", "0xX")
	})
})
