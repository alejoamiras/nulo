/**
 * Direct unit pins for `ProfileDeletionCoordinator.purge` — the awaited 12-step
 * cascade (finding D). The e2e proves end-state; this proves the CONTRACT the
 * ordering comment relies on: every leaf purge is awaited, the address-derived
 * purges (tx/auth/balance) run BEFORE the account/token/network tail (so the
 * tail's re-emitted delete events find rows already gone), `pxe.clearProfileState`
 * runs LAST, a leaf throw PROPAGATES (caller keeps the tombstone), and `runFor`
 * is single-flight. Drives the real coordinator over `svc()` leaf stubs.
 */
import { describe, expect, test } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { AccountService } from "@/wallet/services/account/service"
import { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { ContactService } from "@/wallet/services/contact/service"
import { DappSessionService } from "@/wallet/services/dapp-session/service"
import { FpcService } from "@/wallet/services/fpc/service"
import { IncomingTransferService } from "@/wallet/services/incoming-transfer/service"
import { NetworkService } from "@/wallet/services/network/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { TokenBalanceService } from "@/wallet/services/token-balance/service"
import { TokenService } from "@/wallet/services/token/service"
import { TransactionService } from "@/wallet/services/transaction/service"
import { svc } from "../composition-harness"
import { ProfileDeletionCoordinator } from "./coordinator"

const SNAP = { addresses: ["0xa"], tokenIds: [1], networkIds: ["n1"], pxeGeneration: "gen-1" }

const build = async (order: string[]) => {
	const rec = (name: string) => async () => {
		order.push(name)
	}
	const services = new ServiceCollection()
	services.add(svc(ProfileService.name, { setDeletionDelegate: () => {}, resumePendingDeletions: rec("profiles") }))
	services.add(svc(TransactionService.name, { purgeForAccounts: rec("txs") }))
	services.add(svc(AuthRegistryService.name, { purgeForAccounts: rec("auth") }))
	services.add(svc(TokenBalanceService.name, { purgeForTokens: rec("balances") }))
	services.add(svc(IncomingTransferService.name, { clearProfile: rec("incoming") }))
	services.add(svc(ContactService.name, { purgeForProfile: rec("contacts") }))
	services.add(svc(DappSessionService.name, { purgeForProfile: rec("sessions") }))
	services.add(svc(FpcService.name, { purgeForProfile: rec("fpcs") }))
	services.add(svc(OperationJournalService.name, { purgeForProfile: rec("journal") }))
	services.add(svc(AccountService.name, { purgeForProfile: rec("accounts") }))
	services.add(svc(TokenService.name, { purgeForProfile: rec("tokens") }))
	services.add(svc(NetworkService.name, { purgeForProfile: rec("networks") }))
	const coord = new ProfileDeletionCoordinator(new LoggerStore(new ConfigStore()))
	services.add(coord)
	await services.start()
	// The coordinator constructs its own PXE client; replace it with a recorder.
	;(coord as unknown as { pxe: { clearProfileState: (id: string) => Promise<void> } }).pxe = {
		clearProfileState: async () => {
			order.push("pxe")
		},
	}
	return coord
}

describe("ProfileDeletionCoordinator.purge — awaited order contract", () => {
	test("awaits all 12 purges in order; address-derived BEFORE the account/token/network tail; pxe LAST", async () => {
		const order: string[] = []
		const coord = await build(order)

		await coord.runFor("p1", SNAP)

		expect(order).toEqual([
			"txs",
			"auth",
			"balances",
			"incoming",
			"contacts",
			"sessions",
			"fpcs",
			"journal",
			"accounts",
			"tokens",
			"networks",
			"pxe",
		])
		// Load-bearing orderings the coordinator's comment promises:
		expect(order.indexOf("txs")).toBeLessThan(order.indexOf("accounts"))
		expect(order.indexOf("balances")).toBeLessThan(order.indexOf("tokens"))
		expect(order.at(-1)).toBe("pxe")
	})

	test("a leaf throw PROPAGATES — the caller keeps the tombstone", async () => {
		const order: string[] = []
		const coord = await build(order)
		;(coord as unknown as { fpcs: { purgeForProfile: (id: string) => Promise<void> } }).fpcs = {
			purgeForProfile: async () => {
				throw new Error("boom")
			},
		}

		await expect(coord.runFor("p1", SNAP)).rejects.toThrow("boom")
		// fail-fast: the later steps did NOT run.
		expect(order).not.toContain("pxe")
		expect(order).not.toContain("networks")
	})

	test("single-flight: a concurrent runFor for the same profile returns the SAME promise", async () => {
		const order: string[] = []
		const coord = await build(order)

		const a = coord.runFor("p1", SNAP)
		const b = coord.runFor("p1", SNAP)
		expect(a).toBe(b)
		await a
	})
})
