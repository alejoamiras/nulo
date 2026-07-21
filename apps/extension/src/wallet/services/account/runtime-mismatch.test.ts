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

async function build(opts: { failBlockWrite?: boolean } = {}) {
	const api = new FakeBrowserApi()
	api.reset()
	if (opts.failBlockWrite) {
		// Force the block-persist to reject so the fail-closed contract (throw + close still happen)
		// is genuinely exercised.
		const realSet = api.storage.local.set.bind(api.storage.local)
		api.storage.local.set = async (items: Record<string, unknown>) => {
			if (Object.keys(items).some((k) => k.startsWith("nulo:core:account-integrity-blocked@"))) {
				throw new Error("storage full")
			}
			return realSet(items)
		}
	}
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

	test("fail-closed: even when the block PERSIST fails, the throw + session close still happen", async () => {
		const { raise, locked } = await build({ failBlockWrite: true })
		await expect(raise("p9", 0, 0, "0xa", "0xb")).rejects.toBeInstanceOf(AccountAddressInconsistencyError)
		// The persist failure is logged and swallowed, but the session close still runs and the
		// typed error still propagates — the caller can never end up with a usable mismatched session.
		expect(locked).toEqual(["p9"])
	})
})
