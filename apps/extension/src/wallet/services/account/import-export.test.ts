/**
 * AccountService import/export orchestration (P5). The real address derivation needs bb WASM, so
 * `NuloAccount` is mocked to a deterministic address = `0xADDR<signingKeyHex>`; the envelope
 * (buildAccountExport/parseAccountExport) and the imported-key box are REAL. This pins the
 * service-level contract: service-side auth, address-confirm, duplicate rejection, key-row-first
 * write, the fail-closed Imported signing branch, and purge — the crypto itself is covered by the
 * node-env KATs in aztec-runtime + wallet-crypto.
 */
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { beforeEach, describe, expect, test, vi } from "vitest"

const addrFor = (sk: GrumpkinScalar) => `0xADDR${sk.toString().slice(2, 18)}`

vi.mock("@nulo/aztec-runtime/account", async (importOriginal) => {
	const original = await importOriginal<typeof import("@nulo/aztec-runtime/account")>()
	return {
		...original,
		NuloAccount: {
			fromSigningKey: vi.fn(async (sk: GrumpkinScalar) => ({ address: { toString: () => addrFor(sk) } })),
			new: vi.fn(async () => ({ address: { toString: () => "0xDERIVED" } })),
		},
	}
})

import { buildAccountExport, serializeAccountExport } from "@nulo/aztec-runtime/account"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { svc } from "../composition-harness"
import { AccountService } from "./service"
import { AccountType, ImportedAccountUnusableError } from "./spec"

const MASTER_B64 = Buffer.from(new Uint8Array(32).fill(9)).toString("base64")
const CHAIN = 0
const L1 = 31337

async function build() {
	const api = new FakeBrowserApi()
	api.reset()
	const services = new ServiceCollection()
	services.add(
		svc(PROFILE_SERVICE_NAME, {
			onProfileDeleted: new EventHandler(),
			// getProfileSecret → session-gated master Fr (32 bytes of 9).
			getProfileSecret: async () => (await import("@aztec/foundation/curves/bn254")).Fr.fromBuffer(Buffer.from(MASTER_B64, "base64")),
			// exportPlain(id, password) → base64 master iff the password is right (service-side auth).
			exportPlain: async (_id: string, password?: string) => {
				if (password !== "correct-pass") throw new Error("Invalid password")
				return MASTER_B64
			},
		}),
	)
	services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {}, getL1ChainIdStored: async () => L1 }))
	const account = new AccountService(new LoggerStore(new ConfigStore()), api)
	services.add(account)
	await services.start()
	return { api, account }
}

const SK = GrumpkinScalar.fromString("0x000000000000000000000000000000000000000000000000000000000000002a")
const exportFile = () => serializeAccountExport(buildAccountExport(SK, L1, addrFor(SK)))

describe("AccountService import/export", () => {
	beforeEach(() => vi.clearAllMocks())

	test("import → the account signs (getAccountContract loads + decrypts the stored key)", async () => {
		const { account } = await build()
		const imported = await account.importAccount("p1", CHAIN, exportFile(), addrFor(SK), "")
		expect(imported.type).toBe(AccountType.Imported)
		expect(imported.address).toBe(addrFor(SK))
		// The signing path round-trips: decrypt stored key → fromSigningKey → address matches.
		const contract = await account.getAccountContract("p1", CHAIN, addrFor(SK))
		expect(contract.address.toString()).toBe(addrFor(SK))
	})

	test("rejects an import whose confirmed address differs from the file's key", async () => {
		const { account } = await build()
		await expect(account.importAccount("p1", CHAIN, exportFile(), "0xWRONG", "")).rejects.toThrow(
			/does not match the confirmed address/,
		)
	})

	test("rejects a duplicate import", async () => {
		const { account } = await build()
		await account.importAccount("p1", CHAIN, exportFile(), addrFor(SK), "")
		await expect(account.importAccount("p1", CHAIN, exportFile(), addrFor(SK), "")).rejects.toThrow(/already in your wallet/)
	})

	test("a tampered stored key quarantines ONLY that account (fail-closed, no profile block)", async () => {
		const { api, account } = await build()
		await account.importAccount("p1", CHAIN, exportFile(), addrFor(SK), "")
		// Corrupt the stored encrypted key row directly.
		const all = await api.storage.local.get()
		const [key, raw] = Object.entries(all).find(([k]) => k.startsWith("nulo:core:imported-account-keys@"))!
		const row = JSON.parse(raw as string)
		row.encryptedSigningKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAA"
		await api.storage.local.set({ [key]: JSON.stringify(row) })
		await expect(account.getAccountContract("p1", CHAIN, addrFor(SK))).rejects.toBeInstanceOf(ImportedAccountUnusableError)
	})

	test("export requires the profile password (service-side auth)", async () => {
		const { account } = await build()
		await account.importAccount("p1", CHAIN, exportFile(), addrFor(SK), "")
		await expect(account.exportAccount("p1", CHAIN, addrFor(SK), "wrong-pass", false)).rejects.toThrow()
		const body = await account.exportAccount("p1", CHAIN, addrFor(SK), "correct-pass", false)
		expect(body).toContain("nulo-account-export")
	})

	test("the key row is purged when its chain is cleared", async () => {
		const { api, account } = await build()
		await account.importAccount("p1", CHAIN, exportFile(), addrFor(SK), "")
		await account.clearChainState("p1", CHAIN)
		const keys = Object.keys(await api.storage.local.get()).filter((k) => k.startsWith("nulo:core:imported-account-keys@"))
		expect(keys).toHaveLength(0)
	})
})
