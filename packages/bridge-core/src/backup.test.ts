import { describe, expect, it } from "vitest"
import { EncryptionKey } from "@nulo/wallet-crypto"
import { type BridgeBackupFile, openBridgeBackup, parseBackupFile, sealBridgeBackup, validateBackupRecord } from "./backup"
import type { DepositJournalRecord, WithdrawJournalRecord } from "./journal"

const SEALER = "0xef4d9e1f4e9e2dd9e747b53f4be3d04bfa935f2d"
const DEPLOY = { chainId: 11155111, portal: "0xportal", bridge: "0xbridge" }

const key = await EncryptionKey.fromPassword("0xsig-deterministic")
const otherKey = await EncryptionKey.fromPassword("0xsig-other-wallet")

function publicDeposit(over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id: "0xdep",
		direction: "deposit",
		isPrivate: false,
		amount: "100000000",
		createdAt: 1,
		updatedAt: 2,
		...DEPLOY,
		recipient: "0xrecipient",
		secretHashHex: "0xdep",
		secret: "0xplaintext-bearer-secret",
		depositTxHash: "0xtx",
		leafIndex: "7",
		...over,
	}
}

function privateDeposit(): DepositJournalRecord {
	return publicDeposit({
		id: "0xpriv",
		secretHashHex: "0xpriv",
		isPrivate: true,
		secret: undefined,
		sealedEnvelope: "inner-blob",
		sealerL1: SEALER,
	})
}

function withdraw(over: Partial<WithdrawJournalRecord> = {}): WithdrawJournalRecord {
	return {
		schema: 1,
		id: "0xexit",
		direction: "withdraw",
		isPrivate: false,
		amount: "40000000",
		createdAt: 1,
		updatedAt: 2,
		...DEPLOY,
		recipientL1: SEALER,
		exitTxHash: "0xexit",
		...over,
	}
}

describe("bridge backup files", () => {
	it("round-trips public deposit, private deposit, and withdraw records", async () => {
		for (const rec of [publicDeposit(), privateDeposit(), withdraw()]) {
			const file = await sealBridgeBackup(key, rec, SEALER)
			expect(file.format).toBe("nulo-bridge-backup")
			expect(file.id).toBe(rec.id)
			const reopened = await openBridgeBackup(key, file)
			expect(reopened).toEqual(rec)
		}
	})

	it("the file NEVER contains the plaintext claim secret (seal-everything)", async () => {
		const file = await sealBridgeBackup(key, publicDeposit(), SEALER)
		expect(JSON.stringify(file)).not.toContain("0xplaintext-bearer-secret")
	})

	it("wrong wallet key refuses with the attribution-honest copy", async () => {
		const file = await sealBridgeBackup(key, publicDeposit(), SEALER)
		expect(openBridgeBackup(otherKey, file)).rejects.toThrow(
			/wasn't sealed by the connected Ethereum account, or the file is corrupted/,
		)
	})

	it("a tampered blob refuses (GCM auth)", async () => {
		const file = await sealBridgeBackup(key, publicDeposit(), SEALER)
		const tampered: BridgeBackupFile = { ...file, blob: `${file.blob.slice(0, -4)}AAAA` }
		expect(openBridgeBackup(key, tampered)).rejects.toThrow(/corrupted|tampered/)
	})

	it("a swapped header (unauthenticated) is caught against the sealed copies", async () => {
		const file = await sealBridgeBackup(key, publicDeposit(), SEALER)
		expect(openBridgeBackup(key, { ...file, id: "0xother" })).rejects.toThrow(/label doesn't match its sealed contents/)
		expect(openBridgeBackup(key, { ...file, chainId: 1 })).rejects.toThrow(/label doesn't match/)
		expect(openBridgeBackup(key, { ...file, direction: "withdraw" })).rejects.toThrow(/label doesn't match/)
	})

	it("a private deposit without its sealed envelope refuses to export (no false recovery promise)", async () => {
		const unsealed = publicDeposit({ id: "0xunsealed", secretHashHex: "0xunsealed", isPrivate: true, secret: undefined })
		expect(sealBridgeBackup(key, unsealed, SEALER)).rejects.toThrow(/hasn't sealed its recovery secret/)
	})

	it("a swapped sealerL1 header on a private deposit is caught against the sealed copy", async () => {
		const file = await sealBridgeBackup(key, privateDeposit(), SEALER)
		await expect(openBridgeBackup(key, { ...file, sealerL1: "0xevil" })).rejects.toThrow(/label doesn't match/)
	})

	it("provisional withdraws refuse at seal AND at parse", async () => {
		const prov = withdraw({ id: "wd-pending-abc12345", exitTxHash: undefined })
		expect(sealBridgeBackup(key, prov, SEALER)).rejects.toThrow(/nothing restorable/)
		const forged = { ...(await sealBridgeBackup(key, withdraw(), SEALER)), id: "wd-pending-abc12345" }
		expect(() => parseBackupFile(forged)).toThrow(/half-started withdraw/)
	})

	it("parseBackupFile ladder: junk, foreign format, future version, malformed fields", () => {
		expect(() => parseBackupFile("not json {")).toThrow(/not a Nulo bridge recovery file/)
		expect(() => parseBackupFile({ format: "something-else" })).toThrow(/not a Nulo bridge recovery file/)
		expect(() => parseBackupFile({ format: "nulo-bridge-backup", v: 2 })).toThrow(/newer version/)
		expect(() => parseBackupFile({ format: "nulo-bridge-backup", v: 1, chainId: "nope" })).toThrow(/malformed/)
	})

	it("schema-2 fuel records validate strictly; malformed fuel rejects restore", () => {
		const fuel = {
			amount: "250000000000000000",
			secret: "0xf00d",
			secretHashHex: "0xfeed",
			minOutput: "450000000000000000000",
			leafIndex: "7",
			received: "487000000000000000000",
			claimAttempt: true,
			consumed: false,
		}
		const fueled = publicDeposit({ schema: 2, fuel } as never)
		expect(validateBackupRecord(fueled)).toEqual(fueled)
		// Tampered fuel amount (non-decimal) rejects.
		expect(() => validateBackupRecord(publicDeposit({ schema: 2, fuel: { ...fuel, amount: "12.5" } } as never))).toThrow(
			/not a valid bridge record/,
		)
		// Missing secret rejects.
		expect(() => validateBackupRecord(publicDeposit({ schema: 2, fuel: { ...fuel, secret: "" } } as never))).toThrow(
			/not a valid bridge record/,
		)
		// Schema 2 without a fuel block is a contradiction.
		expect(() => validateBackupRecord(publicDeposit({ schema: 2 } as never))).toThrow(/not a valid bridge record/)
		// Schema 1 carrying fuel is a contradiction.
		expect(() => validateBackupRecord(publicDeposit({ fuel } as never))).toThrow(/not a valid bridge record/)
		// Withdraws never carry schema 2.
		expect(() => validateBackupRecord({ ...withdraw(), schema: 2 })).toThrow(/not a valid bridge record/)
	})

	it("validateBackupRecord rejects junk shapes the journal's shallow parser would let through", () => {
		expect(() => validateBackupRecord({ id: "0x1", direction: "deposit" })).toThrow(/not a valid bridge record/)
		expect(() => validateBackupRecord(publicDeposit({ amount: "12.5" as never }))).toThrow(/not a valid bridge record/)
		expect(() => validateBackupRecord({ ...withdraw(), recipientL1: undefined })).toThrow(/not a valid bridge record/)
		// And accepts the real shapes.
		expect(validateBackupRecord(publicDeposit())).toEqual(publicDeposit())
	})

	it("a forged payload (valid JSON, wrong inner marker) refuses", async () => {
		const raw = JSON.stringify({ notBk: true })
		const enc = new TextEncoder().encode(raw)
		const blob = Buffer.from(await key.encrypt(enc)).toString("base64")
		const file = await sealBridgeBackup(key, publicDeposit(), SEALER)
		expect(openBridgeBackup(key, { ...file, blob })).rejects.toThrow(/not a valid bridge record/)
	})
})
