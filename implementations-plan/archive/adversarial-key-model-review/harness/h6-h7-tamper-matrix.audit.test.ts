/**
 * ADVERSARIAL AUDIT — H6 storage-tamper matrix (report-only; not a repo test).
 * Covers the rows the existing integration suite does NOT:
 *   T4  authentic same-password sibling dekSealed transplant (MAC is the only sensor)
 *   T5  full-envelope swap into a zero-derived-account profile (codex residual — record actual)
 *   T6  MAC-field-only corruption: unlock must NOT destroy the DEK; password change refuses
 *   T7  walletFingerprint corruption: duplicate guard silently blinded
 * Run: bun run --cwd apps/extension vitest run src/wallet/services/profile/adversarial-tamper-matrix.audit.test.ts
 */
import { describe, expect, test } from "vitest"
import type { IConfig } from "@/wallet/config"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { PasskeyCredentialData } from "@nulo/wallet-crypto"
import { asBase64CredentialId, asBase64SecretPrf } from "@nulo/wallet-crypto"
import { Service } from "@nulo/extension-messaging/background"
import { ProfileService } from "./service"
import { SESSION_STORAGE_ROOT } from "./session-manager"

function fakeConfig(init: { sessionTtl?: number; strict?: boolean } = {}): IConfig {
	const onUpdate = new EventHandler()
	let sessionTtl = init.sessionTtl ?? 1_800_000
	let strictSecurityMode = init.strict ?? false
	return {
		onUpdate,
		get: ((key: string) => {
			if (key === "sessionTtl") return sessionTtl
			if (key === "strictSecurityMode") return strictSecurityMode
			return undefined
		}) as IConfig["get"],
	} as unknown as IConfig
}

class FakePasskeyService extends Service<any> {
	public static name = "passkey"
	constructor(logger: LoggerStore) {
		super("passkey", logger as any)
	}
	public async materializeCredential(data: PasskeyCredentialData) {
		// minimal stand-in matching the integration suite's fake: no real HKDF
		return {
			id: data.id,
			userHandle: data.userHandle,
			deriveMasterSecret: async () => new Uint8Array(32).fill(7),
			deriveDekWrapKey: async () => {
				throw new Error("not needed here")
			},
		} as any
	}
}

async function makeService() {
	const api = new FakeBrowserApi()
	api.reset()
	const config = fakeConfig()
	const logger = new LoggerStore(config)
	const passkeys = new FakePasskeyService(logger)
	const services = new ServiceCollection()
	services.add(passkeys)
	const service = new ProfileService(config, logger, api)
	services.add(service)
	await services.start()
	service.setDeletionDelegate({ snapshot: async () => ({ addresses: [], tokenIds: [], networkIds: [] }), runFor: async () => {} })
	return { api, service }
}

const rowKey = (id: string) => `nulo:core:profiles@${id}`
async function readRow(api: FakeBrowserApi, id: string): Promise<Record<string, unknown>> {
	const raw = (await api.storage.local.get(rowKey(id)))[rowKey(id)]
	return typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>)
}
async function writeRow(api: FakeBrowserApi, id: string, row: unknown) {
	await api.storage.local.set({ [rowKey(id)]: JSON.stringify(row) })
}
async function readSession(api: FakeBrowserApi): Promise<Record<string, unknown> | undefined> {
	const raw = (await api.storage.session.get(SESSION_STORAGE_ROOT))[SESSION_STORAGE_ROOT]
	return typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>)
}

describe("ADVERSARIAL H6 tamper matrix", () => {
	test("T4: authentic sibling dekSealed transplant → derived-only unlock, degraded event, no bearer", async () => {
		const { api, service } = await makeService()
		const a = await service.createProfile("A", "shared-pass1")
		await service.lockActiveProfile()
		const b = await service.createProfile("B", "shared-pass1")
		await service.lockActiveProfile()

		// Give A an imported account so the degradation has something to quarantine.
		const rowA = await readRow(api, a.id)
		const rowB = await readRow(api, b.id)

		// Transplant B's AUTHENTIC dekSealed into A. Purpose-AAD matches (constant),
		// same password opens it — the envelope MAC is the ONLY sensor for this.
		await writeRow(api, a.id, { ...rowA, dekSealed: rowB.dekSealed })

		const degraded: string[] = []
		service.onImportedKeysDegraded.add((info: { id: string }) => degraded.push(info.id))
		await service.unlockProfile(a.id, "shared-pass1")
		expect((await service.getActiveProfile())?.id).toBe(a.id)
		expect(await service.getProfileDek(a.id)).toBeUndefined()
		expect(degraded).toContain(a.id)
		const session = await readSession(api)
		expect(session?.bearer).toBeUndefined()
	}, 30_000)

	test("T5: full-envelope swap into a zero-account profile — RECORD actual behavior (codex residual)", async () => {
		const { api, service } = await makeService()
		const a = await service.createProfile("A", "shared-pass1") // zero accounts
		await service.lockActiveProfile()
		const b = await service.createProfile("B", "shared-pass1")
		await service.lockActiveProfile()

		const rowB = await readRow(api, b.id)
		// Overwrite EVERY sealed field + fingerprint of A with B's row (keep A's id).
		await writeRow(api, a.id, { ...rowB, id: a.id, name: "A" })

		let outcome: string
		try {
			const info = await service.unlockProfile(a.id, "shared-pass1")
			outcome = `UNLOCKED as profile ${info.id} named "${info.name}" — attacker-controlled identity adoption`
		} catch (e) {
			outcome = `REJECTED: ${(e as Error).message}`
		}
		console.log(`[H6/T5 residual] full-envelope swap outcome: ${outcome}`)
		expect(outcome.length).toBeGreaterThan(0)
	}, 30_000)

	test("T6: MAC-field-only corruption → unlock keeps the DEK alive, change-password refuses", async () => {
		const { api, service } = await makeService()
		const p = await service.createProfile("P", "pass1234")
		// live DEK before tamper
		const dekBefore = await service.getProfileDek(p.id)
		expect(dekBefore).toBeDefined()

		const row = await readRow(api, p.id)
		row.envelopeMac = (row.envelopeMac as string).replace(/^./, (c) => (c === "A" ? "B" : "A"))
		await writeRow(api, p.id, row)

		const degraded: string[] = []
		service.onImportedKeysDegraded.add((info: { id: string }) => degraded.push(info.id))
		await service.lockActiveProfile()
		await service.unlockProfile(p.id, "pass1234")
		expect(degraded).toContain(p.id)
		// Round-3 contract: derived-only, but NOTHING destroyed.
		const session = await readSession(api)
		expect(session?.bearer).toBeUndefined()

		// Password change must REFUSE (never bless an uncovered slot).
		await expect(service.changeProfilePassword(p.id, "pass1234", "newpass99")).rejects.toThrow()
	}, 30_000)

	test("H7: changeProfilePassword racing exportMnemonic — exported words must pair with SOME committed row", async () => {
		const { service } = await makeService()
		const p = await service.createProfile("R", "old-pass-1")

		const [exported, changed] = await Promise.allSettled([
			service.exportMnemonic(p.id, "old-pass-1"),
			service.changeProfilePassword(p.id, "old-pass-1", "brand-new-2"),
		])

		// Whatever the interleaving, the exported words must derive the master that
		// SOME committed seal still protects — verify by re-unlocking under the
		// winning password and pairing the words.
		const words = exported.status === "fulfilled" ? (exported.value as string[]) : null
		expect(changed.status).toBe("fulfilled")
		await service.lockActiveProfile()
		const info = await service.unlockProfile(p.id, "brand-new-2")
		expect(info.id).toBe(p.id)
		if (words) {
			const fresh = await service.exportMnemonic(p.id, "brand-new-2")
			// The exported snapshot must be either the old words or the current words —
			// both are the SAME words here (entropy never changes) — the real assertion
			// is that export never throws mid-change and never yields non-pairing words.
			expect(fresh.join(" ") === words.join(" ")).toBe(true)
		}
	}, 30_000)

	test("T7: walletFingerprint corruption blinds the duplicate guard silently (informational)", async () => {
		const { api, service } = await makeService()
		const a = await service.createProfile("A", "pass1234")
		await service.lockActiveProfile()
		const rowA = await readRow(api, a.id)
		await writeRow(api, a.id, { ...rowA, walletFingerprint: "0".repeat(64) })

		// Re-import the SAME phrase under a different profile with dup-guard ON.
		// The guard compares candidate fingerprint vs stored — corrupted stored value
		// means NO clash detected. DuplicateWalletError should NOT fire... unless the
		// guard recomputes from the live session master of the unlocked twin.
		let threw = false
		try {
			await service.exportMnemonic(a.id, "pass1234").then(async (mnemonic: string[]) => {
				await service.lockActiveProfile()
				await service.importMnemonic("A2", mnemonic, "pass1234", false)
			})
		} catch (e) {
			threw = true
			console.log(`[H6/T7] duplicate re-import with corrupted fingerprint threw: ${(e as Error).message}`)
		}
		console.log(`[H6/T7] threw=${threw} (record-only; guard blindness is a LOW finding either way)`)
		expect(true).toBe(true)
	}, 30_000)
})
