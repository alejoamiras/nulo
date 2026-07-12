/**
 * Unit tests for `AccountService.restore` validation + provenance hardening
 * (Phase 3) using `FakeBrowserApi` + `svc` dependency stubs. Real service
 * lifecycle via `ServiceCollection`.
 */

import { beforeEach, describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection } from "@/wallet/base"
import { LoggerStore } from "@/wallet/logger"
import { ConfigStore } from "@/wallet/config"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { svc } from "../composition-harness"
import { AccountService } from "./service"

const mkAccount = (address: string, over: Record<string, unknown> = {}) =>
	({ profileId: "p1", chainId: 1, address, index: 0, type: 0, name: "A", visible: true, ...over }) as never

describe("AccountService.restore — validation + provenance (P3)", () => {
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

	test("(P3/F) rejects an empty/whitespace account address — never written", async () => {
		const [res] = await accountService.restore([mkAccount("   ")])
		expect(res.restoreError).toBeDefined()
		const raw = await api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.startsWith("nulo:core:accounts@"))).toBe(false)
	})

	test("(P3) dedupes an address repeated within the same restore batch", async () => {
		const [ok, dup] = await accountService.restore([mkAccount("0xabc"), mkAccount("0xabc")])
		expect(ok.restoreError).toBeUndefined()
		expect(dup.restoreError).toBeDefined()
	})

	test("(P3/H) rejects a schema-malformed account row — never written + codec-hidden", async () => {
		const [res] = await accountService.restore([mkAccount("0xdef", { visible: "yes" })])
		expect(res.restoreError).toBeDefined()
		const raw = await api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.includes("0xdef"))).toBe(false)
	})

	test("a well-formed unique account restores cleanly", async () => {
		const [res] = await accountService.restore([mkAccount("0x111")])
		expect(res.restoreError).toBeUndefined()
		const raw = await api.storage.local.get(null)
		expect(Object.keys(raw).some((k) => k.includes("0x111"))).toBe(true)
	})
})
