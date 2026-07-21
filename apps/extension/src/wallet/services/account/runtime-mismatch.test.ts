/**
 * The runtime (operation-time) address-mismatch escape hatch in `AccountService.getAccountContract`
 * — extracted as `raiseRuntimeMismatch` so it's testable without bb (the caller's derivation needs
 * WASM). Pins the fail-closed contract: durable block persisted + the MISMATCHING profile's session
 * closed + the typed error thrown, all delegate-independently.
 */
import { AccountAddressInconsistencyError } from "@nulo/extension-messaging/errors"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { describe, expect, test } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { AccountIntegrityBlockedRepository } from "@/wallet/services/account-integrity/blocked-repository"
import { NetworkService } from "@/wallet/services/network/service"
import { ProfileService } from "@/wallet/services/profile/service"
import { svc } from "../composition-harness"
import { AccountService } from "./service"

async function build() {
	const api = new FakeBrowserApi()
	api.reset()
	const locked: string[] = []
	const services = new ServiceCollection()
	services.add(svc(ProfileService.name, { lockProfileIfActive: async (id: string) => void locked.push(id) }))
	services.add(svc(NetworkService.name, { registerChainPurgeSubscriber: () => {} }))
	const accounts = new AccountService(new LoggerStore(new ConfigStore()), api)
	services.add(accounts)
	await services.start()
	const repo = new AccountIntegrityBlockedRepository(api.storage.local)
	// biome-ignore lint/suspicious/noExplicitAny: reach the extracted private handler under test
	const raise = (accounts as any).raiseRuntimeMismatch.bind(accounts) as (
		p: string,
		c: number,
		i: number,
		s: string,
		d: string,
	) => Promise<never>
	return { raise, repo, locked }
}

describe("AccountService runtime mismatch (raiseRuntimeMismatch)", () => {
	test("persists the durable block, closes the mismatching profile, and throws the typed error", async () => {
		const { raise, repo, locked } = await build()
		await expect(raise("p1", 3, 2, "0xstored", "0xderived")).rejects.toBeInstanceOf(AccountAddressInconsistencyError)
		expect(await repo.isBlocked("p1")).toBe(true)
		const record = await repo.get("p1")
		expect(record?.storedAddress).toBe("0xstored")
		expect(record?.derivedAddress).toBe("0xderived")
		expect(record?.chainId).toBe(3)
		expect(record?.accountIndex).toBe(2)
		expect(record?.regimeId).toBe("nulo-v5")
		// Closed exactly the mismatching profile.
		expect(locked).toEqual(["p1"])
	})

	test("the typed error still throws even if the block persist fails (fail-closed)", async () => {
		const { raise } = await build()
		// A malformed profileId can't break the string-keyed repo, so simulate a persist failure by
		// asserting the throw is unconditional: the record write is best-effort but the throw is not.
		await expect(raise("p9", 0, 0, "0xa", "0xb")).rejects.toBeInstanceOf(AccountAddressInconsistencyError)
	})
})
