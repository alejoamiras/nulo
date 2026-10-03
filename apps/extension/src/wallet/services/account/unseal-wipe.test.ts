/**
 * The two imported-key unseal blocks (signing load, account export) in use-and-wipe order. They
 * wipe in different orders at different points, so each is pinned as it stands: load wipes only
 * after the awaited contract construction, export right after the scalar is built.
 */
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { describe, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({
	log: [] as string[],
	dek: undefined as Uint8Array | undefined,
	sk: undefined as Uint8Array | undefined,
	skFill: 7,
	unsealFails: false,
	gate: undefined as Promise<void> | undefined,
	address: "0xA",
}))

vi.mock("@nulo/wallet-crypto", async (importOriginal) => {
	const original = await importOriginal<typeof import("@nulo/wallet-crypto")>()
	const label = (b: unknown) => (b === state.dek ? "dek" : b === state.sk ? "sk" : "copy")
	return {
		...original,
		zeroize: (b: Uint8Array) => {
			state.log.push(`wipe:${label(b)}`)
			original.zeroize(b)
		},
		unsealImportedSigningKeyV2: async () => {
			state.log.push("unseal")
			if (state.unsealFails) throw new Error("unseal failed")
			state.sk = new Uint8Array(32)
			if (state.skFill === 0xff) state.sk.fill(0xff)
			else state.sk[31] = state.skFill
			return state.sk
		},
	}
})
vi.mock("@nulo/aztec-runtime/account", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	NuloAccount: {
		fromSigningKey: async () => {
			state.log.push("construct")
			if (state.gate) await state.gate
			state.log.push("constructed")
			return { address: { toString: () => state.address } }
		},
	},
	buildAccountExport: () => {
		state.log.push("build")
		return {}
	},
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
import { accountRowId } from "./spec"

async function makeHarness(over: { skFill?: number; unsealFails?: boolean; address?: string; gate?: Promise<void> } = {}) {
	Object.assign(state, { log: [], dek: undefined, sk: undefined, skFill: 7, unsealFails: false, gate: undefined, address: "0xA" }, over)
	const api = new FakeBrowserApi()
	api.reset()
	const key = accountRowId("p1", 1, "0xA")
	const row = { profileId: "p1", chainId: 1, address: "0xA", index: 0, type: 1, l1ChainId: 1, name: "I", visible: true }
	await api.storage.local.set({
		[`nulo:core:accounts@${key}`]: JSON.stringify(row),
		[`nulo:core:imported-account-keys@${key}`]: JSON.stringify({
			profileId: "p1",
			chainId: 1,
			address: "0xA",
			encryptedSigningKey: "s",
		}),
	})
	const freshDek = async () => {
		state.dek = new Uint8Array(32).fill(1)
		return state.dek
	}
	const services = new ServiceCollection()
	services.add(
		svc(PROFILE_SERVICE_NAME, {
			onProfileDeleted: new EventHandler(),
			getDeletionState: () => new ProfileDeletionState(),
			getProfileDek: freshDek,
			exportImportedKeysDek: freshDek,
			exportPlain: async () => Buffer.from(new Uint8Array(32).fill(9)).toString("base64"),
		}),
	)
	services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {} }))
	const service = new AccountService(new LoggerStore(new ConfigStore()), api)
	services.add(service)
	await services.start()
	return service
}

describe("signing load: wipes DEK, plaintext, copy only after construction and the address check", () => {
	test("success with construction parked: nothing is wiped until it resolves", async () => {
		let release!: () => void
		const gate = new Promise<void>((r) => {
			release = r
		})
		const service = await makeHarness({ gate })
		const run = service.getAccountContract("p1", 1, "0xA")
		await vi.waitFor(() => expect(state.log).toContain("construct"))
		expect(state.log).toEqual(["unseal", "construct"])
		release()
		await run
		expect(state.log).toEqual(["unseal", "construct", "constructed", "wipe:dek", "wipe:sk", "wipe:copy"])
		expect([state.dek, state.sk].every((b) => b?.every((x) => x === 0))).toBe(true)
	})

	test("an address mismatch wipes the same three, after construction", async () => {
		const service = await makeHarness({ address: "0xB" })
		await expect(service.getAccountContract("p1", 1, "0xA")).rejects.toThrow(/^Imported account 0xA is unusable: address mismatch$/)
		expect(state.log).toEqual(["unseal", "construct", "constructed", "wipe:dek", "wipe:sk", "wipe:copy"])
	})

	test("a non-canonical scalar never constructs and still wipes all three", async () => {
		const service = await makeHarness({ skFill: 0xff })
		await expect(service.getAccountContract("p1", 1, "0xA")).rejects.toThrow(
			/^Imported account 0xA is unusable: signing key could not be recovered$/,
		)
		expect(state.log).toEqual(["unseal", "wipe:dek", "wipe:sk", "wipe:copy"])
	})

	test("an unseal rejection wipes the DEK, the only buffer that exists", async () => {
		const service = await makeHarness({ unsealFails: true })
		await expect(service.getAccountContract("p1", 1, "0xA")).rejects.toThrow(
			/^Imported account 0xA is unusable: signing key could not be recovered$/,
		)
		expect(state.log).toEqual(["unseal", "wipe:dek"])
	})
})

describe("account export: wipes plaintext, copy, DEK right after the scalar is built", () => {
	test("success wipes before the envelope is built", async () => {
		const service = await makeHarness()
		expect(await service.exportAccount("p1", 1, "0xA", "pw", false)).toBe("body")
		expect(state.log).toEqual(["unseal", "wipe:sk", "wipe:copy", "wipe:dek", "build"])
	})

	test("a non-canonical scalar propagates the field error raw, after the same wipes", async () => {
		const service = await makeHarness({ skFill: 0xff })
		await expect(service.exportAccount("p1", 1, "0xA", "pw", false)).rejects.toThrow(
			/^Value 0xf{64} is greater or equal to field modulus\.$/,
		)
		expect(state.log).toEqual(["unseal", "wipe:sk", "wipe:copy", "wipe:dek"])
	})

	test("an unseal rejection propagates raw and wipes only the DEK", async () => {
		const service = await makeHarness({ unsealFails: true })
		await expect(service.exportAccount("p1", 1, "0xA", "pw", false)).rejects.toThrow(/^unseal failed$/)
		expect(state.log).toEqual(["unseal", "wipe:dek"])
	})
})
