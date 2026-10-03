/**
 * The derived-account export decodes the profile master leniently: a junk-suffixed or URL-safe
 * master string reaches the seed derivation as the same field element as the canonical one, under
 * the test runtime's `Buffer` and under the one the extension ships.
 */
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { afterEach, describe, expect, test, vi } from "vitest"
import { BUFFER_BINDINGS, withBuffer } from "../../../../tests/helpers/shipped-buffer"

const state = vi.hoisted(() => ({ seedInputs: [] as string[], master: "" }))

vi.mock("@nulo/wallet-crypto", async (importOriginal) => {
	const original = await importOriginal<typeof import("@nulo/wallet-crypto")>()
	return {
		...original,
		deriveAccountSeed: async (masterFr: { toString(): string }) => {
			state.seedInputs.push(masterFr.toString())
			return new Uint8Array(32)
		},
		deriveSigningKeyFromSeed: () => ({}),
	}
})
vi.mock("@nulo/aztec-runtime/account", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	buildAccountExport: () => ({}),
	serializeAccountExport: () => "body",
}))

import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { svc } from "../composition-harness"
import { AccountService } from "./service"
import { AccountType, accountRowId } from "./spec"

/** 32 bytes whose canonical base64 uses `+`, `/` and `=`. */
const MASTER_BYTES = new Uint8Array(32).map((_, i) => (i % 2 ? 0xfb : 0x0f))
const CANONICAL = Buffer.from(MASTER_BYTES).toString("base64")

async function makeService(): Promise<AccountService> {
	const api = new FakeBrowserApi()
	api.reset()
	const key = accountRowId("p1", 1, "0xA")
	const row = { profileId: "p1", chainId: 1, address: "0xA", index: 0, type: AccountType.Nulo_v1, l1ChainId: 1, name: "D", visible: true }
	await api.storage.local.set({ [`nulo:core:accounts@${key}`]: JSON.stringify(row) })
	const services = new ServiceCollection()
	services.add(
		svc(PROFILE_SERVICE_NAME, {
			onProfileDeleted: new EventHandler(),
			getDeletionState: () => new ProfileDeletionState(),
			exportPlain: async () => state.master,
		}),
	)
	services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {} }))
	const service = new AccountService(new LoggerStore(new ConfigStore()), api)
	services.add(service)
	await services.start()
	return service
}

describe.each(BUFFER_BINDINGS)("derived-account export: master decode (%s Buffer)", (_name, binding) => {
	afterEach(() => vi.unstubAllGlobals())

	test("canonical, junk-suffixed and URL-safe masters reach the seed derivation as the same Fr", async () => {
		expect(CANONICAL).toMatch(/\+/)
		expect(CANONICAL).toMatch(/\//)
		expect(CANONICAL).toMatch(/=$/)
		const expected = Fr.fromBuffer(Buffer.from(MASTER_BYTES)).toString()
		const service = await makeService()
		withBuffer(binding)
		state.seedInputs = []
		for (const master of [CANONICAL, `${CANONICAL}!`, CANONICAL.replaceAll("+", "-").replaceAll("/", "_")]) {
			state.master = master
			await service.exportAccount("p1", 1, "0xA", "pw", false)
		}
		expect(state.seedInputs).toEqual([expected, expected, expected])
	})
})
