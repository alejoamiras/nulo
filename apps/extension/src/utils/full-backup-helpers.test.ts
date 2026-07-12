import { describe, expect, it } from "vitest"
import { collectRestoreErrors, detectBackupType, readBackupFile, remapIdInBackupData } from "./full-backup-helpers"

describe("detectBackupType", () => {
	it("detects plain JSON object", () => {
		expect(detectBackupType('{"hello":1}')).toBe("plain")
	})
	it("detects plain JSON array", () => {
		expect(detectBackupType("[1,2,3]")).toBe("plain")
	})
	it("trims leading/trailing whitespace before classifying", () => {
		expect(detectBackupType('   { "x": 1 }   ')).toBe("plain")
	})
	it("detects encrypted base64 prefix (first byte 0, length >=13)", () => {
		const bytes = new Uint8Array(20)
		const b64 = btoa(String.fromCharCode(...bytes))
		expect(detectBackupType(b64)).toBe("encrypted")
	})
	it("returns unknown for short base64", () => {
		const bytes = new Uint8Array(5)
		const b64 = btoa(String.fromCharCode(...bytes))
		expect(detectBackupType(b64)).toBe("unknown")
	})
	it("returns unknown for non-base64 garbage", () => {
		expect(detectBackupType("not really base64 ###")).toBe("unknown")
	})
})

describe("readBackupFile", () => {
	function makeFile(text: string, name = "backup.json"): File {
		// jsdom's File doesn't implement .text(); shim it.
		return { name, text: async () => text } as unknown as File
	}

	it("parses a plain JSON backup and extracts profileType", async () => {
		const text = JSON.stringify({ data: { profile: { type: "password" } } })
		const { selection, parseError } = await readBackupFile(makeFile(text))
		expect(parseError).toBeUndefined()
		expect(selection.type).toBe("plain")
		expect(selection.profileType).toBe("password")
		expect(selection.name).toBe("backup.json")
	})

	it("returns parseError for malformed plain JSON", async () => {
		const { selection, parseError } = await readBackupFile(makeFile("{ not: 'json'"))
		expect(parseError).toBeDefined()
		expect(parseError?.title).toMatch(/Invalid JSON/i)
		expect(selection.type).toBe("plain")
	})

	it("treats encrypted backup as raw text", async () => {
		const bytes = new Uint8Array(20)
		const b64 = btoa(String.fromCharCode(...bytes))
		const { selection } = await readBackupFile(makeFile(b64, "backup.txt"))
		expect(selection.type).toBe("encrypted")
		expect(selection.backup).toBe(b64)
		expect(selection.profileType).toBeNull()
	})

	it("classifies garbage as unknown", async () => {
		const { selection } = await readBackupFile(makeFile("hello world ###"))
		expect(selection.type).toBe("unknown")
	})
})

describe("collectRestoreErrors", () => {
	it("returns null for empty/non-array input", () => {
		expect(collectRestoreErrors("network", null as unknown as unknown[])).toBeNull()
		expect(collectRestoreErrors("network", [])).toBeNull()
		expect(collectRestoreErrors("", [{ restoreError: "x" }])).toBeNull()
	})

	it("filters generic services to only failed entries", () => {
		const result = collectRestoreErrors("network", [{ id: "a", restoreError: "boom" }, { id: "b" }, { id: "c", restoreError: "kaput" }])
		expect(result).toEqual([
			{ id: "a", restoreError: "boom" },
			{ id: "c", restoreError: "kaput" },
		])
	})

	it("returns null when no generic entries failed", () => {
		const result = collectRestoreErrors("network", [{ id: "a" }, { id: "b" }])
		expect(result).toBeNull()
	})

	it("preserves networkId for account-state and filters contracts/senders", () => {
		const result = collectRestoreErrors("account-state", [
			{
				networkId: "net1",
				contracts: [{ address: "x", restoreError: "fail" }, { address: "y" }],
				senders: [{ address: "s" }],
			},
			{
				networkId: "net2",
				contracts: [{ address: "z" }],
				senders: [{ address: "t", restoreError: "boom" }],
			},
			{
				networkId: "net3",
				contracts: [{ address: "ok" }],
				senders: [{ address: "ok" }],
			},
		])
		expect(result).toEqual([
			{ networkId: "net1", contracts: [{ address: "x", restoreError: "fail" }], senders: [] },
			{ networkId: "net2", contracts: [], senders: [{ address: "t", restoreError: "boom" }] },
		])
	})
})

describe("remapIdInBackupData", () => {
	it("rewrites the given key in every array entry that has it", () => {
		const data: Record<string, unknown> = {
			account: [
				{ profileId: "old", id: "a1" },
				{ profileId: "old", id: "a2" },
			],
			network: [{ profileId: "old", id: "n1" }],
			meta: { profileId: "old" }, // non-array left untouched
			scalar: 42,
		}
		remapIdInBackupData(data, "profileId", "new")
		expect(data.account).toEqual([
			{ profileId: "new", id: "a1" },
			{ profileId: "new", id: "a2" },
		])
		expect(data.network).toEqual([{ profileId: "new", id: "n1" }])
		expect(data.meta).toEqual({ profileId: "old" })
		expect(data.scalar).toBe(42)
	})

	it("leaves entries without the key unchanged", () => {
		const data: Record<string, unknown> = {
			account: [{ id: "a1" }, { profileId: "old", id: "a2" }],
		}
		remapIdInBackupData(data, "profileId", "new")
		expect(data.account).toEqual([{ id: "a1" }, { profileId: "new", id: "a2" }])
	})

	it("SCOPED form (oldId given): rewrites only rows matching oldId — no cross-graft across networks (P2)", () => {
		// Two networks N1→M1, N2→M2. Each remap must touch ONLY its own rows.
		const data: Record<string, unknown> = {
			"account-state": [
				{ networkId: "N1", x: 1 },
				{ networkId: "N2", x: 2 },
			],
			fpc: [{ networkId: "N2", y: 1 }],
		}
		remapIdInBackupData(data, "networkId", "M1", "N1")
		remapIdInBackupData(data, "networkId", "M2", "N2")
		expect(data["account-state"]).toEqual([
			{ networkId: "M1", x: 1 },
			{ networkId: "M2", x: 2 },
		])
		expect(data.fpc).toEqual([{ networkId: "M2", y: 1 }])
	})

	it("SCOPED form: an unrelated networkId is left alone (no over-write)", () => {
		const data: Record<string, unknown> = { fpc: [{ networkId: "N1" }, { networkId: "N9" }] }
		remapIdInBackupData(data, "networkId", "M1", "N1")
		expect(data.fpc).toEqual([{ networkId: "M1" }, { networkId: "N9" }])
	})

	it("ALL-ROWS form (oldId omitted): still normalizes a hostile row whose profileId differs (P2 guard)", () => {
		const data: Record<string, unknown> = {
			account: [
				{ profileId: "real-old", id: "a1" },
				{ profileId: "0xHOSTILE-FOREIGN", id: "a2" },
			],
		}
		remapIdInBackupData(data, "profileId", "new")
		expect(data.account).toEqual([
			{ profileId: "new", id: "a1" },
			{ profileId: "new", id: "a2" },
		])
	})
})
