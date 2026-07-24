/**
 * Account rows are keyed by `(profileId, chainId, address)`.
 *
 * The address derives from `poseidon2Hash([profileSecret, chainId, type, index])`,
 * so two profiles built from the SAME mnemonic derive the SAME address at the
 * same index. Under the previous address-only key those two profiles collided on
 * one row: the second write took ownership and the first profile's account
 * silently vanished. Including the profile in the row id lets both coexist.
 *
 * These tests were originally written to pin that collision as it behaved
 * before the re-key; they now assert the inverse, which is what proves the
 * re-key landed. Exercised through the service's own write path (`restore`),
 * which is bb-free — real derivation needs bb.js and is out of bounds here.
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
import { accountRowId } from "./spec"

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

describe("AccountService — composite storage key", () => {
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

	test("two same-mnemonic profiles each keep their own row for the shared address", async () => {
		const [first] = await accountService.restore([mkAccount("profile-1")])
		const [second] = await accountService.restore([mkAccount("profile-2")])

		expect(first?.restoreError).toBeUndefined()
		expect(second?.restoreError).toBeUndefined()

		const rows = Object.keys(await api.storage.local.get(null)).filter((k) => k.startsWith("nulo:core:accounts@"))
		expect(rows).toHaveLength(2)

		expect(await accountService.getAccount("profile-1", CHAIN, SHARED_ADDRESS)).toMatchObject({
			profileId: "profile-1",
			name: "profile-1 account",
		})
		expect(await accountService.getAccount("profile-2", CHAIN, SHARED_ADDRESS)).toMatchObject({
			profileId: "profile-2",
			name: "profile-2 account",
		})
		expect(await accountService.getAccounts("profile-1", CHAIN)).toHaveLength(1)
		expect(await accountService.getAccounts("profile-2", CHAIN)).toHaveLength(1)
	})

	test("a write under one profile's row id cannot reach another profile's account", async () => {
		await accountService.restore([mkAccount("profile-1")])

		// Write the second profile's row directly, exactly as account creation does.
		await api.storage.local.set({
			[`nulo:core:accounts@${accountRowId("profile-2", CHAIN, SHARED_ADDRESS)}`]: JSON.stringify(mkAccount("profile-2")),
		})

		// profile-1 is untouched: no ownership flip.
		expect(await accountService.getAccount("profile-1", CHAIN, SHARED_ADDRESS)).toMatchObject({ profileId: "profile-1" })
		expect(await accountService.getAccount("profile-2", CHAIN, SHARED_ADDRESS)).toMatchObject({ profileId: "profile-2" })
	})

	test("a row left at the old address-only key is ignored, not half-honored", async () => {
		// Written by a build that keyed rows by address alone. The field scans would
		// otherwise find it while the composite lookups would not, leaving an
		// account that renders but cannot sign.
		await api.storage.local.set({
			[`nulo:core:accounts@${SHARED_ADDRESS}`]: JSON.stringify(mkAccount("profile-1")),
		})

		expect(await accountService.getAccounts("profile-1", CHAIN)).toHaveLength(0)
		expect(await accountService.getAccount("profile-1", CHAIN, SHARED_ADDRESS)).toBeUndefined()
		// And it does not block writing the canonical row.
		const [restored] = await accountService.restore([mkAccount("profile-1")])
		expect(restored?.restoreError).toBeUndefined()
		expect(await accountService.getAccounts("profile-1", CHAIN)).toHaveLength(1)
	})

	test("deleting one profile's accounts leaves the colliding profile's row intact", async () => {
		await accountService.restore([mkAccount("profile-1")])
		await accountService.restore([mkAccount("profile-2")])

		await accountService.purgeForProfile("profile-1")

		expect(await accountService.getAccount("profile-1", CHAIN, SHARED_ADDRESS)).toBeUndefined()
		expect(await accountService.getAccount("profile-2", CHAIN, SHARED_ADDRESS)).toMatchObject({ profileId: "profile-2" })
	})
})
