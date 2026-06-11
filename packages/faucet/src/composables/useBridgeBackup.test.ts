import type { DepositJournalRecord } from "@nulo/bridge-core"
import { recoveryKeyFromSignature, recoveryKeyMessage, sealBridgeBackup } from "@nulo/bridge-core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ref } from "vue"

const signMessage = vi.fn(async ({ message }: { message: string }) => `0xsig-for:${message.length}`)
const retainedKey = vi.fn((_id: string) => undefined as unknown)

vi.mock("@/contracts/bridge-deployments", () => ({
	L1_PORTAL: "0xportal",
	BRIDGE: { toString: () => "0xbridge" },
}))
vi.mock("./useL1Wallet", () => ({
	useL1Wallet: () => ({
		address: ref("0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d"),
		ensureWalletClient: () => ({ signMessage }),
	}),
}))
vi.mock("./useDeposit", () => ({
	getRetainedSealKey: (id: string) => retainedKey(id),
	providerFingerprint: () => "rabby",
}))

import { __resetJournalForTests, addRecord, connectJournalDeps, useBridgeJournal } from "./useBridgeJournal"
import { useBridgeBackup } from "./useBridgeBackup"

const DEPLOY = { chainId: 11155111, portal: "0xportal", bridge: "0xbridge" }

function publicDeposit(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xbk",
		direction: "deposit",
		isPrivate: false,
		amount: "100000000",
		createdAt: 1,
		updatedAt: 2,
		...DEPLOY,
		recipient: "0xrecipient",
		secretHashHex: "0xbk",
		secret: "0xbearer",
		leafIndex: "7",
		...over,
	}
}

function memKV() {
	const store = new Map<string, string>()
	return {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
	}
}

describe("useBridgeBackup", () => {
	beforeEach(() => {
		vi.restoreAllMocks() // prototype spies (anchor click) must not leak across tests.
		__resetJournalForTests()
		connectJournalDeps({ kv: memKV(), now: () => 999 })
		signMessage.mockReset() // implementations persist past mockClear - reset + re-prime.
		signMessage.mockImplementation(async ({ message }: { message: string }) => `0xsig-for:${message.length}`)
		retainedKey.mockReturnValue(undefined)
		localStorage.clear()
		// jsdom lacks createObjectURL; the download path needs both stubs.
		URL.createObjectURL = vi.fn(() => "blob:fake")
		URL.revokeObjectURL = vi.fn()
	})

	it("first export on an untrusted wallet runs the determinism self-test (two signatures), then trusts", async () => {
		const clicks: string[] = []
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
			clicks.push(this.download)
		})
		const backup = useBridgeBackup()
		await backup.exportBridge(publicDeposit())
		expect(signMessage).toHaveBeenCalledTimes(2)
		expect(clicks).toEqual(["nulo-bridge-deposit-0xbk.json"])

		signMessage.mockClear()
		await backup.exportBridge(publicDeposit({ id: "0xbk2", secretHashHex: "0xbk2" }))
		expect(signMessage).toHaveBeenCalledTimes(1) // trusted now - single signature.
	})

	it("a non-deterministic signer aborts the export BEFORE any file exists", async () => {
		let n = 0
		signMessage.mockImplementation(async () => `0xrandom-${n++}`)
		const clicks = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
		await expect(useBridgeBackup().exportBridge(publicDeposit())).rejects.toThrow(/signs non-deterministically/)
		expect(clicks).not.toHaveBeenCalled()
	})

	it("a same-session retained key exports with ZERO signatures", async () => {
		const key = await recoveryKeyFromSignature("0xretained-sig")
		retainedKey.mockReturnValue(key)
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
		await useBridgeBackup().exportBridge(publicDeposit())
		expect(signMessage).not.toHaveBeenCalled()
	})

	it("restore ladder: foreign deployment and duplicates refuse before any signature", async () => {
		const backup = useBridgeBackup()
		const key = await recoveryKeyFromSignature("0xany")
		const foreign = await sealBridgeBackup(key, publicDeposit({ chainId: 1 }), "0xme")
		await expect(backup.restoreFile(JSON.stringify(foreign))).rejects.toThrow(/different bridge deployment/)

		addRecord(publicDeposit())
		const dup = await sealBridgeBackup(key, publicDeposit(), "0xme")
		await expect(backup.restoreFile(JSON.stringify(dup))).rejects.toThrow(/already tracked/)
		expect(signMessage).not.toHaveBeenCalled()
	})

	it("restore happy path: one signature, record lands in the journal as a normal idle card", async () => {
		const rec = publicDeposit()
		// Seal with the key the mocked signer will actually derive for this record's message.
		const message = recoveryKeyMessage({ chainId: rec.chainId, portal: rec.portal, bridge: rec.bridge, secretHashHex: rec.id })
		const key = await recoveryKeyFromSignature(`0xsig-for:${message.length}`)
		const file = await sealBridgeBackup(key, rec, "0xme")

		const restored = await useBridgeBackup().restoreFile(JSON.stringify(file))
		expect(restored.id).toBe(rec.id)
		expect(signMessage).toHaveBeenCalledTimes(1)
		const { records, runtime } = useBridgeJournal()
		// The journal re-stamps updatedAt on write - everything else round-trips exactly.
		const { updatedAt: _stamped, ...stored } = records.value.find((r) => r.id === rec.id) as DepositJournalRecord
		const { updatedAt: _orig, ...original } = rec
		expect(stored).toEqual(original)
		expect(runtime.value[rec.id]?.busy).toBeUndefined() // idle - no auto-claim.
	})

	it("restore with the wrong wallet's file refuses with the attribution-honest copy", async () => {
		const rec = publicDeposit()
		const file = await sealBridgeBackup(await recoveryKeyFromSignature("0xsomeone-else"), rec, "0xother")
		await expect(useBridgeBackup().restoreFile(JSON.stringify(file))).rejects.toThrow(/wasn't sealed by the connected|corrupted/)
		expect(useBridgeJournal().records.value).toHaveLength(0)
	})
})
