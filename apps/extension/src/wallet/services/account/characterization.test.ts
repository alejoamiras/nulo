/**
 * Characterization pin for the address-only account storage key.
 *
 * Account rows are filed under `account.address` alone (`ACCOUNT_STORAGE_ROOT`).
 * The address derives from `poseidon2Hash([profileSecret, chainId, type, index])`,
 * so two profiles built from the SAME mnemonic derive the SAME address at the
 * same index — and collide on one storage key. One key means one row and one
 * owner: the two profiles cannot both hold that account.
 *
 * Pinned here through the service's own write path (`restore`), which is
 * bb-free — real derivation needs bb.js and is out of bounds for this layer, so
 * the collision is expressed by writing the colliding address directly.
 *
 * The composite re-key inverts this: both rows coexist, each profile keeps its
 * own. Flip these expectations then; do not relax them.
 */

import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { beforeEach, describe, expect, test } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { svc } from "../composition-harness"
import { AccountService } from "./service"

const CHAIN = 1
/** The address both same-mnemonic profiles derive at index 0. */
const SHARED_ADDRESS = "0xc0111d1ng"

const mkAccount = (profileId: string, over: Record<string, unknown> = {}) =>
	({
		profileId,
		chainId: CHAIN,
		address: SHARED_ADDRESS,
		index: 0,
		type: 0,
		name: `${profileId} account`,
		visible: true,
		...over,
	}) as never

describe("AccountService — address-only storage key characterization", () => {
	let accountService: AccountService
	let api: FakeBrowserApi

	beforeEach(async () => {
		api = new FakeBrowserApi()
		api.reset()
		const services = new ServiceCollection()
		services.add(svc(PROFILE_SERVICE_NAME, { onProfileDeleted: new EventHandler() }))
		services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {} }))
		accountService = new AccountService(new LoggerStore(new ConfigStore()), api)
		services.add(accountService)
		await services.start()
	})

	test("(BUG PIN) one derived address = one row with one owner — a second profile cannot hold it", async () => {
		const [first] = await accountService.restore([mkAccount("profile-1")])
		expect(first?.restoreError).toBeUndefined()

		// The same mnemonic in a second profile derives the same address, which
		// collides on the single address-keyed row and is refused outright.
		await expect(accountService.restore([mkAccount("profile-2")])).rejects.toThrow(/Duplicate address/)

		// One row, owned by profile-1. profile-2 has no account at all.
		const rows = Object.keys(await api.storage.local.get(null)).filter((k) => k.startsWith("nulo:core:accounts@"))
		expect(rows).toHaveLength(1)
		expect(await accountService.getAccount("profile-1", CHAIN, SHARED_ADDRESS)).toMatchObject({ profileId: "profile-1" })
		expect(await accountService.getAccount("profile-2", CHAIN, SHARED_ADDRESS)).toBeUndefined()
		expect(await accountService.getAccounts("profile-2", CHAIN)).toHaveLength(0)
	})

	test("(BUG PIN) a direct write under the colliding key hands ownership to the last writer", async () => {
		await accountService.restore([mkAccount("profile-1")])

		// Model what account creation does today: `storage.set(address, account)`
		// with no profile in the key, so profile-2's row lands on profile-1's.
		await api.storage.local.set({
			[`nulo:core:accounts@${SHARED_ADDRESS}`]: JSON.stringify(mkAccount("profile-2")),
		})

		expect(await accountService.getAccount("profile-2", CHAIN, SHARED_ADDRESS)).toMatchObject({ profileId: "profile-2" })
		expect(await accountService.getAccount("profile-1", CHAIN, SHARED_ADDRESS)).toBeUndefined()
		expect(await accountService.getAccounts("profile-1", CHAIN)).toHaveLength(0)
	})
})
